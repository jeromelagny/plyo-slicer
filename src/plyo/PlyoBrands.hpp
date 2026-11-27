#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Marque d'une bobine, côté Orca : les profils de filament fournis (système) d'une matière, compatibles avec l'imprimante en
// cours, qui ne sont pas génériques. Lecture seule ; rien n'écrit dans un profil fourni. Rangement et rapprochement : BrandsLogic.
// Un profil de marque n'est choisi que sur un geste de l'utilisateur dans le panneau (spool_choose, canvas_apply), jamais par
// un ordre de l'IA.
namespace Plyo { namespace Brands {

// Profils de marque de cette matière (filament_type exact, première valeur), compatibles avec l'imprimante en cours
// (Preset::is_compatible, tenu à jour par Orca à chaque changement d'imprimante, comme pour FirstSteps::best_filament) :
// BrandsLogic::group. Un profil fourni non coché dans la fenêtre « Filaments » d'Orca compte aussi (is_visible n'est pas exigé).
nlohmann::json groups(const std::string& material);

// Pour un emplacement de type `type` : la matière retenue comme Canvas::apply (CanvasLogic::profile_types, la première qui a
// un profil chez FirstSteps::best_filament) et ses marques : {material, brands}. Matière introuvable : {material: "", brands: []}.
nlohmann::json for_type(const std::string& type);

// Le profil `preset` est-il un profil de marque de cette matière pour l'imprimante en cours ? Son entrée {brand, label, short,
// preset}, ou {}.
nlohmann::json check(const std::string& material, const std::string& preset);

// Ce préréglage d'imprimante est-il celui choisi dans Orca ? (vide : non)
bool is_current_printer(const std::string& printer_preset);

// Profil de marque choisi par l'utilisateur : coché comme installé (section « filaments » des préférences d'Orca, comme le fait
// sa fenêtre « Filaments »), pour qu'Orca le garde au prochain lancement au lieu de le remplacer par un autre.
void keep_visible(const std::string& preset);

}} // namespace Plyo::Brands
