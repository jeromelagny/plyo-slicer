#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace Plyo { namespace Commands {

// Exécute les ordres de l'assistant ({op, object, axis, amount, amount2, text, setting, setting_value, summary}),
// dans l'ordre, en une seule étape d'annulation d'Orca. Chaque ordre est revérifié ici.
// Rend {ok, done: [phrases des ordres réussis], text (premier échec, vide sinon), undo_token}.
nlohmann::json run(const nlohmann::json& commands);

// Ouvre un outil de la vue 3D (« paint_supports », « cut »…) sur la pièce sélectionnée, ou la seule du plateau.
nlohmann::json open_tool(const std::string& tool);

}} // namespace Plyo::Commands
