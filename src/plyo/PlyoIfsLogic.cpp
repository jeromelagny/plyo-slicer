#include "PlyoIfsLogic.hpp"

#include "PlyoJson.hpp"
#include "PlyoSlotsLogic.hpp"

#include <algorithm>
#include <cctype>

namespace Plyo { namespace IfsLogic {

namespace {

std::string normalized(const std::string& material)
{
    std::string out;
    for (unsigned char c : material)
        if (std::isalnum(c) != 0)
            out.push_back(static_cast<char>(std::toupper(c)));
    return out;
}

} // namespace

nlohmann::json canvases_from_slots(const std::vector<Slot>& slots)
{
    nlohmann::json trays = nlohmann::json::array();
    for (const Slot& s : slots) {
        if (s.slot_id <= 0)
            continue;
        trays.push_back({{"tray_id", s.slot_id},
                         {"label", std::to_string(s.slot_id)},
                         {"brand", ""},
                         {"type", Json::utf8_prefix(s.material_name, 30)},
                         {"name", Json::utf8_prefix(s.material_name, 60)},
                         {"color", SlotsLogic::hex_colour(s.material_color)},
                         {"raw_color", Json::utf8_prefix(s.material_color, 16)},
                         {"min_temp", 0},
                         {"max_temp", 0},
                         {"status", s.has_filament ? 2 : 0}});
    }
    if (trays.empty())
        return nlohmann::json::array();
    return nlohmann::json::array({{{"canvas_id", 0}, {"connected", true}, {"trays", trays}}});
}

bool live_imposable(bool supports_material_station, const std::vector<Slot>& slots)
{
    if (!supports_material_station || slots.empty())
        return false;
    std::vector<int> seen;
    for (const Slot& s : slots) {
        if (s.slot_id <= 0 || std::find(seen.begin(), seen.end(), s.slot_id) != seen.end())
            return false;
        seen.push_back(s.slot_id);
    }
    return true;
}

bool same_material(const std::string& a, const std::string& b)
{
    const std::string na = normalized(a);
    return !na.empty() && na == normalized(b);
}

std::map<std::string, std::string> mapping_info(const nlohmann::json& map, const nlohmann::json& canvases, const nlohmann::json& tools, bool leveling, bool timelapse,
                                                std::string& refusal)
{
    refusal.clear();
    const auto refuse = [&](const std::string& text) {
        refusal = text + " Rien n'est parti : relis les emplacements ou choisis-en d'autres.";
        return std::map<std::string, std::string>();
    };
    if (!map.is_array() || map.empty())
        return refuse("Aucun emplacement choisi pour cette pièce.");
    std::map<int, nlohmann::json> by_t; // trié par numéro de filament, comme les rangées du dialogue d'Orca
    std::vector<int>              used_slots;
    for (const nlohmann::json& e : map) {
        const int t = static_cast<int>(Json::integer(e, "t", -1)), canvas = static_cast<int>(Json::integer(e, "canvas_id", -1)), slot = static_cast<int>(Json::integer(e, "tray_id", -1));
        if (t < 0 || by_t.count(t) != 0)
            return refuse("Une couleur choisie n'existe plus dans la pièce.");
        nlohmann::json tool = nullptr;
        if (tools.is_array())
            for (const nlohmann::json& candidate : tools)
                if (static_cast<int>(Json::integer(candidate, "t", -1)) == t)
                    tool = candidate;
        if (tool.is_null())
            return refuse("Une couleur choisie n'existe plus dans la pièce.");
        const std::string tool_color = Json::str(tool, "color", 16), tool_type = Json::str(tool, "type", 30);
        if (tool_color.empty() || tool_type.empty())
            return refuse("Je ne connais pas la couleur ou le type d'un filament de la pièce.");
        nlohmann::json tray = nullptr;
        if (canvases.is_array())
            for (const nlohmann::json& unit : canvases)
                if (static_cast<int>(Json::integer(unit, "canvas_id", -1)) == canvas && Json::boolean(unit, "connected", false))
                    for (const nlohmann::json& tr : Json::arr(unit, "trays"))
                        if (static_cast<int>(Json::integer(tr, "tray_id", -1)) == slot)
                            tray = tr;
        if (tray.is_null())
            return refuse("Un emplacement choisi n'est plus visible sur l'imprimante.");
        if (SlotsLogic::EMPTY_SLOT_BLOCKS && static_cast<int>(Json::integer(tray, "status", 0)) == 0)
            return refuse("L'emplacement " + std::to_string(slot) + " est vide.");
        const std::string name = Json::str(tray, "name", 60);
        if (!same_material(tool_type, name))
            return refuse("L'emplacement " + std::to_string(slot) + " contient du " + (name.empty() ? std::string("?") : name) + ", la pièce est découpée en " + tool_type + ".");
        if (std::find(used_slots.begin(), used_slots.end(), slot) != used_slots.end())
            return refuse("Deux couleurs de la pièce sont sur le même emplacement.");
        used_slots.push_back(slot);
        by_t[t] = {{"toolId", t}, {"slotId", slot}, {"materialName", name}, {"toolMaterialColor", tool_color}, {"slotMaterialColor", Json::str(tray, "raw_color", 16)}};
    }
    nlohmann::json mappings = nlohmann::json::array();
    for (const auto& entry : by_t)
        mappings.push_back(entry.second);
    return {{"levelingBeforePrint", leveling ? "1" : "0"},
            {"timeLapseVideo", timelapse ? "1" : "0"},
            {"useMatlStation", "1"},
            {"gcodeToolCnt", std::to_string(by_t.size())},
            {"materialMappings", mappings.dump()}};
}

}} // namespace Plyo::IfsLogic
