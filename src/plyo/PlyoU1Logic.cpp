#include "PlyoU1Logic.hpp"

#include "PlyoJson.hpp"
#include "PlyoSlotsLogic.hpp"

#include <algorithm>
#include <cctype>

namespace Plyo { namespace U1Logic {

namespace {

constexpr size_t MAX_HEADS = 16; // bien au-dessus des 4 têtes : une réponse délirante ne remplit pas le panneau

std::string trimmed_upper(const std::string& raw)
{
    size_t b = 0, e = raw.size();
    while (b < e && std::isspace(static_cast<unsigned char>(raw[b])) != 0)
        ++b;
    while (e > b && std::isspace(static_cast<unsigned char>(raw[e - 1])) != 0)
        --e;
    std::string out;
    for (size_t i = b; i < e; ++i)
        out.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(raw[i]))));
    return out;
}

// La valeur texte d'un tableau parallèle, ou vide s'il est trop court ou d'un autre type.
std::string text_at(const nlohmann::json& array, size_t i, size_t max)
{
    if (!array.is_array() || i >= array.size() || !array[i].is_string())
        return std::string();
    return Json::utf8_prefix(array[i].get_ref<const std::string&>(), max);
}

std::string rgba_colour(const std::string& raw) { return raw.size() == 8 ? SlotsLogic::hex_colour("#" + raw.substr(0, 6)) : std::string(); }

} // namespace

nlohmann::json parse_query(const std::string& body)
{
    nlohmann::json out = {{"ok", false}, {"canvases", nlohmann::json::array()}};
    const nlohmann::json j      = nlohmann::json::parse(body, nullptr, false);
    const nlohmann::json status = Json::obj(Json::obj(j, "result"), "status");
    const nlohmann::json config = Json::obj(status, "print_task_config");
    const nlohmann::json exist  = Json::arr(config, "filament_exist");
    if (exist.empty())
        return out;
    const nlohmann::json types = Json::arr(config, "filament_type"), subs = Json::arr(config, "filament_sub_type"), colors = Json::arr(config, "filament_color_rgba"),
                         vendors = Json::arr(config, "filament_vendor");
    nlohmann::json trays = nlohmann::json::array();
    for (size_t i = 0; i < std::min(exist.size(), MAX_HEADS); ++i) {
        const bool  loaded = exist[i].is_boolean() && exist[i].get<bool>();
        std::string type   = loaded ? trimmed_upper(text_at(types, i, 30)) : std::string();
        if (!type.empty()) {
            const std::string sub = loaded ? trimmed_upper(text_at(subs, i, 30)) : std::string();
            if (sub == "CF" || sub == "GF")
                type += "-" + sub;
        }
        trays.push_back({{"tray_id", static_cast<int>(i)},
                         {"label", std::to_string(i + 1)},
                         {"brand", loaded ? text_at(vendors, i, 60) : std::string()},
                         {"type", type},
                         {"name", ""},
                         {"color", loaded ? rgba_colour(text_at(colors, i, 16)) : std::string()},
                         {"min_temp", 0},
                         {"max_temp", 0},
                         {"status", loaded ? 2 : 0}});
    }
    out["ok"]       = true;
    out["canvases"] = nlohmann::json::array({{{"canvas_id", 0}, {"connected", true}, {"trays", trays}}});
    return out;
}

std::string query_url(const std::string& print_host)
{
    std::string host = print_host;
    while (!host.empty() && host.back() == '/')
        host.pop_back();
    if (host.empty())
        return host;
    if (host.find("://") == std::string::npos)
        host = "http://" + host;
    return host + "/printer/objects/query?print_task_config&filament_detect";
}

}} // namespace Plyo::U1Logic
