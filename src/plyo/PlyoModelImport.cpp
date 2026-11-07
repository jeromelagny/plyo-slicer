#include "PlyoModelImport.hpp"
#include "PlyoFiles.hpp"
#include "PlyoJson.hpp"
#include "PlyoPlateActions.hpp"
#include "PlyoProject.hpp"

#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/Utils/UndoRedo.hpp"

#include <boost/algorithm/string/case_conv.hpp>
#include <boost/beast/core/detail/base64.hpp>
#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <cctype>
#include <cmath>
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

} // namespace

nlohmann::json add(const std::string& name, const std::string& base64, const nlohmann::json& project, bool replace)
{
    const std::string file = safe_name(name);
    if (file.empty())
        return {{"ok", false}, {"text", "Ce type de fichier n'est pas un modèle 3D (STL, 3MF, OBJ, STEP ou AMF)."}};
    if (base64.empty() || boost::beast::detail::base64::decoded_size(base64.size()) > MAX_BYTES)
        return {{"ok", false}, {"text", "Fichier vide ou trop lourd (150 Mo au plus). Importe-le plutôt par Fichier › Importer d'Orca : je verrai la pièce arriver."}};

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

    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return {{"ok", false}, {"text", "Plateau indisponible."}};
    if (auto* frame = wxGetApp().mainframe)
        frame->select_tab(TAB_ID_PREPARE);
    // Nouveau projet : l'ancienne pièce part et la nouvelle arrive en une seule étape d'annulation (comme un Cmd+Z).
    const size_t      replaced      = replace ? plater->model().objects.size() : 0;
    const std::string replaced_name = replaced > 0 ? plater->model().objects.front()->name : std::string();
    std::vector<size_t> added;
    if (replaced > 0) {
        Slic3r::GUI::Plater::TakeSnapshot snapshot(plater, "Plyo: nouvelle pièce");
        plater->delete_all_objects_from_model();
        added = plater->load_files({path}, Slic3r::LoadStrategy::LoadModel);
    } else
        added = plater->load_files({path}, Slic3r::LoadStrategy::LoadModel);
    if (added.empty()) {
        if (replaced > 0)
            plater->undo(); // le fichier ne s'ouvre pas : l'ancienne pièce revient
        return {{"ok", false}, {"text", "Orca n'a pas pu ouvrir « " + fs::path(name).filename().string() + " »."}};
    }

    Slic3r::BoundingBoxf3 box;
    for (size_t idx : added)
        if (idx < plater->model().objects.size())
            box.merge(plater->model().objects[idx]->instance_bounding_box(0));

    const Slic3r::Vec3d bed  = PlateActions::bed_size();
    const Slic3r::Vec3d size = box.defined ? box.size() : Slic3r::Vec3d(0, 0, 0);
    const bool          fits = PlateActions::fits(size, bed);
    BOOST_LOG_TRIVIAL(info) << "Plyo: modèle joint posé sur le plateau : " << path.string();
    nlohmann::json result = {{"ok", true}, {"name", fs::path(name).filename().string()}, {"count", added.size()},
                             {"size_mm", size_of(size)}, {"bed_mm", size_of(bed)}, {"fits", fits}};
    if (replaced > 0) {
        result["replaced"]      = replaced;
        result["replaced_name"] = Json::utf8_prefix(replaced_name, 120);
        result["undo_token"]    = static_cast<long long>(plater->undo_redo_stack_main().active_snapshot_time());
    }
    // Un 3MF arrive avec les réglages de son auteur : on les adapte à l'imprimante et au filament du projet.
    if (boost::algorithm::to_lower_copy(path.extension().string()) == ".3mf") {
        s_last_3mf = path.string();
        const nlohmann::json adaptation = Project::adapt_file(path.string(), project);
        if (!adaptation.empty())
            result["adaptation"] = adaptation;
    }
    return result;
}

nlohmann::json adapt_last(const nlohmann::json& project)
{
    if (s_last_3mf.empty())
        return nlohmann::json::object();
    return Project::adapt_file(s_last_3mf, project);
}

}} // namespace Plyo::ModelImport
