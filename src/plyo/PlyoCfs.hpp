#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace Slic3r { class DynamicPrintConfig; }

// Lecture du CFS d'une Creality par CrealityPrint (WebSocket, port 9999). Réseau : hors du fil principal. NON VALIDÉ sur machine (T9).
namespace Plyo { namespace Cfs {

// Sur une copie du profil. {canvases, imposable, blocker} ; null et `error` (sans contenu de réponse) si la lecture échoue.
nlohmann::json read(const Slic3r::DynamicPrintConfig& config, std::string& error);

}} // namespace Plyo::Cfs
