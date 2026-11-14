#pragma once

#include <nlohmann/json.hpp>

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

// Couleur des pièces de la plaque en cours (carte « Couleurs » de l'étape Filament), côté slicer : lecture, sélection d'une
// pièce, changement de couleur d'une pièce ou d'une partie. Messages colours_get / colour_set du panneau (PlyoAssistant.cpp).
// Tout passe par les fonctions publiques d'Orca (ObjectList::set_extruder_for_selected_items, Sidebar::add_filament) et par
// Canvas::apply pour le profil et la couleur de la bobine. Rien de ce qui est lu ici ne part au service.
namespace Plyo { namespace Colours {

// Plaque en cours (50 pièces au plus) : {ok, pieces:[ColoursLogic::to_json], colours:[{t, color, type}], count}.
nlohmann::json state();

// Sélectionne la pièce `ref` dans la vue 3D et dans la liste des objets, comme un clic (aucun point d'annulation).
// Faux si elle n'est plus sur la plaque en cours.
bool select(const std::string& ref);

// request : {preset, object: ref, part: ref|"", all_parts, source, slot: {canvas_id, tray_id, type, color, preset?},
//            canvas: [{t, canvas_id, tray_id}]}
// `done` (fil principal) reçoit {ok, text?, reason?, t, added, undo_token, preset, canvas:[association mise à jour]}.
// reason : busy, gone, slot (la bobine a changé : « Vérifier à nouveau »), mixed, full, failed.
// La bobine est revérifiée avant tout changement : relue sur l'imprimante (lecture existante, réseau local), ou dans la
// saisie manuelle quand `source` vaut « manual ». Puis, sous un seul point d'annulation « Plyo assistant » : couleur ajoutée
// au projet si besoin, profil et couleur de la bobine sur cette couleur, sélection de la cible, changement de couleur, sélection
// d'avant remise. « Annuler » : plate_action « undo » avec `undo_token` (PlateActions::undo).
void set_colour(const nlohmann::json& request, std::function<void(nlohmann::json)> done);

// Lot 21 : couleurs prévues par le 3MF `path_utf8` que le panneau vient de poser (pièces `added`, rangs dans le modèle, dans
// l'ordre du fichier). Rend le fichier tel qu'il est, sans choix de l'assistant : chaque partie reprend la couleur du fichier
// (3MF ordinaire : matériaux de base ou groupes de couleurs, que le lecteur d'Orca ne reprend pas ; projet Bambu Studio ou Orca :
// Orca garde déjà la couleur des parties), les couleurs du projet manquantes sont ajoutées comme le fait l'import d'Orca, et les
// couleurs du projet que portent ces pièces (et aucune autre pièce de la plaque) prennent la teinte du fichier. Aucune étape
// d'annulation à part : celle de l'import la défait. Fichier d'une seule couleur, ou pièces qui ne correspondent pas : rien.
// Rend {file_colours: ["#RRGGBB" ou "", rang = t]} (vide si rien n'est repris). Rien de tout cela ne part au service.
nlohmann::json from_file(const std::string& path_utf8, const std::vector<size_t>& added);

}} // namespace Plyo::Colours
