#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Le « projet » d'une conversation (imprimante, filament, pièce, voir PlyoProjectLogic.hpp) côté Orca : état courant,
// imprimantes configurées, et remise du projet dans Orca. Aucun secret n'en sort (pas de code d'accès).
namespace Plyo { namespace Project {

// {printer_preset, filament_preset, nozzle_temp, bed_temp} : les profils édités d'Orca. Températures null si illisibles.
nlohmann::json state();

// Imprimantes installées et visibles : [{preset, name, linked}] ; `linked` = une adresse de connexion est enregistrée.
nlohmann::json printers();

// Le profil répond-il sur le réseau ? Test en tâche de fond ; `done(false)` si le profil est inconnu ou sans connexion.
void reachable(const std::string& preset, std::function<void(bool)> done);

// Remet imprimante, filament et températures du projet dans Orca. Si des réglages non enregistrés seraient perdus et
// que `discard_unsaved` est faux : {ok:false, needs_confirmation:true} sans rien changer. {ok, text, needs_confirmation?}
nlohmann::json restore(const nlohmann::json& project, bool discard_unsaved);

}} // namespace Plyo::Project
