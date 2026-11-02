#pragma once

#include <nlohmann/json.hpp>

// Habitudes de l'utilisateur gardées sur l'ordinateur (datadir/plyo/habits.json) : dernier filament par machine, machines
// masquées dans la liste de Plyo. Jamais envoyées au service Plyo. Le contenu est toujours nettoyé (ProjectLogic::sanitize_habits).
namespace Plyo { namespace Habits {

nlohmann::json load();
bool           save(const nlohmann::json& habits);

}} // namespace Plyo::Habits
