#include "PlyoCfsLogic.hpp"

#include "PlyoJson.hpp"
#include "PlyoSlotsLogic.hpp"

#include <algorithm>
#include <utility>
#include <vector>

namespace Plyo { namespace CfsLogic {

namespace {

bool is_int(const nlohmann::json& j, const char* key)
{
    const nlohmann::json* v = Json::field(j, key);
    return v != nullptr && v->is_number_integer();
}

// Creality donne « #0RRGGBB ». Toute autre forme reste vide : on ne devine pas une couleur.
std::string creality_colour(const std::string& raw)
{
    if (raw.size() == 8 && raw[0] == '#' && raw[1] == '0')
        return SlotsLogic::hex_colour("#" + raw.substr(2));
    return SlotsLogic::hex_colour(raw);
}

} // namespace

nlohmann::json parse_boxes(const std::string& body)
{
    nlohmann::json out = {{"ok", false}, {"canvases", nlohmann::json::array()}, {"box_count", 0}, {"anomaly", ""}};
    const nlohmann::json j    = nlohmann::json::parse(body, nullptr, false);
    const nlohmann::json info = Json::obj(j, "boxsInfo");
    const nlohmann::json* boxes = Json::field(info, "materialBoxs");
    if (boxes == nullptr || !boxes->is_array()) {
        out["anomaly"] = "illisible";
        return out;
    }
    out["ok"] = true;
    int box_count = 0;
    std::string anomaly;
    for (const nlohmann::json& box : *boxes) {
        if (!is_int(box, "id") || !is_int(box, "type")) {
            anomaly = "boîte sans numéro ou sans type";
            continue;
        }
        const int id = box["id"].get<int>(), type = box["type"].get<int>();
        if (id < 0 || (type != 0 && type != 1)) {
            anomaly = "boîte de numéro ou de type inattendu";
            continue;
        }
        const bool active = type == 1 || static_cast<int>(Json::num(box, "state", 0)) == 1; // porte-bobine : toujours disponible
        if (type == 0 && active)
            ++box_count;
        nlohmann::json trays = nlohmann::json::array();
        for (const nlohmann::json& mat : Json::arr(box, "materials")) {
            if (!is_int(mat, "id") || mat["id"].get<int>() < 0 || mat["id"].get<int>() > 25) {
                anomaly = "emplacement de numéro inattendu";
                continue;
            }
            const int         slot   = mat["id"].get<int>();
            const std::string vendor = Json::str(mat, "vendor", 60), mat_type = Json::str(mat, "type", 30);
            const bool        loaded = static_cast<int>(Json::num(mat, "state", 0)) != 0 && !(vendor.empty() && mat_type.empty());
            trays.push_back({{"tray_id", slot},
                             {"label", id == 0 ? std::string("Ext") : std::to_string(id) + std::string(1, char('A' + slot))},
                             {"brand", vendor},
                             {"type", mat_type},
                             {"name", Json::str(mat, "name", 60)},
                             {"color", creality_colour(Json::str(mat, "color", 16))},
                             {"min_temp", 0},
                             {"max_temp", 0},
                             {"status", loaded ? 2 : 0}});
        }
        out["canvases"].push_back({{"canvas_id", id}, {"box_type", type}, {"connected", active}, {"trays", trays}});
    }
    out["box_count"] = box_count;
    out["anomaly"]   = anomaly;
    return out;
}

std::string live_blocker(const std::string& model_display, const std::string& profile_model, const nlohmann::json& parsed)
{
    if (!Json::boolean(parsed, "ok", false))
        return "lecture illisible";
    if (const std::string anomaly = Json::str(parsed, "anomaly"); !anomaly.empty())
        return anomaly;
    // « Creality K2 » (profil) ↔ « K2 » (machine) : le profil doit être sur la liste blanche et correspondre à la machine.
    const auto& allowed = SlotsLogic::cfs_imposable_models();
    if (std::find(allowed.begin(), allowed.end(), profile_model) == allowed.end())
        return "modèle du profil non essayé";
    if (model_display.empty() || "Creality " + model_display != profile_model)
        return "modèle de la machine différent du profil";
    if (static_cast<int>(Json::num(parsed, "box_count", 0)) != 1)
        return "il faut exactement une boîte CFS active";
    bool holder_at_zero = false;
    for (const nlohmann::json& unit : Json::arr(parsed, "canvases")) {
        const int id = static_cast<int>(Json::num(unit, "canvas_id", -1)), type = static_cast<int>(Json::num(unit, "box_type", -1));
        if (type == 0 && id == 0)
            return "boîte CFS au numéro 0, réservé au porte-bobine";
        if (type == 1 && id != 0)
            return "porte-bobine ailleurs qu'au numéro 0";
        holder_at_zero = holder_at_zero || (type == 1 && id == 0);
    }
    return holder_at_zero ? std::string() : "porte-bobine absent de la lecture";
}

bool live_imposable(const std::string& model_display, const std::string& profile_model, const nlohmann::json& parsed)
{
    return live_blocker(model_display, profile_model, parsed).empty();
}

std::map<std::string, std::string> color_match_info(const nlohmann::json& map, const nlohmann::json& canvases, int filament_count, bool self_test,
                                                    std::string& refusal)
{
    refusal.clear();
    const auto refuse = [&](const std::string& text) {
        refusal = text + " Rien n'est parti : relis les emplacements ou choisis-en d'autres.";
        return std::map<std::string, std::string>();
    };
    if (!map.is_array() || map.empty())
        return refuse("Aucun emplacement choisi pour cette pièce.");
    if (filament_count <= 0 || filament_count > 26)
        return refuse("Ce projet a trop de filaments pour que je choisisse les emplacements.");
    struct Slot { std::string line_end; bool holder = false; };
    std::map<int, Slot> by_t;
    std::vector<std::pair<int, int>> used;
    Slot first;
    bool have_first = false;
    for (const nlohmann::json& e : map) {
        const int t = static_cast<int>(Json::integer(e, "t", -1)), box = static_cast<int>(Json::integer(e, "canvas_id", -1)), mat = static_cast<int>(Json::integer(e, "tray_id", -1));
        if (t < 0 || t >= filament_count || by_t.count(t) != 0)
            return refuse("Une couleur choisie n'existe plus dans la pièce.");
        nlohmann::json tray = nullptr;
        int box_type = -1;
        for (const nlohmann::json& unit : canvases)
            if (static_cast<int>(Json::integer(unit, "canvas_id", -1)) == box && Json::boolean(unit, "connected", false))
                for (const nlohmann::json& tr : Json::arr(unit, "trays"))
                    if (static_cast<int>(Json::integer(tr, "tray_id", -1)) == mat) {
                        tray     = tr;
                        box_type = static_cast<int>(Json::integer(unit, "box_type", -1));
                    }
        if (tray.is_null())
            return refuse("Un emplacement choisi n'est plus visible sur l'imprimante.");
        // start_print traite boxId 0 comme le porte-bobine ; une boîte CFS au numéro 0 ferait abandonner la répartition sans erreur.
        if ((box == 0) != (box_type == 1) || (box_type != 0 && box_type != 1))
            return refuse("La boîte lue a un numéro inattendu.");
        const std::string type = Json::str(tray, "type", 30), color = Json::str(tray, "color", 16);
        if (type.empty() || type.find('\t') != std::string::npos)
            return refuse("Je ne connais pas le type du filament d'un emplacement choisi.");
        if (color.empty() || color.find('\t') != std::string::npos)
            return refuse("Je ne connais pas la couleur du filament d'un emplacement choisi.");
        if (SlotsLogic::EMPTY_SLOT_BLOCKS && static_cast<int>(Json::integer(tray, "status", 0)) == 0)
            return refuse("Un emplacement choisi est vide.");
        if (std::find(used.begin(), used.end(), std::make_pair(box, mat)) != used.end())
            return refuse("Deux couleurs de la pièce sont sur le même emplacement.");
        used.emplace_back(box, mat);
        Slot slot;
        slot.line_end = "\t" + type + "\t" + color + "\t" + std::to_string(box) + "\t" + std::to_string(mat);
        slot.holder   = box_type == 1;
        by_t[t]       = slot;
        if (!have_first) {
            first      = slot;
            have_first = true;
        }
    }
    // Le porte-bobine ne sert qu'à une pièce d'une couleur : avec lui, Orca envoie opGcodeFile et abandonne toute répartition.
    for (const auto& entry : by_t)
        if (entry.second.holder && by_t.size() > 1)
            return refuse("Le porte-bobine ne peut pas servir avec des emplacements de la boîte : une seule couleur sur lui, ou seulement la boîte.");
    if (!SlotsLogic::UNUSED_COLOUR_ON_FIRST_SLOT && static_cast<int>(by_t.size()) != filament_count)
        return refuse("Ce projet a des filaments que la pièce n'utilise pas.");
    std::map<std::string, std::string> out;
    for (int i = 0; i < filament_count; ++i) {
        const auto it = by_t.find(i);
        out["colorMatch_" + std::to_string(i)] = "T1" + std::string(1, char('A' + i)) + (it != by_t.end() ? it->second : first).line_end;
    }
    out["enableSelfTest"] = self_test ? "1" : "0";
    return out;
}

}} // namespace Plyo::CfsLogic
