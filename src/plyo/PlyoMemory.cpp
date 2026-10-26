#include "PlyoMemory.hpp"
#include "PlyoJson.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoSanitize.hpp"
#include "PlyoStore.hpp"

#include <boost/date_time/posix_time/posix_time.hpp>

#include <cmath>

namespace Plyo { namespace Memory {

namespace {

boost::filesystem::path file() { return Store::dir() / "memoire.json"; }

std::string machine_key(const nlohmann::json& values)
{
    const nlohmann::json ctx = Json::obj(values, "context");
    return Json::str(ctx, "printer") + " | " + Json::str(ctx, "filament");
}

nlohmann::json load_all()
{
    // Une fiche abîmée (écrite par une ancienne version) ne doit pas bloquer la lecture des autres.
    return Sanitize::memory(Store::read(file()));
}

bool same(const nlohmann::json& a, const nlohmann::json& b)
{
    if (a.is_number() && b.is_number())
        return std::abs(a.get<double>() - b.get<double>()) < 1e-9;
    return a == b;
}

// Date de la dernière entrée d'une machine ("" si la liste est abîmée).
std::string last_date(const nlohmann::json& list)
{
    return list.is_array() && !list.empty() && list[0].is_object() ? Json::str(list[0], "date") : std::string();
}

} // namespace

std::string note_applied(const nlohmann::json& before, const nlohmann::json& after, const std::string& why, const nlohmann::json& ask)
{
    nlohmann::json changes = nlohmann::json::array();
    for (const nlohmann::json& p : Json::arr(after, "params"))
        for (const nlohmann::json& q : Json::arr(before, "params"))
            if (Json::str(q, "id") == Json::str(p, "id") && !same(q["value"], p["value"]))
                changes.push_back({{"id", p["id"]}, {"before", q["value"]}, {"after", p["value"]}});
    if (changes.empty())
        return std::string();
    const std::string key  = machine_key(after);
    nlohmann::json    all  = load_all();
    nlohmann::json&   list = all[key];
    if (!list.is_array())
        list = nlohmann::json::array();
    const std::string at   = boost::posix_time::to_iso_extended_string(boost::posix_time::second_clock::local_time());
    nlohmann::json    entry{{"date", at.substr(0, 10)}, {"changes", changes}, {"why", Json::utf8_prefix(why, 200)}};
    if (ask.is_object()) {
        entry["at"]      = at;
        entry["outcome"] = "pending";
        entry["asked"]   = 0;
        entry["conv"]    = Json::str(ask, "conv", 40);
        entry["defect"]  = Json::str(ask, "defect", 40);
    }
    list.insert(list.begin(), entry);
    if (list.size() > MAX_PER_MACHINE)
        list.erase(list.begin() + MAX_PER_MACHINE, list.end());
    // Trop de machines : on retire la moins récemment utilisée (jamais celle qu'on vient de noter).
    while (all.size() > MAX_MACHINES) {
        auto oldest = all.end();
        for (auto it = all.begin(); it != all.end(); ++it)
            if (it.key() != key && (oldest == all.end() || last_date(it.value()) < last_date(oldest.value())))
                oldest = it;
        if (oldest == all.end())
            break;
        all.erase(oldest);
    }
    Store::write(file(), all);
    return key;
}

std::string forget(const std::string& machine_key)
{
    if (machine_key.empty())
        return std::string();
    nlohmann::json all = load_all();
    if (!all.contains(machine_key) || !all[machine_key].is_array() || all[machine_key].empty())
        return std::string();
    const nlohmann::json& first = all[machine_key][0];
    const std::string     conv  = first.is_object() && first.contains("conv") && first["conv"].is_string() ? first["conv"].get<std::string>() : std::string();
    all[machine_key].erase(all[machine_key].begin());
    if (all[machine_key].empty())
        all.erase(machine_key);
    Store::write(file(), all);
    return conv;
}

nlohmann::json for_current()
{
    const nlohmann::json all = load_all();
    const std::string    key = machine_key(SettingsBridge::read_values());
    const auto           it  = all.find(key);
    return it != all.end() && it->is_array() ? *it : nlohmann::json::array();
}

nlohmann::json pending()
{
    const nlohmann::json all    = load_all();
    const nlohmann::json values = SettingsBridge::read_values();
    const std::string    key    = machine_key(values);
    const nlohmann::json ctx    = Json::obj(values, "context");
    nlohmann::json       out    = nlohmann::json::array();
    const auto           it     = all.find(key);
    if (it == all.end() || !it->is_array())
        return out;
    for (const nlohmann::json& e : *it)
        if (e.is_object() && Json::str(e, "outcome") == "pending")
            out.push_back({{"machine", key},
                    {"printer", Json::str(ctx, "printer")},
                    {"filament", Json::str(ctx, "filament")},
                    {"at", Json::str(e, "at")},
                    {"date", Json::str(e, "date")},
                    {"why", Json::str(e, "why")},
                    {"defect", Json::str(e, "defect")},
                    {"conv", Json::str(e, "conv")},
                    {"changes", Json::arr(e, "changes")}});
    return out;
}

bool set_outcome(const std::string& machine, const std::string& at, const std::string& outcome, const std::string& note)
{
    if (at.empty() || (outcome != "ok" && outcome != "bad" && outcome != "later"))
        return false;
    nlohmann::json all = load_all();
    if (!all.contains(machine) || !all[machine].is_array())
        return false;
    for (nlohmann::json& e : all[machine]) {
        if (!e.is_object() || Json::str(e, "at") != at)
            continue;
        if (outcome == "later") {
            const int asked = Json::integer(e, "asked", 0) + 1;
            e["asked"]      = asked;
            if (asked >= 3)
                e["outcome"] = "unknown";
        } else {
            e["outcome"] = outcome;
            if (!note.empty())
                e["note"] = Json::utf8_prefix(note, 200);
        }
        return Store::write(file(), all);
    }
    return false;
}

}} // namespace Plyo::Memory
