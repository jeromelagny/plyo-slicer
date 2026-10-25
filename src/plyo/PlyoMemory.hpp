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
// `ask` : {conv, defect} pour des réglages proposés par l'IA ; l'entrée attend alors le résultat (« Ça a marché ? »).
std::string    note_applied(const nlohmann::json& before, const nlohmann::json& after, const std::string& why,
                            const nlohmann::json& ask = nullptr);
// Annulation d'un lot : retire la dernière entrée de cette machine.
void           forget(const std::string& machine_key);
// [{date, changes: [{id, before, after}], why}] pour l'imprimante et le filament en cours, du plus récent au plus ancien.
nlohmann::json for_current();

// Dernière entrée de l'imprimante et du filament en cours qui attend son résultat :
// {machine, at, date, why, defect, conv, changes}, ou null.
nlohmann::json pending();

// Résultat déclaré pour l'entrée `at` de `machine` : "ok", "bad", ou "later" (redemander plus tard ; après
// 3 reports, le résultat devient « inconnu » et on ne demande plus). Faux si l'entrée n'existe plus.
bool           set_outcome(const std::string& machine, const std::string& at, const std::string& outcome);

}} // namespace Plyo::Memory
