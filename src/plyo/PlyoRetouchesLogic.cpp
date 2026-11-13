#include "PlyoRetouchesLogic.hpp"
#include "PlyoJson.hpp"
#include "PlyoProfilesLogic.hpp"

#include <algorithm>
#include <cmath>

namespace Plyo { namespace RetouchesLogic {

namespace {

// {clé: texte} relu du disque : clés et textes bornés, au plus MAX_CHANGES entrées.
nlohmann::json clean_values(const nlohmann::json* values)
{
    nlohmann::json out = nlohmann::json::object();
    if (values == nullptr || !values->is_object())
        return out;
    for (const auto& [key, value] : values->items()) {
        if (out.size() >= MAX_CHANGES)
            break;
        if (key.empty() || key.size() > 80 || !value.is_string() || value.get_ref<const std::string&>().size() > MAX_VALUE_BYTES)
            continue;
        out[key] = value;
    }
    return out;
}

// Valeur affichable : nombre, booléen, texte court ou null.
nlohmann::json shown(const nlohmann::json* v)
{
    if (v == nullptr || v->is_null() || v->is_boolean())
        return v == nullptr ? nlohmann::json(nullptr) : *v;
    if (v->is_number())
        return std::isfinite(v->get<double>()) ? *v : nlohmann::json(nullptr);
    if (v->is_string())
        return Json::utf8_prefix(v->get<std::string>(), 120);
    return nullptr;
}

} // namespace

std::vector<std::string> manual_keys(const Values& saved, const Values& edited, const Values& plyo_written)
{
    std::vector<std::string> out;
    for (const auto& [key, now] : edited) {
        const auto before = saved.find(key);
        if (before != saved.end() && before->second == now)
            continue; // pas modifié
        const auto plyo = plyo_written.find(key);
        if (plyo != plyo_written.end() && plyo->second == now)
            continue; // écrit par Plyo (un lot annulable), pas retouché depuis
        out.push_back(key);
    }
    std::sort(out.begin(), out.end());
    return out;
}

nlohmann::json sanitize_pending(const nlohmann::json& stored)
{
    if (!stored.is_object())
        return nlohmann::json::object();
    const std::string preset = Json::str(stored, "preset", 200);
    nlohmann::json    values = clean_values(Json::field(stored, "values"));
    if (preset.empty() || values.empty())
        return nlohmann::json::object();
    nlohmann::json changes = nlohmann::json::array();
    if (const nlohmann::json* list = Json::field(stored, "changes"); list != nullptr && list->is_array())
        for (const nlohmann::json& c : *list) {
            if (changes.size() >= MAX_CHANGES)
                break;
            const std::string key = c.is_object() ? Json::str(c, "key", 80) : std::string();
            if (key.empty() || !values.contains(key))
                continue;
            changes.push_back({{"key", key}, {"label", Json::str(c, "label", 120)}, {"before", shown(Json::field(c, "before"))},
                               {"after", shown(Json::field(c, "after"))}});
        }
    return {{"preset", preset},
            {"project", Json::str(stored, "project", 200)},
            {"conv", Json::str(stored, "conv", 80)},
            {"at", Json::str(stored, "at", 40)},
            {"changes", changes},
            {"values", values},
            {"before", clean_values(Json::field(stored, "before"))}};
}

std::string keep_refusal(const nlohmann::json& pending, const std::string& selected_preset, bool print_dirty)
{
    const nlohmann::json p = sanitize_pending(pending);
    if (p.empty())
        return "empty";
    if (Json::str(p, "preset") != selected_preset)
        return "other_preset";
    return print_dirty ? "dirty" : std::string();
}

std::string keep_name(const std::string& preset, bool can_overwrite, const std::vector<std::string>& existing)
{
    return can_overwrite ? preset : Profiles::copy_name(preset, existing);
}

std::string spool_undo_refusal(const nlohmann::json& kept, const std::string& selected_preset, bool filament_dirty, const Values& now)
{
    if (!kept.is_object() || Json::str(kept, "preset").empty() || Json::str(kept, "preset") != selected_preset)
        return "other_spool";
    if (filament_dirty)
        return "dirty";
    const nlohmann::json* after = Json::field(kept, "values");
    if (after == nullptr || !after->is_object() || after->empty())
        return "changed";
    for (const auto& [key, value] : after->items()) {
        const auto it = now.find(key);
        if (!value.is_string() || it == now.end() || it->second != value.get<std::string>())
            return "changed";
    }
    return std::string();
}

}} // namespace Plyo::RetouchesLogic
