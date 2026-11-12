#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>
#include <vector>

// Logique pure de la mémoire des corrections (une liste d'entrées d'une machine, telle que memoire.json la range) : sans
// Orca ni fichier, testée par src/plyo/tests/cpp.
namespace Plyo { namespace MemoryLogic {

// L'étape Résultat d'un projet commence (l'impression est partie) : les corrections de `conv` qui attendent leur résultat
// et ne sont rattachées à aucune impression le sont (`printed` = `now`). La question de l'étape Résultat les couvre ; une
// correction appliquée plus tard (pendant l'impression) attend la suivante. Rend le nombre d'entrées rattachées.
int mark_printed(nlohmann::json& list, const std::string& conv, const std::string& now);

// Réponse à la question de l'étape Résultat : `outcome` (« ok » ou « bad ») sur les corrections de `conv` rattachées à cette
// impression, encore sans réponse (« pending », ou « unknown » après trois reports). `ats` non vide : exactement ces
// entrées-là, quelle que soit leur réponse d'avant (changement d'avis sur la même impression). Rend les entrées marquées,
// de la plus récente à la plus ancienne.
nlohmann::json mark_result(nlohmann::json& list, const std::string& conv, const std::string& outcome, const std::vector<std::string>& ats);

// Changements notés sans libellé (versions d'avant le lot 4) : le titre du catalogue (`title`, vide si inconnu) est ajouté,
// pour qu'aucune question ne montre une clé brute. Un libellé déjà noté est gardé.
nlohmann::json with_labels(const nlohmann::json& changes, const std::function<std::string(const std::string&)>& title);

}} // namespace Plyo::MemoryLogic
