#pragma once

#include "PlyoHooks.hpp" // on_startup, on_process_completed : appelées par Orca

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Premiers pas : accueil au premier lancement, ouverture du panneau au démarrage, parcours « Ma première impression »
// et « Explique-moi ce réglage ». État dans datadir/plyo/premiers-pas.json :
// {seen, level: "beginner"|"expert"|"skipped", tour_step, greeted (message « je suis là » déjà montré)}.
namespace Plyo { namespace FirstSteps {

nlohmann::json state();
// Fusionne `patch` dans l'état (clés connues seulement) et l'enregistre.
void set_state(const nlohmann::json& patch);

// Parcours : {objects, sliced, slicing, ready_for_print, time_s, weight_g} pour la plaque en cours (0 si pas encore tranchée).
nlohmann::json tour_signals();
// Pose le petit bateau (3DBenchy, fourni par Orca) sur le plateau.
nlohmann::json add_benchy();

// Choisit le filament générique compatible de cette matière (« PLA », « PETG »…) pour le premier filament. { ok, name }
nlohmann::json choose_filament(const std::string& type);
// Profil de filament compatible avec la machine en cours pour ce type exact (« PLA », « PLA-CF »…), le plus générique ; vide si aucun.
std::string best_filament(const std::string& type);
// Sélectionne ce profil de filament pour le filament `idx` (0 : le premier) dans Orca, comme un choix dans la liste du
// plateau (Plater::priv::on_select_preset, gardée par un test de source). Seule fonction de Plyo qui le fait. Pour le premier
// filament, l'onglet Filament suit d'abord : faux si l'utilisateur a annulé dans la fenêtre d'Orca (filament modifié non
// enregistré), rien n'a alors changé. Toujours vrai pour les suivants.
bool select_filament(const std::string& name, size_t idx = 0);

// Bouton « Imprimer » du panneau : exactement comme « Imprimer la plaque » d'Orca (envoi à l'imprimante reliée, avec
// la fenêtre de confirmation d'Orca). `done` ne reçoit la réponse qu'une fois Orca décidé (lot 10, UX-03) :
// { ok: true, route: "host" } Orca a pris l'envoi (suivi ensuite par Send) ; { ok: true, route: "device" } fenêtre d'envoi
// du module Bambu Lab (ou des agents d'imprimante) ouverte, dont le résultat n'est pas lisible ; { ok: false, reason:
// "not_sliced" | "not_ready" (issues : ce qu'Orca dit de la plaque) | "refused" (failure) | "not_started" | "busy" } ;
// { ok: false, cancelled: true } fenêtre d'envoi fermée sans envoi.
void start_print(std::function<void(nlohmann::json)> done);
// Bouton « Exporter » : la fenêtre d'enregistrement d'Orca s'ouvre (dans cet appel), `done` n'est appelé qu'à la fin réelle :
// { ok: true, path } fichier écrit ; { ok: false, cancelled: true } rien n'a été choisi ; { ok: false, reason, text } refus ;
// { ok: false, reason: "error", kind, text } erreur (kind : OrcaMessagesLogic::export_kind, texte sans le dossier).
// Dossier proposé : le dernier choisi, sinon le Bureau, jamais le dossier interne des modèles posés par le panneau.
void export_file(std::function<void(nlohmann::json)> done);
// Fin d'un export (appelé par on_process_completed, voir PlyoHooks.hpp).
void on_export_done(bool finished, const std::string& error, const std::string& path);
// Fiche d'un réglage : {key, label, tooltip, value, system_value, min, max, unit} (valeurs absentes : null).
nlohmann::json explain(const std::string& key);
// Appelé avec {key, label} quand l'utilisateur clique dans un champ d'un onglet de réglages.
void set_focus_listener(std::function<void(const nlohmann::json&)> listener);

}} // namespace Plyo::FirstSteps
