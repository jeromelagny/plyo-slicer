#include "PlyoSpoolsLogic.hpp"

#include "PlyoJson.hpp"

#include <algorithm>
#include <cctype>
#include <regex>
#include <set>

namespace Plyo { namespace SpoolsLogic {

namespace {

constexpr size_t MAX_NAME_BYTES = 60;
constexpr size_t MIN_NAME_CHARS = 3;
constexpr size_t MAX_SPOOLS     = 200;
constexpr size_t MAX_ID_BYTES   = 64;

const char* const MATERIALS[] = {"PLA", "PETG", "ABS", "ASA", "TPU"};

bool valid_material(const std::string& m)
{
    return std::find(std::begin(MATERIALS), std::end(MATERIALS), m) != std::end(MATERIALS);
}

// Espaces de bord supprimés, espaces multiples réduits à un seul.
std::string collapse(const std::string& s)
{
    std::string out;
    for (const char c : s) {
        if (c == ' ') {
            if (!out.empty() && out.back() != ' ')
                out.push_back(c);
        } else
            out.push_back(c);
    }
    if (!out.empty() && out.back() == ' ')
        out.pop_back();
    return out;
}

size_t char_count(const std::string& s)
{
    size_t n = 0;
    for (const char c : s)
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80)
            ++n;
    return n;
}

// "AAAA-MM-JJ" avec un mois de 01 à 12 et un jour de 01 à 31.
bool valid_date(const std::string& d)
{
    if (d.size() != 10 || d[4] != '-' || d[7] != '-')
        return false;
    for (size_t i = 0; i < d.size(); ++i)
        if (i != 4 && i != 7 && std::isdigit(static_cast<unsigned char>(d[i])) == 0)
            return false;
    const int month = std::stoi(d.substr(5, 2)), day = std::stoi(d.substr(8, 2));
    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

nlohmann::json machine_entry(const nlohmann::json& raw)
{
    std::string outcome = Json::str(raw, "last_outcome");
    if (outcome != "ok" && outcome != "bad")
        outcome.clear();
    std::string date = Json::str(raw, "last_ok_at");
    if (!valid_date(date))
        date.clear();
    return {{"preset", Json::str(raw, "preset", Profiles::MAX_NAME_BYTES)}, {"last_outcome", outcome}, {"last_ok_at", date},
            {"pending", Json::boolean(raw, "pending", false)}};
}

} // namespace

std::string clean_name(const std::string& typed)
{
    std::string s = typed;
    for (char& c : s)
        if (std::string("/\\:*?\"<>|").find(c) != std::string::npos || c == '\t' || c == '\n' || c == '\r')
            c = ' ';
    s = collapse(s);
    if (char_count(s) < MIN_NAME_CHARS)
        return "";
    return collapse(Json::utf8_prefix(s, MAX_NAME_BYTES)); // la coupe peut laisser un espace final
}

std::string key_of(const std::string& name)
{
    std::string s = name;
    for (char& c : s)
        if (c >= 'A' && c <= 'Z')
            c = static_cast<char>(c - 'A' + 'a');
    return collapse(s);
}

std::string preset_name(const std::string& spool, const std::string& machine_label, const std::vector<std::string>& existing,
                        const std::vector<std::string>& ours)
{
    const std::string base   = spool + " \xE2\x80\x94 " + machine_label;
    auto              has    = [](const std::vector<std::string>& v, const std::string& n) { return std::find(v.begin(), v.end(), n) != v.end(); };
    for (int n = 1;; ++n) {
        const std::string suffix = n == 1 ? std::string() : " " + std::to_string(n);
        const std::string name   = Json::utf8_prefix(base, Profiles::MAX_NAME_BYTES - suffix.size()) + suffix;
        if (!has(existing, name) || has(ours, name))
            return name;
    }
}

nlohmann::json sanitize(const nlohmann::json& raw)
{
    nlohmann::json spools = nlohmann::json::array();
    std::set<std::string> ids;
    for (const nlohmann::json& row : Json::arr(raw, "spools")) {
        if (spools.size() >= MAX_SPOOLS)
            break;
        const std::string id       = Json::str(row, "id");
        const std::string name     = clean_name(Json::str(row, "name"));
        const std::string material = Json::str(row, "material");
        if (id.empty() || id.size() > MAX_ID_BYTES || name.empty() || !valid_material(material) || !ids.insert(id).second)
            continue;
        nlohmann::json machines = nlohmann::json::object();
        const nlohmann::json rawMachines = Json::obj(row, "machines"); // copie nommée : items() ne garde pas un temporaire
        for (const auto& [printer, entry] : rawMachines.items())
            if (!printer.empty() && entry.is_object())
                machines[printer] = machine_entry(entry);
        spools.push_back({{"id", id}, {"name", name}, {"material", material}, {"machines", machines}});
    }
    return {{"spools", spools}};
}

nlohmann::json add(const nlohmann::json& reg, const std::string& name, const std::string& material)
{
    nlohmann::json    clean   = sanitize(reg);
    const std::string cleaned = clean_name(name);
    if (cleaned.empty() || !valid_material(material))
        return {{"reg", clean}, {"id", ""}, {"created", false}};
    std::set<std::string> ids;
    for (const nlohmann::json& s : clean["spools"]) {
        if (key_of(s["name"].get<std::string>()) == key_of(cleaned))
            return {{"reg", clean}, {"id", s["id"]}, {"created", false}};
        ids.insert(s["id"].get<std::string>());
    }
    if (clean["spools"].size() >= MAX_SPOOLS)
        return {{"reg", clean}, {"id", ""}, {"created", false}};
    size_t n = clean["spools"].size() + 1;
    while (ids.count("b" + std::to_string(n)) != 0)
        ++n;
    const std::string id = "b" + std::to_string(n);
    clean["spools"].push_back({{"id", id}, {"name", cleaned}, {"material", material}, {"machines", nlohmann::json::object()}});
    return {{"reg", clean}, {"id", id}, {"created", true}};
}

nlohmann::json for_machine(const nlohmann::json& reg, const std::string& printer)
{
    std::vector<nlohmann::json> rows;
    const nlohmann::json        clean = sanitize(reg); // nommé : la boucle ne doit pas parcourir un temporaire
    for (const nlohmann::json& s : clean["spools"]) {
        const nlohmann::json entry = Json::obj(s["machines"], printer.c_str());
        rows.push_back({{"id", s["id"]},
                        {"name", s["name"]},
                        {"material", s["material"]},
                        {"has_preset", !Json::str(entry, "preset").empty() && !Json::boolean(entry, "pending", false)},
                        {"last_outcome", Json::str(entry, "last_outcome")},
                        {"last_ok_at", Json::str(entry, "last_ok_at")}});
    }
    std::stable_sort(rows.begin(), rows.end(), [](const nlohmann::json& a, const nlohmann::json& b) {
        return a["last_ok_at"].get<std::string>() > b["last_ok_at"].get<std::string>();
    });
    return nlohmann::json(rows);
}

std::string spool_of_preset(const nlohmann::json& reg, const std::string& filament_preset)
{
    if (filament_preset.empty())
        return "";
    const nlohmann::json clean = sanitize(reg);
    for (const nlohmann::json& s : clean["spools"])
        for (const auto& [printer, entry] : s["machines"].items())
            if (entry["preset"] == filament_preset && !entry["pending"].get<bool>())
                return s["id"];
    return "";
}

std::string preset_for(const nlohmann::json& reg, const std::string& id, const std::string& printer)
{
    const nlohmann::json clean = sanitize(reg);
    for (const nlohmann::json& s : clean["spools"])
        if (s["id"] == id)
            return Json::str(Json::obj(s["machines"], printer.c_str()), "preset");
    return "";
}

nlohmann::json set_preset(const nlohmann::json& reg, const std::string& id, const std::string& printer, const std::string& preset,
                          bool pending)
{
    nlohmann::json clean = sanitize(reg);
    if (printer.empty())
        return clean;
    for (nlohmann::json& s : clean["spools"])
        if (s["id"] == id)
            s["machines"][printer] = {{"preset", preset}, {"last_outcome", ""}, {"last_ok_at", ""}, {"pending", pending}};
    return sanitize(clean); // le nom du préréglage est borné comme à la lecture
}

bool is_pending(const nlohmann::json& reg, const std::string& id, const std::string& printer)
{
    const nlohmann::json clean = sanitize(reg);
    for (const nlohmann::json& s : clean["spools"])
        if (s["id"] == id)
            return Json::boolean(Json::obj(s["machines"], printer.c_str()), "pending", false);
    return false;
}

std::string spool_name(const nlohmann::json& reg, const std::string& id)
{
    const nlohmann::json clean = sanitize(reg);
    for (const nlohmann::json& s : clean["spools"])
        if (s["id"] == id)
            return s["name"];
    return "";
}

std::string machine_label(const std::string& printer_preset)
{
    using std::regex;
    const auto icase = regex::ECMAScript | regex::icase;
    static const regex mine("^\\s*Ma\\s+", icase);
    static const regex copy("\\s*-\\s*Cop(ie|y)\\b.*$", icase);
    static const regex plyo("\\s*\\(Plyo( \\d+)?\\)\\s*$");
    static const regex nozzle("\\s+\\d+(\\.\\d+)?\\s*nozzle\\s*$", icase);
    std::string s = std::regex_replace(printer_preset, mine, "");
    s             = std::regex_replace(s, copy, "");
    s             = std::regex_replace(s, plyo, "");
    s             = std::regex_replace(s, nozzle, "");
    for (char& c : s)
        if (c == '\t' || c == '\n' || c == '\r')
            c = ' ';
    return collapse(s);
}

bool should_save_spool(const AutoSaveState& state)
{
    return state.filament_dirty && state.is_spool && !state.slicing && !state.sending && state.quiet_ms >= AUTOSAVE_QUIET_MS;
}

bool temperature_pairs_ok(const std::vector<TempPair>& pairs)
{
    for (const TempPair& p : pairs) {
        if (p.first_layer <= 0 || p.other_layers <= 0)
            continue;
        const int delta = p.first_layer > p.other_layers ? p.first_layer - p.other_layers : p.other_layers - p.first_layer;
        if (delta > p.max_delta)
            return false;
    }
    return true;
}

}} // namespace Plyo::SpoolsLogic
