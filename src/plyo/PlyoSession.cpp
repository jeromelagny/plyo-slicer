#include "PlyoSession.hpp"
#include "PlyoStore.hpp"
#include "PlyoJson.hpp"

#include "libslic3r/Utils.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>


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
    return Store::write(session_path(), {{"access_token", session["access_token"]},
                                         {"refresh_token", session["refresh_token"]},
                                         {"expires_at", Json::integer(session, "expires_at", 0)},
                                         {"email", Json::str(session, "email", 320)}});
}

nlohmann::json load()
{
    const nlohmann::json s = Store::read(session_path());
    return well_formed(s) ? s : nlohmann::json(nullptr);
}

void clear()
{
    boost::system::error_code ec;
    fs::remove(session_path(), ec);
}

}} // namespace Plyo::Session
