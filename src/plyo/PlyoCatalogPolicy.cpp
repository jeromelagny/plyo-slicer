#include "PlyoCatalogPolicy.hpp"
#include "PlyoJson.hpp"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <locale>
#include <map>
#include <sstream>

namespace Plyo { namespace Catalog {

namespace {

std::vector<std::string> strings(const nlohmann::json& j, const char* key)
{
    std::vector<std::string> out;
    const auto it = j.is_object() ? j.find(key) : j.end();
    if (it != j.end() && it->is_array())
        for (const nlohmann::json& s : *it)
            if (s.is_string())
                out.push_back(s.get<std::string>());
    return out;
}

bool contains_any(const std::string& key, const std::vector<std::string>& patterns)
{
    return std::any_of(patterns.begin(), patterns.end(), [&](const std::string& p) { return key.find(p) != std::string::npos; });
}

} // namespace

Policy Policy::from_json(const nlohmann::json& policy, const nlohmann::json& keys)
{
    Policy p;
    p.m_forbidden_patterns = strings(policy, "forbidden_patterns");
    p.m_forbidden_keys     = strings(policy, "forbidden_keys");
    p.m_confirm_patterns   = strings(policy, "confirm_patterns");
    p.m_confirm_keys       = strings(policy, "confirm_keys");
    if (keys.is_object())
        for (const auto& [scope, items] : keys.items()) {
            if (scope == "titles") {
                if (items.is_object())
                    for (const auto& [key, title] : items.items())
                        if (title.is_string())
                            p.m_titles[key] = title.get<std::string>();
                continue;
            }
            if (items.is_object())
                for (const auto& [key, kind] : items.items())
                    if (kind.is_string())
                        p.m_keys[scope][key] = kind.get<std::string>();
        }
    return p;
}

bool Policy::is_forbidden(const std::string& key) const
{
    return std::find(m_forbidden_keys.begin(), m_forbidden_keys.end(), key) != m_forbidden_keys.end() || contains_any(key, m_forbidden_patterns);
}

bool Policy::allows(const std::string& scope, const std::string& key) const
{
    if (is_forbidden(key))
        return false;
    const auto s = m_keys.find(scope);
    return s != m_keys.end() && s->second.count(key) > 0;
}

bool Policy::needs_confirmation(const std::string& key) const
{
    return std::find(m_confirm_keys.begin(), m_confirm_keys.end(), key) != m_confirm_keys.end() || contains_any(key, m_confirm_patterns);
}

std::string Policy::title(const std::string& key) const
{
    const auto it = m_titles.find(key);
    return it == m_titles.end() ? std::string() : it->second;
}

std::string Policy::kind(const std::string& scope, const std::string& key) const
{
    return allows(scope, key) ? m_keys.at(scope).at(key) : std::string();
}

std::vector<std::string> Policy::keys(const std::string& scope) const
{
    std::vector<std::string> out;
    const auto               s = m_keys.find(scope);
    if (s != m_keys.end())
        for (const auto& [key, kind] : s->second)
            if (!is_forbidden(key))
                out.push_back(key);
    return out;
}

nlohmann::json typed_value(const std::string& kind, const std::string& text)
{
    if (kind == "enum")
        return text.empty() || text == "nil" ? nlohmann::json(nullptr) : nlohmann::json(text);
    if (kind == "bool")
        return text == "1" ? nlohmann::json(true) : text == "0" ? nlohmann::json(false) : nlohmann::json(nullptr);
    if ((kind == "percent" || kind == "float_or_percent") && !text.empty() && text.back() == '%')
        return text;
    std::istringstream in(text);
    in.imbue(std::locale::classic());
    double value = 0;
    if (!(in >> value) || !std::isfinite(value) || !in.eof())
        return nullptr;
    return kind == "int" ? nlohmann::json(static_cast<long long>(std::llround(value))) : nlohmann::json(value);
}

namespace {

bool is_percent_text(const nlohmann::json& v) { return v.is_string() && !v.get<std::string>().empty() && v.get<std::string>().back() == '%'; }

// Nombre d'une valeur JSON : nombre, ou texte « 15% » (pourcentage).
std::optional<double> number_of(const nlohmann::json& v)
{
    if (v.is_number())
        return v.get<double>();
    if (is_percent_text(v)) {
        std::istringstream in(v.get<std::string>().substr(0, v.get<std::string>().size() - 1));
        in.imbue(std::locale::classic());
        double x = 0;
        if (in >> x && in.eof())
            return x;
    }
    return std::nullopt;
}

std::string plain(double value)
{
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::setprecision(6) << std::round(value * 1000.) / 1000.;
    return out.str();
}

CheckResult refuse(const std::string& label, const std::string& why) { return {false, "Refusé : " + label + " " + why + " Aucune modification appliquée."}; }

} // namespace

CheckResult check_change(const std::string& label, const OptionInfo& info, const nlohmann::json& value, const Limits::Range& limits,
                         const std::string& limit_id, bool confirmed_outside)
{
    if (info.kind == "bool")
        return value.is_boolean() ? CheckResult{} : refuse(label, "attend oui ou non.");
    if (info.kind == "enum") {
        const bool known = value.is_string() && std::find(info.enum_values.begin(), info.enum_values.end(), value.get<std::string>()) != info.enum_values.end();
        return known ? CheckResult{} : refuse(label, "n'accepte pas ce choix.");
    }
    if (info.kind != "int" && info.kind != "float" && info.kind != "percent" && info.kind != "float_or_percent")
        return refuse(label, "n'est pas un réglage que l'assistant peut modifier.");
    if (info.kind != "percent" && info.kind != "float_or_percent" && !value.is_number())
        return refuse(label, "attend un nombre.");
    const std::optional<double> number = number_of(value);
    if (!number || !std::isfinite(*number))
        return refuse(label, "attend un nombre.");
    if (info.kind == "int" && std::abs(*number - std::round(*number)) > 1e-9)
        return refuse(label, "attend un nombre entier.");
    if ((info.min && *number < *info.min - BOUND_MARGIN) || (info.max && *number > *info.max + BOUND_MARGIN))
        return refuse(label, "à " + plain(*number) + " est hors de la plage autorisée par Orca.");
    if (!limit_id.empty() && !confirmed_outside) {
        const Limits::Verdict verdict = Limits::check(limit_id, *number, limits);
        if (verdict != Limits::Verdict::Ok)
            return refuse(label, "à " + plain(*number) + (verdict == Limits::Verdict::Below ? " est sous" : " est au-dessus de") + " la plage du fabricant de ton filament.");
    }
    return {};
}

std::string to_serialized(const OptionInfo& info, const nlohmann::json& value)
{
    if (info.kind == "enum")
        return value.is_string() ? value.get<std::string>() : std::string();
    if (info.kind == "bool")
        return value.is_boolean() ? (value.get<bool>() ? "1" : "0") : std::string();
    const std::optional<double> number = number_of(value);
    if (!number)
        return std::string();
    if (info.kind == "int")
        return std::to_string(static_cast<long long>(std::llround(*number)));
    if (info.kind == "percent")
        return plain(*number) + "%";
    if (info.kind == "float_or_percent" && is_percent_text(value))
        return plain(*number) + "%";
    return plain(*number);
}

std::optional<double> temperature_cap(const std::string& key)
{
    constexpr double NOZZLE_MAX = 300; // PA, PC, PET-CF montent jusque-là (MATERIAL_RANGES du service)
    constexpr double BED_MAX    = 110; // plateau et caisson
    static const std::map<std::string, double> CAPS = {
        {"nozzle_temperature", NOZZLE_MAX},
        {"nozzle_temperature_initial_layer", NOZZLE_MAX},
        {"idle_temperature", NOZZLE_MAX},
        {"filament_tower_interface_print_temp", NOZZLE_MAX},
        {"standby_temperature_delta", NOZZLE_MAX},
        {"temperature_vitrification", NOZZLE_MAX}, // propriété de la matière : au-delà de 130 °C pour un PC ou un PEEK
        {"chamber_temperature", BED_MAX},
        {"chamber_minimal_temperature", BED_MAX},
    };
    if (const auto it = CAPS.find(key); it != CAPS.end())
        return it->second;
    if (const std::string id = limit_id_of(key); id == "bed_temp" || id == "bed_temp_initial") // une clé par type de plateau
        return BED_MAX;
    return std::nullopt;
}

CheckResult check_temperature_cap(const std::string& label, const std::string& key, const nlohmann::json& value)
{
    const std::optional<double> cap    = temperature_cap(key);
    const std::optional<double> number = number_of(value);
    if (!cap || !number || !(*number > *cap))
        return {};
    return refuse(label, "à " + plain(*number) + " °C dépasse le plafond de Plyo (" + plain(*cap) + " °C).");
}

std::string limit_id_of(const std::string& key)
{
    if (key == "nozzle_temperature")
        return "nozzle_temp";
    if (key == "nozzle_temperature_initial_layer")
        return "nozzle_temp_initial";
    const auto ends_with = [&](const char* suffix) {
        const std::string s(suffix);
        return key.size() >= s.size() && key.compare(key.size() - s.size(), s.size(), s) == 0;
    };
    if (ends_with("_plate_temp"))
        return "bed_temp";
    if (ends_with("_plate_temp_initial_layer"))
        return "bed_temp_initial";
    return std::string();
}

namespace {

constexpr const char* TOWER_INTERFACE_TEMP = "filament_tower_interface_print_temp"; // -1 : automatique
constexpr double      REL_DELTA            = 0.3;
constexpr double      MAX_LAYER_OF_NOZZLE  = 0.75;

bool is_numeric_kind(const std::string& kind) { return kind == "int" || kind == "float" || kind == "percent" || kind == "float_or_percent"; }
bool is_layer_key(const std::string& key) { return key == "layer_height" || key == "initial_layer_print_height"; }
bool is_bed_id(const std::string& id) { return id == "bed_temp" || id == "bed_temp_initial"; }

// Écart minimal toujours permis, proportionné à la plage d'Orca (floorOf du service).
double floor_of(const std::string& kind, std::optional<double> span, double current)
{
    if (kind == "int")
        return std::max(3.0, std::min(span ? *span * 0.1 : 3.0, 10.0));
    if (kind == "percent")
        return span ? std::max(5.0, std::min(*span * 0.15, 15.0)) : 5.0;
    double floor = span ? std::min(*span * 0.1, 10.0) : 1.0;
    if (current > 0)
        floor = std::min(floor, 0.5 * current);
    return floor;
}

std::string fr(double value)
{
    std::string s = plain(value);
    std::replace(s.begin(), s.end(), '.', ',');
    return s;
}

} // namespace

CheckResult check_hard(const std::string& label, const std::string& key, const OptionInfo& info, const nlohmann::json& value,
                       const nlohmann::json& current, double nozzle_mm)
{
    if (!is_numeric_kind(info.kind))
        return {};
    const std::optional<double> number = number_of(value);
    if (!number)
        return {};
    // « mm ou % » : on reste dans l'unité actuelle.
    if (info.kind == "float_or_percent" && !current.is_null() && is_percent_text(value) != is_percent_text(current))
        return refuse(label, "garde la même unité qu'aujourd'hui (" + std::string(is_percent_text(current) ? "en %" : "en mm") + ").");
    if (key == "filament_diameter" && (*number < 1.5 || *number > 3.1))
        return refuse(label, "à " + fr(*number) + " mm sort de la plage permise (1,5 à 3,1 mm).");
    if (is_layer_key(key) && nozzle_mm > 0) {
        const double max = std::floor(nozzle_mm * MAX_LAYER_OF_NOZZLE * 100 + 1e-6) / 100;
        if (*number > max + 1e-9)
            return refuse(label, "à " + fr(*number) + " mm est trop haute pour ta buse (" + fr(max) + " mm au plus).");
    }
    const std::string id    = limit_id_of(key);
    const bool        tower = key == TOWER_INTERFACE_TEMP;
    if (tower && *number == -1)
        return {};
    if (id == "nozzle_temp" || id == "nozzle_temp_initial" || tower) {
        if (*number < 170 || *number > 300)
            return refuse(label, "à " + fr(*number) + " °C sort de la plage permise (170 à 300 °C).");
    } else if (is_bed_id(id) && (*number < 0 || *number > 110))
        return refuse(label, "à " + fr(*number) + " °C sort de la plage permise (0 à 110 °C).");
    return {};
}

double max_delta(const std::string& key, const OptionInfo& info, double current)
{
    if (key == "filament_diameter")
        return 0.1;
    const std::optional<double> span = info.min && info.max ? std::optional<double>(*info.max - *info.min) : std::nullopt;
    double delta = std::max(REL_DELTA * std::abs(current), floor_of(info.kind, span, current));
    // Températures : le même écart que la buse et le plateau de la liste d'origine, quelle que soit la clé.
    if (key.find("temp") != std::string::npos)
        delta = std::min(delta, is_bed_id(limit_id_of(key)) ? 10.0 : 15.0);
    return delta;
}

CheckResult check_delta(const std::string& label, const std::string& key, const OptionInfo& info, const nlohmann::json& value,
                        const nlohmann::json& current)
{
    if (!is_numeric_kind(info.kind))
        return {};
    const std::optional<double> target = number_of(value);
    const std::optional<double> now    = number_of(current);
    if (!target)
        return {};
    if (!now) {
        // Ni valeur actuelle ni bornes d'Orca : rien ne borne le changement.
        if (!info.min || !info.max)
            return refuse(label, "a une valeur actuelle que je ne connais pas : je ne peux pas vérifier l'écart.");
        return {};
    }
    if (key == TOWER_INTERFACE_TEMP && (*target == -1 || *now == -1))
        return {};
    const double delta = max_delta(key, info, *now);
    if (std::abs(*target - *now) > delta + 1e-9)
        return refuse(label, "passerait de " + fr(*now) + " à " + fr(*target) + " d'un coup : c'est plus que l'écart permis sans ta confirmation (" +
                                 fr(delta) + " au plus).");
    return {};
}

bool requires_confirmation(const Policy& policy, const std::string& key)
{
    return policy.needs_confirmation(key) || key == "filament_diameter" || key == "filament_flow_ratio" || key == TOWER_INTERFACE_TEMP;
}

Verdict check_barrier(const Policy& policy, const std::string& label, const std::string& key, const OptionInfo& info,
                      const nlohmann::json& value, const nlohmann::json& current, double nozzle_mm, const Limits::Range& limits,
                      bool confirmed_outside, bool confirmed)
{
    if (const CheckResult capped = check_temperature_cap(label, key, value); !capped.ok)
        return {capped, ""};
    if (const CheckResult checked = check_change(label, info, value, limits, limit_id_of(key), confirmed_outside); !checked.ok)
        return {checked, ""};
    if (const CheckResult hard = check_hard(label, key, info, value, current, nozzle_mm); !hard.ok)
        return {hard, ""};
    if (confirmed)
        return {};
    if (requires_confirmation(policy, key))
        return {refuse(label, "est un réglage sensible : il ne s'applique qu'avec ta confirmation."), "needs_confirmation"};
    if (const CheckResult delta = check_delta(label, key, info, value, current); !delta.ok)
        return {delta, "needs_confirmation"};
    return {};
}

std::string refused_name(const std::string& key, const LabelFn& label_of)
{
    const std::string title = key.empty() ? key : label_of(key);
    return title.empty() || title == key ? std::string("ce réglage") : "« " + title + " »";
}

std::optional<Refusal> check_planned(const Policy& policy, const std::optional<Probe>& probe, const std::string& key, const std::string& scope,
                                     const nlohmann::json& value, const std::string& label, double nozzle_mm, const Limits::Range& limits,
                                     bool confirmed_outside, bool confirmed, Planned& out)
{
    if (!probe)
        return Refusal{"Refusé : « " + label + " » n'existe pas dans ce profil. Aucune modification appliquée.", "", key};
    const Verdict verdict = check_barrier(policy, label, key, probe->info, value, probe->current, nozzle_mm, limits, confirmed_outside, confirmed);
    if (!verdict.check.ok)
        return Refusal{verdict.check.text, verdict.code, key};
    const std::string text = to_serialized(probe->info, value);
    if (text.empty())
        return Refusal{"Refusé : valeur illisible pour « " + label + " ». Aucune modification appliquée.", "", key};
    out = Planned{key, scope, label, text, probe->info.kind, value, probe->before, confirmed};
    return std::nullopt;
}

std::optional<Refusal> check_lot(const Policy& policy, const nlohmann::json& changes, const ProbeFn& probe, const LabelFn& label_of, double nozzle_mm,
                                 const Limits::Range& limits, std::vector<Planned>& out)
{
    out.clear();
    if (!changes.is_array() || changes.empty())
        return Refusal{"Refusé : aucune modification reçue.", "", ""};
    std::vector<std::string> seen;
    for (const nlohmann::json& change : changes) {
        const std::string key   = change.is_object() ? Json::str(change, "key") : std::string();
        const char*       scope = policy.allows("print", key) ? "print" : policy.allows("filament", key) ? "filament" : "";
        if (*scope == '\0') {
            out.clear();
            return Refusal{"Refusé : " + refused_name(key, label_of) + " ne fait pas partie des réglages que l'assistant peut modifier. Aucune modification appliquée.", "", ""};
        }
        if (std::find(seen.begin(), seen.end(), key) != seen.end()) {
            out.clear();
            return Refusal{"Refusé : " + refused_name(key, label_of) + " est demandé deux fois. Aucune modification appliquée.", "", ""};
        }
        seen.push_back(key);
        // Sans libellé du panneau : le titre du catalogue (les refus ne montrent jamais la clé d'Orca).
        const std::string label = Json::str(change, "label").empty() ? label_of(key) : Json::str(change, "label");
        // `confirmed` : la ligne a été cochée à la main, ou le bouton cliqué annonçait cette valeur. `confirmed_outside_range` :
        // sortie de la plage du fabricant confirmée de la même façon.
        Planned p;
        if (std::optional<Refusal> bad = check_planned(policy, probe(scope, key), key, scope, change.contains("value") ? change["value"] : nlohmann::json(),
                                                       label, nozzle_mm, limits, Json::boolean(change, "confirmed_outside_range", false),
                                                       Json::boolean(change, "confirmed", false), p)) {
            out.clear();
            return bad;
        }
        out.push_back(std::move(p));
    }
    return std::nullopt;
}

}} // namespace Plyo::Catalog
