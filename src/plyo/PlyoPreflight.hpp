#pragma once

#include <nlohmann/json.hpp>

namespace Plyo { namespace Preflight {

// Mesures du plateau en cours pour la vérification avant impression : réglages de bordure et de supports,
// et pour chaque pièce sa hauteur, son emprise, sa surface posée et l'alerte « supports nécessaires » du
// dernier découpage d'Orca. Les risques sont déduits côté panneau (preflight.js).
nlohmann::json measure();

}} // namespace Plyo::Preflight
