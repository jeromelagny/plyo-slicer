#include "PlyoDiscoveryLogic.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <map>
#include <utility>

namespace Plyo { namespace Discovery {

namespace {

// Les quatre octets d'une adresse IPv4 écrite « a.b.c.d » ; rien si elle est mal formée.
std::optional<std::array<int, 4>> octets(const std::string& ip)
{
    std::array<int, 4> o{};
    char               tail = 0;
    if (std::sscanf(ip.c_str(), "%d.%d.%d.%d%c", &o[0], &o[1], &o[2], &o[3], &tail) != 4)
        return std::nullopt;
    for (int v : o)
        if (v < 0 || v > 255)
            return std::nullopt;
    return o;
}

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return char(std::tolower(c)); });
    return s;
}

std::string text_of(const nlohmann::json& j, const char* key)
{
    return j.is_object() && j.contains(key) && j[key].is_string() ? j[key].get<std::string>() : std::string();
}

} // namespace

bool is_private_ipv4(const std::string& ip)
{
    const auto o = octets(ip);
    if (!o)
        return false;
    return (*o)[0] == 10 || ((*o)[0] == 172 && (*o)[1] >= 16 && (*o)[1] <= 31) || ((*o)[0] == 192 && (*o)[1] == 168);
}

std::vector<std::string> neighbours(const std::string& local_ip)
{
    std::vector<std::string> out;
    const auto               o = octets(local_ip);
    if (!o || !is_private_ipv4(local_ip))
        return out;
    const std::string prefix = std::to_string((*o)[0]) + "." + std::to_string((*o)[1]) + "." + std::to_string((*o)[2]) + ".";
    for (int last = 1; last <= 254; ++last)
        if (last != (*o)[3])
            out.push_back(prefix + std::to_string(last));
    return out;
}

std::string creality_mdns_name(const std::string& model_code, const std::string& orca_model_name,
                               const std::map<std::string, std::string>& learned)
{
    if (!orca_model_name.empty())
        return "Creality " + orca_model_name;
    if (const auto it = learned.find(model_code); it != learned.end())
        return it->second;
    // Codes de /info absents de la table d'Orca (qui ne connaît que les modèles à CFS). N'ajouter un code que constaté sur
    // une vraie machine.
    static const std::map<std::string, std::string> CODES = {
        {"F003", "CR-10 SE"}, // CR-10 SE de Jérôme, 2026-11-10
    };
    if (const auto it = CODES.find(model_code); it != CODES.end())
        return "Creality " + it->second;
    return "Imprimante Creality";
}

namespace {
bool safe_chars(const std::string& s, const std::string& extra)
{
    return std::all_of(s.begin(), s.end(), [&](unsigned char c) { return std::isalnum(c) || extra.find(static_cast<char>(c)) != std::string::npos || c >= 0x80; });
}
} // namespace

bool valid_learned(const std::string& brand, const std::string& code, const std::string& model)
{
    const bool brand_ok = !brand.empty() && brand.size() <= 30 && std::isalnum(static_cast<unsigned char>(brand[0])) && safe_chars(brand, " .-");
    const bool code_ok  = !code.empty() && code.size() <= 20 && std::all_of(code.begin(), code.end(), [](unsigned char c) { return std::isalnum(c) || c == '_' || c == '.' || c == '-'; });
    const bool model_ok = model.size() >= 2 && model.size() <= 100 && safe_chars(model, " ()+.,'/_-");
    return brand_ok && code_ok && model_ok;
}

std::map<std::string, std::string> learned_for(const nlohmann::json& store, const std::string& brand)
{
    std::map<std::string, std::string> out;
    for (const char* part : {"shared", "local"}) { // local en dernier : il remplace
        if (!store.is_object() || !store.contains(part) || !store[part].is_object() || !store[part].contains(brand) || !store[part][brand].is_object())
            continue;
        for (auto it = store[part][brand].begin(); it != store[part][brand].end(); ++it)
            if (it.value().is_string() && valid_learned(brand, it.key(), it.value().get<std::string>()))
                out[it.key()] = it.value().get<std::string>();
    }
    return out;
}

nlohmann::json shared_from_server(const nlohmann::json& reply)
{
    nlohmann::json out = nlohmann::json::object();
    if (!reply.is_object() || !reply.contains("models") || !reply["models"].is_array())
        return out;
    for (const nlohmann::json& m : reply["models"]) {
        if (!m.is_object())
            continue;
        const std::string brand = m.value("brand", std::string()), code = m.value("code", std::string()), model = m.value("model", std::string());
        if (valid_learned(brand, code, model))
            out[brand][code] = model;
    }
    return out;
}

std::string brand_from_name(const std::string& name)
{
    const std::string n = lower(name);
    // Préfixes des noms donnés par les firmwares (Creality OS : « K1C-1A2B », « Ender-3 V3 KE », « Hi-… »).
    static const std::vector<std::pair<std::string, std::string>> PREFIXES = {
        {"k1", "Creality"},      {"k2", "Creality"},    {"ender", "Creality"},   {"cr-", "Creality"}, {"hi-", "Creality"},
        {"creality", "Creality"}, {"sermoon", "Creality"}, {"neptune", "Elegoo"}, {"elegoo", "Elegoo"},
        {"centauri", "Elegoo"},  {"voron", "Voron"},    {"sovol", "Sovol"},      {"qidi", "Qidi"},    {"x-max", "Qidi"},
        {"x-plus", "Qidi"},      {"adventurer", "Flashforge"}, {"anycubic", "Anycubic"}, {"kobra", "Anycubic"},
        {"snapmaker", "Snapmaker"}, {"prusa", "Prusa"}, {"artillery", "Artillery"},
    };
    for (const auto& [prefix, brand] : PREFIXES)
        if (n.rfind(prefix, 0) == 0)
            return brand;
    return std::string();
}

namespace {

// Minuscules, tirets et soulignés en espaces, parenthèses retirées, espaces simples.
std::string words(const std::string& text)
{
    std::string out;
    int         depth = 0;
    for (char ch : lower(text)) {
        if (ch == '(') { ++depth; continue; }
        if (ch == ')') { depth = std::max(0, depth - 1); continue; }
        if (depth > 0) continue;
        const char c = (ch == '-' || ch == '_') ? ' ' : ch;
        if (c == ' ' && (out.empty() || out.back() == ' ')) continue;
        out.push_back(c);
    }
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

// Retire la marque en tête (« creality k2 » → « k2 »).
std::string without_brand(std::string w)
{
    static const std::vector<std::string> BRANDS = {"creality", "elegoo", "flashforge", "qidi", "sovol", "voron", "anycubic",
                                                    "snapmaker", "prusa", "artillery", "bambu lab", "bambulab"};
    for (const std::string& b : BRANDS)
        if (w.rfind(b + " ", 0) == 0)
            return w.substr(b.size() + 1);
    return w;
}

bool is_hex_tag(const std::string& s)
{
    return s.size() >= 4 && s.size() <= 12 && std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isxdigit(c); });
}

} // namespace

std::string model_hint(const Printer& p)
{
    std::string name = p.name;
    // Nom réseau « K2-DD52 » : le suffixe vient de l'adresse MAC, il ne dit rien du modèle.
    const auto dash = name.find_last_of('-');
    if (dash != std::string::npos && is_hex_tag(name.substr(dash + 1)))
        name = name.substr(0, dash);
    const std::string w = without_brand(words(name));
    if (w.empty() || w == "imprimante klipper" || w.rfind("imprimante ", 0) == 0 || w == "octoprint")
        return std::string();
    return w;
}

bool profile_matches(const std::string& printer_model, const std::string& hint)
{
    return !hint.empty() && without_brand(words(printer_model)) == words(hint);
}

bool allowed_host_type(const std::string& host_type)
{
    static const std::vector<std::string> TYPES = {"moonraker", "crealityprint", "flashforge", "octoprint", "elegoolink"};
    return std::find(TYPES.begin(), TYPES.end(), host_type) != TYPES.end();
}

bool valid_host(const std::string& host)
{
    const auto        colon = host.find(':');
    const std::string ip    = host.substr(0, colon);
    if (!is_private_ipv4(ip))
        return false;
    if (colon == std::string::npos)
        return true;
    const std::string port = host.substr(colon + 1);
    return !port.empty() && port.size() <= 5 && std::all_of(port.begin(), port.end(), [](unsigned char c) { return std::isdigit(c); }) &&
           std::stoi(port) > 0 && std::stoi(port) <= 65535;
}

std::optional<Printer> from_moonraker(const std::string& ip, const std::string& body)
{
    const nlohmann::json j = nlohmann::json::parse(body, nullptr, false);
    if (!j.is_object() || !j.contains("result") || !j["result"].is_object())
        return std::nullopt;
    const nlohmann::json& r = j["result"];
    // Une réponse de Klipper porte au moins son état ou sa version : sinon ce n'est pas Moonraker.
    if (!r.contains("state") && !r.contains("software_version"))
        return std::nullopt;
    Printer p;
    p.ip        = ip;
    p.name      = text_of(r, "hostname");
    p.brand     = brand_from_name(p.name);
    if (p.name.empty())
        p.name = "Imprimante Klipper";
    p.host_type = "moonraker";
    p.host      = ip + ":7125";
    p.priority  = 1;
    return p;
}

std::optional<Printer> from_elegoo_sdcp(const std::string& datagram)
{
    const nlohmann::json j = nlohmann::json::parse(datagram, nullptr, false);
    if (!j.is_object() || !j.contains("Data") || !j["Data"].is_object())
        return std::nullopt;
    const nlohmann::json& d  = j["Data"];
    const std::string     ip = text_of(d, "MainboardIP");
    if (!octets(ip))
        return std::nullopt;
    Printer p;
    p.ip        = ip;
    p.name      = text_of(d, "MachineName");
    if (p.name.empty())
        p.name = text_of(d, "Name");
    if (p.name.empty())
        p.name = "Imprimante Elegoo";
    p.brand     = "Elegoo";
    p.host_type = "elegoolink";
    p.host      = ip;
    p.priority  = 2;
    return p;
}

std::optional<Printer> from_elegoo_cc2(const std::string& ip, const std::string& datagram)
{
    if (!octets(ip))
        return std::nullopt;
    const nlohmann::json j = nlohmann::json::parse(datagram, nullptr, false);
    if (!j.is_object() || !j.contains("result") || !j["result"].is_object())
        return std::nullopt;
    const nlohmann::json& r    = j["result"];
    std::string           name = text_of(r, "host_name");
    if (name.empty())
        name = text_of(r, "machine_model");
    // Une réponse sans nom ni modèle n'est pas celle d'une imprimante (le serveur UDP répond aussi « Hello from UDP Server! »).
    if (name.empty())
        return std::nullopt;
    Printer p;
    p.ip        = ip;
    p.name      = name;
    p.brand     = "Elegoo";
    p.host_type = "elegoolink";
    p.host      = ip;
    p.priority  = 2;
    return p;
}

bool valid_serial(const std::string& serial)
{
    if (serial.empty() || serial.size() > 64)
        return false;
    return std::all_of(serial.begin(), serial.end(), [](unsigned char c) { return c < 0x80 && std::isalnum(c) != 0; });
}

std::vector<Printer> merge(std::vector<Printer> found)
{
    std::map<std::string, Printer> by_ip;
    for (Printer& p : found) {
        if (p.ip.empty())
            continue;
        auto it = by_ip.find(p.ip);
        if (it == by_ip.end() || p.priority > it->second.priority) {
            // La source plus précise garde un nom, une marque ou une série que seule l'autre connaissait.
            if (it != by_ip.end()) {
                if (p.name.empty())
                    p.name = it->second.name;
                if (p.brand.empty())
                    p.brand = it->second.brand;
                if (p.serial.empty())
                    p.serial = it->second.serial;
            }
            by_ip[p.ip] = std::move(p);
        } else if (it->second.serial.empty())
            it->second.serial = p.serial;
    }
    std::vector<Printer> out;
    for (auto& [ip, p] : by_ip)
        out.push_back(std::move(p));
    std::sort(out.begin(), out.end(), [](const Printer& a, const Printer& b) { return lower(a.name) < lower(b.name); });
    return out;
}

nlohmann::json to_json(const std::vector<Printer>& printers)
{
    nlohmann::json out = nlohmann::json::array();
    for (const Printer& p : printers)
    {
        nlohmann::json item = {{"ip", p.ip}, {"name", p.name}, {"brand", p.brand}, {"host_type", p.host_type}, {"host", p.host}};
        if (!p.code.empty())
            item["code"] = p.code;
        out.push_back(item);
    }
    return out;
}

}} // namespace Plyo::Discovery
