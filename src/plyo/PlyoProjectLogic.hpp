#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>
#include <vector>

// Logique pure du « projet » d'une conversation (sans Orca ni wxWidgets, testée par src/plyo/tests/cpp) :
// { "printer": {"preset", "name"}, "filament": {"type", "preset", "nozzle_temp", "bed_temp"}, "part": {"name"} }.
// Chaque clé est absente ou null tant que l'utilisateur ne l'a pas choisie. Le projet ne porte jamais de secret
// (code d'accès d'imprimante…) : seules les clés ci-dessus sont lues.
namespace Plyo { namespace ProjectLogic {

// Étapes pas encore choisies, dans l'ordre « printer », « filament », « part ». Un projet null ou abîmé les a toutes.
std::vector<std::string> missing(const nlohmann::json& project);

bool complete(const nlohmann::json& project);

// Texte français pour l'utilisateur si une modification doit être refusée (fiche incomplète, ou profils d'Orca qui ne
// sont plus ceux du projet) ; chaîne vide si elle est permise.
std::string refusal(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament);

struct Adaptation
{
    nlohmann::json apply   = nlohmann::json::array(); // [{key, value}]
    nlohmann::json dropped = nlohmann::json::array(); // [{key, reason}]
};

// Réglages lus dans un 3MF ({clé du catalogue: valeur}) adaptés au projet : les températures viennent toujours de la
// fiche ; une autre valeur numérique hors de la plage de `range_of(clé)` ({min, max}) est écartée et signalée ;
// une clé sans plage (null : hors liste blanche de l'assistant) ou une valeur non numérique est ignorée.
Adaptation adapt_3mf(const nlohmann::json& file_values, const nlohmann::json& project,
                     const std::function<nlohmann::json(const std::string&)>& range_of);

}} // namespace Plyo::ProjectLogic
