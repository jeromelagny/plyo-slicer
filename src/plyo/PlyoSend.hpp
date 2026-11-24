#pragma once

#include "PlyoHooks.hpp" // on_upload_handed : appelée par Orca

#include <nlohmann/json.hpp>

#include <functional>

// Envoi à l'imprimante demandé par le panneau (lot 10, UX-03 et ERR-10), par la file d'envoi d'Orca (hôtes d'impression).
// Le panneau ne dit « parti » que quand Orca a réellement pris l'envoi : Send::on_upload_handed (PlyoHooks.hpp) est appelée
// par Plater::send_gcode_legacy juste avant de le confier à sa file, après sa fenêtre d'envoi et ses dernières questions.
// Ensuite, les événements publics de la file (EVT_PRINTHOST_PROGRESS, _ERROR, _CANCEL, PrintHostDialogs.hpp) disent la
// progression, l'arrivée ou l'échec : Plyo s'y lie sans rien changer à leur traitement par Orca (evt.Skip()). Les imprimantes
// Bambu Lab passent par leur module réseau : rien ici ne les concerne. Fil de l'interface seulement.
// Un envoi lancé par le bouton « Imprimer la plaque » d'Orca passe par le même appel : il est suivi pareil, et le panneau en
// est prévenu ({type: "print_upload", phase: "orca", preset}) pour le reprendre dans le projet affiché.
namespace Plyo { namespace Send {

// Qui prévient le panneau : {type: "print_send_waiting"} avant la fenêtre d'envoi d'Orca, puis {type: "print_upload", phase:
// "orca" (preset : envoi lancé par le bouton d'Orca) | "progress" (percent) | "arrived" | "failed" (failure) | "cancelled"}
// pour l'envoi suivi.
void set_listener(std::function<void(const nlohmann::json&)> listener);

// Se lier à la file d'envoi d'Orca (une fois par fenêtre principale).
void attach();

// Pendant un appel à Plater::send_gcode_legacy fait par le panneau : l'envoi pris par Orca est suivi.
class Scope
{
public:
    Scope();
    ~Scope();
    Scope(const Scope&)            = delete;
    Scope& operator=(const Scope&) = delete;
    bool handed() const;
};

// « Envoyer et imprimer » vers un hôte d'impression : la fenêtre d'envoi d'Orca s'ouvre dans cet appel ; `done` reçoit le
// verdict une fois Orca décidé (fenêtre fermée, et ses fenêtres d'erreur ouvertes) : {ok: true, route: "host"} si Orca a pris
// l'envoi ; sinon {ok: false, cancelled: true} (fenêtre fermée sans envoi), {reason: "refused", failure} (Orca a refusé
// avec un message), {reason: "not_ready", issues} ou {reason: "not_started"}.
void from_panel(std::function<void(nlohmann::json)> done);

// Un envoi du panneau attend encore son verdict, ou un envoi suivi est en cours.
bool busy();

// Dernier échec d'envoi (15 min au plus), au format des problèmes d'Orca pour l'IA : [{source: "upload_error", code, level,
// text}] ; vide sinon.
nlohmann::json recent_issues();

// Banc d'essai : état du suivi.
nlohmann::json state();

}} // namespace Plyo::Send
