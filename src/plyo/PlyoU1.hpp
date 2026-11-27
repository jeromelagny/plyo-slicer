#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace Slic3r { class DynamicPrintConfig; }

// Lecture des têtes d'une Snapmaker U1 (HTTP, requête d'Orca). Réseau : hors du fil principal. NON VALIDÉ sur machine (T17). On lit sans
// jamais imposer : le corps des réponses et la clé d'API ne sont pas journalisés.
namespace Plyo { namespace U1 {

// {canvases, imposable: false, blocker} ; null et `error` (sans contenu de réponse) si la lecture échoue.
nlohmann::json read(const Slic3r::DynamicPrintConfig& config, std::string& error);

}} // namespace Plyo::U1
