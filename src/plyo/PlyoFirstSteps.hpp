#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Premiers pas : accueil au premier lancement, ouverture du panneau au démarrage, parcours « Ma première impression »
// et « Explique-moi ce réglage ». État dans datadir/plyo/premiers-pas.json :
// {seen, level: "beginner"|"expert"|"skipped", tour_step, greeted (message « je suis là » déjà montré)}.
namespace Plyo { namespace FirstSteps {

// Appelé à la fin du constructeur de MainFrame (seule accroche dans Orca).
void on_startup();

nlohmann::json state();
// Fusionne `patch` dans l'état (clés connues seulement) et l'enregistre.
void set_state(const nlohmann::json& patch);

// Parcours : {objects, sliced, time_s, weight_g} pour la plaque en cours (0 si pas encore tranchée).
nlohmann::json tour_signals();
// Pose le petit bateau (3DBenchy, fourni par Orca) sur le plateau.
nlohmann::json add_benchy();

// Choisit le filament générique compatible de cette matière (« PLA », « PETG »…) pour le premier filament. { ok, name }
nlohmann::json choose_filament(const std::string& type);

// Bouton « Imprimer » du panneau : exactement comme « Imprimer la plaque » d'Orca (envoi à l'imprimante reliée, avec
// la fenêtre de confirmation d'Orca), ou l'export du G-code si `export_file`. { ok, reason: "not_sliced" }
nlohmann::json start_print(bool export_file);
// Fiche d'un réglage : {key, label, tooltip, value, system_value, min, max, unit} (valeurs absentes : null).
nlohmann::json explain(const std::string& key);
// Appelé avec {key, label} quand l'utilisateur clique dans un champ d'un onglet de réglages.
void set_focus_listener(std::function<void(const nlohmann::json&)> listener);

}} // namespace Plyo::FirstSteps
