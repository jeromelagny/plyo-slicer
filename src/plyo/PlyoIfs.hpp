#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace Slic3r { class DynamicPrintConfig; }

// Lecture de l'IFS d'une Flashforge par son API locale (port 8898 ; série et code du profil). Réseau : hors du fil principal.
// NON VALIDÉ sur machine (T9). Le corps des réponses n'est jamais journalisé ici.
namespace Plyo { namespace Ifs {

// Sur une copie du profil. {canvases, imposable, blocker} ; null et `error` (sans contenu de réponse) si la lecture échoue.
nlohmann::json read(const Slic3r::DynamicPrintConfig& config, std::string& error);

}} // namespace Plyo::Ifs
