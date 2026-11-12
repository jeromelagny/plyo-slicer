#pragma once
// Vérification du démarrage après « Envoyer et imprimer » : l'état de l'imprimante est noté au moment de l'envoi, puis relu
// toutes les 5 s (4 min au plus) jusqu'à un verdict ; une impression démarrée est ensuite relue toutes les 30 s jusqu'à sa fin
// (voir PlyoPrinterStatusLogic.hpp). Protocoles lus : Creality (WebSocket 9999) et Moonraker. Les autres répondent
// « unknown » : le panneau dit alors de regarder l'écran de l'imprimante. Rien n'est bloqué : tout se lit sur un fil à part.
#include <functional>
#include <nlohmann/json.hpp>
#include <string>

namespace Plyo::PrinterStatus {

// Commence la surveillance de l'imprimante `preset` (une nouvelle surveillance remplace la précédente). `notify` est appelé
// sur le fil principal avec { verdict, state, file, progress } : verdict "started", "busy", "error", "timeout" ou "unknown" ;
// après "started", un second message à la fin : "finished", "cancelled", "error", "unknown_end" ou "lost".
void watch(const std::string& preset, std::function<void(nlohmann::json)> notify);

// Arrête la surveillance en cours (Orca qui se ferme).
void stop();

} // namespace Plyo::PrinterStatus
