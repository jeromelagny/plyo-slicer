#pragma once

#include <nlohmann/json.hpp>

#include <cmath>
#include <limits>
#include <string>

// Lecture typée et tolérante des messages du panneau et des fichiers JSON de Plyo : une forme inattendue donne la
// valeur par défaut, jamais une exception (une exception dans un CallAfter ferme Orca).
namespace Plyo { namespace Json {

// Les `max` premiers octets d'une chaîne UTF-8, sans couper un caractère en deux.
inline std::string utf8_prefix(const std::string& s, size_t max)
{
    if (s.size() <= max)
        return s;
    size_t end = max;
    while (end > 0 && (static_cast<unsigned char>(s[end]) & 0xC0) == 0x80) // octet de suite : recule au début du caractère
        --end;
    return s.substr(0, end);
}

inline const nlohmann::json* field(const nlohmann::json& j, const char* key)
{
    if (!j.is_object())
        return nullptr;
    const auto it = j.find(key);
    return it == j.end() ? nullptr : &*it;
}

inline std::string str(const nlohmann::json& j, const char* key, size_t max = std::string::npos)
{
    const nlohmann::json* v = field(j, key);
    return v != nullptr && v->is_string() ? utf8_prefix(v->get_ref<const std::string&>(), max) : std::string();
}

inline double num(const nlohmann::json& j, const char* key, double fallback = 0)
{
    const nlohmann::json* v = field(j, key);
    return v != nullptr && v->is_number() && std::isfinite(v->get<double>()) ? v->get<double>() : fallback;
}

inline long long integer(const nlohmann::json& j, const char* key, long long fallback = 0)
{
    const double d = num(j, key, std::numeric_limits<double>::quiet_NaN());
    return std::isfinite(d) && std::abs(d) < 9e15 ? static_cast<long long>(d) : fallback;
}

inline bool boolean(const nlohmann::json& j, const char* key, bool fallback = false)
{
    const nlohmann::json* v = field(j, key);
    return v != nullptr && v->is_boolean() ? v->get<bool>() : fallback;
}

inline nlohmann::json obj(const nlohmann::json& j, const char* key)
{
    const nlohmann::json* v = field(j, key);
    return v != nullptr && v->is_object() ? *v : nlohmann::json::object();
}

// Valeur brute du champ (n'importe quel type), ou null.
inline nlohmann::json any(const nlohmann::json& j, const char* key)
{
    const nlohmann::json* v = field(j, key);
    return v != nullptr ? *v : nlohmann::json();
}

inline nlohmann::json arr(const nlohmann::json& j, const char* key)
{
    const nlohmann::json* v = field(j, key);
    return v != nullptr && v->is_array() ? *v : nlohmann::json::array();
}

}} // namespace Plyo::Json
