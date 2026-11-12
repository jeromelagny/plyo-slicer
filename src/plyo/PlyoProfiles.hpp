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

// Enregistre le profil filament modifié. Un profil d'Orca (non écrasable) est copié sous « <nom> (Plyo) ».
// Le préréglage d'une bobine (registre des bobines) est toujours écrasé sous son propre nom, jamais copié.
// Les réglages d'impression (ceux de la pièce) ne sont JAMAIS enregistrés : ils restent modifiés, gardés dans le 3MF de la
// conversation (`in_project`) ou, sans plateau de conversation (`print_edited`), protégés par la question d'Orca.
// Renvoie {"saved": [{"type", "name", "created", "from"}], "save_error": "" ou le motif, "in_project", "print_edited"}.
// Les valeurs restent appliquées en mémoire si l'écriture échoue.
nlohmann::json save_applied();

// Version fiable de l'imprimante + filament en cours : copie des réglages du catalogue, gardée par Plyo (dossier
// plyo/fiable, invisible dans la liste des profils d'Orca), au moment où l'utilisateur dit « ça a marché ».
// Remplacée seulement par un nouveau « ça a marché ».
// Juste après l'enregistrement d'un lot (`at` : l'instant de son entrée dans la mémoire) : copie de ce que l'assistant
// a appliqué, mise à l'essai. Elle devient la version fiable seulement si l'utilisateur répond « ça a marché » pour ce lot.
bool           note_trial(const std::string& at);
bool           mark_reliable(const std::string& at);
// Filament en cours qui est une bobine : la version réussie de la bobine sur cette imprimante (plyo/fiable, voir
// mark_spool_success) remplace celle du couple imprimante + filament.
// Réglages du FILAMENT seulement (ceux d'impression sont ceux de la pièce d'alors) ; `count` et `changes` : ce que la remise
// changerait aujourd'hui ([{key, scope, label, before, after}]), à dire avant de remettre.
nlohmann::json reliable_info(); // {"available": bool, "date": "2026-10-28", "count": 3, "changes": [...]}
// Remet la version fiable (annulable) puis enregistre les profils (le préréglage d'une bobine est écrasé sous son nom).
// Refuse si l'imprimante ou le filament ne sont plus ceux de la version fiable. {ok, text, undo_id?, saved, save_error}
nlohmann::json restore_reliable();

// Bobines : la version qui a réussi est celle qui est partie à l'imprimante. À chaque envoi ou export réussi, les valeurs
// filament du catalogue de la bobine en cours sont notées à l'essai (plyo/essai, {spool, printer, date, at, values}), et
// cet envoi devient le « dernier envoi » (plyo/essai/dernier-envoi.json, {spool, printer, date, at}).
// Faux si le filament en cours n'est pas une bobine, pendant une calibration (plateau de test), ou si l'écriture échoue.
bool note_sent();
// « Ça a marché » : la dernière version envoyée de la bobine en cours sur cette imprimante devient sa version réussie
// (plyo/fiable), et le registre note last_outcome "ok" et last_ok_at (date de l'envoi). Faux sans bobine ni envoi noté.
bool mark_spool_success();
// Réussite dite hors de la carte (phrase dans la discussion, ou « Oui » à l'étape Résultat) : elle vise le DERNIER envoi
// (bobine et imprimante notées par note_sent), et seulement s'il est celui de la bobine `expected_spool` (id de la bobine
// de la conversation), date de moins de SpoolsLogic::SENT_MAX_AGE_HOURS et n'a pas été déclaré raté (sauf
// `change_of_mind` : « Oui » juste après « Non » à l'étape Résultat). Refusée aussi si l'essai a été réécrit ou manque.
// {ok, name, date, text} : `name` et `date` (de l'envoi) sont ceux réellement marqués ; `text`, le refus à montrer.
nlohmann::json mark_sent_success(const std::string& expected_spool, bool change_of_mind = false);
// « Ça n'a pas marché » : le registre note last_outcome "bad" pour la bobine en cours sur cette imprimante ; si le dernier
// envoi est le sien, il est déclaré raté (une réussite dite ensuite ne le marque plus).
bool mark_spool_failure();

// « Non, c'est raté » à l'étape Résultat : le dernier envoi ou export (plyo/essai/dernier-envoi.json), s'il est celui de la
// bobine `expected_spool` et récent, est noté « bad » au registre et déclaré raté. {ok, name, text}.
nlohmann::json mark_sent_failure(const std::string& expected_spool);

}} // namespace Plyo::Profiles
