#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace Plyo { namespace Calibration {

// Calibration guidée : l'assistant lance un test (température, débit, rétraction, pressure advance, lissage),
// l'utilisateur photographie le résultat, puis la valeur gagnante est enregistrée dans un préréglage de filament
// dédié à l'imprimante. La pièce et les réglages de l'utilisateur sont gardés avant le test et remis après.

// Lance un test (`pass` : 1 ou 2, utile au débit ; `base_value` : gagnant de la passe 1 pour la passe 2).
// Renvoie {ok, test, pass, sections:[{index,label,value}], instructions} ou {ok:false, text}.
nlohmann::json start_test(const std::string& test, int pass, double base_value);

// Enregistre les valeurs gagnantes du test dans le préréglage « <filament> — <imprimante> (calibré Plyo) ».
nlohmann::json save_result(const std::string& test, double value);

// Remet le projet et les réglages d'avant le test (avec le préréglage calibré s'il vient d'être enregistré).
nlohmann::json restore();

// Calibrations déjà faites pour le filament et l'imprimante en cours : [{test, value, date}].
nlohmann::json history_for_current();

}} // namespace Plyo::Calibration
