#include "PlyoMemory.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoStore.hpp"

#include <boost/date_time/posix_time/posix_time.hpp>

#include <cmath>
#include <vector>

namespace Plyo { namespace Memory {

namespace {

boost::filesystem::path file() { return Store::dir() / "memoire.json"; }

std::string machine_key(const nlohmann::json& values)
{
    const nlohmann::json ctx = values.value("context", nlohmann::json::object());
    return ctx.value("printer", std::string()) + " | " + ctx.value("filament", std::string());
}

nlohmann::json load_all()
{
    nlohmann::json all = Store::read(file());
    return all.is_object() ? all : nlohmann::json::object();
}

bool same(const nlohmann::json& a, const nlohmann::json& b)
{
    if (a.is_number() && b.is_number())
        return std::abs(a.get<double>() - b.get<double>()) < 1e-9;
    return a == b;
}

// Machines des applications de cette session, dans l'ordre : chaque annulation retire l'entrée de la dernière,
// même si les préréglages ont changé entre-temps (même pile que les annulations de SettingsBridge).
std::vector<std::string> s_applied_keys;

} // namespace

void note_applied(const nlohmann::json& before, const nlohmann::json& after, const std::string& why)
{
    nlohmann::json changes = nlohmann::json::array();
    for (const nlohmann::json& p : after.value("params", nlohmann::json::array()))
        for (const nlohmann::json& q : before.value("params", nlohmann::json::array()))
            if (q.value("id", std::string()) == p.value("id", std::string()) && !same(q["value"], p["value"]))
                changes.push_back({{"id", p["id"]}, {"before", q["value"]}, {"after", p["value"]}});
    if (changes.empty()) {
        s_applied_keys.emplace_back(); // garde la pile alignée sur les annulations
        return;
    }
    const std::string key = machine_key(after);
    nlohmann::json    all = load_all();
    nlohmann::json&   list = all[key];
    if (!list.is_array())
        list = nlohmann::json::array();
    const std::string date = boost::posix_time::to_iso_extended_string(boost::posix_time::second_clock::local_time()).substr(0, 10);
    list.insert(list.begin(), {{"date", date}, {"changes", changes}, {"why", why.substr(0, 200)}});
    if (list.size() > MAX_PER_MACHINE)
        list.erase(list.begin() + MAX_PER_MACHINE, list.end());
    // Trop de machines : on garde les plus récemment utilisées (la date de leur dernière entrée).
    while (all.size() > MAX_MACHINES) {
        auto oldest = all.begin();
        for (auto it = all.begin(); it != all.end(); ++it)
            if (it.value()[0].value("date", std::string()) < oldest.value()[0].value("date", std::string()))
                oldest = it;
        all.erase(oldest);
    }
    s_applied_keys.push_back(key);
    Store::write(file(), all);
}

void forget_last()
{
    if (s_applied_keys.empty())
        return;
    const std::string key = s_applied_keys.back();
    s_applied_keys.pop_back();
    if (key.empty())
        return;
    nlohmann::json all = load_all();
    if (!all.contains(key) || !all[key].is_array() || all[key].empty())
        return;
    all[key].erase(all[key].begin());
    if (all[key].empty())
        all.erase(key);
    Store::write(file(), all);
}

nlohmann::json for_current()
{
    const nlohmann::json all  = load_all();
    const std::string    key  = machine_key(SettingsBridge::read_values());
    const auto           it   = all.find(key);
    return it != all.end() && it->is_array() ? *it : nlohmann::json::array();
}

}} // namespace Plyo::Memory
