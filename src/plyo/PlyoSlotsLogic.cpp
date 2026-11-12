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
        " Le fichier est sur l'imprimante : dans Plyo, à l'étape Imprimer, « Laisser l'imprimante choisir l'emplacement », ou choisis à nouveau les emplacements." :
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

std::string used_refusal(const std::vector<int>& model_t, const std::vector<int>& cursor_t, const std::vector<int>& sliced_t, const std::vector<int>& plan_t)
{
    const auto sorted = [](std::vector<int> v) {
        std::sort(v.begin(), v.end());
        return v;
    };
    const std::vector<int> model = sorted(model_t), cursor = sorted(cursor_t), sliced = sorted(sliced_t), plan = sorted(plan_t);
    const std::string nothing = " Rien n'est parti.";
    if (plan.empty() || sliced.empty())
        return "Je ne sais pas quels filaments la plaque utilise : découpe-la à nouveau, puis relance l'envoi." + nothing;
    if (REFUSE_CURSOR_FILAMENT_CHANGES && model != cursor)
        return "Cette plaque change de filament à une couche choisie dans l'aperçu : je ne sais pas encore l'envoyer avec une répartition. Envoie-la par le bouton d'Orca." + nothing;
    if (cursor != sliced)
        return "La découpe n'utilise pas les filaments prévus par les réglages (support, tour de purge, filament par zone) : vérifie tes réglages, ou envoie par le bouton d'Orca." + nothing;
    if (plan != sliced)
        return "Les emplacements choisis ne couvrent plus les couleurs de la pièce découpée : choisis à nouveau les emplacements." + nothing;
    return std::string();
}

bool plan_allowed(const Detection& detection, const nlohmann::json& last_read, const std::string& host)
{
    return (detection.kind == "cfs" || detection.kind == "ifs") && detection.imposable && !host.empty() && Json::str(last_read, "host") == host &&
           Json::boolean(last_read, "ok", false) && Json::boolean(last_read, "imposable", false) && Json::str(last_read, "source") == "printer";
}

nlohmann::json clean_send_map(const nlohmann::json& map)
{
    const nlohmann::json none = nlohmann::json::array();
    if (!map.is_array() || map.empty())
        return none;
    nlohmann::json out = nlohmann::json::array();
    for (const nlohmann::json& e : map) {
        const std::string type = Json::str(e, "type", 30), preset = Json::str(e, "preset", 200);
        if (!is_int(e, "t") || !is_int(e, "canvas_id") || !is_int(e, "tray_id") || type.empty() || preset.empty())
            return none;
        nlohmann::json clean = {{"t", e["t"]}, {"canvas_id", e["canvas_id"]}, {"tray_id", e["tray_id"]}, {"type", type}, {"preset", preset}};
        if (const std::string label = Json::str(e, "label", 16); !label.empty())
            clean["label"] = label;
        out.push_back(clean);
    }
    return out;
}

std::string profile_refusal(const nlohmann::json& plan, const Detection& edited, const std::string& edited_host, const std::string& edited_host_type,
                            const std::string& edited_model)
{
    const bool same = plan.is_object() && edited.imposable && !edited_host.empty() && edited.kind == Json::str(plan, "kind") && edited_host == Json::str(plan, "host") &&
                      edited_host_type == Json::str(plan, "host_type") && edited_model == Json::str(plan, "model");
    return same ? std::string() : "L'imprimante choisie dans Orca n'est plus celle des emplacements choisis : rien n'est parti. Remets-la, ou choisis à nouveau les emplacements.";
}

namespace {

constexpr size_t MANUAL_MAX_MACHINES = 50, MANUAL_MAX_SLOTS = 16, MANUAL_MAX_NAME = 200;

nlohmann::json manual_slots(const nlohmann::json& slots, const std::vector<std::string>& known_types)
{
    nlohmann::json out = nlohmann::json::array();
    if (!slots.is_array())
        return out;
    for (const nlohmann::json& s : slots) {
        if (out.size() >= MANUAL_MAX_SLOTS)
            break;
        if (!s.is_object())
            continue;
        const std::string type = Json::str(s, "type", 30);
        out.push_back({{"type", std::find(known_types.begin(), known_types.end(), type) != known_types.end() ? type : std::string()},
                       {"color", hex_colour(Json::str(s, "color", 16))}});
    }
    return out;
}

} // namespace

nlohmann::json sanitize_manual(const nlohmann::json& all, const std::vector<std::string>& known_types)
{
    nlohmann::json out = nlohmann::json::object();
    if (!all.is_object())
        return out;
    for (const auto& [preset, entry] : all.items()) {
        if (out.size() >= MANUAL_MAX_MACHINES)
            break;
        if (preset.empty() || preset.size() > MANUAL_MAX_NAME)
            continue;
        const nlohmann::json slots = manual_slots(Json::any(entry, "slots"), known_types);
        if (!slots.empty())
            out[preset] = {{"slots", slots}};
    }
    return out;
}

nlohmann::json manual_state(const nlohmann::json& entry)
{
    nlohmann::json out = state_fields("manual", false);
    out["source"]       = "manual";
    out["empty_blocks"] = false; // rien n'est jamais envoyé depuis une saisie : pas de refus à l'envoi
    nlohmann::json trays = nlohmann::json::array();
    const nlohmann::json slots = Json::arr(entry, "slots");
    for (size_t i = 0; i < slots.size(); ++i) {
        const std::string type = Json::str(slots[i], "type", 30), color = Json::str(slots[i], "color", 16);
        trays.push_back({{"tray_id", static_cast<int>(i)},
                         {"label", std::to_string(i + 1)},
                         {"brand", ""},
                         {"type", type},
                         {"name", ""},
                         {"color", color},
                         {"min_temp", 0},
                         {"max_temp", 0},
                         {"status", type.empty() && color.empty() ? 0 : 2}});
    }
    if (trays.empty()) {
        out["ok"]     = false;
        out["reason"] = "no_manual";
        return out;
    }
    out["ok"]       = true;
    out["canvases"] = nlohmann::json::array({{{"canvas_id", 0}, {"connected", true}, {"trays", trays}}});
    return out;
}

nlohmann::json manual_with(const nlohmann::json& all, const std::string& preset, const nlohmann::json& slots, const std::vector<std::string>& known_types, bool& ok)
{
    nlohmann::json out = sanitize_manual(all, known_types);
    ok                 = false;
    if (preset.empty() || preset.size() > MANUAL_MAX_NAME)
        return out;
    const nlohmann::json clean = manual_slots(slots, known_types);
    if (clean.empty()) {
        out.erase(preset);
        ok = true;
        return out;
    }
    if (!out.contains(preset) && out.size() >= MANUAL_MAX_MACHINES)
        return out;
    out[preset] = {{"slots", clean}};
    ok          = true;
    return out;
}

}} // namespace Plyo::SlotsLogic
