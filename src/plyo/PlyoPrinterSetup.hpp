#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Installation d'une imprimante par l'assistant Plyo, à la place de l'assistant de configuration d'Orca : catalogue
// des imprimantes fournies avec Orca (resources/profiles), reconnaissance d'une imprimante trouvée sur le réseau,
// installation de son profil (même fonction qu'Orca : PresetBundle::apply_vendor_config).
namespace Plyo { namespace PrinterSetup {

// Aucune imprimante installée (premier lancement, ou assistant d'Orca passé) : l'assistant propose d'en installer une.
bool needs_printer();

// Catalogue des imprimantes FFF fournies : [{ vendor, model, nozzles: ["0.4", …] }], trié par modèle.
nlohmann::json catalog();

// Le modèle du catalogue de l'imprimante en cours (printer_model de son profil) : { vendor, model, nozzles, nozzle (variante
// en cours, « 0.4 »), system (profil fourni, pas un profil à soi) }, ou null si le modèle n'est pas reconnu. Lecture seule ; un
// changement de buse repasse par install() avec la même marque et le même modèle.
nlohmann::json current_model();

// Le modèle du catalogue qui correspond à une imprimante trouvée ({ name, … }) : { vendor, model, nozzles } ou null.
nlohmann::json identify(const nlohmann::json& printer);

// Installe et sélectionne le profil (marque, modèle, buse) avec ses filaments par défaut. { ok, preset }
nlohmann::json install(const std::string& vendor, const std::string& model, const std::string& nozzle);

}} // namespace Plyo::PrinterSetup
