#pragma once

#include <nlohmann/json.hpp>

#include <optional>
#include <string>
#include <vector>

// Logique pure de la recherche d'imprimantes sur le réseau local (sans réseau ni wxWidgets, testée par
// src/plyo/tests/cpp) : adresses à essayer, lecture des réponses des imprimantes, fusion des résultats.
// Les résultats restent sur l'ordinateur : ils ne sont jamais envoyés au service Plyo ni à l'IA.
namespace Plyo { namespace Discovery {

// Une imprimante trouvée. `host_type` est la valeur Orca de la connexion (« moonraker », « crealityprint »,
// « flashforge », « octoprint », « elegoolink ») ; `host` est l'adresse à saisir (avec le port s'il le faut).
struct Printer
{
    std::string ip;
    std::string name;      // nom affiché : « K1C-1A2B », « Centauri Carbon »…
    std::string brand;     // « Creality », « Elegoo », « Flashforge »… ; vide si inconnue
    std::string host_type;
    std::string host;
    int         priority = 0; // en cas de doublon (même IP), la source la plus précise gagne
};

// Adresse IPv4 privée de la maison (10.x, 172.16-31.x, 192.168.x) : seuls ces réseaux sont parcourus.
bool is_private_ipv4(const std::string& ip);

// Les 253 autres adresses du /24 de `local_ip` (sans elle-même ni .0/.255) ; vide si l'adresse n'est pas privée.
std::vector<std::string> neighbours(const std::string& local_ip);

// Réponse de Moonraker (GET /printer/info, port 7125) : Klipper, dont les Creality K1, Ender-3 V3 KE, Hi…
std::optional<Printer> from_moonraker(const std::string& ip, const std::string& body);

// Réponse d'une imprimante Elegoo au message de recherche SDCP (« M99999 » sur le port UDP 3000).
std::optional<Printer> from_elegoo_sdcp(const std::string& datagram);

// Marque devinée d'après un nom d'imprimante (« K1C-1A2B » → Creality) ; vide si rien ne correspond.
std::string brand_from_name(const std::string& name);

// Modèle d'après le nom trouvé, en minuscules et sans la marque : « K2-DD52 » → « k2 », « Creality K2 Plus » → « k2 plus ».
// Vide si le nom ne dit rien du modèle (« Imprimante Klipper »).
std::string model_hint(const Printer& p);

// Le profil d'imprimante (`printer_model` d'Orca, ex. « Creality K2 ») correspond-il au modèle trouvé ?
bool profile_matches(const std::string& printer_model, const std::string& hint);

// Types de connexion que le panneau peut demander (liste blanche), et forme d'une adresse « ip » ou « ip:port ».
bool allowed_host_type(const std::string& host_type);
bool valid_host(const std::string& host);

// Fusionne les résultats de toutes les sources : une entrée par IP (la plus prioritaire), triées par nom.
std::vector<Printer> merge(std::vector<Printer> found);

nlohmann::json to_json(const std::vector<Printer>& printers);

}} // namespace Plyo::Discovery
