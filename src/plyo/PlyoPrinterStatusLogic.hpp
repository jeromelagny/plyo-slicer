#pragma once
// Logique pure (testée) : ce que l'imprimante dit d'elle-même, pour ne pas dépendre de listes de modèles.
// - dossier où une Creality range un fichier (sa liste de fichiers, `get reqGcodeFile`) ;
// - état d'impression (Creality : messages du WebSocket 9999 ; Moonraker : print_stats) ;
// - verdict après un envoi, en comparant avec l'état d'avant ;
// - fin d'une impression démarrée (terminée, arrêtée, en erreur, ou sans savoir comment).
#include "PlyoHooks.hpp" // creality_file_dir : appelée par Orca (CrealityPrint::start_print)

#include <nlohmann/json.hpp>
#include <map>
#include <string>

namespace Plyo::PrinterStatus {

struct Status
{
    std::string state;    // "printing", "paused", "idle", "error" ou "unknown"
    std::string file;     // nom du fichier en cours, sans dossier ("" si inconnu)
    int         progress = -1;
    std::string end{};    // fin dite par l'imprimante : "finished", "cancelled", "error" ("" si elle n'en dit rien)
};

// Après « started », l'état est relu toutes les 30 s jusqu'à la fin ; sans réponse pendant plus de 10 min, l'impression est « perdue ».
constexpr int END_POLL_SECONDS   = 30;
constexpr int LOST_AFTER_SECONDS = 600;

// Codes `state` de la Creality (WebSocket 9999) → sens : "printing", "paused", "finished", "cancelled" ou "error".
// Seul « 1 » (impression) a été constaté sur la CR-10 SE ; un code lu dans le journal (« Plyo: état Creality ») s'ajoute ici.
const std::map<std::string, std::string>& creality_states();

// creality_file_dir (dossier d'un fichier dans la réponse `retGcodeFileInfo` d'une Creality) : déclarée dans PlyoHooks.hpp.

// État d'après les champs fusionnés des messages Creality, lus avec la table `states` (creality_states() par défaut).
Status creality_status(const nlohmann::json& fields);
Status creality_status(const nlohmann::json& fields, const std::map<std::string, std::string>& states);

// Champs qui ressemblent à un état dans les messages Creality, « nom=valeur » triés, pour le journal ; jamais un code
// d'accès, un mot de passe ni une clé, ni les températures et durées qui changent sans cesse. Vide si rien.
std::string creality_status_fields(const nlohmann::json& fields);

// État d'après la réponse de /printer/objects/query?print_stats de Moonraker.
Status moonraker_status(const nlohmann::json& reply);

// Après un envoi : "started", "busy" (elle imprimait déjà ce fichier), "error", "waiting" (rien encore) ou "unknown".
std::string verdict(const Status& before, const Status& now);

// Pendant l'impression démarrée (`started`) : "" tant qu'elle continue (ou qu'on attend une réponse), sinon "finished",
// "cancelled", "error", "unknown_end" (finie sans savoir comment) ou "lost" (muette depuis plus de LOST_AFTER_SECONDS).
std::string end_verdict(const Status& started, const Status& now, int silent_seconds);

// Creality : « unknown_end » n'est retenu qu'à la deuxième lecture de suite (`previous`, la précédente) ; une courte pause
// au code inconnu ne termine pas le suivi. "" tant que ce n'est pas confirmé ; les autres verdicts passent tels quels.
std::string settle_end(const std::string& verdict, const std::string& previous, bool creality);

} // namespace Plyo::PrinterStatus
