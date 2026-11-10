#pragma once
// Logique pure (testée) : ce que l'imprimante dit d'elle-même, pour ne pas dépendre de listes de modèles.
// - dossier où une Creality range un fichier (sa liste de fichiers, `get reqGcodeFile`) ;
// - état d'impression (Creality : messages du WebSocket 9999 ; Moonraker : print_stats) ;
// - verdict après un envoi, en comparant avec l'état d'avant.
#include <nlohmann/json.hpp>
#include <string>

namespace Plyo::PrinterStatus {

struct Status
{
    std::string state;    // "printing", "paused", "idle", "error" ou "unknown"
    std::string file;     // nom du fichier en cours, sans dossier ("" si inconnu)
    int         progress = -1;
};

// Dossier du fichier `filename` dans la réponse `retGcodeFileInfo` d'une Creality (« dossier:nom:taille:…;… »).
// Vide si le fichier n'y est pas ou si le dossier n'est pas un chemin absolu propre.
std::string creality_file_dir(const std::string& reply, const std::string& filename);

// État d'après les champs fusionnés des messages Creality (`state` 1 = impression, constaté sur la CR-10 SE).
Status creality_status(const nlohmann::json& fields);

// État d'après la réponse de /printer/objects/query?print_stats de Moonraker.
Status moonraker_status(const nlohmann::json& reply);

// Après un envoi : "started", "busy" (elle imprimait déjà ce fichier), "error", "waiting" (rien encore) ou "unknown".
std::string verdict(const Status& before, const Status& now);

} // namespace Plyo::PrinterStatus
