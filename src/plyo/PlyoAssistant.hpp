#pragma once

// Fonctions appelées par Orca (barre du haut, menu Affichage, changements de configuration et de projet) : PlyoHooks.hpp.
#include "PlyoHooks.hpp"

class wxMenuItem;
class wxWindow;

namespace Slic3r { namespace GUI {
class Plater;
}} // namespace Slic3r::GUI

// Panneau « Assistant Plyo » : une page web (resources/web/plyo/index.html) ancrée
// à droite de la vue 3D, via le mécanisme de panneaux ancrables d'Orca (DockPanel).
namespace Plyo {

// Ouvre le panneau s'il est fermé, le ferme s'il est ouvert.
void toggle_assistant(Slic3r::GUI::Plater* plater);

bool is_assistant_shown();

// Bouton « Assistant » de la barre du haut d'Orca (à gauche de « Découper ») : ouvre ou ferme le panneau,
// et reste en surbrillance tant que le panneau est ouvert. `parent` : la fenêtre principale. Posé par add_topbar_button().
wxWindow* create_topbar_button(wxWindow* parent);

// Banc d'essai (PlyoSelfTest) : entrée « Assistant Plyo » du menu Affichage, nullptr tant qu'append_view_menu_item() ne
// l'a pas créée.
wxMenuItem* view_menu_item();

// Nombre d'appels à on_project_changed() depuis le lancement : un test d'Orca (PlyoRawTests) sait ainsi si sa fenêtre a
// ouvert un nouveau projet.
int project_change_count();

// Tant qu'une de ces gardes existe, on_project_changed() ne prévient pas le panneau : la calibration vide et recharge le
// plateau, mais la conversation et le lien téléphone doivent continuer (comme un `try/finally` qui lève puis baisse un drapeau).
class ProjectNotificationsPause
{
public:
    ProjectNotificationsPause();
    ~ProjectNotificationsPause();
    ProjectNotificationsPause(const ProjectNotificationsPause&) = delete;
    ProjectNotificationsPause& operator=(const ProjectNotificationsPause&) = delete;
};

} // namespace Plyo
