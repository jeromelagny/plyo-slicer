#include "PlyoCC2Logic.hpp"

#include "PlyoJson.hpp"

#include <algorithm>
#include <cstdint>

namespace Plyo { namespace CC2Logic {

namespace {

void put_string(std::string& out, const std::string& s)
{
    out.push_back(char((s.size() >> 8) & 0xFF));
    out.push_back(char(s.size() & 0xFF));
    out += s;
}

std::string with_header(unsigned char first, const std::string& body)
{
    std::string out(1, char(first));
    size_t      n = body.size();
    do {
        unsigned char digit = n % 128;
        n /= 128;
        out.push_back(char(n ? (digit | 0x80) : digit));
    } while (n);
    return out + body;
}

} // namespace

std::string connect_packet(const std::string& client_id, const std::string& user, const std::string& password)
{
    std::string body;
    put_string(body, "MQTT");
    body.push_back(char(4));                      // niveau du protocole : MQTT 3.1.1
    body.push_back(char(0xC2));                   // nom d'utilisateur + mot de passe + session propre
    body.push_back(char(0));
    body.push_back(char(60));                     // maintien de la connexion : 60 s
    put_string(body, client_id);
    put_string(body, user);
    put_string(body, password);
    return with_header(0x10, body);
}

std::string subscribe_packet(unsigned short packet_id, const std::vector<std::string>& topics)
{
    std::string body;
    body.push_back(char(packet_id >> 8));
    body.push_back(char(packet_id & 0xFF));
    for (const std::string& t : topics) {
        put_string(body, t);
        body.push_back(char(0)); // QoS 0
    }
    return with_header(0x82, body);
}

std::string publish_packet(const std::string& topic, const std::string& payload)
{
    std::string body;
    put_string(body, topic);
    return with_header(0x30, body + payload);
}

bool parse_packet(const std::string& buffer, size_t& consumed, Packet& out)
{
    if (buffer.size() < 2)
        return false;
    size_t pos = 1, length = 0, multiplier = 1;
    for (int i = 0; i < 4; ++i) {
        if (pos >= buffer.size())
            return false;
        const unsigned char digit = static_cast<unsigned char>(buffer[pos++]);
        length += (digit & 0x7F) * multiplier;
        multiplier *= 128;
        if (!(digit & 0x80))
            break;
        if (i == 3)
            return false; // longueur impossible
    }
    if (buffer.size() < pos + length)
        return false;
    out.type     = static_cast<unsigned char>(buffer[0]) >> 4;
    out.body     = buffer.substr(pos, length);
    consumed     = pos + length;
    return true;
}

bool publish_fields(const Packet& packet, std::string& topic, std::string& payload)
{
    if (packet.type != 3 || packet.body.size() < 2)
        return false;
    const size_t topic_len = (static_cast<unsigned char>(packet.body[0]) << 8) | static_cast<unsigned char>(packet.body[1]);
    if (packet.body.size() < 2 + topic_len)
        return false;
    topic   = packet.body.substr(2, topic_len);
    payload = packet.body.substr(2 + topic_len);
    return true;
}

std::string topic_api_register(const std::string& sn) { return "elegoo/" + sn + "/api_register"; }
std::string topic_register_response(const std::string& sn, const std::string& client_id) { return "elegoo/" + sn + "/" + client_id + "_req/register_response"; }
std::string topic_api_request(const std::string& sn, const std::string& client_id) { return "elegoo/" + sn + "/" + client_id + "/api_request"; }
std::string topic_api_response(const std::string& sn, const std::string& client_id) { return "elegoo/" + sn + "/" + client_id + "/api_response"; }

std::string register_payload(const std::string& client_id)
{
    return nlohmann::json{{"client_id", client_id}, {"request_id", client_id + "_req"}}.dump();
}

bool is_register_ok(const std::string& payload)
{
    const nlohmann::json j = nlohmann::json::parse(payload, nullptr, false);
    return j.is_object() && Json::str(j, "error") == "ok";
}

std::string start_print_payload(int id, const std::string& filename, const nlohmann::json& slot_map)
{
    nlohmann::json params = {{"filename", filename}, {"storage_media", "local"}};
    if (slot_map.is_array() && !slot_map.empty())
        params["config"] = {{"slot_map", slot_map}};
    return nlohmann::json{{"id", id}, {"method", 1020}, {"params", params}}.dump();
}

std::string canvas_read_payload(int id)
{
    return nlohmann::json{{"id", id}, {"method", 2005}, {"params", nlohmann::json::object()}}.dump();
}

namespace {

std::string hex_colour(const std::string& raw)
{
    if (raw.size() != 7 || raw[0] != '#')
        return std::string();
    std::string out = "#";
    for (size_t i = 1; i < raw.size(); ++i) {
        const char c = raw[i];
        if (c >= '0' && c <= '9')
            out.push_back(c);
        else if (c >= 'a' && c <= 'f')
            out.push_back(char(c - 'a' + 'A'));
        else if (c >= 'A' && c <= 'F')
            out.push_back(c);
        else
            return std::string();
    }
    return out;
}

bool is_int(const nlohmann::json& j, const char* key) { return j.is_object() && j.contains(key) && j[key].is_number_integer(); }

} // namespace

nlohmann::json parse_canvas_reply(const std::string& payload, int id)
{
    const nlohmann::json j = nlohmann::json::parse(payload, nullptr, false);
    if (!j.is_object() || static_cast<int>(Json::num(j, "id", -1)) != id || static_cast<int>(Json::num(j, "method", -1)) != 2005)
        return nullptr;
    const nlohmann::json result = Json::obj(j, "result");
    const nlohmann::json info   = Json::obj(result, "canvas_info");
    nlohmann::json       out    = {{"error_code", static_cast<int>(Json::num(result, "error_code", -1))},
                                   {"canvases", nlohmann::json::array()},
                                   {"active", {{"canvas_id", static_cast<int>(Json::num(info, "active_canvas_id", -1))},
                                               {"tray_id", static_cast<int>(Json::num(info, "active_tray_id", -1))}}}};
    for (const nlohmann::json& unit : Json::arr(info, "canvas_list")) {
        if (!is_int(unit, "canvas_id"))
            continue;
        nlohmann::json trays = nlohmann::json::array();
        for (const nlohmann::json& t : Json::arr(unit, "tray_list")) {
            if (!is_int(t, "tray_id") || t["tray_id"].get<int>() < 0)
                continue;
            trays.push_back({{"tray_id", t["tray_id"].get<int>()},
                             {"brand", Json::str(t, "brand", 60)},
                             {"type", Json::str(t, "filament_type", 30)},
                             {"name", Json::str(t, "filament_name", 60)},
                             {"color", hex_colour(Json::str(t, "filament_color", 16))},
                             {"min_temp", static_cast<int>(Json::num(t, "min_nozzle_temp", 0))},
                             {"max_temp", static_cast<int>(Json::num(t, "max_nozzle_temp", 0))},
                             {"status", static_cast<int>(Json::num(t, "status", 0))}});
        }
        out["canvases"].push_back({{"canvas_id", unit["canvas_id"].get<int>()}, {"connected", Json::num(unit, "connected", 0) != 0}, {"trays", trays}});
    }
    return out;
}

nlohmann::json sanitize_slot_map(const nlohmann::json& map, const nlohmann::json& canvases)
{
    const nlohmann::json none = nlohmann::json::array();
    if (!map.is_array() || map.empty() || !canvases.is_array())
        return none;
    nlohmann::json   out = nlohmann::json::array();
    std::vector<int> seen;
    for (const nlohmann::json& e : map) {
        if (!is_int(e, "t") || !is_int(e, "canvas_id") || !is_int(e, "tray_id"))
            return none;
        const int t = e["t"].get<int>(), canvas = e["canvas_id"].get<int>(), tray = e["tray_id"].get<int>();
        if (t < 0 || std::find(seen.begin(), seen.end(), t) != seen.end())
            return none;
        bool found = false;
        for (const nlohmann::json& unit : canvases)
            if (unit.is_object() && Json::num(unit, "canvas_id", -1) == canvas && Json::boolean(unit, "connected", false))
                for (const nlohmann::json& tr : Json::arr(unit, "trays"))
                    found = found || Json::num(tr, "tray_id", -1) == tray;
        if (!found)
            return none;
        seen.push_back(t);
        out.push_back({{"t", t}, {"canvas_id", canvas}, {"tray_id", tray}});
    }
    return out;
}

nlohmann::json map_for_send(const nlohmann::json& plan, const std::string& host, const std::vector<int>& sliced_t)
{
    const nlohmann::json none = nlohmann::json::array();
    if (!plan.is_object() || host.empty() || Json::str(plan, "host") != host)
        return none;
    const nlohmann::json map = Json::arr(plan, "map");
    std::vector<int>     planned;
    for (const nlohmann::json& e : map)
        if (is_int(e, "t"))
            planned.push_back(e["t"].get<int>());
    std::vector<int> sliced = sliced_t;
    std::sort(planned.begin(), planned.end());
    std::sort(sliced.begin(), sliced.end());
    if (planned.empty() || planned.size() != map.size() || planned != sliced)
        return none;
    return map;
}

std::string serial_from_discovery(const std::string& datagram)
{
    const nlohmann::json j = nlohmann::json::parse(datagram, nullptr, false);
    if (!j.is_object())
        return std::string();
    return Json::str(Json::obj(j, "result"), "sn", 64);
}

StartReply parse_start_reply(const std::string& payload, int id)
{
    StartReply         out;
    const nlohmann::json j = nlohmann::json::parse(payload, nullptr, false);
    if (!j.is_object() || static_cast<int>(Json::num(j, "id", -1)) != id || static_cast<int>(Json::num(j, "method", -1)) != 1020)
        return out;
    const nlohmann::json* result = Json::field(j, "result");
    out.matched    = true;
    out.error_code = result != nullptr ? static_cast<int>(Json::num(*result, "error_code", -1)) : -1;
    return out;
}

std::string error_text(int error_code)
{
    switch (error_code) {
    case 0: return "L'impression a démarré.";
    case 1003: return "L'imprimante a refusé la demande (paramètre invalide).";
    case 1009: return "L'imprimante est occupée : attends la fin de ce qu'elle fait, puis réessaie.";
    case 1014: return "L'imprimante dit que le fichier G-code n'est pas valide.";
    case 1021: return "Fichier introuvable sur l'imprimante : l'envoi n'a pas abouti.";
    default: return "L'imprimante a répondu avec l'erreur " + std::to_string(error_code) + ".";
    }
}

}} // namespace Plyo::CC2Logic
