#include "PlyoModelImport.hpp"
#include "PlyoColours.hpp"
#include "PlyoFiles.hpp"
#include "PlyoGalleryLogic.hpp"
#include "PlyoJson.hpp"
#include "PlyoOrcaWindows.hpp"
#include "PlyoPlateActions.hpp"
#include "PlyoProject.hpp"

#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/GUI_Factories.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/Utils/UndoRedo.hpp"

#include <boost/algorithm/string/case_conv.hpp>
#include <boost/beast/core/detail/base64.hpp>
#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>
#include <boost/nowide/fstream.hpp>

#include <cctype>
#include <cmath>
#include <cstdint>
#include <iterator>
#include <fstream>
#include <vector>

namespace Plyo { namespace ModelImport {

namespace fs = boost::filesystem;
using Slic3r::GUI::wxGetApp;

namespace {

std::string s_last_3mf; // chemin du dernier 3MF posé par le panneau

// Nom de fichier sûr (pas de dossier, caractères simples) avec une extension de modèle acceptée ; "" sinon.
std::string safe_name(const std::string& name)
{
    std::string base = fs::path(name).filename().string();
    std::string ext  = boost::algorithm::to_lower_copy(fs::path(base).extension().string());
    if (ext != ".stl" && ext != ".3mf" && ext != ".obj" && ext != ".step" && ext != ".stp" && ext != ".amf")
        return std::string();
    std::string out;
    for (unsigned char c : base)
        out += (std::isalnum(c) || c == '.' || c == '-' || c == '_') ? char(c) : '_';
    return out.empty() || out[0] == '.' ? "modele" + ext : out;
}

nlohmann::json size_of(const Slic3r::Vec3d& v)
{
    return {std::round(v.x()), std::round(v.y()), std::round(v.z())};
}

// Pose `path` sur le plateau (une nouvelle pièce, ou la pièce qui remplace celle du projet précédent) et mesure si elle
// tient ; `shown_name` est le nom de la pièce dans le panneau.
nlohmann::json place(const fs::path& path, const std::string& shown_name, const nlohmann::json& project, bool replace)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return {{"ok", false}, {"text", "Plateau indisponible."}};
    if (auto* frame = wxGetApp().mainframe)
        frame->select_tab(TAB_ID_PREPARE);
    // Nouveau projet : l'ancienne pièce part et la nouvelle arrive en une seule étape d'annulation (comme un Cmd+Z).
    const size_t      replaced      = replace ? plater->model().objects.size() : 0;
    const std::string replaced_name = replaced > 0 ? plater->model().objects.front()->name : std::string();
    std::vector<size_t> added;
    {
        // Lot 10 (ERR-14) : une question d'Orca pendant l'ajout (pièce en plusieurs parties…) est vue par le panneau, qui dit
        // de répondre dans sa fenêtre.
        OrcaWindows::Scope windows("model_add");
        if (replaced > 0) {
            Slic3r::GUI::Plater::TakeSnapshot snapshot(plater, "Plyo: nouvelle pièce");
            plater->delete_all_objects_from_model();
            added = plater->load_files({path}, Slic3r::LoadStrategy::LoadModel);
        } else
            added = plater->load_files({path}, Slic3r::LoadStrategy::LoadModel);
    }
    if (added.empty()) {
        if (replaced > 0)
            plater->undo(); // le fichier ne s'ouvre pas : l'ancienne pièce revient
        // Orca dit pourquoi dans sa fenêtre d'erreur, ouverte juste après (show_error) : le panneau la cite sous ce message.
        OrcaWindows::expect("model_add", 3000);
        const std::string ext  = boost::algorithm::to_lower_copy(path.extension().string());
        const bool        step = ext == ".step" || ext == ".stp";
        return {{"ok", false},
                {"reason", "orca_refused"},
                {"step_file", step},
                {"text", "Plyo Slicer n'a pas pu ouvrir « " + shown_name + " »" +
                             (step ? std::string(". Les fichiers STEP sont parfois mal lus : exporte-le plutôt en STL ou en 3MF depuis ton "
                                                 "logiciel de dessin, puis réessaie.")
                                   : std::string(" : le fichier est peut-être abîmé ou incomplet (téléchargement interrompu), ou ce "
                                                 "n'est pas un modèle 3D."))}};
    }

    Slic3r::BoundingBoxf3 box;
    for (size_t idx : added)
        if (idx < plater->model().objects.size())
            box.merge(plater->model().objects[idx]->instance_bounding_box(0));

    const Slic3r::Vec3d bed  = PlateActions::bed_size();
    const Slic3r::Vec3d size = box.defined ? box.size() : Slic3r::Vec3d(0, 0, 0);
    const bool          fits = PlateActions::fits(size, bed);
    BOOST_LOG_TRIVIAL(info) << "Plyo: modèle joint posé sur le plateau : " << path.string();
    nlohmann::json result = {{"ok", true}, {"name", shown_name}, {"count", added.size()},
                             {"size_mm", size_of(size)}, {"bed_mm", size_of(bed)}, {"fits", fits}};
    if (replaced > 0) {
        result["replaced"]      = replaced;
        result["replaced_name"] = Json::utf8_prefix(replaced_name, 120);
        result["undo_token"]    = static_cast<long long>(plater->undo_redo_stack_main().active_snapshot_time());
    }
    // Un 3MF arrive avec les réglages de son auteur : on les adapte à l'imprimante et au filament du projet.
    if (boost::algorithm::to_lower_copy(path.extension().string()) == ".3mf") {
        s_last_3mf = path.string();
        // Lot 21 : les couleurs prévues par le fichier, rendues aux pièces (le lecteur d'Orca les perd pour un 3MF ordinaire).
        const nlohmann::json colours = Colours::from_file(path.string(), added);
        if (!Json::arr(colours, "file_colours").empty())
            result["file_colours"] = colours["file_colours"];
        const nlohmann::json adaptation = Project::adapt_file(path.string(), project);
        if (!adaptation.empty())
            result["adaptation"] = adaptation;
    }
    return result;
}

} // namespace

nlohmann::json add(const std::string& name, const std::string& base64, const nlohmann::json& project, bool replace)
{
    const std::string file = safe_name(name);
    if (file.empty())
        return {{"ok", false}, {"text", "Ce type de fichier n'est pas un modèle 3D (STL, 3MF, OBJ, STEP ou AMF)."}};
    if (base64.empty() || boost::beast::detail::base64::decoded_size(base64.size()) > MAX_BYTES)
        return {{"ok", false}, {"text", "Fichier vide ou trop lourd (150 Mo au plus). Importe-le plutôt par le menu Fichier › Importer : je verrai la pièce arriver."}};

    std::string bytes(boost::beast::detail::base64::decoded_size(base64.size()), '\0');
    bytes.resize(boost::beast::detail::base64::decode(bytes.data(), base64.data(), base64.size()).first);

    const fs::path            dir = fs::path(Slic3r::data_dir()) / "plyo" / "modeles";
    boost::system::error_code ec;
    fs::create_directories(dir, ec);
    fs::path path = dir / file;
    for (int i = 2; fs::exists(path) && i < 1000; ++i)
        path = dir / (fs::path(file).stem().string() + "-" + std::to_string(i) + fs::path(file).extension().string());
    if (!Files::write_atomic(path, bytes, false))
        return {{"ok", false}, {"text", "Le fichier n'a pas pu être copié."}};
    return place(path, fs::path(name).filename().string(), project, replace);
}

namespace {

// Galerie du panneau (parcours débutant, lot 7) : des modèles déjà livrés avec Orca (resources/handy_models), donc déjà
// redistribués avec l'application, chacun d'un seul fichier. `sample` (clé du panneau) → clé de la table d'Orca et nom affiché.
// « benchy » : le petit bateau de test d'avant la galerie, même pièce.
struct GalleryModel
{
    const char* sample;
    const char* orca_key;
    const char* name;
};
constexpr GalleryModel GALLERY[] = {
    {"benchy", "3dbenchy", "Petit bateau de test (3DBenchy)"},
    {"cali_cat", "cali_cat", "Chat de calibration (Cali Cat)"},
    {"stanford_bunny", "stanford_bunny", "Lapin de Stanford"},
    {"voron_cube", "voron_cube", "Cube de test Voron"},
    {"autodesk_fdm_test", "autodesk_fdm_test", "Test d'impression Autodesk"},
    {"orca_tolerance_test", "orca_tolerance_test", "Test de tolérance"},
};

// Galerie remplie à la main (resources/plyo/galerie) : le manifeste, ses entrées vérifiées, et les fichiers lus d'un bloc.
fs::path gallery_dir() { return fs::path(Slic3r::resources_dir()) / "plyo" / "galerie"; }

std::string read_small(const fs::path& path, std::uintmax_t max_bytes)
{
    boost::system::error_code ec;
    const std::uintmax_t      size = fs::file_size(path, ec);
    if (ec || size == 0 || size > max_bytes)
        return std::string();
    boost::nowide::ifstream file(path.string(), std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
}

nlohmann::json gallery_entries()
{
    const fs::path       dir      = gallery_dir();
    const nlohmann::json manifest = nlohmann::json::parse(read_small(dir / "galerie.json", 256 * 1024), nullptr, false);
    return GalleryLogic::entries(manifest, [&dir](const std::string& name) {
        boost::system::error_code ec;
        return fs::is_regular_file(dir / name, ec);
    });
}

} // namespace

nlohmann::json gallery()
{
    nlohmann::json out = nlohmann::json::array();
    for (nlohmann::json e : gallery_entries()) {
        const std::string image = Json::str(e, "image");
        e.erase("file");
        e.erase("image");
        // Vignette : 300 Ko au plus, envoyée au panneau en data: (la page n'a pas accès aux fichiers).
        const std::string bytes = image.empty() ? std::string() : read_small(gallery_dir() / image, 300 * 1024);
        if (!bytes.empty()) {
            std::string encoded(boost::beast::detail::base64::encoded_size(bytes.size()), '\0');
            encoded.resize(boost::beast::detail::base64::encode(encoded.data(), bytes.data(), bytes.size()));
            const bool png = boost::algorithm::to_lower_copy(fs::path(image).extension().string()) == ".png";
            e["image"]     = std::string(png ? "data:image/png;base64," : "data:image/jpeg;base64,") + encoded;
        }
        out.push_back(e);
    }
    return out;
}

nlohmann::json add_sample(const std::string& sample, const nlohmann::json& project, bool replace)
{
    // Même pose qu'un fichier choisi, sans copie (le fichier est déjà sur l'ordinateur, dans les ressources de l'application).
    const char* const missing = "Je ne trouve pas cette pièce dans les fichiers de Plyo.";
    const GalleryModel* pick = nullptr;
    for (const GalleryModel& g : GALLERY)
        if (sample == g.sample)
            pick = &g;
    if (pick == nullptr) {
        // Un modèle ajouté à la galerie (resources/plyo/galerie), vérifié de nouveau au moment de le poser.
        for (const nlohmann::json& e : gallery_entries())
            if (Json::str(e, "id") == sample)
                return place(gallery_dir() / Json::str(e, "file"), Json::str(e, "name"), project, replace);
        return {{"ok", false}, {"text", missing}};
    }
    for (const auto& model : Slic3r::GUI::MenuFactory::handy_models()) {
        if (std::string(model.key) != pick->orca_key || model.file_names.empty())
            continue;
        const fs::path            path = fs::path(Slic3r::resources_dir()) / "handy_models" / model.file_names.front();
        boost::system::error_code ec;
        if (!fs::exists(path, ec))
            break;
        return place(path, pick->name, project, replace);
    }
    BOOST_LOG_TRIVIAL(warning) << "Plyo: modèle de la galerie introuvable dans les ressources : " << pick->orca_key;
    return {{"ok", false}, {"text", missing}};
}

nlohmann::json adapt_last(const nlohmann::json& project)
{
    if (s_last_3mf.empty())
        return nlohmann::json::object();
    return Project::adapt_file(s_last_3mf, project);
}

}} // namespace Plyo::ModelImport
