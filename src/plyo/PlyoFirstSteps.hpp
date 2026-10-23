#pragma once

#include <nlohmann/json.hpp>

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

}} // namespace Plyo::FirstSteps
