#include "PlyoSession.hpp"

#include "libslic3r/Utils.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <fstream>

namespace Plyo { namespace Session {

namespace fs = boost::filesystem;

namespace {

fs::path session_path() { return fs::path(Slic3r::data_dir()) / "plyo" / "session.json"; }

bool well_formed(const nlohmann::json& s)
{
    return s.is_object() && s.contains("access_token") && s["access_token"].is_string() && s.contains("refresh_token") &&
           s["refresh_token"].is_string();
}

} // namespace

bool save(const nlohmann::json& session)
{
    if (!well_formed(session))
        return false;
    const fs::path path = session_path();
    const fs::path tmp  = path.string() + ".tmp";
    boost::system::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    {
        std::ofstream out(tmp.string(), std::ios::binary | std::ios::trunc);
        if (!out)
            return false;
        // Seuls les champs utiles sont conservés.
        out << nlohmann::json{{"access_token", session["access_token"]},
                              {"refresh_token", session["refresh_token"]},
                              {"expires_at", session.value("expires_at", 0)},
                              {"email", session.value("email", std::string())}}
                   .dump();
    }
    fs::permissions(tmp, fs::owner_read | fs::owner_write, ec);
    fs::rename(tmp, path, ec);
    if (ec)
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible d'enregistrer la session : " << ec.message();
    return !ec;
}

nlohmann::json load()
{
    std::ifstream in(session_path().string(), std::ios::binary);
    if (!in)
        return nullptr;
    const nlohmann::json s = nlohmann::json::parse(in, nullptr, false);
    return well_formed(s) ? s : nlohmann::json(nullptr);
}

void clear()
{
    boost::system::error_code ec;
    fs::remove(session_path(), ec);
}

}} // namespace Plyo::Session
