#pragma once

#include <nlohmann/json.hpp>

// Profils (impression et filament) enregistrés par l'assistant après un lot de réglages, pour que la fenêtre
// « enregistrer les modifications ? » d'Orca ne s'affiche plus à la fermeture.
namespace Plyo { namespace Profiles {

// Modifications non enregistrées des profils impression et filament en cours :
// [{"preset": "print"|"filament", "key", "title", "before", "after"}]. Elles sont enregistrées avec le lot (« tout enregistrer »).
nlohmann::json manual_edits();

// Enregistre les profils impression et filament modifiés. Un profil d'Orca (non écrasable) est copié sous « <nom> (Plyo) ».
// Renvoie {"saved": [{"type", "name", "created", "from"}], "save_error": "" ou le motif}. Les valeurs restent appliquées
// en mémoire si l'écriture échoue.
nlohmann::json save_applied();

// Version fiable de l'imprimante + filament en cours : copie des réglages du catalogue, gardée par Plyo (dossier
// plyo/fiable, invisible dans la liste des profils d'Orca), au moment où l'utilisateur dit « ça a marché ».
// Remplacée seulement par un nouveau « ça a marché ».
bool           mark_reliable();
nlohmann::json reliable_info(); // {"available": bool, "date": "2026-10-28"}
// Remet la version fiable (annulable) puis enregistre les profils. Refuse si l'imprimante ou le filament ne sont plus
// ceux de la version fiable. {ok, text, undo_id?, saved, save_error}
nlohmann::json restore_reliable();

}} // namespace Plyo::Profiles
