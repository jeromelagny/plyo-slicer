#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// « Montre-moi » : un cadre de couleur autour d'une zone de l'interface d'Orca pendant quelques secondes,
// sans modifier Orca (les fenêtres sont retrouvées dans l'arbre de la fenêtre principale).
namespace Plyo { namespace Highlight {

// Cibles : "printer", "filament", "slice", "print", "plate". Renvoie {ok} ; ok faux si la zone est introuvable ou cachée.
// Encadre une zone de la fenêtre pendant 3 s : printer | filament | slice | print | plate. Renvoie {ok}.
nlohmann::json show(const std::string& target);
// Ouvre l'onglet du réglage `key` (traitement, filament ou imprimante), va à sa page puis l'encadre.
// `done` reçoit {ok, hidden} une fois l'interface mise à jour ; hidden : le réglage n'est visible qu'en mode avancé.
void show_setting(const std::string& key, std::function<void(const nlohmann::json&)> done);

}} // namespace Plyo::Highlight
