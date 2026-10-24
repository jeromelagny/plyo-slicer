#include "PlyoConversations.hpp"
#include "PlyoStore.hpp"

#include <boost/filesystem.hpp>

#include <algorithm>
#include <cctype>
#include <vector>

namespace Plyo { namespace Conversations {

namespace fs = boost::filesystem;

namespace {

fs::path path_of(const std::string& id) { return Store::dir("conversations") / (id + ".json"); }

// Une conversation lisible : un objet avec une liste d'éléments.
bool well_formed(const nlohmann::json& c) { return c.is_object() && c.contains("entries") && c["entries"].is_array(); }

std::string updated_of(const nlohmann::json& c) { return c.contains("updated") && c["updated"].is_string() ? c["updated"].get<std::string>() : std::string(); }

} // namespace

bool valid_id(const std::string& id)
{
    return !id.empty() && id.size() <= 40 &&
           std::all_of(id.begin(), id.end(), [](unsigned char c) { return std::islower(c) || std::isdigit(c) || c == '-'; });
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
        out.push_back({{"id", p.stem().string()}, {"title", c.value("title", std::string())}, {"updated", updated_of(c)}});
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
    if (!Store::write(path_of(id), conversation))
        return false;
    const nlohmann::json all = list();
    for (size_t i = MAX_KEPT; i < all.size(); ++i)
        remove(all[i]["id"].get<std::string>());
    return true;
}

bool remove(const std::string& id)
{
    if (!valid_id(id))
        return false;
    boost::system::error_code ec;
    return fs::remove(path_of(id), ec) && !ec;
}

}} // namespace Plyo::Conversations
