#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Profils (impression et filament) enregistrés par l'assistant après un lot de réglages, pour que la fenêtre
// « enregistrer les modifications ? » d'Orca ne s'affiche plus à la fermeture.
namespace Plyo { namespace Profiles {

// Modifications non enregistrées des profils impression et filament en cours :
// [{"preset": "print"|"filament", "key", "title", "before", "after"}]. Elles sont enregistrées avec le lot (« tout enregistrer »).
nlohmann::json manual_edits();

// Résultat de save_current_as.
enum class SaveOutcome { Ok, Failed, Refused, NotWritten };

// Enregistre le profil en cours (impression si `print`, sinon filament) sous `name` (avec un nom : aucune fenêtre de nom)
// et vérifie qu'Orca l'a bien fait : Failed (erreur levée ou onglet absent), Refused (pas choisi sous ce nom, ou encore
// modifié), NotWritten (fichier absent, vide ou pas réécrit). Chaque échec est noté dans le journal.
SaveOutcome save_current_as(bool print, const std::string& name);

// Enregistre les profils impression et filament modifiés. Un profil d'Orca (non écrasable) est copié sous « <nom> (Plyo) ».
// Le préréglage d'une bobine (registre des bobines) est toujours écrasé sous son propre nom, jamais copié.
// Renvoie {"saved": [{"type", "name", "created", "from"}], "save_error": "" ou le motif}. Les valeurs restent appliquées
// en mémoire si l'écriture échoue.
nlohmann::json save_applied();

// Version fiable de l'imprimante + filament en cours : copie des réglages du catalogue, gardée par Plyo (dossier
// plyo/fiable, invisible dans la liste des profils d'Orca), au moment où l'utilisateur dit « ça a marché ».
// Remplacée seulement par un nouveau « ça a marché ».
// Juste après l'enregistrement d'un lot (`at` : l'instant de son entrée dans la mémoire) : copie de ce que l'assistant
// a appliqué, mise à l'essai. Elle devient la version fiable seulement si l'utilisateur répond « ça a marché » pour ce lot.
bool           note_trial(const std::string& at);
bool           mark_reliable(const std::string& at);
nlohmann::json reliable_info(); // {"available": bool, "date": "2026-10-28"}
// Remet la version fiable (annulable) puis enregistre les profils. Refuse si l'imprimante ou le filament ne sont plus
// ceux de la version fiable. {ok, text, undo_id?, saved, save_error}
nlohmann::json restore_reliable();

}} // namespace Plyo::Profiles
