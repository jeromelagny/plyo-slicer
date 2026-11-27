#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

class wxWindow;

// « Montre-moi » : un cadre de couleur autour d'une zone de l'interface d'Orca pendant quelques secondes,
// sans modifier Orca (boutons du haut par les membres publics de MainFrame, le reste dans l'arbre de la fenêtre principale).
namespace Plyo { namespace Highlight {

// Cibles : "printer", "filament", "slice", "print", "plate". Renvoie {ok} ; ok faux si la zone est introuvable ou cachée.
// Encadre une zone de la fenêtre pendant 3 s : printer | filament | slice | print | plate. Renvoie {ok}.
nlohmann::json show(const std::string& target);
// Zone que show() encadrerait (nullptr si introuvable ou cachée). « slice » et « print » : MainFrame::m_slice_btn et
// m_print_btn (membres publics), jamais reconnus par leur libellé. Lu aussi par le banc d'essai (PlyoSelfTest).
wxWindow* find_target(const std::string& target);
// Ouvre l'onglet du réglage `key` (traitement, filament ou imprimante), va à sa page puis l'encadre.
// `done` reçoit {ok, hidden} une fois l'interface mise à jour ; hidden : le réglage n'est visible qu'en mode avancé.
void show_setting(const std::string& key, std::function<void(const nlohmann::json&)> done);

}} // namespace Plyo::Highlight
