#pragma once

#include <string>
#include <vector>

// Envoi à l'imprimante par la file d'envoi d'Orca (hôtes d'impression : OctoPrint, Moonraker, PrusaLink, Creality, Elegoo,
// Flashforge…) et fenêtres de message d'Orca : ce que le panneau en dit est décidé par des éléments stables (code HTTP du
// format d'Orca, étape atteinte par l'envoi, ce qu'Orca a pris ou non), jamais par le texte traduit d'Orca, qui n'est que
// montré, une fois nettoyé. Sans dépendance à wxWidgets ni à Orca (testé par src/plyo/tests/cpp).
namespace Plyo { namespace SendLogic {

// Code HTTP d'un message d'erreur d'envoi : PrintHost::format_error d'Orca écrit « HTTP <code>: … » (format non traduit) en
// tête de ligne. 0 s'il n'y en a pas (erreur de réseau, ou hôte qui ne passe pas par ce format).
int http_status(const std::string& message);

// Étape atteinte par un envoi suivi, d'après la progression reçue de la file d'Orca : « connect » (aucun octet du fichier
// n'est parti : connexion, test de l'hôte), « upload » (le fichier part), « sent » (Orca a tout envoyé : l'imprimante
// répond, ou démarre). `last_progress` : dernier pourcentage reçu (-1 : aucun) ; `hundreds` : nombre de « 100 % » reçus.
std::string step_of(int last_progress, int hundreds);

// Famille d'un échec d'envoi : auth (401, 403), no_space (413, 507), file_refused (400, 409, 415, 422), not_printer (404,
// 405), server_error (5xx), autre code : unknown ; sans code : unreachable si rien n'est parti (étape « connect »),
// interrupted pendant l'envoi (étape « upload »), no_confirmation après « 100 % » (étape « sent » : le fichier est arrivé,
// mais l'imprimante n'a pas confirmé le démarrage).
std::string failure_code(int http, const std::string& step);

// Verdict d'un envoi demandé par le panneau, une fois la fenêtre d'envoi d'Orca fermée et ses messages éventuels ouverts :
// « taken » (Orca a mis l'envoi dans sa file), « refused » (Orca a ouvert une fenêtre d'erreur), « closed » (la fenêtre
// d'envoi s'est fermée sans envoi), « not_ready » (la plaque a une erreur d'Orca), « not_started » (rien de tout ça).
std::string verdict(bool handed, bool error_dialog, bool send_dialog_seen, bool plate_error);

// Fin d'un envoi réussi : la file d'Orca dit « 100 % » quand le fichier est entièrement parti (progression du transfert),
// puis encore « 100 % » quand l'hôte a répondu sans erreur. Deux « 100 % » : arrivé ; un seul (hôte sans progression du
// transfert) : arrivé si aucune erreur ne suit pendant ARRIVED_QUIET_MS.
constexpr int ARRIVED_QUIET_MS = 2500;
bool arrived_now(int hundreds);

// Texte d'Orca sans adresse du réseau : adresses web (http://…), adresses IPv4 et IPv6 (avec leur port), noms « .local », et
// chaque élément de `hosts` (adresse enregistrée de l'imprimante, son nom) remplacés par « [adresse] » ; chaque élément de
// `secrets` (code d'accès, clé d'API, numéro de série) par « [code] ». Les éléments de moins de 3 caractères sont ignorés.
std::string scrub_network(const std::string& text, const std::vector<std::string>& hosts, const std::vector<std::string>& secrets);

// Adresse d'imprimante sur le réseau local (le panneau ne teste jamais une adresse d'internet) : IPv4 privée (10/8,
// 172.16/12, 192.168/16), de bouclage (127/8) ou de lien local (169.254/16), IPv6 de bouclage, de lien local ou privée,
// « localhost », nom en « .local », ou nom sans point (réseau de la maison). Schéma, identifiant, port et chemin ignorés.
bool local_host(const std::string& print_host);

// Résultat d'un test de la liaison enregistrée : ok, auth (401, 403), not_printer (404, 405), unreachable (pas de code),
// error (autre code).
std::string link_code(bool ok, int http);

}} // namespace Plyo::SendLogic
