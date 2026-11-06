#include "PlyoCatalogPolicy.hpp"

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
    if ((info.min && *number < *info.min - 1e-9) || (info.max && *number > *info.max + 1e-9))
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
    constexpr double NOZZLE_MAX = 320; // PA-CF, PC, PPS peuvent monter haut
    constexpr double BED_MAX    = 130; // plateau et enceinte
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

}} // namespace Plyo::Catalog
