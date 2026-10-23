#pragma once

#include <nlohmann/json.hpp>

#include <string>

// « Montre-moi » : un cadre de couleur autour d'une zone de l'interface d'Orca pendant quelques secondes,
// sans modifier Orca (les fenêtres sont retrouvées dans l'arbre de la fenêtre principale).
namespace Plyo { namespace Highlight {

// Cibles : "printer", "filament", "slice", "print", "plate". Renvoie {ok} ; ok faux si la zone est introuvable ou cachée.
nlohmann::json show(const std::string& target);

}} // namespace Plyo::Highlight
