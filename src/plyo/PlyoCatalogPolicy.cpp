#include "PlyoCatalogPolicy.hpp"

#include <algorithm>
#include <cmath>
#include <locale>
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
        for (const auto& [scope, items] : keys.items())
            if (items.is_object())
                for (const auto& [key, kind] : items.items())
                    if (kind.is_string())
                        p.m_keys[scope][key] = kind.get<std::string>();
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

}} // namespace Plyo::Catalog
