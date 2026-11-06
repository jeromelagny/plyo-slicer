#pragma once

#include <boost/filesystem.hpp>

#include <algorithm>
#include <string>
#include <vector>

// Calibration guidée : la part sans Orca (testée par src/plyo/tests/cpp).
namespace Plyo { namespace CalibrationLogic {

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

}} // namespace Plyo::CalibrationLogic
