#include "PlyoSpoolsLogic.hpp"

#include "PlyoBrandsLogic.hpp"
#include "PlyoConfigRulesLogic.hpp"
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

// Marque et gamme de la bobine (étape Filament), seulement si elles sont dites : un registre d'avant reste identique.
// La gamme n'existe pas sans marque.
void put_brand(nlohmann::json& spool, const std::string& brand, const std::string& range)
{
    const std::string b = BrandsLogic::clean_brand(brand);
    if (b.empty())
        return;
    spool["brand"] = b;
    if (const std::string r = BrandsLogic::clean_brand(range); !r.empty())
        spool["range"] = r;
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
        nlohmann::json spool = {{"id", id}, {"name", name}, {"material", material}, {"machines", machines}};
        put_brand(spool, Json::str(row, "brand"), Json::str(row, "range"));
        spools.push_back(spool);
    }
    return {{"spools", spools}};
}

nlohmann::json add(const nlohmann::json& reg, const std::string& name, const std::string& material, const std::string& brand,
                   const std::string& range)
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
    const std::string id    = "b" + std::to_string(n);
    nlohmann::json    spool = {{"id", id}, {"name", cleaned}, {"material", material}, {"machines", nlohmann::json::object()}};
    put_brand(spool, brand, range);
    clean["spools"].push_back(spool);
    return {{"reg", clean}, {"id", id}, {"created", true}};
}

nlohmann::json for_machine(const nlohmann::json& reg, const std::string& printer)
{
    std::vector<nlohmann::json> rows;
    const nlohmann::json        clean = sanitize(reg); // nommé : la boucle ne doit pas parcourir un temporaire
    for (const nlohmann::json& s : clean["spools"]) {
        const nlohmann::json entry = Json::obj(s["machines"], printer.c_str());
        nlohmann::json       row   = {{"id", s["id"]},
                                      {"name", s["name"]},
                                      {"material", s["material"]},
                                      {"has_preset", !Json::str(entry, "preset").empty() && !Json::boolean(entry, "pending", false)},
                                      {"last_outcome", Json::str(entry, "last_outcome")},
                                      {"last_ok_at", Json::str(entry, "last_ok_at")}};
        put_brand(row, Json::str(s, "brand"), Json::str(s, "range"));
        rows.push_back(row);
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

nlohmann::json adopt(const nlohmann::json& reg, const std::string& preset, const std::string& name, const std::string& material,
                     const std::string& printer)
{
    const nlohmann::json clean = sanitize(reg);
    if (preset.empty() || printer.empty())
        return {{"reg", clean}, {"id", ""}, {"created", false}};
    if (const std::string known = spool_of_preset(clean, preset); !known.empty())
        return {{"reg", clean}, {"id", known}, {"created", false}};
    const nlohmann::json added = add(clean, name, material);
    const std::string    id    = Json::str(added, "id");
    if (id.empty())
        return {{"reg", clean}, {"id", ""}, {"created", false}};
    const std::string recorded = preset_for(added["reg"], id, printer);
    if (!recorded.empty() && recorded != preset && !is_pending(added["reg"], id, printer))
        return {{"reg", clean}, {"id", ""}, {"created", false}};
    return {{"reg", set_preset(added["reg"], id, printer, preset)}, {"id", id}, {"created", added["created"]}};
}

bool is_pending(const nlohmann::json& reg, const std::string& id, const std::string& printer)
{
    const nlohmann::json clean = sanitize(reg);
    for (const nlohmann::json& s : clean["spools"])
        if (s["id"] == id)
            return Json::boolean(Json::obj(s["machines"], printer.c_str()), "pending", false);
    return false;
}

nlohmann::json brand_of(const nlohmann::json& reg, const std::string& id)
{
    const nlohmann::json clean = sanitize(reg);
    for (const nlohmann::json& s : clean["spools"])
        if (s["id"] == id)
            return {{"brand", Json::str(s, "brand")}, {"range", Json::str(s, "range")}};
    return {{"brand", ""}, {"range", ""}};
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
    const auto texts = [&raw](const char* field, bool print) {
        nlohmann::json       out = nlohmann::json::object();
        const nlohmann::json src = Json::obj(raw, field); // copie nommée : items() ne garde pas un temporaire
        for (const auto& [key, value] : src.items())
            if (!key.empty() && key.size() <= 80 && value.is_string() && (!print || carries_with_spool(key)))
                out[key] = value;
        return out;
    };
    nlohmann::json out = {{"spool", spool}, {"printer", printer}, {"date", date}, {"at", Json::str(raw, "at", 40)}, {"values", texts("values", false)}};
    if (nlohmann::json print = texts("print", true); !print.empty())
        out["print"] = print;
    return out;
}

bool carries_with_spool(const std::string& key)
{
    // La forme de la pièce décide de ceux-là, même s'ils portent un nom de vitesse ou de débit.
    static const char* const PART[] = {"support_", "tree_support_", "brim_", "raft_", "skirt_", "ironing_", "fuzzy_skin", "spiral_", "prime_tower", "wipe_tower"};
    for (const char* p : PART)
        if (key.rfind(p, 0) == 0)
            return false;
    const auto ends_with = [&key](const std::string& end) { return key.size() > end.size() && key.compare(key.size() - end.size(), end.size(), end) == 0; };
    if (key.rfind("initial_layer_", 0) == 0 || key.rfind("elefant_foot_compensation", 0) == 0 || ends_with("_flow_ratio") ||
        ends_with("_speed") || ends_with("_acceleration") || ends_with("_jerk"))
        return true;
    static const std::set<std::string> MORE = {"set_other_flow_ratios", "bridge_flow", "internal_bridge_flow", "enable_overhang_speed",
                                               "slow_down_layers", "slowdown_for_curled_perimeters", "max_volumetric_extrusion_rate_slope",
                                               "max_volumetric_extrusion_rate_slope_segment_length", "accel_to_decel_enable",
                                               "accel_to_decel_factor", "default_junction_deviation", "small_area_infill_flow_compensation"};
    return MORE.count(key) > 0;
}

nlohmann::json print_to_restore(const nlohmann::json& ok_print, const std::map<std::string, std::string>& saved,
                                const std::map<std::string, std::string>& edited)
{
    nlohmann::json out = nlohmann::json::object();
    if (!ok_print.is_object())
        return out;
    for (const auto& [key, value] : ok_print.items()) {
        if (!value.is_string() || !carries_with_spool(key))
            continue;
        const auto s = saved.find(key), e = edited.find(key);
        // Réglage absent d'aujourd'hui, ou déjà changé dans ce projet (par toi ou par moi) : on n'y touche pas.
        if (s == saved.end() || e == edited.end() || s->second != e->second || e->second == value.get<std::string>())
            continue;
        out[key] = value;
    }
    // Un débit remis sans son interrupteur n'aurait aucun effet (ConfigRules::gate_of) : on l'allume avec, s'il est éteint ici.
    const nlohmann::json restored = out; // copie nommée : items() ne garde pas un temporaire, et `out` grandit dans la boucle
    for (const auto& [key, value] : restored.items()) {
        const std::string gate = ConfigRules::gate_of(key);
        const auto        e    = edited.find(gate);
        if (!gate.empty() && !out.contains(gate) && e != edited.end() && e->second != "1" && value.get<std::string>() != "1")
            out[gate] = "1";
    }
    return out;
}

nlohmann::json last_sent(const nlohmann::json& raw)
{
    const std::string spool   = Json::str(raw, "spool", MAX_ID_BYTES);
    const std::string printer = Json::str(raw, "printer", 200);
    const std::string date    = Json::str(raw, "date");
    const std::string at      = Json::str(raw, "at", 40);
    if (spool.empty() || printer.empty() || !valid_date(date) || at.empty())
        return nlohmann::json::object();
    nlohmann::json out = {{"spool", spool}, {"printer", printer}, {"date", date}, {"at", at}};
    if (Json::str(raw, "answered") == "bad")
        out["answered"] = "bad";
    return out;
}

namespace {

// Jours depuis le 1970-01-01 (calendrier grégorien), sans fuseau : les deux instants comparés sont en heure locale.
long long days_from_civil(long long y, unsigned m, unsigned d)
{
    y -= m <= 2;
    const long long era = (y >= 0 ? y : y - 399) / 400;
    const unsigned  yoe = static_cast<unsigned>(y - era * 400);
    const unsigned  doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned  doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<long long>(doe) - 719468;
}

// « AAAA-MM-JJTHH:MM:SS » en secondes ; faux si illisible.
bool iso_seconds(const std::string& iso, long long& out)
{
    if (iso.size() < 19 || iso[10] != 'T' || iso[13] != ':' || iso[16] != ':' || !valid_date(iso.substr(0, 10)))
        return false;
    for (const size_t i : {11, 12, 14, 15, 17, 18})
        if (std::isdigit(static_cast<unsigned char>(iso[i])) == 0)
            return false;
    const int h = std::stoi(iso.substr(11, 2)), mi = std::stoi(iso.substr(14, 2)), s = std::stoi(iso.substr(17, 2));
    if (h > 23 || mi > 59 || s > 60)
        return false;
    const long long days = days_from_civil(std::stoll(iso.substr(0, 4)), static_cast<unsigned>(std::stoi(iso.substr(5, 2))),
                                           static_cast<unsigned>(std::stoi(iso.substr(8, 2))));
    out = days * 86400 + h * 3600 + mi * 60 + s;
    return true;
}

} // namespace

nlohmann::json answered(const nlohmann::json& pointer, const std::string& outcome)
{
    nlohmann::json p = last_sent(pointer);
    if (!p.empty() && outcome == "bad")
        p["answered"] = "bad";
    return p;
}

std::string sent_refusal(const nlohmann::json& pointer, const std::string& expected_spool, const std::string& now_iso)
{
    const nlohmann::json p = last_sent(pointer);
    if (p.empty())
        return "none";
    if (expected_spool.empty() || p["spool"] != expected_spool)
        return "other";
    if (Json::str(p, "answered") == "bad")
        return "answered";
    long long sent = 0, now = 0;
    if (!iso_seconds(p["at"], sent) || !iso_seconds(now_iso, now))
        return "old";
    const long long age = now - sent;
    // Une heure en arrière permise (passage à l'heure d'hiver) ; au-delà, l'horloge a bougé : on ne se fie pas à l'envoi.
    if (age < -3600 || age > SENT_MAX_AGE_HOURS * 3600)
        return "old";
    return "";
}

Flush flush_before_switch(bool filament_dirty, bool is_spool, bool calibrating, bool temperatures_ok)
{
    if (!filament_dirty)
        return Flush::Clean;
    if (!is_spool)
        return Flush::NotSpool;
    if (calibrating || !temperatures_ok)
        return Flush::Refuse;
    return Flush::Save;
}

std::string adoptable_material(const std::string& filament_type, bool is_system, bool is_default, bool is_spool, bool has_system_parent)
{
    if (is_system || is_default || is_spool || !has_system_parent || !valid_material(filament_type))
        return "";
    return filament_type;
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
    {"first_layer_flow_ratio", "débit de la première couche"},
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
