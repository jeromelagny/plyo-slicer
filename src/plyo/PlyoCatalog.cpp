#include "PlyoCatalog.hpp"

#include "libslic3r/Utils.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>
#include <boost/nowide/fstream.hpp>

namespace Plyo { namespace Catalog {

namespace {

nlohmann::json read(const char* name)
{
    const boost::filesystem::path path = boost::filesystem::path(Slic3r::resources_dir()) / "plyo" / name;
    boost::nowide::ifstream       file(path.string(), std::ios::binary);
    if (!file) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: fichier du catalogue introuvable : " << path.string();
        return nlohmann::json::object();
    }
    nlohmann::json parsed = nlohmann::json::parse(file, nullptr, false);
    if (parsed.is_discarded()) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: fichier du catalogue illisible : " << path.string();
        return nlohmann::json::object();
    }
    return parsed;
}

} // namespace

const Policy& policy()
{
    static const Policy loaded = Policy::from_json(read("policy.json"), read("catalog-keys.json"));
    return loaded;
}

}} // namespace Plyo::Catalog
