#include "PlyoJournal.hpp"
#include "PlyoStore.hpp"

#include <boost/date_time/posix_time/posix_time.hpp>

namespace Plyo { namespace Journal {

namespace {

boost::filesystem::path file() { return Store::dir() / "journal.json"; }

nlohmann::json load()
{
    nlohmann::json all = Store::read(file());
    return all.is_array() ? all : nlohmann::json::array();
}

std::string text(const nlohmann::json& e, const char* key, size_t max)
{
    return e.contains(key) && e[key].is_string() ? e[key].get<std::string>().substr(0, max) : std::string();
}

// Dernière entrée de `conv` qui vérifie `pred`, ou nullptr.
template<class Pred> nlohmann::json* latest(nlohmann::json& all, const std::string& conv, Pred pred)
{
    for (nlohmann::json& e : all)
        if (e.is_object() && e.value("conv", std::string()) == conv && pred(e))
            return &e;
    return nullptr;
}

} // namespace

void record(const nlohmann::json& event)
{
    const std::string conv = text(event, "conv", 40);
    if (conv.empty() || !event.contains("parts") || !event["parts"].is_array() || event["parts"].empty())
        return;
    nlohmann::json parts = nlohmann::json::array();
    for (const nlohmann::json& p : event["parts"])
        if (p.is_string() && parts.size() < 3)
            parts.push_back(p.get<std::string>().substr(0, 120));
    std::string thumb = text(event, "thumb", MAX_THUMB_BYTES + 1);
    if (thumb.size() > MAX_THUMB_BYTES || thumb.rfind("data:image/", 0) != 0)
        thumb.clear();

    nlohmann::json all = load();
    nlohmann::json* e  = latest(all, conv, [&](const nlohmann::json& x) { return x.value("parts", nlohmann::json()) == parts; });
    if (e == nullptr) {
        all.insert(all.begin(), {{"conv", conv}, {"parts", parts}, {"changes", nlohmann::json::array()}, {"outcome", ""}, {"thumb", ""}});
        e = &all[0];
    }
    (*e)["at"]       = boost::posix_time::to_iso_extended_string(boost::posix_time::second_clock::local_time());
    (*e)["printer"]  = text(event, "printer", 200);
    (*e)["filament"] = text(event, "filament", 200);
    (*e)["problem"]  = text(event, "problem", 120);
    (*e)["defect"]   = text(event, "defect", 40);
    if ((*e).value("thumb", std::string()).empty())
        (*e)["thumb"] = thumb;
    if (all.size() > MAX_EVENTS)
        all.erase(all.begin() + MAX_EVENTS, all.end());
    Store::write(file(), all);
}

void set_changes(const std::string& conv, const nlohmann::json& changes)
{
    if (conv.empty() || !changes.is_array() || changes.empty())
        return;
    nlohmann::json  all = load();
    nlohmann::json* e   = latest(all, conv, [](const nlohmann::json&) { return true; });
    if (e == nullptr)
        return;
    (*e)["changes"] = changes;
    (*e)["outcome"] = "pending";
    Store::write(file(), all);
}

void clear_changes(const std::string& conv)
{
    if (conv.empty())
        return;
    nlohmann::json  all = load();
    nlohmann::json* e   = latest(all, conv, [](const nlohmann::json& x) { return x.contains("changes") && x["changes"].is_array() && !x["changes"].empty(); });
    if (e == nullptr)
        return;
    (*e)["changes"] = nlohmann::json::array();
    (*e)["outcome"] = "";
    Store::write(file(), all);
}

void set_outcome(const std::string& conv, const std::string& outcome, const std::string& note)
{
    if (conv.empty() || (outcome != "ok" && outcome != "bad"))
        return;
    nlohmann::json  all = load();
    nlohmann::json* e   = latest(all, conv, [](const nlohmann::json& x) { return x.contains("changes") && x["changes"].is_array() && !x["changes"].empty(); });
    if (e == nullptr)
        return;
    (*e)["outcome"] = outcome;
    (*e)["note"]    = note.substr(0, 200);
    Store::write(file(), all);
}

nlohmann::json list() { return load(); }

}} // namespace Plyo::Journal
