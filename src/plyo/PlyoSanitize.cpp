#include "PlyoSanitize.hpp"
#include "PlyoJson.hpp"

namespace Plyo { namespace Sanitize {

using nlohmann::json;

json first_steps(const json& stored)
{
    json s = {{"seen", false}, {"level", nullptr}, {"tour_step", nullptr}, {"greeted", false}, {"share_outcomes", false}};
    if (!stored.is_object())
        return s;
    for (const char* key : {"seen", "greeted", "share_outcomes"})
        s[key] = Json::boolean(stored, key, false);
    for (const char* key : {"level", "tour_step"}) {
        const std::string text = Json::str(stored, key, 40);
        if (!text.empty())
            s[key] = text;
    }
    return s;
}

json memory(const json& stored)
{
    json out = json::object();
    if (!stored.is_object())
        return out;
    for (const auto& [machine, list] : stored.items()) {
        json kept = json::array();
        if (list.is_array())
            for (const json& e : list)
                if (e.is_object() && Json::field(e, "changes") != nullptr && e["changes"].is_array())
                    kept.push_back(e);
        out[machine] = kept;
    }
    return out;
}

json journal(const json& stored)
{
    json out = json::array();
    if (stored.is_array())
        for (const json& e : stored)
            if (e.is_object() && !Json::str(e, "conv").empty() && Json::field(e, "parts") != nullptr && e["parts"].is_array())
                out.push_back(e);
    return out;
}

json calibrations(const json& stored)
{
    json out = json::object();
    if (!stored.is_object())
        return out;
    for (const auto& [machine, tests] : stored.items()) {
        if (!tests.is_object())
            continue;
        json kept = json::object();
        for (const auto& [test, item] : tests.items())
            if (item.is_object() && Json::field(item, "value") != nullptr && item["value"].is_number())
                kept[test] = item;
        out[machine] = kept;
    }
    return out;
}

}} // namespace Plyo::Sanitize
