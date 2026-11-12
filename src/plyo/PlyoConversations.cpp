#include "PlyoConversations.hpp"
#include "PlyoJson.hpp"
#include "PlyoProjectFilesLogic.hpp"
#include "PlyoProjectLogic.hpp"
#include "PlyoStore.hpp"

#include <boost/filesystem.hpp>

#include <algorithm>
#include <cctype>
#include <ctime>
#include <utility>
#include <vector>

namespace Plyo { namespace Conversations {

namespace fs = boost::filesystem;

namespace {

fs::path path_of(const std::string& id) { return Store::dir("conversations") / (id + ".json"); }

// Projet 3MF de la conversation (voir PlyoProjectFiles) : il vit et meurt avec elle.
fs::path project_of(const std::string& id) { return Store::dir("projets") / (id + ".3mf"); }

// Une conversation lisible : un objet avec une liste d'éléments.
bool well_formed(const nlohmann::json& c) { return c.is_object() && c.contains("entries") && c["entries"].is_array(); }

std::string updated_of(const nlohmann::json& c) { return c.contains("updated") && c["updated"].is_string() ? c["updated"].get<std::string>() : std::string(); }

} // namespace

bool valid_id(const std::string& id)
{
    return !id.empty() && id.size() <= 40 &&
           std::all_of(id.begin(), id.end(), [](unsigned char c) { return std::islower(c) || std::isdigit(c) || c == '-'; });
}

// Garde les MAX_KEPT conversations les plus récentes, d'après la date des fichiers : sans les relire (jusqu'à
// 4 Mo chacune), l'enregistrement automatique ne fige pas l'interface.
static void prune()
{
    boost::system::error_code                    ec;
    std::vector<std::pair<std::time_t, fs::path>> files;
    for (const fs::directory_entry& entry : fs::directory_iterator(Store::dir("conversations"), ec)) {
        const fs::path& p = entry.path();
        if (p.extension() == ".json" && valid_id(p.stem().string()))
            files.emplace_back(fs::last_write_time(p, ec), p);
    }
    std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
    std::vector<std::string> kept;
    for (size_t i = 0; i < files.size(); ++i) {
        if (i < MAX_KEPT)
            kept.push_back(files[i].second.stem().string());
        else
            fs::remove(files[i].second, ec);
    }
    // Les projets 3MF des conversations effacées partent avec elles (et les restes d'une écriture interrompue).
    std::vector<std::string> projects;
    for (const fs::directory_entry& entry : fs::directory_iterator(Store::dir("projets"), ec)) {
        const fs::path& p = entry.path();
        if (p.extension() == ".3mf")
            projects.push_back(p.stem().string());
    }
    for (const std::string& stem : ProjectFilesLogic::orphans(kept, projects))
        fs::remove(Store::dir("projets") / (stem + ".3mf"), ec);
}

nlohmann::json list()
{
    nlohmann::json            out = nlohmann::json::array();
    boost::system::error_code ec;
    const fs::path            folder = Store::dir("conversations");
    if (!fs::is_directory(folder, ec))
        return out;
    for (const fs::directory_entry& entry : fs::directory_iterator(folder, ec)) {
        const fs::path& p = entry.path();
        if (p.extension() != ".json" || !valid_id(p.stem().string()))
            continue;
        const nlohmann::json c = Store::read(p);
        if (!well_formed(c))
            continue;
        out.push_back({{"id", p.stem().string()}, {"title", Json::str(c, "title")}, {"updated", updated_of(c)}});
    }
    // Dates ISO 8601 : l'ordre du texte est l'ordre du temps.
    std::sort(out.begin(), out.end(), [](const nlohmann::json& a, const nlohmann::json& b) { return a["updated"] > b["updated"]; });
    return out;
}

nlohmann::json load(const std::string& id)
{
    if (!valid_id(id))
        return nullptr;
    nlohmann::json c = Store::read(path_of(id));
    return well_formed(c) ? c : nlohmann::json();
}

bool save(const std::string& id, const nlohmann::json& conversation)
{
    if (!valid_id(id) || !well_formed(conversation) || conversation.dump().size() > MAX_BYTES)
        return false;
    // Le projet est réduit à ses clés connues : ni secret ni chemin de fichier dans la conversation enregistrée.
    nlohmann::json kept = conversation;
    if (kept.contains("project"))
        kept["project"] = ProjectLogic::sanitize(kept["project"]);
    if (!Store::write(path_of(id), kept))
        return false;
    prune();
    return true;
}

bool remove(const std::string& id)
{
    if (!valid_id(id))
        return false;
    boost::system::error_code ec;
    fs::remove(project_of(id), ec);
    return fs::remove(path_of(id), ec) && !ec;
}

}} // namespace Plyo::Conversations
