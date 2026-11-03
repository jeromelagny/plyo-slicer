#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

// Logique pure (sans réseau ni Orca, testée par src/plyo/tests/cpp) du démarrage d'une impression sur une Elegoo
// Centauri Carbon 2 : paquets MQTT 3.1.1 minimaux et messages JSON de son protocole local (port 1883, utilisateur
// « elegoo », code d'accès en mot de passe ; méthode 1020 = démarrer l'impression d'un fichier déjà envoyé).
// Protocole rétro-ingénieré par la communauté, vérifié en lecture seule sur une vraie machine : voir JOURNAL-BUILD.md.
namespace Plyo { namespace CC2Logic {

struct Packet
{
    int         type = 0; // type MQTT (1 CONNECT, 2 CONNACK, 3 PUBLISH, 9 SUBACK…)
    std::string body;     // après l'en-tête et la longueur
};

std::string connect_packet(const std::string& client_id, const std::string& user, const std::string& password);
std::string subscribe_packet(unsigned short packet_id, const std::vector<std::string>& topics);
std::string publish_packet(const std::string& topic, const std::string& payload);

// Lit un paquet au début de `buffer`. Faux s'il est incomplet ou mal formé ; sinon `consumed` = octets lus.
bool parse_packet(const std::string& buffer, size_t& consumed, Packet& out);
// Sujet et contenu d'un paquet PUBLISH (QoS 0). Faux si ce n'en est pas un.
bool publish_fields(const Packet& packet, std::string& topic, std::string& payload);

std::string topic_api_register(const std::string& sn);
std::string topic_register_response(const std::string& sn, const std::string& client_id);
std::string topic_api_request(const std::string& sn, const std::string& client_id);
std::string topic_api_response(const std::string& sn, const std::string& client_id);

std::string register_payload(const std::string& client_id);
bool        is_register_ok(const std::string& payload);

// Démarre l'impression de `filename` (fichier déjà envoyé dans le stockage « local » de l'imprimante). `slot_map`
// ([{t, canvas_id, tray_id}], couleur découpée → emplacement du Canvas) n'est ajouté (params.config.slot_map) que s'il
// n'est pas vide : sans carte, le message est celui d'avant et l'imprimante choisit elle-même.
std::string start_print_payload(int id, const std::string& filename, const nlohmann::json& slot_map = nlohmann::json::array());

// Lecture des emplacements du Canvas (méthode 2005, paramètres vides).
std::string canvas_read_payload(int id);
// Réponse à `canvas_read_payload(id)` : null si ce n'en est pas une ; sinon
// {error_code, canvases:[{canvas_id, connected, trays:[{tray_id, brand, type, name, color "#RRGGBB" ou "", min_temp,
// max_temp, status}]}], active:{canvas_id, tray_id}}. Sur la CC2, tray_id va de 0 à 3 (emplacement affiché = tray_id + 1).
nlohmann::json parse_canvas_reply(const std::string& payload, int id);
// La carte réduite à {t, canvas_id, tray_id} si chaque entrée est valable (t entier ≥ 0 sans doublon, unité connectée,
// emplacement existant) ; sinon un tableau vide : jamais de carte partielle.
nlohmann::json sanitize_slot_map(const nlohmann::json& map, const nlohmann::json& canvases);
// Carte du plan d'envoi ({host, map}) si l'envoi vise cette imprimante et que la pièce découpée utilise exactement les
// couleurs de la carte (`sliced_t`, numéros de filament à partir de 0) ; sinon un tableau vide.
nlohmann::json map_for_send(const nlohmann::json& plan, const std::string& host, const std::vector<int>& sliced_t);
// Numéro de série dans la réponse de découverte (méthode 7000) ; vide s'il n'y est pas.
std::string serial_from_discovery(const std::string& datagram);

struct StartReply
{
    bool matched    = false; // c'est bien la réponse à cette demande (même id, méthode 1020)
    int  error_code = -1;    // 0 = démarrée
};
StartReply parse_start_reply(const std::string& payload, int id);

// Texte français pour un code d'erreur de l'imprimante.
std::string error_text(int error_code);

}} // namespace Plyo::CC2Logic
