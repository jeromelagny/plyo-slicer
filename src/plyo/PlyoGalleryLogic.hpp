#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Galerie de l'étape « Ta pièce » (parcours débutant, lot 7) : logique pure, sans wxWidgets ni Orca.
// Les modèles ajoutés à la main vivent dans resources/plyo/galerie/ avec leur manifeste galerie.json ; chaque entrée est
// vérifiée ici avant d'être montrée ou posée. Voir resources/plyo/galerie/LISEZMOI.md.
namespace Plyo { namespace GalleryLogic {

// La licence permet-elle de livrer le fichier tel quel avec Plyo ? CC0, domaine public, CC BY, CC BY-SA et CC BY-ND (versions
// 2.0 à 4.0 ou sans version). Jamais « NC » (Plyo a des formules payantes) ni une licence propre à un site (par exemple la
// « Standard Digital File License » de MakerWorld, qui interdit la redistribution).
bool license_ok(const std::string& license);

// Entrées valides du manifeste, dans son ordre, 40 au plus : { id, file, name, category, what, image, author, license, source }.
// `exists(nom)` : le fichier est-il dans le dossier de la galerie ? Une entrée abîmée, en double, sans auteur, à la licence
// refusée ou dont le fichier manque est écartée ; une vignette absente est seulement retirée.
nlohmann::json entries(const nlohmann::json& manifest, const std::function<bool(const std::string&)>& exists);

}} // namespace Plyo::GalleryLogic
