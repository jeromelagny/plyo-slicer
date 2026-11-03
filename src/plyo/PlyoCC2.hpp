#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Démarrage d'une impression sur une Elegoo Centauri Carbon 2 : Orca sait envoyer le fichier (HTTP) mais pas le
// démarrer, Plyo ajoute la commande par le canal MQTT local de l'imprimante (voir PlyoCC2Logic.hpp). Appelé par
// ElegooLink::loopUploadCC2 (seule retouche d'Orca, listée dans docs/plyo/FICHIERS-MODIFIES.md), après l'envoi.
namespace Plyo { namespace CC2 {

// `host` : adresse de l'imprimante (IP ou nom) ; `serial` : son numéro de série ; `filename` : nom du fichier envoyé.
// Bloque jusqu'à la réponse de l'imprimante (90 s au plus). Vrai si elle a démarré ; sinon `error` dit pourquoi, en
// français. Le code d'accès n'est jamais écrit dans les journaux.
bool start_print(const std::string& host, const std::string& access_code, const std::string& serial, const std::string& filename,
                 std::string& error);

// Si un plan d'envoi vise cette imprimante (voir set_plan) et que la pièce découpée a les couleurs du plan, la carte des
// emplacements part avec l'ordre de départ, après une relecture du Canvas. Un départ refusé avec une carte est gardé
// (last_refused) pour « Démarrer sans carte ».

// Plan d'envoi choisi dans Plyo : {host, map:[{t, canvas_id, tray_id}], sliced_t:[numéros de filament découpés]}.
void set_plan(const nlohmann::json& plan);
void clear_plan();
// Appelé (hors du fil principal) quand un départ avec carte n'a pas abouti ; reçoit le texte de l'erreur.
void on_refused(std::function<void(const std::string&)> callback);
// {host, serial, filename} du dernier départ refusé avec une carte, ou null.
nlohmann::json last_refused();
// Relance ce départ sans carte (l'imprimante choisit). Bloquant.
bool start_again_plain(const std::string& access_code, std::string& error);

// Emplacements du Canvas (voir CC2Logic::parse_canvas_reply), null en cas d'échec (`error` dit pourquoi). Bloquant.
nlohmann::json read_canvas(const std::string& host, const std::string& access_code, const std::string& serial, std::string& error);
// Numéro de série de la CC2 à cette adresse (découverte UDP directe), vide si elle ne répond pas. Bloquant (3 s).
std::string serial_of(const std::string& host);

}} // namespace Plyo::CC2
