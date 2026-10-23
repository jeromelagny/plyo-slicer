#pragma once

#include <nlohmann/json.hpp>

// Session de connexion au service Plyo (jetons), conservée dans <data_dir>/plyo/session.json
// pour survivre au redémarrage d'Orca. Fichier lisible par l'utilisateur seul (droits 600).
// À remplacer par le trousseau macOS avant distribution.
namespace Plyo { namespace Session {

// Enregistre la session ; renvoie false si elle est mal formée ou si l'écriture échoue.
bool save(const nlohmann::json& session);

// Session enregistrée, ou null s'il n'y en a pas (ou si le fichier est illisible).
nlohmann::json load();

void clear();

}} // namespace Plyo::Session
