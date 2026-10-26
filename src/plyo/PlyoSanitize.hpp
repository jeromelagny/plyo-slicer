#pragma once

#include <nlohmann/json.hpp>

// Nettoyage des fichiers JSON de Plyo relus depuis le disque (ou des états envoyés par le panneau) : on ne garde
// que des fiches de la forme attendue. Un fichier modifié à la main ou écrit par une ancienne version ne doit
// jamais faire planter la lecture. Sans dépendance à Orca (testé par src/plyo/tests/cpp).
namespace Plyo { namespace Sanitize {

// premiers-pas.json : seen, greeted, share_outcomes (booléens) ; level, tour_step (texte court ou null).
nlohmann::json first_steps(const nlohmann::json& stored);

// memoire.json : { machine : [ fiche {date, changes:[…], …} ] }.
nlohmann::json memory(const nlohmann::json& stored);

// journal.json : [ fiche {conv, parts:[…], …} ].
nlohmann::json journal(const nlohmann::json& stored);

// calibrations.json : { machine : { test : {value (nombre), date, preset} } }.
nlohmann::json calibrations(const nlohmann::json& stored);

}} // namespace Plyo::Sanitize
