#pragma once

#include "PlyoProfilesLogic.hpp"

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

// Registre des bobines : la part sans Orca (testée par src/plyo/tests/cpp).
namespace Plyo { namespace SpoolsLogic {

// Nom de bobine saisi, nettoyé : espaces de bord supprimés, espaces multiples réduits, / \ : * ? " < > | remplacés par
// un espace, coupé à 60 octets sur un caractère entier. "" si le résultat fait moins de 3 caractères.
std::string clean_name(const std::string& typed);

// Clé de comparaison de deux noms : minuscules ASCII, espaces réduits.
std::string key_of(const std::string& name);

// Nom du préréglage filament d'une bobine pour une machine : « <bobine> — <machine> », coupé à Profiles::MAX_NAME_BYTES.
// S'il existe déjà chez l'utilisateur (`existing`) sans être à nous (`ours`) : « 2 », « 3 »… ; s'il est à nous, on l'écrase.
std::string preset_name(const std::string& spool, const std::string& machine_label, const std::vector<std::string>& existing,
                        const std::vector<std::string>& ours);

// Registre lu depuis le disque, remis en forme : {spools: [{id, name, material, machines: {<imprimante>: {preset,
// last_outcome: "ok"|"bad"|"", last_ok_at: "AAAA-MM-JJ"|""}}}]}. Lignes invalides écartées, 200 bobines au plus.
nlohmann::json sanitize(const nlohmann::json& raw);

// Ajoute une bobine : {reg, id, created}. Une bobine de même `key_of` est reprise (created faux). Refus (nom ou matière
// invalide, registre plein) : registre inchangé, id "", created faux.
nlohmann::json add(const nlohmann::json& reg, const std::string& name, const std::string& material);

// Bobines pour une imprimante : [{id, name, material, has_preset, last_outcome, last_ok_at}], la dernière réussite d'abord.
nlohmann::json for_machine(const nlohmann::json& reg, const std::string& printer);

// Id de la bobine qui possède ce préréglage filament, ou "".
std::string spool_of_preset(const nlohmann::json& reg, const std::string& filament_preset);

}} // namespace Plyo::SpoolsLogic
