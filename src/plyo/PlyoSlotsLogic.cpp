#include "PlyoSlotsLogic.hpp"

#include "PlyoJson.hpp"
#include "PlyoProjectLogic.hpp"

#include <algorithm>
#include <cctype>

namespace Plyo { namespace SlotsLogic {

namespace {

bool is_int(const nlohmann::json& j, const char* key) { return j.is_object() && j.contains(key) && j[key].is_number_integer(); }

std::string upper(std::string v)
{
    for (char& c : v)
        c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return v;
}

// « le Canvas » → « au Canvas », « la boîte CFS » → « à la boîte CFS ».
std::string to_unit(const std::string& unit) { return unit.rfind("le ", 0) == 0 ? "au " + unit.substr(3) : "à " + unit; }

} // namespace

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

MapDecision decide_map(const nlohmann::json& planned, const nlohmann::json& canvases, const std::vector<std::string>& presets, const DecideOptions& opts)
{
    MapDecision out;
    const std::string again = opts.offer_plain ?
        " Le fichier est sur l'imprimante : dans Plyo, à l'étape Imprimer, « Démarrer sans carte », ou choisis à nouveau les emplacements." :
        " Rien n'est parti : relis les emplacements ou choisis-en d'autres.";
    if (!canvases.is_array()) {
        out.refusal = "Je n'ai pas pu relire les emplacements de l'imprimante : l'impression n'a pas démarré." + again;
        return out;
    }
    for (const nlohmann::json& e : planned) {
        const int t = static_cast<int>(Json::num(e, "t", -1)), tray_id = static_cast<int>(Json::num(e, "tray_id", -1));
        nlohmann::json tray = nullptr; // copie : Json::arr rend une copie temporaire
        for (const nlohmann::json& unit : canvases)
            if (Json::num(unit, "canvas_id", -1) == Json::num(e, "canvas_id", -2) && Json::boolean(unit, "connected", false))
                for (const nlohmann::json& tr : Json::arr(unit, "trays"))
                    if (Json::num(tr, "tray_id", -1) == tray_id)
                        tray = tr;
        std::string n = Json::str(e, "label", 16);
        if (n.empty())
            n = Json::str(tray, "label", 16);
        if (n.empty())
            n = std::to_string(tray_id + 1);
        if (tray.is_null()) {
            out.refusal = "L'emplacement " + n + " n'est plus visible sur " + opts.unit_name + " : l'impression n'a pas démarré." + again;
            return out;
        }
        if (opts.empty_blocks && Json::num(tray, "status", 0) == 0) {
            out.refusal = "L'emplacement " + n + " est vide : l'impression n'a pas démarré." + again;
            return out;
        }
        const std::string want = Json::str(e, "type"), now = Json::str(tray, "type");
        if (!want.empty() && upper(want) != upper(now)) {
            out.refusal = "L'emplacement " + n + " contient maintenant du " + (now.empty() ? std::string("?") : now) + " (choisi : " + want + ") : l'impression n'a pas démarré." + again;
            return out;
        }
        const std::string preset = Json::str(e, "preset");
        if (!preset.empty() && (t < 0 || t >= static_cast<int>(presets.size()) || !ProjectLogic::same_filament(preset, presets[t]))) {
            out.refusal = "Le filament de la couleur " + std::to_string(t + 1) + " a changé dans Orca depuis le choix des emplacements : l'impression n'a pas démarré." + again;
            return out;
        }
    }
    out.map = sanitize_slot_map(planned, canvases);
    if (out.map.empty())
        out.refusal = "Les emplacements choisis dans Plyo ne correspondent plus " + to_unit(opts.unit_name) + " : l'impression n'a pas démarré." + again;
    return out;
}

Detection detect(const PrinterFacts& f)
{
    Detection out;
    if (!f.has_host)
        return out;
    const auto listed = [&](const std::vector<std::string>& list) { return std::find(list.begin(), list.end(), f.printer_model) != list.end(); };
    if (f.printer_model.find("Centauri Carbon 2") != std::string::npos) {
        out.kind      = "canvas";
        out.imposable = true;
    } else if (f.host_type == "crealityprint") {
        out.kind      = "cfs";
        out.imposable = listed(cfs_imposable_models());
    } else if (f.host_type == "flashforge") {
        const bool complete = f.has_ff_serial && f.has_code;
        if (complete) {
            out.kind      = "ifs";
            out.imposable = listed(ifs_imposable_models());
        } else if (listed(ifs_imposable_models()))
            out.reason = "link_incomplete"; // sans série ou code, Flashforge::upload prend l'ancien chemin et ignore toute répartition
    } else if (f.printer_model == "Snapmaker U1" && f.printer_agent == "snapmaker")
        out.kind = "u1";
    return out;
}

bool link_needs_code(const std::string& host_type, const std::string& printer_model, bool has_serial, bool has_code)
{
    const auto& list = ifs_imposable_models();
    return host_type == "flashforge" && has_serial && !has_code && std::find(list.begin(), list.end(), printer_model) != list.end();
}

nlohmann::json state_fields(const std::string& kind, bool imposable)
{
    const bool cc2 = kind == "canvas";
    return {{"system", kind},
            {"source", "printer"},
            {"imposable", imposable && (cc2 || kind == "cfs" || kind == "ifs")},
            {"empty_blocks", !cc2 && EMPTY_SLOT_BLOCKS},
            {"start_plain", cc2},
            {"validated", cc2}};
}

DecideOptions decide_options(const std::string& kind)
{
    DecideOptions out;
    if (kind == "canvas")
        return out;
    out.offer_plain  = false;
    out.empty_blocks = EMPTY_SLOT_BLOCKS;
    out.unit_name    = kind == "cfs" ? "la boîte CFS" : kind == "ifs" ? "l'IFS" : "l'imprimante";
    return out;
}

}} // namespace Plyo::SlotsLogic
