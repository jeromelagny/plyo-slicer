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
    return state.filament_dirty && state.is_spool && !state.slicing && !state.sending && !state.calibrating &&
           state.quiet_ms >= AUTOSAVE_QUIET_MS;
}

nlohmann::json set_outcome(const nlohmann::json& reg, const std::string& id, const std::string& printer, const std::string& outcome,
                           const std::string& date)
{
    nlohmann::json clean = sanitize(reg);
    if ((outcome != "ok" && outcome != "bad") || !valid_date(date))
        return clean;
    for (nlohmann::json& s : clean["spools"]) {
        if (s["id"] != id || !s["machines"].contains(printer))
            continue;
        nlohmann::json& entry = s["machines"][printer];
        if (entry["preset"].get<std::string>().empty() || entry["pending"].get<bool>())
            break; // aucun préréglage utilisable : rien n'a pu être imprimé avec
        entry["last_outcome"] = outcome;
        if (outcome == "ok")
            entry["last_ok_at"] = date;
    }
    return clean;
}

std::string version_stem(const std::string& id, const std::string& printer) { return Profiles::file_stem(id + "|" + printer); }

nlohmann::json sanitize_version(const nlohmann::json& raw)
{
    const std::string spool   = Json::str(raw, "spool", MAX_ID_BYTES);
    const std::string printer = Json::str(raw, "printer", 200);
    const std::string date    = Json::str(raw, "date");
    if (spool.empty() || printer.empty() || !valid_date(date))
        return nlohmann::json::object();
    nlohmann::json       values = nlohmann::json::object();
    const nlohmann::json src    = Json::obj(raw, "values"); // copie nommée : items() ne garde pas un temporaire
    for (const auto& [key, value] : src.items())
        if (!key.empty() && key.size() <= 80 && value.is_string())
            values[key] = value;
    return {{"spool", spool}, {"printer", printer}, {"date", date}, {"at", Json::str(raw, "at", 40)}, {"values", values}};
}

nlohmann::json last_sent(const nlohmann::json& raw)
{
    const std::string spool   = Json::str(raw, "spool", MAX_ID_BYTES);
    const std::string printer = Json::str(raw, "printer", 200);
    const std::string date    = Json::str(raw, "date");
    const std::string at      = Json::str(raw, "at", 40);
    if (spool.empty() || printer.empty() || !valid_date(date) || at.empty())
        return nlohmann::json::object();
    return {{"spool", spool}, {"printer", printer}, {"date", date}, {"at", at}};
}

bool sent_trial_matches(const nlohmann::json& pointer, const nlohmann::json& trial)
{
    const std::string at = Json::str(pointer, "at");
    return !at.empty() && !Json::str(pointer, "spool").empty() && Json::str(trial, "at") == at &&
           Json::str(trial, "spool") == Json::str(pointer, "spool") && Json::str(trial, "printer") == Json::str(pointer, "printer");
}

namespace {

// Réglages cités d'abord, avec leur nom simple (vide : celui du catalogue).
const std::vector<std::pair<std::string, std::string>> SUMMARY_FIRST = {
    {"filament_flow_ratio", "débit"},
    {"nozzle_temperature_initial_layer", "température de buse (première couche)"},
    {"nozzle_temperature", "température de buse"},
    {"pressure_advance", ""},
    {"filament_retraction_length", "rétraction"},
};

// Première lettre d'un mot en minuscule (A-Z et À-Þ en UTF-8).
void lower_first(std::string& word)
{
    if (word.empty())
        return;
    if (word[0] >= 'A' && word[0] <= 'Z')
        word[0] = static_cast<char>(word[0] - 'A' + 'a');
    else if (word.size() >= 2 && static_cast<unsigned char>(word[0]) == 0xC3) {
        const unsigned char c = static_cast<unsigned char>(word[1]);
        if (c >= 0x80 && c <= 0x9E && c != 0x97) // pas « × »
            word[1] = static_cast<char>(c + 0x20);
    }
}

bool is_temperature(const std::string& key)
{
    return key.find("temperature") != std::string::npos || key.find("plate_temp") != std::string::npos;
}

// Valeur d'Orca dite dans une phrase : première valeur d'un tableau, virgule décimale, « % » détaché. "" si illisible.
std::string spoken_value(const std::string& key, const std::string& serialized)
{
    std::string v = collapse(serialized.substr(0, serialized.find(',')));
    if (v.empty() || v == "nil")
        return "";
    bool percent = false;
    if (v.back() == '%') {
        percent = true;
        v.pop_back();
    }
    // Un nombre seulement : un texte (« PLA », « "a" ») ne se lit pas dans une phrase « débit 0,88 ».
    static const std::regex number("^-?[0-9]+(\\.[0-9]+)?$");
    if (!std::regex_match(v, number))
        return "";
    for (char& c : v)
        if (c == '.')
            c = ',';
    if (percent)
        return v + " %";
    return is_temperature(key) ? v + " \xC2\xB0" "C" : v;
}

} // namespace

std::string short_title(const std::string& key, const std::string& catalog_title)
{
    for (const auto& [k, title] : SUMMARY_FIRST)
        if (k == key && !title.empty())
            return title;
    std::string title = catalog_title;
    const std::string dot = " \xC2\xB7 "; // « · »
    if (const size_t at = title.rfind(dot); at != std::string::npos)
        title = title.substr(at + dot.size());
    title = collapse(title);
    if (title.empty())
        return key;
    std::string out, word;
    auto flush = [&]() {
        bool caps_inside = false; // sigle (« PEI ») : gardé tel quel
        for (size_t i = 1; i < word.size(); ++i)
            if (word[i] >= 'A' && word[i] <= 'Z')
                caps_inside = true;
        if (!caps_inside)
            lower_first(word);
        out += word;
        word.clear();
    };
    for (const char c : title) {
        if (c == ' ') {
            flush();
            out.push_back(' ');
        } else
            word.push_back(c);
    }
    flush();
    return out;
}

nlohmann::json success_summary(const nlohmann::json& values_before, const nlohmann::json& values_ok,
                               const std::map<std::string, std::string>& catalog_titles,
                               const std::map<std::string, std::string>& kinds)
{
    if (!values_before.is_object() || !values_ok.is_object())
        return {{"differs", false}, {"summary", ""}};
    std::vector<std::string> changed; // par clé (ordre de l'objet JSON)
    for (const auto& [key, ok] : values_ok.items()) {
        const auto before = values_before.find(key);
        if (ok.is_string() && before != values_before.end() && before->is_string() && *before != ok)
            changed.push_back(key);
    }
    std::vector<std::string> ordered;
    for (const auto& first : SUMMARY_FIRST)
        if (std::find(changed.begin(), changed.end(), first.first) != changed.end())
            ordered.push_back(first.first);
    for (const std::string& key : changed)
        if (std::find(ordered.begin(), ordered.end(), key) == ordered.end())
            ordered.push_back(key);

    std::vector<std::string> titles_said;
    std::string              summary;
    for (const std::string& key : ordered) {
        if (titles_said.size() >= 3)
            break;
        const auto        kind  = kinds.find(key);
        if (kind != kinds.end() && (kind->second == "bool" || kind->second == "enum"))
            continue; // « 1 » serait lu comme un nombre
        const std::string value = spoken_value(key, values_ok[key].get<std::string>());
        if (value.empty())
            continue;
        const auto        it    = catalog_titles.find(key);
        const std::string title = short_title(key, it == catalog_titles.end() ? std::string() : it->second);
        if (std::find(titles_said.begin(), titles_said.end(), title) != titles_said.end())
            continue;
        titles_said.push_back(title);
        summary += (summary.empty() ? "" : ", ") + title + " " + value;
    }
    return {{"differs", !changed.empty()}, {"summary", summary}};
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
