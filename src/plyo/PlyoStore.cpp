#include "PlyoStore.hpp"
#include "PlyoFiles.hpp"

#include "libslic3r/Utils.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

namespace Plyo { namespace Store {

namespace fs = boost::filesystem;

fs::path dir(const std::string& sub)
{
    fs::path path = fs::path(Slic3r::data_dir()) / "plyo";
    return sub.empty() ? path : path / sub;
}

nlohmann::json read(const fs::path& path)
{
    Files::Loaded loaded = Files::read_json(path, MAX_READ_BYTES);
    if (loaded.status == Files::Status::Damaged)
        BOOST_LOG_TRIVIAL(error) << "Plyo: fichier illisible ou trop gros, mis de côté : " << path.string() << " → "
                                 << (loaded.kept_as.empty() ? std::string("(impossible de le renommer)") : loaded.kept_as.string());
    return loaded.value;
}

bool write(const fs::path& path, const nlohmann::json& value)
{
    const bool ok = Files::write_atomic(path, value.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace), true);
    if (!ok)
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible d'enregistrer " << path.string();
    return ok;
}

}} // namespace Plyo::Store
