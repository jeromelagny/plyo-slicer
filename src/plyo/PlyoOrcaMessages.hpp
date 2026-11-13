#pragma once

#include "PlyoHooks.hpp" // on_slicing_done : appelée par Orca

#include <nlohmann/json.hpp>

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

namespace Slic3r {
class Print;
class SlicingProcessCompletedEvent;
} // namespace Slic3r

// Ce qu'Orca sait de la plaque en cours, lu sans rien changer dans Orca (fil de l'interface seulement) : refus et
// avertissements de validation (Print::validate), avertissements des étapes de découpe, contrôles du G-code, et la fin
// de chaque découpe. Chaque problème a la forme commune de PlyoOrcaMessagesLogic (to_json) :
// {source, code, level, text, opt_key?, scope?, object_ref?, object_name?, critical?, fix?}.
namespace Plyo { namespace OrcaMessages {

// Qui prévient le panneau : message {type: "slice_result", status: "error" | "finished" | "cancelled", issues, …}.
void set_listener(std::function<void(const nlohmann::json&)> listener);

// on_slicing_done (PlyoHooks.hpp, fil de l'interface, à chaque fin de traitement de fond) classe l'erreur par type
// d'exception, retient ce type pour l'export, et prévient le panneau d'une découpe finie ou en erreur. Une annulation
// n'est jamais une erreur : elle n'est dite que si aucune découpe ne reprend.

// Refus et avertissements de validation de la plaque en cours, avec les notifications d'Orca sur la plaque et la pièce
// (source « notification », OrcaMessagesLogic::merge_notices). `busy` : Orca découpe, rien n'est lu. `pending` : un
// changement attend d'être pris en compte par Orca (la lecture peut dater d'avant ce changement).
struct Validation
{
    nlohmann::json issues = nlohmann::json::array();
    bool           busy    = false;
    bool           pending = false;
};
Validation validate_plate();

// Tout ce qu'Orca dit de la plaque en cours (validation et notifications du plateau, puis avertissements de découpe et
// contrôles du G-code si elle est découpée), MAX_ISSUES au plus : {issues, busy, pending, sliced, ready_for_print}.
nlohmann::json report();

// Codes des notifications d'Orca que le panneau explique, affichées en ce moment (ERR-11) : signal léger joint à
// tour_signals ; le panneau demande le détail (orca_issues) quand il change.
std::vector<std::string> notice_codes();

// Plaque découpée et imprimable : le résultat d'Orca (PartPlate::is_slice_result_ready_for_print) et ses contrôles de
// l'aperçu (trajet hors plateau ou trop haut).
bool ready_for_print();

// Avertissement d'une étape de découpe, gardé avec son identifiant stable.
struct StepWarning
{
    int         message_id = 0;  // PrintStateBase::SlicingNotificationType
    bool        critical   = false;
    std::string text;
    size_t      object_id  = 0;  // ModelObject::id de la pièce, 0 pour un avertissement de toute la plaque
    std::string step;            // nom de l'étape (posSupportMaterial, psGCodeExport…)
};
// Avertissements « en cours » de toutes les étapes du Print et de ses pièces.
std::vector<StepWarning> step_warnings(const Slic3r::Print& print);

// Erreur d'export relayée au panneau : {kind, text} d'après le type de l'exception lue par on_slicing_done, texte nettoyé
// (le dossier de l'utilisateur réduit au nom du fichier `path`).
nlohmann::json export_failure(const std::string& error, const std::string& path);

// Texte d'Orca prêt pour le panneau et l'IA : adresses du réseau (dont l'adresse, le code d'accès et le numéro de série de
// l'imprimante en cours) puis chemins privés retirés (SendLogic::scrub_network, OrcaMessagesLogic::clean_text). Lot 10.
std::string clean_for_panel(const std::string& text);

}} // namespace Plyo::OrcaMessages
