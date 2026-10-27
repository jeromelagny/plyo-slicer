#include "PlyoConfig.hpp"

#include <nlohmann/json.hpp>

#include <cstdlib>

#ifndef PLYO_API_URL_DEFAULT
#define PLYO_API_URL_DEFAULT "https://api.getplyo.app"
#endif

namespace Plyo { namespace Config {

namespace {

bool is_http_url(const std::string& url) { return url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0; }

std::string without_trailing_slash(std::string url)
{
    while (!url.empty() && url.back() == '/')
        url.pop_back();
    return url;
}

} // namespace

std::string api_url()
{
    static const std::string url = [] {
        const char* env = std::getenv("PLYO_API_URL");
        if (env != nullptr && is_http_url(env))
            return without_trailing_slash(env);
        return without_trailing_slash(PLYO_API_URL_DEFAULT);
    }();
    return url;
}

std::string api_url_script()
{
    return "window.PLYO_API_URL = " + nlohmann::json(api_url()).dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) + ";";
}

}} // namespace Plyo::Config
