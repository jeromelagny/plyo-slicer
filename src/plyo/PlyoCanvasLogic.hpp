#pragma once

#include <string>
#include <vector>

// Logique pure des emplacements du Canvas côté Orca (testée par src/plyo/tests/cpp ; même règles que canvas-logic.js).
namespace Plyo { namespace CanvasLogic {

// Adresse sans schéma, chemin ni port : « http://192.168.1.29:80/ » → « 192.168.1.29 » (comme ElegooLink à l'envoi).
std::string bare_host(const std::string& print_host);
// Types de profil à essayer pour le type d'un emplacement : exact (en majuscules), puis le type de base (« PLA-CF » → PLA).
std::vector<std::string> profile_types(const std::string& type);

}} // namespace Plyo::CanvasLogic
