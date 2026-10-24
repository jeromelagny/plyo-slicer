#include "PlyoStore.hpp"

#include "libslic3r/Utils.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <fstream>

namespace Plyo { namespace Store {

namespace fs = boost::filesystem;

fs::path dir(const std::string& sub)
{
    fs::path path = fs::path(Slic3r::data_dir()) / "plyo";
    return sub.empty() ? path : path / sub;
}

nlohmann::json read(const fs::path& path)
{
    // Un fichier démesuré (abîmé ou modifié à la main) n'est pas lu : il serait analysé en entier à chaque fois.
    boost::system::error_code ec;
    const auto                size = fs::file_size(path, ec);
    if (ec || size > MAX_READ_BYTES)
        return nullptr;
    std::ifstream in(path.string(), std::ios::binary);
    if (!in)
        return nullptr;
    nlohmann::json value = nlohmann::json::parse(in, nullptr, false);
    return value.is_discarded() ? nlohmann::json() : value;
}

bool write(const fs::path& path, const nlohmann::json& value)
{
    const fs::path            tmp = path.string() + ".tmp";
    boost::system::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    {
        std::ofstream out(tmp.string(), std::ios::binary | std::ios::trunc);
        if (!out || !(out << value.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace)))
            return false;
    }
    fs::permissions(tmp, fs::owner_read | fs::owner_write, ec);
    fs::rename(tmp, path, ec);
    if (ec)
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible d'enregistrer " << path.string() << " : " << ec.message();
    return !ec;
}

}} // namespace Plyo::Store
