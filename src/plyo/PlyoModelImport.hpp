#pragma once

#include <nlohmann/json.hpp>

#include <string>

// Modèle 3D joint dans l'assistant (trombone ou glisser-déposer) : le panneau n'a que le contenu du fichier,
// Plyo en écrit une copie dans datadir/plyo/modeles puis la pose sur le plateau comme un import d'Orca.
namespace Plyo { namespace ModelImport {

// Taille maximale d'un fichier reçu du panneau.
constexpr size_t MAX_BYTES = 150 * 1024 * 1024;

// `name` : nom du fichier d'origine (STL, 3MF, OBJ, STEP, AMF) ; `base64` : son contenu.
// Renvoie {ok, name, size_mm:[x,y,z], fits, bed_mm:[x,y,z]} ou {ok:false, text}.
// `project` : le projet de la conversation ; pour un 3MF, ses réglages sont adaptés au projet (Project::adapt_file) et
// rendus dans `adaptation`.
// `replace` : ce qui est sur le plateau est retiré dans la même étape annulable (réponse : replaced, replaced_name, undo_token ;
// annuler avec PlateActions::undo). Si le fichier ne s'ouvre pas, le plateau reste comme avant.
nlohmann::json add(const std::string& name, const std::string& base64, const nlohmann::json& project = nlohmann::json(), bool replace = false);

// Adapte au projet le dernier 3MF posé par `add` (réglages d'impression du fichier, voir Project::adapt_file). Sert quand le
// filament est choisi après la pièce. {} si aucun 3MF n'a été posé ou si le fichier n'a pas de réglages.
nlohmann::json adapt_last(const nlohmann::json& project);

}} // namespace Plyo::ModelImport
