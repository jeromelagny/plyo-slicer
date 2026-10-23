#pragma once

#include <nlohmann/json.hpp>

// Pont entre le panneau Assistant et la configuration d'Orca.
// Seuls les paramètres de la liste blanche (PlyoSettingsBridge.cpp) sont lus ou modifiés,
// toujours dans le préréglage « édité » (jamais sauvegardé sur disque).
namespace Plyo { namespace SettingsBridge {

// {"params": [{"id", "label", "key", "value", "unit", "min", "max", "note"}...], "can_undo": bool}
nlohmann::json read_values();

// changes : [{"id": "...", "value": x} ou {"id": "...", "delta": x}, ...]
// Tout ou rien : si un seul changement est invalide, rien n'est appliqué.
// Renvoie {"ok": bool, "text": "message pour l'utilisateur"}.
nlohmann::json apply_changes(const nlohmann::json& changes);

// Annule le dernier lot de changements appliqué par Plyo.
nlohmann::json undo_last();

}} // namespace Plyo::SettingsBridge
