#pragma once

#include <nlohmann/json.hpp>

namespace Plyo { namespace Preflight {

// Mesures du plateau en cours pour la vérification avant impression : réglages de bordure et de supports,
// et pour chaque pièce sa hauteur, son emprise, sa surface posée et l'alerte « supports nécessaires » du
// dernier découpage d'Orca. Les risques sont déduits côté panneau (preflight.js).
nlohmann::json measure();

// Mêmes mesures, pour la question envoyée à l'IA (lecture seule, plaque en cours) : {objects: {"<ref>": {needs_support,
// contact_mm2}}, conflict: bool} ; `ref` est l'identifiant de pièce de PlateActions::context, `conflict` n'est donné que
// pour une plaque découpée. null sans plateau.
nlohmann::json ai_facts();

}} // namespace Plyo::Preflight
