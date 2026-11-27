#pragma once

#include <nlohmann/json.hpp>

#include <map>
#include <string>
#include <vector>

// Logique pure de l'IFS (Flashforge AD5X), testée par src/plyo/tests/cpp. NON VALIDÉE sur machine : schéma lu dans le code d'Orca
// (Flashforge::parse_material_slots, FlashforgePrintHostSendDialog), à confronter à une vraie lecture en T9 et à de vrais départs
// en T14 et T15. Struct à part : Flashforge.hpp tire wxWidgets, que la logique pure ne voit pas.
namespace Plyo { namespace IfsLogic {

struct Slot
{
    int         slot_id = 0; // à partir de 1
    bool        has_filament = false;
    std::string material_name;
    std::string material_color;
};

// Une unité (canvas_id 0) ; tray_id = label = slot_id ; raw_color : la couleur telle que la machine l'a donnée, renvoyée
// telle quelle dans slotMaterialColor. Un numéro impossible (≤ 0) est écarté.
nlohmann::json canvases_from_slots(const std::vector<Slot>& slots);
// `supports_material_station` vrai, au moins un emplacement, numéros > 0 et sans doublon ; sinon on lit sans imposer.
bool live_imposable(bool supports_material_station, const std::vector<Slot>& slots);

// Même matière : majuscules, seulement lettres et chiffres, comparaison exacte. Plus strict que normalize_material du dialogue
// d'Orca, qui regroupe (ASA = ABS, tout ce qui contient PLA = PLA) : ici, le doute est un refus. Vide : jamais la même.
bool same_material(const std::string& a, const std::string& b);

// Carte vérifiée ([{t, canvas_id, tray_id}]) → extended_info de Flashforge::upload_local_api, comme le dialogue d'Orca :
// levelingBeforePrint, timeLapseVideo, useMatlStation « 1 », gcodeToolCnt, materialMappings = JSON (pas de base64 : l'hôte
// l'encode) [{toolId, slotId, materialName, toolMaterialColor, slotMaterialColor}], seulement les couleurs utilisées.
// `tools` : [{t, color, type}] de la plaque. `refusal` non vide et résultat vide si un doute subsiste : emplacement vide,
// matière différente, deux couleurs sur le même emplacement, couleur ou type inconnu, entrée absente de la lecture.
std::map<std::string, std::string> mapping_info(const nlohmann::json& map, const nlohmann::json& canvases, const nlohmann::json& tools, bool leveling, bool timelapse,
                                                std::string& refusal);

}} // namespace Plyo::IfsLogic
