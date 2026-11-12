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

// Pourquoi un lot n'est plus annulable : le refus d'annulation le dit (projet ouvert dans Orca, autre projet de l'assistant,
// fichier ouvert, calibration, imprimante ou filament changés).
enum class DropReason { Project, Conversation, Import, Calibration, Profile };

// Vide la pile d'annulation (ses entrées viseraient d'autres préréglages après un changement de préréglage).
void clear_undo(DropReason reason);

// Réglages oubliés d'une portée (comme le bouton « Ignorer » d'Orca), à appeler après l'oubli : l'impression retire toutes ses
// valeurs de la pile, le filament seulement celles qu'il n'a plus (un lot enregistré dans la bobine reste annulable). Les
// autres valeurs d'un lot restent annulables.
void forget_scope(bool print, bool filament, DropReason reason);

// changes : [{"id": "...", "value": x} ou {"id": "...", "delta": x}, ...]
// Tout ou rien : si un seul changement est invalide, rien n'est appliqué. Comme apply_catalog_changes : refus si une fenêtre
// d'Orca est ouverte, règles d'Orca vérifiées avant l'écriture, relecture après.
// Renvoie {"ok": bool, "text": "message pour l'utilisateur", "undo_id": identifiant du lot si ok, "also_changed"}.
nlohmann::json apply_changes(const nlohmann::json& changes);

// Rattache au lot `undo_id` l'entrée de la mémoire de la machine qu'il a créée.
void set_memory_key(int undo_id, const std::string& key);

// Annule le dernier lot appliqué par Plyo. `expected_id` > 0 : seulement si c'est bien ce lot (sinon refus clair, avec sa
// cause et, quand c'est possible, `restore` : [{key, scope, label, value}] les valeurs d'avant à remettre une par une).
// Un réglage retouché depuis le lot est laissé tel quel (`kept` : [{key, label, value}]).
// Renvoie {ok, text, undone_id, memory_key, kept, also_changed}.
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

// Ce que restore_values changerait, sans rien écrire : [{key, scope, label, before, after}] (valeurs affichables).
nlohmann::json preview_values(const nlohmann::json& values);

// Remet ces valeurs (clés du catalogue seulement, celles qui diffèrent), comme un lot annulable et relu. {ok, text, undo_id?}
nlohmann::json restore_values(const nlohmann::json& values);

// Après l'enregistrement d'un profil sous un autre nom (copie d'un profil d'Orca) : l'annulation vise le nouveau nom.
void retarget_undo(bool print, const std::string& from, const std::string& to);

// Changements du mode catalogue : [{"key", "value", "confirmed"?, "confirmed_outside_range"?, "label"?}, ...]. Tout ou rien.
// 1. Chaque changement passe Catalog::check_barrier (bornes d'Orca et strictes, limites du fabricant, et sans `confirmed`
//    l'écart maximal et les réglages sensibles) ; refus si le profil impression ou filament n'est plus celui de la
//    proposition, ou si une fenêtre d'Orca est ouverte.
// 2. Règles d'Orca (ConfigRules) : le lot est complété (mode vase, peau irrégulière, première couche…) ou refusé.
// 3. Écriture, puis relecture : une valeur remise par Orca défait tout le lot ; ce qu'Orca change en plus est rendu et
//    entre dans l'annulation.
// Renvoie {ok, text, undo_id, applied: [{id, label, before, after, added?}], also_changed: [{key, scope, label, before,
// after}]}, ou un refus {ok: false, text, code?, key?, orca_refused?}.
nlohmann::json apply_catalog_changes(const nlohmann::json& changes, const std::string& print_name, const std::string& filament_name);

// Le lot (changements du mode catalogue ou de la liste blanche) ne touche que des réglages de l'onglet Filament : la pièce
// n'est alors pas exigée pour l'appliquer (ProjectLogic::missing_for). Faux pour un lot vide ou une clé inconnue.
bool filament_only(const nlohmann::json& changes);

// Réglages d'impression laissés par le mode vase (ConfigRules::spiral_leftovers), au catalogue seulement. Référence : les
// valeurs d'avant le lot encore annulable qui a activé le mode vase, sinon celles du profil d'impression enregistré.
// [{key, label, value (valeur à remettre, typée), now (valeur actuelle, typée)}].
nlohmann::json spiral_leftovers();

// Plage Plyo d'une clé de configuration de la liste blanche : {min, max, unit}, ou null hors liste blanche.
nlohmann::json whitelist_range(const std::string& key);

// Réglage d'impression d'une seule pièce (ordres de l'assistant), vérifié comme apply_changes. Écrit la clé d'Orca
// dans `out` et rend {ok, key, text} ; refuse les réglages du filament et de l'imprimante.
nlohmann::json object_override(const std::string& id, const nlohmann::json& value, Slic3r::DynamicPrintConfig& out);

}} // namespace Plyo::SettingsBridge
