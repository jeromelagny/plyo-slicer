#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <utility>
#include <vector>

// Couleur des pièces de la plaque (carte « Couleurs » de l'étape Filament) : logique pure, sans Orca ni wxWidgets, testée
// par src/plyo/tests/cpp. La lecture et l'écriture dans le slicer sont dans PlyoColours.cpp.
// « t » : la couleur du projet (filament n° t + 1 d'Orca), toujours à partir de 0 ici. Jamais montré à l'utilisateur.
namespace Plyo { namespace ColoursLogic {

struct Part
{
    std::string ref, name; // ref : identifiant stable de la partie (ModelVolume::id)
    int         t = 0;
};

struct Piece
{
    std::string       ref, name; // ref : identifiant stable de la pièce (ModelObject::id), comme les ordres du plateau
    bool              selected = false;
    int               t        = 0;  // couleur de la pièce elle-même (clé « extruder » de l'objet)
    std::vector<Part> parts;         // seulement quand la pièce a plusieurs parties imprimées
    std::vector<int>  painted;       // couleurs de ses zones peintes
    bool              splittable = false;
};

// t commun à la pièce et à toutes ses parties, -1 si elles n'ont pas la même couleur.
int piece_colour(const Piece& piece);
// [{ref, name, selected, t, mixed, parts:[{ref, name, t}], painted:[t], splittable}] ; t vaut -1 quand mixed.
nlohmann::json to_json(const std::vector<Piece>& pieces);

struct Slot
{
    int canvas_id = 0, tray_id = 0;
};
struct Choice
{
    int         t   = -1;
    bool        add = false; // la couleur t (= count) est à ajouter au projet
    std::string refusal;
};

constexpr int MAX_COLOURS = 16;
extern const char* const TOO_MANY_TEXT;

// Couleur du projet pour la bobine `wanted`. `canvas` : association en cours [{t, canvas_id, tray_id}] (une entrée mal formée
// est ignorée) ; `used` : couleurs utilisées par la plaque ; `count` : couleurs du projet.
// Règle : la couleur déjà associée à `wanted` ; sinon la plus petite couleur ni utilisée ni associée (jamais la première, t = 0 :
// c'est le filament du projet, que suit l'onglet Filament) ; sinon une couleur ajoutée (t = count) ; refus à `max_count`.
Choice filament_for(const nlohmann::json& canvas, const std::vector<int>& used, int count, Slot wanted, int max_count);

// L'association après le choix : `canvas` sans l'entrée de `t`, ni une autre entrée sur la même bobine que l'on vient de
// libérer, plus {t, canvas_id, tray_id} ; triée par t. Seules les entrées bien formées sont gardées (t, canvas_id, tray_id).
nlohmann::json canvas_with(const nlohmann::json& canvas, int t, Slot slot);
// Les entrées de `canvas` dont la couleur est encore utilisée par la plaque.
nlohmann::json only_used(const nlohmann::json& canvas, const std::vector<int>& used);

// Refus d'un changement de couleur quand le slicer est occupé, '' sinon. Dans l'ordre : plateau d'une autre conversation
// (`busy_text` de ProjectFiles), tâche d'Orca en cours, découpe, envoi ou calibration, fenêtre ouverte.
struct Busy
{
    bool        other_conversation = false;
    std::string other_conversation_text;
    bool        job = false, slicing = false, sending = false, calibrating = false, modal = false;
};
std::string busy_refusal(const Busy& busy);

// La bobine demandée est-elle encore celle qu'on a lue ? `state` : lecture des emplacements au format commun ({ok, canvases,
// empty_blocks}) ; `type`, `color` : ce que la carte a montré. '' si oui, sinon la phrase à montrer (avec « Vérifier à nouveau »).
std::string slot_refusal(const nlohmann::json& state, Slot wanted, const std::string& type, const std::string& color);

// --- Couleurs prévues par un 3MF joint (lot 21) ---

// « #RRGGBB » en majuscules depuis « #RRGGBB » ou « #RRGGBBAA » (forme des 3MF), '' pour toute autre valeur.
std::string colour_hex(const std::string& value);

// Couleurs d'un 3MF « ordinaire » (exporté par un logiciel de dessin : pas de Metadata/model_settings.config de Bambu Studio ou
// d'Orca), lues dans le modèle `3D/3dmodel.model` : matériaux de base (`basematerials`, `displaycolor`) ou groupes de couleurs
// (`m:colorgroup`), désignés par `pid` / `pindex` sur un objet (ou, de façon uniforme, sur tous ses triangles). Le lecteur 3MF
// d'Orca ne lit que `m:colorgroup` sur l'objet de tête et ignore les matériaux de base : sans cette lecture, toutes les parties
// arrivent dans la première couleur.
struct FilePart
{
    int         t = -1; // couleur du fichier (rang dans `colours`), -1 : aucune
    std::string name;   // nom du sous-objet dans le fichier
};
struct FileObject
{
    std::string           name;
    std::vector<FilePart> parts; // dans l'ordre où Orca crée les parties (composants parcourus en largeur, comme bbs_3mf)
};
struct FileColours
{
    std::vector<std::string> colours; // couleurs utilisées, « #RRGGBB », dans l'ordre de leur première partie
    std::vector<FileObject>  objects; // un par objet du `build`, dans l'ordre où Orca crée les pièces
};
FileColours model_colours(const std::string& model_xml);

// Couleurs du projet à recolorer d'après le fichier : {t, couleur} pour chaque t que portent les pièces posées (`used_by_file`)
// et qu'aucune autre pièce de la plaque n'utilise (`used_by_others`), avec une couleur valide dans `file`. Rien si le fichier
// prévoit moins de deux couleurs : une seule couleur ne dit rien de la répartition, la bobine choisie reste.
std::vector<std::pair<int, std::string>> colours_to_set(const std::vector<std::string>& file, const std::vector<int>& used_by_file,
                                                        const std::vector<int>& used_by_others);

}} // namespace Plyo::ColoursLogic
