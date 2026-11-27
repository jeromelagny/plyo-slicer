#include "PlyoGalleryLogic.hpp"

#include "PlyoJson.hpp"

#include <algorithm>
#include <cctype>
#include <regex>
#include <set>

namespace Plyo { namespace GalleryLogic {

namespace {

constexpr size_t MAX_ENTRIES = 40;

std::string upper(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
    return s;
}

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

// Nom de fichier seul (pas de chemin), avec l'une des extensions données.
bool plain_file(const std::string& name, const std::set<std::string>& extensions)
{
    if (name.empty() || name.size() > 80 || name.find_first_of("/\\:") != std::string::npos || name.find("..") != std::string::npos ||
        name.front() == '.')
        return false;
    const size_t dot = name.rfind('.');
    return dot != std::string::npos && extensions.count(lower(name.substr(dot))) > 0;
}

} // namespace

bool license_ok(const std::string& license)
{
    static const std::regex allowed(R"(^(CC0( 1\.0)?|PUBLIC DOMAIN|DOMAINE PUBLIC|CC BY(-SA|-ND)?( [234]\.0)?)$)");
    return std::regex_match(upper(license), allowed);
}

nlohmann::json entries(const nlohmann::json& manifest, const std::function<bool(const std::string&)>& exists)
{
    static const std::regex                 id_rule("^[a-z0-9-]{2,40}$");
    static const std::set<std::string>      categories = {"utile", "jouet", "déco", "test"};
    nlohmann::json                          out        = nlohmann::json::array();
    std::set<std::string>                   seen;
    const nlohmann::json&                   list       = manifest.is_array() ? manifest : Json::arr(manifest, "models");
    if (!list.is_array())
        return out;
    for (const nlohmann::json& m : list) {
        if (out.size() >= MAX_ENTRIES)
            break;
        if (!m.is_object())
            continue;
        const std::string id = Json::str(m, "id", 41), file = Json::str(m, "file", 81), name = Json::str(m, "name", 121);
        const std::string category = Json::str(m, "category", 20), author = Json::str(m, "author", 61), license = Json::str(m, "license", 41);
        if (!std::regex_match(id, id_rule) || seen.count(id) || !plain_file(file, {".stl", ".3mf", ".obj"}) || !exists(file))
            continue;
        if (name.empty() || name.size() > 120 || !categories.count(category) || author.empty() || author.size() > 60 || !license_ok(license))
            continue;
        seen.insert(id);
        nlohmann::json e = {{"id", id}, {"file", file}, {"name", name}, {"category", category}, {"author", author}, {"license", license},
                            {"what", Json::str(m, "what", 160)}, {"source", Json::str(m, "source", 300)}};
        const std::string image = Json::str(m, "image", 81);
        if (plain_file(image, {".png", ".jpg", ".jpeg"}) && exists(image))
            e["image"] = image;
        out.push_back(e);
    }
    return out;
}

}} // namespace Plyo::GalleryLogic
