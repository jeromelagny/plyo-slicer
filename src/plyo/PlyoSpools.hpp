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
// { ok, id, name, preset, created, cancelled?, text? } (`created` : la bobine est nouvelle).
nlohmann::json create_or_choose(const std::string& name, const std::string& material, const std::string& printer_preset);

// Ce préréglage filament est-il celui d'une bobine du registre (hors nom encore « en attente ») ? Le registre est gardé
// en mémoire après sa première lecture (relu seulement après une écriture par Plyo) : appelable souvent, sans disque.
bool is_spool_preset(const std::string& filament_preset);

// Bobine du premier filament en cours : { id, name }, ou {} si ce préréglage n'est pas une bobine.
nlohmann::json current();

}} // namespace Plyo::Spools
