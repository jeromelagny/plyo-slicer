#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

// Conversations de l'assistant, gardées sur l'ordinateur (datadir/plyo/conversations/<id>.json) pour les
// retrouver après une fermeture du panneau ou d'Orca. Le panneau fournit le contenu ({title, updated, entries})
// et l'affiche ; Plyo ne fait que ranger. 30 conversations avec un plateau (projet 3MF) et 30 sans plateau au plus : les
// plus anciennes sont effacées, et le panneau le dit.
namespace Plyo { namespace Conversations {

constexpr size_t MAX_KEPT  = 30;
constexpr size_t MAX_BYTES = 4 * 1024 * 1024;

// Identifiant donné par le panneau : lettres minuscules, chiffres et tirets (1 à 40).
bool           valid_id(const std::string& id);
// [{id, title, updated, project, has_plate}] du plus récent au plus ancien ; les fichiers abîmés sont ignorés.
nlohmann::json list();
// La conversation, ou null si elle n'existe pas ou est abîmée.
nlohmann::json load(const std::string& id);
// `removed` : noms (pièce, sinon titre) des conversations effacées pour faire de la place.
bool           save(const std::string& id, const nlohmann::json& conversation, std::vector<std::string>* removed = nullptr);
bool           remove(const std::string& id);

}} // namespace Plyo::Conversations
