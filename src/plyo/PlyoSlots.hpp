#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Saisie manuelle des emplacements, par préréglage d'imprimante : datadir/plyo/slots.json. Reste sur l'ordinateur : rien n'est envoyé au
// service Plyo ni à l'IA. Jamais imposée : ni plan, ni relecture ; Canvas::plan refuse (voir SlotsLogic::plan_allowed).
namespace Plyo { namespace Slots {

// État au format commun (source: manual, imposable faux) ; {ok: false, reason: no_manual} si rien n'a été saisi.
nlohmann::json manual_get(const std::string& printer_preset);
// Enregistre [{type, color}] (une liste vide retire la saisie). {ok}.
nlohmann::json manual_save(const std::string& printer_preset, const nlohmann::json& slots);

}} // namespace Plyo::Slots
