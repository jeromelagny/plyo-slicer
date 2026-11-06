#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

// Logique pure (sans réseau ni Orca, testée par src/plyo/tests/cpp) des emplacements, commune à toutes les marques.
// Format commun : canvases[{canvas_id, connected, trays[{tray_id, label, brand, type, name, color, min_temp, max_temp, status}]}].
// « canvas » désigne ici toute unité d'emplacements (Canvas, boîte CFS, IFS, têtes de la U1).
//
// ÉTAT : NON VALIDÉ sur machine pour CFS, IFS et U1 : les essais T9, T13, T14, T15 et T17 ne sont pas faits, et cette
// branche n'est pas livrable tant qu'ils ne le sont pas.
namespace Plyo { namespace SlotsLogic {

// La carte réduite à {t, canvas_id, tray_id} si chaque entrée est valable (t entier ≥ 0 sans doublon, unité connectée,
// emplacement existant) ; sinon un tableau vide : jamais de carte partielle.
nlohmann::json sanitize_slot_map(const nlohmann::json& map, const nlohmann::json& canvases);
// Carte du plan d'envoi ({host, map}) si l'envoi vise cette imprimante et que la pièce découpée utilise exactement les
// couleurs de la carte (`sliced_t`, numéros de filament à partir de 0) ; sinon un tableau vide.
nlohmann::json map_for_send(const nlohmann::json& plan, const std::string& host, const std::vector<int>& sliced_t);

struct MapDecision
{
    nlohmann::json map = nlohmann::json::array(); // carte à envoyer ({t, canvas_id, tray_id})
    std::string    refusal;                       // non vide : ne pas démarrer, texte pour l'utilisateur
};
struct DecideOptions
{
    std::string unit_name    = "le Canvas"; // « le … » ou « la … », utilisé dans les refus
    bool        offer_plain  = true;        // le refus propose « Démarrer sans carte » (CC2 seulement tant que son sens n'est pas vérifié ailleurs)
    bool        empty_blocks = false;       // un emplacement vide (status 0) est refusé
};
// Carte prévue (`planned` : [{t, canvas_id, tray_id, type, preset, label?}], non vide) confrontée à une relecture fraîche
// (`canvases`, null si la relecture a échoué) et aux profils de filament actuels d'Orca (`presets`, par numéro) : refus si
// la relecture manque, si un emplacement a disparu ou changé de type, ou si une couleur a changé de profil.
// Numéro affiché : `label` du plan, puis celui de la lecture, puis tray_id + 1 (CC2 et ses projets enregistrés).
MapDecision decide_map(const nlohmann::json& planned, const nlohmann::json& canvases, const std::vector<std::string>& presets,
                       const DecideOptions& opts = {});

// --- Choix du traducteur ---

// Décision ouverte 1 (Jérôme) : modèles sur lesquels la répartition peut être imposée. Réglage par défaut : K2 et K2 Plus
// restent tous deux ; T13/T15 retirent tout modèle non essayé avant livraison. Comparaison exacte avec printer_model
// (« Creality K2 SE » contient « Creality K2 »). Une seule liste à modifier.
inline const std::vector<std::string>& cfs_imposable_models()
{
    static const std::vector<std::string> models = {"Creality K2", "Creality K2 Plus"};
    return models;
}
inline const std::vector<std::string>& ifs_imposable_models()
{
    static const std::vector<std::string> models = {"Flashforge AD5X"};
    return models;
}

// Décision ouverte 3 (Jérôme, à confirmer en T13) : sur CFS, Orca envoie toute la liste des filaments, couleurs inutilisées
// comprises. Réglage par défaut : elles partent sur le même emplacement que la première entrée de la carte. À false, ces
// projets sont refusés.
constexpr bool UNUSED_COLOUR_ON_FIRST_SLOT = true;
// Décision ouverte 4 (Jérôme) : un emplacement vide est refusé à l'envoi sur CFS et IFS. La CC2 garde sa règle (son `status`
// n'est pas fiable). À false, CFS et IFS suivraient la règle permissive de la CC2.
constexpr bool EMPTY_SLOT_BLOCKS = true;

struct PrinterFacts
{
    std::string         printer_model, host_type, printer_agent;
    bool                has_host      = false;
    bool                has_ff_serial = false;
    bool                has_code      = false;
    std::vector<double> nozzles; // diamètre par tête : ne change pas le traducteur, servira au réordonnancement U1 (T18)
};
struct Detection
{
    std::string kind = "none";    // canvas, cfs, ifs, u1, none
    bool        imposable = false; // la répartition peut être imposée, sous réserve du contrôle vivant de chaque traducteur
    std::string reason;           // link_incomplete : le panneau propose de relier à nouveau (décision ouverte 5)
};
// Une valeur inattendue baisse toujours vers « lire sans imposer » ou « sans traducteur », jamais l'inverse.
Detection detect(const PrinterFacts& facts);
// Au moment de relier : sans code, Flashforge::test reste sur l'ancien chemin TCP et réussit quand même, et l'imprimante ne pourrait
// ensuite recevoir aucune répartition. Seulement les modèles imposables : les autres Flashforge se relient comme avant.
bool link_needs_code(const std::string& host_type, const std::string& printer_model, bool has_serial, bool has_code);

// « #RRGGBB » en majuscules, ou vide si la valeur n'a pas cette forme.
std::string hex_colour(const std::string& raw);

}} // namespace Plyo::SlotsLogic
