#pragma once

#include "PlyoLimitsLogic.hpp"

#include <nlohmann/json.hpp>

#include <string>

// Limites du fabricant du filament en cours : saisies par l'utilisateur (limites.json, par imprimante + filament),
// sinon la plage de buse du profil filament d'Orca.
namespace Plyo { namespace Limits {

// « imprimante | filament » des profils en cours d'édition (même clé que la mémoire de la machine).
std::string machine_key();

Range current();

// Enregistre les limites saisies pour la machine en cours ({} les efface). false si la plage n'est pas valable.
bool set(const nlohmann::json& limits);

// Reprend pour la machine en cours les limites saisies sous `old_key` (profil copié par l'assistant), si elle n'en a pas.
void carry_over(const std::string& old_key);

}} // namespace Plyo::Limits
