#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace Slic3r { class DynamicPrintConfig; }

// Pont entre le panneau Assistant et la configuration d'Orca.
// Seuls les paramètres de la liste blanche (PlyoSettingsBridge.cpp) sont lus ou modifiés,
// toujours dans le préréglage « édité » (jamais sauvegardé sur disque).
namespace Plyo { namespace SettingsBridge {

// {"params": [{"id", "label", "key", "value", "unit", "min", "max", "note"}...],
//  "context": {"printer", "filament", "process"}, "can_undo": bool}
nlohmann::json read_values();

// Vide la pile d'annulation (ses entrées viseraient d'autres préréglages après un changement de préréglage).
void clear_undo();

// changes : [{"id": "...", "value": x} ou {"id": "...", "delta": x}, ...]
// Tout ou rien : si un seul changement est invalide, rien n'est appliqué.
// Renvoie {"ok": bool, "text": "message pour l'utilisateur", "undo_id": identifiant du lot si ok}.
nlohmann::json apply_changes(const nlohmann::json& changes);

// Rattache au lot `undo_id` l'entrée de la mémoire de la machine qu'il a créée.
void set_memory_key(int undo_id, const std::string& key);

// Annule le dernier lot appliqué par Plyo. `expected_id` > 0 : seulement si c'est bien ce lot (sinon refus clair).
// Renvoie {ok, text, undone_id, memory_key}.
nlohmann::json undo_last(int expected_id = 0);

// Plage Plyo d'une clé de configuration de la liste blanche : {min, max, unit}, ou null hors liste blanche.
nlohmann::json whitelist_range(const std::string& key);

// Réglage d'impression d'une seule pièce (ordres de l'assistant), vérifié comme apply_changes. Écrit la clé d'Orca
// dans `out` et rend {ok, key, text} ; refuse les réglages du filament et de l'imprimante.
nlohmann::json object_override(const std::string& id, const nlohmann::json& value, Slic3r::DynamicPrintConfig& out);

}} // namespace Plyo::SettingsBridge
