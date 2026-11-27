#pragma once

#include <nlohmann/json.hpp>

#include <map>
#include <string>
#include <vector>

// Retouches faites à la main dans les onglets Impression et Filament d'Orca (lot 11 : UX-31, UX-32, UX-36) : la part sans
// Orca, testée par src/plyo/tests/cpp. Les valeurs sont les textes d'Orca (opt_serialize) des clés du catalogue.
namespace Plyo { namespace RetouchesLogic {

using Values = std::map<std::string, std::string>;

constexpr size_t MAX_CHANGES = 40;   // une retouche plus large n'est pas listée au-delà (le reste est compté)
constexpr size_t MAX_VALUE_BYTES = 2000;

// Clés retouchées à la main : présentes dans `edited` avec un autre texte que dans `saved` (le préréglage enregistré), sauf
// celles que Plyo a écrites et que personne n'a retouchées depuis (`plyo_written` : même texte qu'aujourd'hui). Triées.
std::vector<std::string> manual_keys(const Values& saved, const Values& edited, const Values& plyo_written);

// Retouches d'impression en attente de ta réponse (« les garder dans mon profil ? »), relues du disque : seulement les
// champs connus, bornés. {} si rien d'utilisable (aucun changement, pas de préréglage).
// Forme : {preset, project, conv, at, changes: [{key, label, before, after}], values: {clé: texte}, before: {clé: texte}}.
nlohmann::json sanitize_pending(const nlohmann::json& stored);

// Peut-on écrire ces retouches dans le profil d'impression maintenant ? "" : oui. « other_preset » : Orca n'est plus sur
// ce profil ; « dirty » : le profil a déjà d'autres retouches dans ce projet (on ne mélange pas) ; « empty » : rien à écrire.
std::string keep_refusal(const nlohmann::json& pending, const std::string& selected_preset, bool print_dirty);

// Nom sous lequel les garder : le profil lui-même s'il est à toi, sinon sa copie « (Plyo) » (un profil d'Orca ne s'écrase
// jamais).
std::string keep_name(const std::string& preset, bool can_overwrite, const std::vector<std::string>& existing);

// « Annuler » d'une retouche gardée dans la bobine : seulement si la bobine est toujours celle-là et garde exactement ce
// qui a été écrit (`now` : ses valeurs enregistrées d'aujourd'hui). "" : oui ; « other_spool » ; « changed » (retouchée
// depuis) ; « dirty » (modifiée et pas encore enregistrée).
std::string spool_undo_refusal(const nlohmann::json& kept, const std::string& selected_preset, bool filament_dirty, const Values& now);

}} // namespace Plyo::RetouchesLogic
