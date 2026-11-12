#include "PlyoMemoryLogic.hpp"
#include "PlyoJson.hpp"

#include <algorithm>

namespace Plyo { namespace MemoryLogic {

int mark_printed(nlohmann::json& list, const std::string& conv, const std::string& now)
{
    if (!list.is_array() || conv.empty() || now.empty())
        return 0;
    int marked = 0;
    for (nlohmann::json& e : list)
        if (e.is_object() && Json::str(e, "conv") == conv && Json::str(e, "outcome") == "pending" && Json::str(e, "printed").empty()) {
            e["printed"] = now;
            ++marked;
        }
    return marked;
}

nlohmann::json mark_result(nlohmann::json& list, const std::string& conv, const std::string& outcome, const std::vector<std::string>& ats)
{
    nlohmann::json out = nlohmann::json::array();
    if (!list.is_array() || conv.empty() || (outcome != "ok" && outcome != "bad"))
        return out;
    for (nlohmann::json& e : list) {
        if (!e.is_object() || Json::str(e, "conv") != conv || Json::str(e, "at").empty())
            continue;
        const std::string was  = Json::str(e, "outcome");
        const bool        pick = ats.empty() ? !Json::str(e, "printed").empty() && (was == "pending" || was == "unknown")
                                             : std::find(ats.begin(), ats.end(), Json::str(e, "at")) != ats.end();
        if (!pick)
            continue;
        e["outcome"] = outcome;
        out.push_back(e);
    }
    return out;
}

nlohmann::json with_labels(const nlohmann::json& changes, const std::function<std::string(const std::string&)>& title)
{
    if (!changes.is_array())
        return nlohmann::json::array();
    nlohmann::json out = changes;
    for (nlohmann::json& c : out) {
        if (!c.is_object() || !Json::str(c, "label").empty())
            continue;
        const std::string key  = Json::str(c, "key").empty() ? Json::str(c, "id") : Json::str(c, "key");
        const std::string name = key.empty() ? std::string() : title(key);
        if (!name.empty())
            c["label"] = name;
    }
    return out;
}

}} // namespace Plyo::MemoryLogic
