#pragma once

namespace Slic3r { namespace GUI {
class Plater;
}} // namespace Slic3r::GUI

// Panneau « Assistant Plyo » : une page web (resources/web/plyo/index.html) ancrée
// à droite de la vue 3D, via le mécanisme de panneaux ancrables d'Orca (DockPanel).
namespace Plyo {

// Ouvre le panneau s'il est fermé, le ferme s'il est ouvert.
void toggle_assistant(Slic3r::GUI::Plater* plater);

bool is_assistant_shown();

// Appelé par MainFrame::on_config_changed() à chaque changement de configuration
// (saisie manuelle, changement de préréglage, modification par Plyo).
void on_config_changed();

} // namespace Plyo
