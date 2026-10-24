#pragma once

#include "libslic3r/Point.hpp"

#include <nlohmann/json.hpp>

#include <string>

// Le plateau vu par l'assistant (ce qui est posé, tient ou pas, découpé ou pas) et les actions que l'utilisateur
// déclenche depuis une réponse : chacune passe par la commande d'Orca correspondante, donc par son « Annuler ».
namespace Plyo { namespace PlateActions {

// Zone imprimable de l'imprimante en cours (largeur, profondeur, hauteur en mm ; 0 si inconnue).
Slic3r::Vec3d  bed_size();
// Tient sur le plateau, au besoin tourné d'un quart de tour (une dimension du plateau à 0 est ignorée).
bool           fits(const Slic3r::Vec3d& size, const Slic3r::Vec3d& bed);
// {objects: [{name, size_mm}], bed_mm, sliced, time_s, weight_g} pour la plaque en cours.
nlohmann::json context();
// `kind` : orient | arrange | scale_to_fit | slice. Renvoie {ok, text} et, pour une action annulable, `undo_token`
// (l'instantané d'annulation d'Orca pris juste avant l'action).
nlohmann::json run(const std::string& kind);
// Annule l'action `undo_token`, seulement si rien n'a changé sur le plateau depuis et qu'aucune tâche ne tourne.
nlohmann::json undo(long long undo_token);

}} // namespace Plyo::PlateActions
