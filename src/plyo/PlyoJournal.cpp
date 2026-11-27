#include "PlyoJournal.hpp"
#include "PlyoJson.hpp"
#include "PlyoMemory.hpp"
#include "PlyoSanitize.hpp"
#include "PlyoStore.hpp"

#include <boost/date_time/posix_time/posix_time.hpp>

namespace Plyo { namespace Journal {

namespace {

boost::filesystem::path file() { return Store::dir() / "journal.json"; }

nlohmann::json load()
{
    // Seules les fiches bien formées sont gardées : une fiche abîmée ne bloque pas le tiroir « Mes pièces ».
    return Sanitize::journal(Store::read(file()));
}

std::string text(const nlohmann::json& e, const char* key, size_t max)
{
    return Json::str(e, key, max); // ne coupe pas un caractère accentué en deux
}

// Dernière entrée de `conv` qui vérifie `pred`, ou nullptr.
template<class Pred> nlohmann::json* latest(nlohmann::json& all, const std::string& conv, Pred pred)
{
    for (nlohmann::json& e : all)
        if (e.is_object() && Json::str(e, "conv") == conv && pred(e))
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
            parts.push_back(Json::utf8_prefix(p.get<std::string>(), 120));
    std::string thumb = text(event, "thumb", MAX_THUMB_BYTES + 1);
    if (thumb.size() > MAX_THUMB_BYTES || thumb.rfind("data:image/", 0) != 0)
        thumb.clear();

    nlohmann::json all = load();
    nlohmann::json* e  = latest(all, conv, [&](const nlohmann::json& x) { return Json::any(x, "parts") == parts; });
    if (e == nullptr) {
        // Une seule fiche : insert(pos, {…}) prendrait les accolades pour une liste d'éléments à insérer.
        const nlohmann::json entry = {{"conv", conv}, {"parts", parts}, {"changes", nlohmann::json::array()}, {"outcome", ""}, {"thumb", ""}};
        all.insert(all.begin(), entry);
        e = &all[0];
    }
    (*e)["at"]       = boost::posix_time::to_iso_extended_string(boost::posix_time::second_clock::local_time());
    (*e)["printer"]  = text(event, "printer", 200);
    (*e)["filament"] = text(event, "filament", 200);
    // Une pièce notée à l'export ou à « réussi » n'a pas de défaut : elle n'efface pas celui qu'une réponse de l'IA a déjà noté.
    const std::string defect = text(event, "defect", 40);
    if (!defect.empty() || !e->contains("defect")) {
        (*e)["problem"] = text(event, "problem", 120);
        (*e)["defect"]  = defect;
    }
    // « Oui, c'est réussi » sans réglage à suivre ; avec des réglages en attente, c'est set_outcome qui décide.
    if (text(event, "outcome", 10) == "ok" && (!e->contains("changes") || !(*e)["changes"].is_array() || (*e)["changes"].empty()))
        (*e)["outcome"] = "ok";
    if (Json::str((*e), "thumb").empty())
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
    (*e)["note"]    = Json::utf8_prefix(note, 200);
    Store::write(file(), all);
}

nlohmann::json list()
{
    nlohmann::json all = load();
    // Une fiche écrite avant le lot 4 n'a pas le libellé de ses réglages : le titre du catalogue, jamais une clé brute.
    for (nlohmann::json& e : all)
        if (e.contains("changes"))
            e["changes"] = Memory::with_labels(e["changes"]);
    return all;
}

}} // namespace Plyo::Journal
