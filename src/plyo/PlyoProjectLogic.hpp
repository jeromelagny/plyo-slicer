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

// Le projet réduit à ses clés connues (aucun secret, aucun chemin de fichier), prêt à être enregistré avec la
// conversation. null si ce n'est pas un objet. `step` (étape guidée) : slice, print, after, ou done (parcours terminé ou passé).
nlohmann::json sanitize(const nlohmann::json& project);

// Réglages d'un projet 3MF (Metadata/project_settings.config) aplatis : { clé: texte }, première valeur des listes,
// valeurs non textuelles et listes vides ignorées.
nlohmann::json first_values(const nlohmann::json& settings);

struct Adaptation
{
    nlohmann::json apply   = nlohmann::json::array(); // [{key, value}]
    nlohmann::json dropped = nlohmann::json::array(); // [{key, reason}]
};

// Réglages lus dans un 3MF ({clé du catalogue: valeur}) adaptés au projet : les températures viennent toujours de la
// fiche ; une autre valeur numérique hors de la plage de `range_of(clé)` ({min, max}, bornes facultatives) est écartée
// et signalée ; un booléen ou un texte d'une clé permise passe tel quel ; une clé que `range_of` rend null (hors de ce
// que l'assistant peut modifier) est ignorée.
Adaptation adapt_3mf(const nlohmann::json& file_values, const nlohmann::json& project,
                     const std::function<nlohmann::json(const std::string&)>& range_of);

}} // namespace Plyo::ProjectLogic
