#pragma once

#include "PlyoSlotsLogic.hpp"

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

namespace Slic3r { class DynamicPrintConfig; }

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
// `access_code` : code d'accès de l'imprimante (Elegoo CC2…), vide si elle n'en demande pas. Jamais journalisé.
void test(const nlohmann::json& printer, const std::string& access_code, std::function<void(nlohmann::json)> done);

// Enregistre la connexion (et la page web) dans le profil, au clic de l'utilisateur sur « Enregistrer ». Un profil
// système d'Orca n'est pas modifiable : la connexion va dans un profil à soi, « Ma <profil> », qui devient actif.
// { ok, profile }
nlohmann::json save(const nlohmann::json& printer, const std::string& webui, const std::string& access_code);

// Préremplit la connexion puis ouvre la fenêtre « Connexion » d'Orca (clé ou code à saisir) : l'utilisateur
// enregistre lui-même par OK. Annulée, la connexion d'avant est remise. { ok, saved }
nlohmann::json open_dialog(const nlohmann::json& printer);

// Lot 10 · « Vérifier la liaison de mon imprimante » après un envoi en échec : la connexion enregistrée dans le profil en
// cours, testée telle quelle en arrière-plan (comme le bouton « Test » de la fenêtre Connexion d'Orca), seulement si son
// adresse est sur le réseau local (SendLogic::local_host). `done` reçoit sur le fil de l'interface { code: ok | auth |
// not_printer | unreachable | error | not_local | none, http, text } (texte d'Orca sans adresse ni code).
void recheck(std::function<void(nlohmann::json)> done);

// Fenêtre « Connexion » d'Orca pour le profil en cours, sans rien préremplir (corriger le code d'accès ou la clé). { saved }
nlohmann::json open_dialog_current();

// Ce que le choix du traducteur doit savoir d'un profil d'imprimante (voir SlotsLogic::detect).
SlotsLogic::PrinterFacts facts_of(const Slic3r::DynamicPrintConfig& config);

// Ouvre l'assistant de configuration d'Orca sur le choix des imprimantes (profil absent).
void open_printer_wizard();

}} // namespace Plyo::PrinterLink
