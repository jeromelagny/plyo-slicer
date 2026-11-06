#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Logique pure de la Snapmaker U1, testée par src/plyo/tests/cpp : lecture des 4 têtes, jamais de répartition imposée (la U1 n'a aucun
// champ de répartition à l'envoi). NON VALIDÉE sur machine : schéma lu dans SnapmakerPrinterAgent.cpp ; print_task_config décrit-il
// les têtes chargées ou la dernière tâche ? À établir en T17. Le réordonnancement (T18 à T21) attend T17 et la décision de Jérôme.
namespace Plyo { namespace U1Logic {

// Réponse de /printer/objects/query → {ok, canvases} au format commun : une unité canvas_id 0, tray_id = index, label = index + 1.
// Couleur RRGGBBAA → #RRGGBB ; type en majuscules, sous-type CF/GF → « -CF » / « -GF » ; un type vide reste vide (contrairement à
// SnapmakerPrinterAgent::combine_filament_type, qui rend « PLA ») ; champ absent ou de longueur différente : neutre. Ne lève jamais.
nlohmann::json parse_query(const std::string& body);
// print_host du profil → adresse de la requête ; vide si l'hôte est vide.
std::string query_url(const std::string& print_host);

}} // namespace Plyo::U1Logic
