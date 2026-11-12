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

// Valeurs actuelles de tous les réglages Filament + Impression du catalogue (mode catalogue) :
// { "<clé>": nombre | booléen | texte | null, ... }. Première valeur des options « tableau », null pour « nil ».
nlohmann::json read_snapshot();

// Les profils imprimante, impression et filament en cours sont-ils ceux de la demande ? Les noms vides ne sont pas
// comparés. null si oui, sinon {ok: false, text} (aucune modification ne doit alors être écrite).
nlohmann::json check_profiles(const std::string& printer_name, const std::string& print_name, const std::string& filament_name);

// Valeur d'une option du catalogue, typée (première valeur des options « tableau », null pour « nil »).
nlohmann::json typed_value_of(const Slic3r::DynamicPrintConfig& config, const std::string& key, const std::string& kind);

// Valeurs actuelles du catalogue, en texte d'Orca : { "print": {clé: texte}, "filament": {...} } (version fiable).
nlohmann::json snapshot_raw();

// Remet ces valeurs (clés du catalogue seulement, celles qui diffèrent), comme un lot annulable. {ok, text, undo_id?}
nlohmann::json restore_values(const nlohmann::json& values);

// Après l'enregistrement d'un profil sous un autre nom (copie d'un profil d'Orca) : l'annulation vise le nouveau nom.
void retarget_undo(bool print, const std::string& from, const std::string& to);

// Changements du mode catalogue : [{"key", "value", "confirmed_outside_range"?, "label"?}, ...]. Tout ou rien, vérifiés
// par Catalog::check_change ; refusés si le profil impression ou filament n'est plus celui de la proposition.
// Renvoie {ok, text, undo_id, applied: [{id, label, before, after}]}.
nlohmann::json apply_catalog_changes(const nlohmann::json& changes, const std::string& print_name, const std::string& filament_name);

// Le lot (changements du mode catalogue ou de la liste blanche) ne touche que des réglages de l'onglet Filament : la pièce
// n'est alors pas exigée pour l'appliquer (ProjectLogic::missing_for). Faux pour un lot vide ou une clé inconnue.
bool filament_only(const nlohmann::json& changes);

// Plage Plyo d'une clé de configuration de la liste blanche : {min, max, unit}, ou null hors liste blanche.
nlohmann::json whitelist_range(const std::string& key);

// Réglage d'impression d'une seule pièce (ordres de l'assistant), vérifié comme apply_changes. Écrit la clé d'Orca
// dans `out` et rend {ok, key, text} ; refuse les réglages du filament et de l'imprimante.
nlohmann::json object_override(const std::string& id, const nlohmann::json& value, Slic3r::DynamicPrintConfig& out);

}} // namespace Plyo::SettingsBridge
