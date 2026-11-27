#pragma once

#include <boost/filesystem.hpp>

#include <algorithm>
#include <cctype>
#include <string>
#include <utility>
#include <vector>

// Calibration guidée : la part sans Orca (testée par src/plyo/tests/cpp).
namespace Plyo { namespace CalibrationLogic {

// Nom du préréglage qui reçoit le résultat d'une calibration. Une bobine garde son propre nom (on écrit dans son
// préréglage, sans « (calibré Plyo) ») ; sinon « origine — imprimante (calibré Plyo) ».
inline std::string target_name(bool is_spool, const std::string& filament, const std::string& origin, const std::string& printer,
                               const std::string& suffix)
{
    return is_spool ? filament : origin + " — " + printer + suffix;
}

enum class CaptureStep {
    First,   // aucune capture en mémoire : on capture
    Keep,    // la capture reste valable : le plateau est celui du test, vidé ou réduit
    Replace, // plus aucun objet du test : on capture ce plateau, sans toucher au fichier de la capture d'avant
};

// `plate` : objets du plateau ; `test` : objets du dernier test. Un seul objet du test encore présent suffit à dire que
// le plateau est un plateau de test, même si l'utilisateur y a supprimé des carrés.
inline CaptureStep capture_step(bool has_capture, const std::vector<size_t>& plate, const std::vector<size_t>& test)
{
    if (!has_capture)
        return CaptureStep::First;
    if (plate.empty())
        return CaptureStep::Keep;
    const bool test_object_left = std::any_of(plate.begin(), plate.end(), [&](size_t id) { return std::find(test.begin(), test.end(), id) != test.end(); });
    return test_object_left ? CaptureStep::Keep : CaptureStep::Replace;
}

// Premier « avant-calibration-N.3mf » libre : un fichier existant n'est jamais réécrit. Chemin vide si le dossier est illisible.
inline boost::filesystem::path free_capture_path(const boost::filesystem::path& dir)
{
    for (int n = 1; n <= 10000; ++n) {
        const boost::filesystem::path path = dir / ("avant-calibration-" + std::to_string(n) + ".3mf");
        boost::system::error_code     ec;
        // status() et non exists() : seul « fichier absent » libère le numéro, pas une erreur de lecture du disque.
        if (boost::filesystem::status(path, ec).type() == boost::filesystem::file_not_found)
            return path;
    }
    return boost::filesystem::path();
}

// Gagnant de la passe 1 du débit donné à la passe 2 : même plage que l'enregistrement de ce réglage (0 : aucun, la passe part
// du débit du filament).
inline bool flow_base_valid(double base) { return base == 0 || (base >= 0.7 && base <= 1.3); }

// Phrase ajoutée à « Remettre ma pièce » quand d'autres pièces sont restées de côté sur le disque ; vide s'il n'y en a pas.
inline std::string kept_note(const std::vector<std::string>& files)
{
    if (files.empty())
        return std::string();
    std::string list;
    for (const std::string& file : files)
        list += (list.empty() ? "" : ", ") + file;
    return " Un plateau d'avant un test précédent reste gardé (à rouvrir par Fichier > Ouvrir si besoin) : " + list + ".";
}

// Tour de température : `start` (le plus chaud, en bas) et `end`, par pas de 5 °C ; `refusal` non vide : on ne lance pas le test.
struct TempTower
{
    int         start = 0, end = 0;
    std::string refusal;
};

// Plage sûre du slicer pour une température de buse (voir keys_for dans PlyoCalibration.cpp) : au-delà, le résultat ne s'enregistrerait pas.
constexpr int TOWER_MIN = 170, TOWER_MAX = 300;
constexpr int TOWER_MIN_SPAN = 10, TOWER_MAX_SPAN = 60; // au moins 3 blocs, au plus 13

// `filament_type` du profil (noms de Slic3r::MaterialType). Types connus : à l'intérieur de MATERIAL_RANGES de plyo-api (whitelist.ts),
// mêmes familles que filamentFamily. Autres types : les limites du profil (`profile_low`, `profile_high`, et `profile_nozzle` pour vérifier
// qu'elles veulent dire quelque chose) ; sans limites utilisables, un refus : mieux vaut pas de test qu'un test inadapté.
inline TempTower temperature_tower(const std::string& filament_type, int profile_low, int profile_high, int profile_nozzle)
{
    static const std::vector<std::pair<std::pair<int, int>, std::vector<std::string>>> towers = {
        {{230, 190}, {"PLA", "PLA-CF", "PLA-GF", "PLA-AERO"}},
        {{260, 220}, {"PETG"}},
        {{270, 240}, {"PETG-CF", "PETG-GF"}},
        {{270, 250}, {"PCTG"}},
        {{270, 230}, {"ABS", "ABS-CF", "ABS-GF", "ASA", "ASA-CF", "ASA-GF", "ASA-AERO"}},
        {{280, 250}, {"PC-ABS"}},
        {{260, 220}, {"HIPS"}},
        {{240, 200}, {"TPU"}},
        {{290, 250}, {"PA", "PA-CF", "PA-GF", "PA6", "PA6-CF", "PA6-GF", "PA11", "PA11-CF", "PA11-GF", "PA12", "PA12-CF", "PA12-GF", "PAHT", "PAHT-CF", "PAHT-GF"}},
        {{300, 260}, {"PC", "PC-CF", "PC-PBT"}},
        {{300, 260}, {"PET-CF"}},
        {{250, 195}, {"PVA"}},
    };
    std::string type = filament_type;
    std::transform(type.begin(), type.end(), type.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
    for (const auto& row : towers)
        if (std::find(row.second.begin(), row.second.end(), type) != row.second.end())
            return {row.first.first, row.first.second, std::string()};

    // Vers l'intérieur de la plage : jamais une température hors des limites du profil.
    const int end   = (profile_low + 4) / 5 * 5;
    const int start = profile_high / 5 * 5;
    const bool usable = profile_low >= TOWER_MIN && profile_high <= TOWER_MAX && start - end >= TOWER_MIN_SPAN && start - end <= TOWER_MAX_SPAN &&
                        profile_nozzle >= profile_low && profile_nozzle <= profile_high;
    if (usable)
        return {start, end, std::string()};
    TempTower refused;
    refused.refusal = "Je ne connais pas les bonnes températures du filament « " + filament_type + " » et son profil n'indique pas de plage utilisable (entre " +
                      std::to_string(TOWER_MIN) + " et " + std::to_string(TOWER_MAX) + " °C) : je ne lance pas ce test, rien n'a changé. "
                      "Vérifie la plage de température de la buse dans l'onglet Filament, puis réessaie.";
    return refused;
}

}} // namespace Plyo::CalibrationLogic
