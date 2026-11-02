#pragma once

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

}} // namespace Plyo::CC2
