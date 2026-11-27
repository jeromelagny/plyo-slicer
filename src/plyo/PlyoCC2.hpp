#pragma once

#include "PlyoHooks.hpp" // start_print : appelée par Orca

#include <nlohmann/json.hpp>

#include <functional>
#include <string>
#include <vector>

// Démarrage d'une impression sur une Elegoo Centauri Carbon 2 : Orca sait envoyer le fichier (HTTP) mais pas le
// démarrer, Plyo ajoute la commande par le canal MQTT local de l'imprimante (voir PlyoCC2Logic.hpp). Appelé par
// ElegooLink::loopUploadCC2 (seule retouche d'Orca, listée dans docs/plyo/FICHIERS-MODIFIES.md), après l'envoi.
namespace Plyo { namespace CC2 {

// start_print (appelée par ElegooLink::loopUploadCC2 après l'envoi) : déclarée et décrite dans PlyoHooks.hpp.

// Si un plan d'envoi vise cette imprimante (voir set_plan) et que la pièce découpée a les couleurs du plan, la carte des
// emplacements part avec l'ordre de départ, après une relecture du Canvas. Un départ refusé avec une carte est gardé
// (last_refused) pour « Démarrer sans carte ».

// Plan d'envoi choisi dans Plyo : {host, map:[{t, canvas_id, tray_id, type, preset}]}.
void set_plan(const nlohmann::json& plan);
void clear_plan();
// Lit dans Orca (fil principal) les numéros de filament utilisés par la plaque et les profils de filament par numéro ;
// faux si la lecture n'a pas abouti. Appelé par start_print hors du fil principal.
using OrcaState = std::function<bool(std::vector<int>& sliced_t, std::vector<std::string>& presets)>;
void on_orca_state(OrcaState provider);
// Appelé (hors du fil principal) quand un départ avec carte n'a pas abouti ; reçoit le texte de l'erreur.
void on_refused(std::function<void(const std::string&)> callback);
// {host, serial, filename} du dernier départ refusé avec une carte, ou null.
nlohmann::json last_refused();
// Oublie ce départ refusé (changement de projet : le fichier en attente n'est plus celui de la pièce affichée).
void clear_refused();
// Relance ce départ sans carte (l'imprimante choisit), seulement si `profile_host` (adresse de l'imprimante du profil, celle
// dont `access_code` est le code) est bien celle qui a refusé. Bloquant.
bool start_again_plain(const std::string& profile_host, const std::string& access_code, std::string& error);

// Emplacements du Canvas (voir CC2Logic::parse_canvas_reply), null en cas d'échec (`error` dit pourquoi). Bloquant.
nlohmann::json read_canvas(const std::string& host, const std::string& access_code, const std::string& serial, std::string& error);
// Numéro de série de la CC2 à cette adresse (découverte UDP directe), vide si elle ne répond pas. Bloquant (3 s).
std::string serial_of(const std::string& host);

}} // namespace Plyo::CC2
