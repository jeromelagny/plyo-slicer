#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Modèle 3D joint dans l'assistant (trombone ou glisser-déposer) : le panneau n'a que le contenu du fichier,
// Plyo en écrit une copie dans datadir/plyo/modeles puis la pose sur le plateau comme un import d'Orca.
namespace Plyo { namespace ModelImport {

// Taille maximale d'un fichier reçu du panneau.
constexpr size_t MAX_BYTES = 50 * 1024 * 1024;

// `name` : nom du fichier d'origine (STL, 3MF, OBJ, STEP, AMF) ; `base64` : son contenu.
// Renvoie {ok, name, size_mm:[x,y,z], fits, bed_mm:[x,y,z]} ou {ok:false, text}.
nlohmann::json add(const std::string& name, const std::string& base64);

}} // namespace Plyo::ModelImport
