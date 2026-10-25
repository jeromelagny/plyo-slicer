#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Journal des pièces (datadir/plyo/journal.json) : pour chaque pièce traitée avec l'assistant, le problème vu,
// une vignette, les réglages appliqués et le résultat déclaré. Reste sur l'ordinateur.
namespace Plyo { namespace Journal {

constexpr size_t MAX_EVENTS      = 200;
constexpr size_t MAX_THUMB_BYTES = 40 * 1024;

// Après une réponse de l'IA : {conv, parts, printer, filament, problem, defect, thumb}. Une seule entrée par
// conversation et par pièce : une nouvelle réponse la met à jour (la vignette d'origine est gardée).
void           record(const nlohmann::json& event);
// Réglages de l'IA appliqués dans la conversation `conv` : notés sur sa dernière entrée, résultat attendu.
void           set_changes(const std::string& conv, const nlohmann::json& changes);
// Réglages annulés : la dernière entrée de `conv` n'a plus de réglages appliqués.
void           clear_changes(const std::string& conv);
// Résultat déclaré (« ok » ou « bad ») pour la dernière entrée de `conv` qui a des réglages.
void           set_outcome(const std::string& conv, const std::string& outcome);
// Toutes les entrées, de la plus récente à la plus ancienne.
nlohmann::json list();

}} // namespace Plyo::Journal
