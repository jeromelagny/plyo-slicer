#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace Plyo { namespace MakerWorldImport {

// Importe le modèle d'un lien « Ouvrir dans … » capté dans la fenêtre MakerWorld, puis capture les réglages du
// créateur. Renvoie le message `makerworld_imported` pour le panneau, ou null si aucun projet avec réglages n'a
// été ouvert (import annulé, géométrie seule, fichier .zip…).
nlohmann::json import_link(const std::string& open_url);

// Repasse sur l'imprimante et le profil d'impression de l'utilisateur (et son filament, sauf si
// `keep_creator_filaments`), puis applique `changes` par le pont des réglages. Renvoie {ok, text}.
nlohmann::json apply(bool keep_creator_filaments, const nlohmann::json& changes);

// Annule `apply` : préréglages et réglages complets du créateur, tels que capturés à l'import.
nlohmann::json restore_creator();

// Modèle multicolore sur une imprimante sans changement de couleur : le filament de l'utilisateur partout.
nlohmann::json use_my_filament_everywhere();

}} // namespace Plyo::MakerWorldImport
