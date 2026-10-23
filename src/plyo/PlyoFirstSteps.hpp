#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Premiers pas : accueil au premier lancement, ouverture du panneau au démarrage, parcours « Ma première impression »
// et « Explique-moi ce réglage ». État dans datadir/plyo/premiers-pas.json :
// {seen, level: "beginner"|"expert"|"skipped", panel_closed, tour_step}.
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
// Fiche d'un réglage : {key, label, tooltip, value, system_value, min, max, unit} (valeurs absentes : null).
nlohmann::json explain(const std::string& key);
// Appelé avec {key, label} quand l'utilisateur clique dans un champ d'un onglet de réglages.
void set_focus_listener(std::function<void(const nlohmann::json&)> listener);

}} // namespace Plyo::FirstSteps
