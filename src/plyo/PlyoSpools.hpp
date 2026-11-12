#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Bobines retenues par Plyo : registre datadir/plyo/bobines.json (logique dans PlyoSpoolsLogic), et un préréglage de
// filament Orca par bobine et par machine, nommé « <bobine> — <machine> ». Tout reste sur l'ordinateur.
namespace Plyo { namespace Spools {

// Bobines connues, vues depuis ce préréglage d'imprimante (vide : celui en cours) : SpoolsLogic::for_machine.
nlohmann::json list(const std::string& printer_preset);

// Bobine nommée par l'utilisateur (retrouvée si elle existe déjà, créée sinon), puis son préréglage pour cette machine :
// choisi s'il existe, sinon créé depuis le profil système de la matière compatible avec la machine en cours (jamais depuis
// les valeurs d'une autre machine), compatible avec elle seule, et choisi. L'imprimante doit être celle en cours.
// { ok, id, name, preset, printer, created, cancelled?, text? } (`created` : la bobine est nouvelle ; `printer` si ok).
nlohmann::json create_or_choose(const std::string& name, const std::string& material, const std::string& printer_preset);

// Ce préréglage filament est-il celui d'une bobine du registre (hors nom encore « en attente ») ? Le registre est gardé
// en mémoire après sa première lecture (relu seulement après une écriture par Plyo) : appelable souvent, sans disque.
bool is_spool_preset(const std::string& filament_preset);

// Bobine du premier filament en cours : { id, name }, ou {} si ce préréglage n'est pas une bobine.
nlohmann::json current();

// Bobine du premier filament en cours, avec l'imprimante et le préréglage : { id, name, printer, preset }, ou {}.
nlohmann::json current_full();

// Valeurs filament du catalogue de ce préréglage, en texte d'Orca ({clé: texte}) : celles de l'onglet (modifications
// comprises) s'il est le filament en cours de l'onglet, sinon celles enregistrées. {} s'il n'existe pas.
nlohmann::json preset_values(const std::string& preset);

// Version envoyée (`ok` faux : plyo/essai) ou réussie (`ok` vrai : plyo/fiable) de la bobine `id` sur cette imprimante :
// {spool, printer, date, values} (SpoolsLogic::sanitize_version), ou {} si absente ou pas à elles.
nlohmann::json read_version(bool ok, const std::string& id, const std::string& printer);
bool           write_version(bool ok, const nlohmann::json& version);

// Dernier envoi ou export (plyo/essai/dernier-envoi.json) : {spool, printer, date, at} (SpoolsLogic::last_sent), ou {}.
nlohmann::json read_last_sent();
bool           write_last_sent(const nlohmann::json& pointer);

// Nom de la bobine `id`, vide si elle est inconnue.
std::string name_of(const std::string& id);

// Note le résultat d'une impression dans le registre (SpoolsLogic::set_outcome). Faux si rien n'a changé ou pas écrit.
bool note_outcome(const std::string& id, const std::string& printer, const std::string& outcome, const std::string& date);

// Dernière version réussie de la bobine `id` sur cette imprimante, comparée à son préréglage d'aujourd'hui :
// {available, date, differs, summary} (summary : « débit 0,88 », au plus 3 réglages).
nlohmann::json success_for(const std::string& id, const std::string& printer);

}} // namespace Plyo::Spools
