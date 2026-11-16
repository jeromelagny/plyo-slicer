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
// { ok, id, name, preset, printer, created, preset_created, brand, range, base, brand_profile, cancelled?, text? } (`created` :
// la bobine est nouvelle ; `preset_created` : son préréglage pour cette machine vient d'être créé ; `printer`, `preset_created`,
// `brand`, `range`, `base` (profil dont il hérite) et `brand_profile` (ce profil est celui d'une marque) si ok).
// Marque (choix de l'utilisateur à l'étape Filament) : `brand` et `range` sont gardés avec une NOUVELLE bobine ; `brand_preset`,
// s'il est donné, est le profil de départ, vérifié par Brands::check (sinon refus). Sans lui, une bobine déjà nommée avec sa
// gamme reprend exactement la même gamme sur cette imprimante si elle existe (BrandsLogic::same_range), sinon le générique.
// Une bobine qui a déjà son préréglage sur cette machine le garde, quelle que soit la marque donnée.
nlohmann::json create_or_choose(const std::string& name, const std::string& material, const std::string& printer_preset,
                                const std::string& brand_preset = "", const std::string& brand = "", const std::string& range = "");

// Préréglage de l'utilisateur choisi dans Orca (filament 1), hors registre : peut-on proposer d'en faire une bobine ?
// { preset, offer, material } ; `offer` faux pour un profil système, une bobine, un autre préréglage que le filament 1 en
// cours ou une matière que Plyo ne connaît pas.
nlohmann::json adopt_offer(const std::string& filament_preset);

// L'utilisateur a dit oui : ce préréglage est inscrit au registre pour l'imprimante en cours, sans être renommé ni
// enregistré. { ok, id, name, preset, text? }.
nlohmann::json adopt(const std::string& filament_preset, const std::string& name);

// Ce préréglage filament est-il celui d'une bobine du registre (hors nom encore « en attente ») ? Le registre est gardé
// en mémoire après sa première lecture (relu seulement après une écriture par Plyo) : appelable souvent, sans disque.
bool is_spool_preset(const std::string& filament_preset);

// Bobine du premier filament en cours : { id, name }, ou {} si ce préréglage n'est pas une bobine.
nlohmann::json current();

// Bobine du premier filament en cours, avec l'imprimante et le préréglage : { id, name, printer, preset }, ou {}.
nlohmann::json current_full();

// Le premier filament d'Orca, pour la carte « Orca est passé sur … » (UX-35) : {preset, material (filament_type), spool
// ({id, name} ou null si ce n'est pas une bobine), adoptable (il peut devenir une bobine : adopt)}.
nlohmann::json about_current();

// Valeurs filament du catalogue de ce préréglage, en texte d'Orca ({clé: texte}) : celles de l'onglet (modifications
// comprises) s'il est le filament en cours de l'onglet, sinon celles enregistrées. {} s'il n'existe pas.
nlohmann::json preset_values(const std::string& preset);

// Version envoyée (`ok` faux : plyo/essai) ou réussie (`ok` vrai : plyo/fiable) de la bobine `id` sur cette imprimante :
// {spool, printer, date, values} (SpoolsLogic::sanitize_version), ou {} si absente ou pas à elles.
// Réglages d'impression de ce projet qui suivent la bobine (SpoolsLogic::carries_with_spool) et diffèrent du profil
// d'impression enregistré : {clé: texte d'Orca}. Notés avec la version envoyée de la bobine.
nlohmann::json print_values();

// Parmi les réglages d'impression réussis `ok_print`, ceux à remettre dans ce projet (SpoolsLogic::print_to_restore).
nlohmann::json print_to_restore(const nlohmann::json& ok_print);

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
