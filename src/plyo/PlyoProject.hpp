#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Le « projet » d'une conversation (imprimante, filament, pièce, voir PlyoProjectLogic.hpp) côté Orca : état courant,
// imprimantes configurées, et remise du projet dans Orca. Aucun secret n'en sort (pas de code d'accès).
namespace Plyo { namespace Project {

// {printer_preset, filament_preset, nozzle_temp, bed_temp} : les profils édités d'Orca. Températures null si illisibles.
nlohmann::json state();

// Couleur 1 de la plaque (premier filament d'Orca) : {preset, type, nozzle_temp, bed_temp}. Températures null si l'onglet
// Filament montre une autre couleur. Sert à la fiche quand une couleur est supprimée dans la barre latérale.
nlohmann::json first_filament();

// Imprimantes installées et visibles : [{preset, name, linked}] ; `linked` = une adresse de connexion est enregistrée.
nlohmann::json printers();

// Le profil répond-il sur le réseau ? Test en tâche de fond ; `done(false)` si le profil est inconnu ou sans connexion.
void reachable(const std::string& preset, std::function<void(bool)> done);

// Remet imprimante, filament et températures du projet dans Orca. Si des réglages non enregistrés seraient perdus et
// que `discard_unsaved` est faux : {ok:false, needs_confirmation:true} sans rien changer. {ok, text, needs_confirmation?}
nlohmann::json restore(const nlohmann::json& project, bool discard_unsaved);

// Pour un fichier 3MF posé sur le plateau : ses réglages d'impression (Metadata/project_settings.config) adaptés au projet
// (voir ProjectLogic::adapt_3mf), appliqués d'un coup et annulables. Seuls les réglages d'impression du catalogue sont
// repris : le filament et les températures sont ceux de la fiche. Renvoie {} si le fichier n'a pas de réglages ou si le
// projet n'a pas encore son imprimante et son filament ; sinon {adapted:[{label,before,after}], dropped:[{label,reason}],
// undo_id, error?}. Orca n'applique pas lui-même ces réglages (l'import de Plyo ne charge que le modèle).
nlohmann::json adapt_file(const std::string& path_utf8, const nlohmann::json& project);

}} // namespace Plyo::Project
