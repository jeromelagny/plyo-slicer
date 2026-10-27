#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Relier une imprimante trouvée sur le réseau local au profil d'imprimante d'Orca (la connexion est rangée dans
// le profil : print_host, host_type). Le panneau envoie l'imprimante choisie ({ip, name, brand, host_type, host}) ;
// tout est vérifié ici (liste blanche des types, adresse privée) avant d'être utilisé.
namespace Plyo { namespace PrinterLink {

// Le profil en cours correspond-il à l'imprimante ? Sinon, les profils installés qui lui correspondent.
// { ok, current, matches, linked, candidates: [noms] } ; ok=false si l'imprimante reçue est invalide.
nlohmann::json check(const nlohmann::json& printer);

// Sélectionne un profil d'imprimante installé (choix de l'utilisateur dans le panneau). { ok }
nlohmann::json select_profile(const std::string& name);

// Teste la connexion en arrière-plan (réseau local) et cherche la page web de l'imprimante (onglet « Appareil »).
// `done` reçoit { ok, message, webui } sur le fil de l'interface.
void test(const nlohmann::json& printer, std::function<void(nlohmann::json)> done);

// Enregistre la connexion (et la page web) dans le profil, au clic de l'utilisateur sur « Enregistrer ». Un profil
// système d'Orca n'est pas modifiable : la connexion va dans un profil à soi, « Ma <profil> », qui devient actif.
// { ok, profile }
nlohmann::json save(const nlohmann::json& printer, const std::string& webui);

// Préremplit la connexion puis ouvre la fenêtre « Connexion » d'Orca (clé ou code à saisir) : l'utilisateur
// enregistre lui-même par OK. Annulée, la connexion d'avant est remise. { ok, saved }
nlohmann::json open_dialog(const nlohmann::json& printer);

// Ouvre l'assistant de configuration d'Orca sur le choix des imprimantes (profil absent).
void open_printer_wizard();

}} // namespace Plyo::PrinterLink
