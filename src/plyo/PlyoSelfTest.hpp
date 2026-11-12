#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Banc d'essai dans la vraie application : quand la variable d'environnement PLYO_SELFTEST donne le chemin d'un fichier
// JavaScript (le « pilote »), ce fichier est ajouté à la fin de la page du panneau. Le pilote clique alors sur les vrais
// boutons par le DOM et rend compte par le pont (messages selftest_*). Variable vide ou absente : rien de tout cela n'existe,
// aucun message du banc n'est accepté. Comparaison web : un script de test injecté seulement en mode « dev ».
namespace Plyo { namespace SelfTest {

// Vrai si PLYO_SELFTEST est renseignée ET que son fichier a pu être lu (lu une seule fois, au premier appel).
bool active();

// Le pilote dans sa balise <script>, à ajouter après les scripts du panneau ; "" hors banc.
std::string page_script();

// Messages du banc (selftest_log, selftest_done, selftest_call). Rend false sans rien faire si le banc est inactif ou si
// `type` n'est pas un message du banc.
bool handle(const std::string& type, const nlohmann::json& data, const std::function<void(const nlohmann::json&)>& send);

}} // namespace Plyo::SelfTest
