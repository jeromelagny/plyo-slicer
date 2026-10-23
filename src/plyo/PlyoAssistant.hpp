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

} // namespace Plyo
