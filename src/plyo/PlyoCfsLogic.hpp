#pragma once

#include <nlohmann/json.hpp>

#include <map>
#include <string>

// Logique pure du CFS (Creality K2 / K2 Plus), testée par src/plyo/tests/cpp. NON VALIDÉE sur machine : schéma lu dans le code
// d'Orca (CrealityPrintAgent.cpp, CrealityPrintHostSendDialog), à confronter à une vraie lecture en T9 et à un vrai départ en T13.
//
// On n'utilise pas CrealityPrintAgent::parse_cfs_response : elle renumérote les boîtes à partir de 0, or CrealityPrint::start_print
// traite boxId 0 comme le porte-bobine : la répartition serait abandonnée sans erreur. Ici, canvas_id = box.id brut.
namespace Plyo { namespace CfsLogic {

// Réponse de CrealityPrint::query_boxes_info() → {ok, canvases, box_count, anomaly}. canvases au format commun + box_type
// (0 CFS, 1 porte-bobine). box_count : boîtes CFS actives. anomaly : non vide si un champ est inattendu ; le contrôle vivant
// refuse alors d'imposer. Ne lève jamais.
nlohmann::json parse_boxes(const std::string& body);

// Pourquoi on ne peut pas imposer (vide : on peut). `model_display` : CrealityPrint::model_name() vivant (K2, K2 Plus,
// unreachable, unknown (F999)…) ; `profile_model` : printer_model du profil, à comparer exactement.
// Exige un modèle de la liste blanche et cohérent avec le profil, exactement une boîte CFS active d'id ≠ 0 et le porte-bobine en id 0.
std::string live_blocker(const std::string& model_display, const std::string& profile_model, const nlohmann::json& parsed);
bool        live_imposable(const std::string& model_display, const std::string& profile_model, const nlohmann::json& parsed);

}} // namespace Plyo::CfsLogic
