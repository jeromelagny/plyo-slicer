#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Mémoire de la machine : les changements de réglages appliqués par l'assistant, rangés par imprimante et
// filament (datadir/plyo/memoire.json), renvoyés à l'IA pour qu'elle reparte de ce qui a déjà été essayé.
namespace Plyo { namespace Memory {

constexpr size_t MAX_PER_MACHINE = 10;
constexpr size_t MAX_MACHINES    = 50;

// `before` et `after` : messages « values » (read_values) avant et après l'application ; seuls les réglages
// dont la valeur a changé sont notés. `why` : ce qui a motivé le changement (titre de la réponse).
// Renvoie la clé de la machine notée, ou "" si rien n'a changé (à rattacher au lot d'annulation).
std::string    note_applied(const nlohmann::json& before, const nlohmann::json& after, const std::string& why);
// Annulation d'un lot : retire la dernière entrée de cette machine.
void           forget(const std::string& machine_key);
// [{date, changes: [{id, before, after}], why}] pour l'imprimante et le filament en cours, du plus récent au plus ancien.
nlohmann::json for_current();

}} // namespace Plyo::Memory
