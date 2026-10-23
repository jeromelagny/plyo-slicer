#include "PlyoSettingsBridge.hpp"

#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Tab.hpp"

#include <boost/log/trivial.hpp>

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <locale>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

namespace Plyo { namespace SettingsBridge {

using Slic3r::DynamicPrintConfig;
using Slic3r::Preset;

namespace {

enum class Kind { Int, Float, Bool };

struct Param
{
    const char*  id;
    const char*  label;
    Preset::Type preset;
    const char*  key; // vide : clé calculée (température de plateau)
    Kind         kind;
    double       min;
    double       max;
    const char*  unit;
};

// Liste blanche Plyo. Les plages sont volontairement plus étroites que celles d'Orca.
// La rétraction passe par la surcharge du filament : on ne touche jamais au préréglage imprimante.
const std::vector<Param> WHITELIST = {
    {"nozzle_temp",      "Température de buse",         Preset::TYPE_FILAMENT, "nozzle_temperature",         Kind::Int,   170, 300, "°C"},
    {"bed_temp",         "Température de plateau",      Preset::TYPE_FILAMENT, "",                           Kind::Int,   0,   110, "°C"},
    {"layer_height",     "Hauteur de couche",           Preset::TYPE_PRINT,    "layer_height",               Kind::Float, 0.05, 0.35, "mm"},
    {"outer_wall_speed", "Vitesse des parois externes", Preset::TYPE_PRINT,    "outer_wall_speed",           Kind::Float, 10,  300, "mm/s"},
    {"retraction",       "Longueur de rétraction",      Preset::TYPE_FILAMENT, "filament_retraction_length", Kind::Float, 0,   8,   "mm"},
    {"brim_width",       "Largeur de bordure",          Preset::TYPE_PRINT,    "brim_width",                 Kind::Float, 0,   20,  "mm"},
    {"support",          "Supports activés",            Preset::TYPE_PRINT,    "enable_support",             Kind::Bool,  0,   1,   ""},
};

// Une valeur d'avant modification, sous forme sérialisée Orca (restaure exactement, y compris « nil »).
struct SavedValue
{
    Preset::Type preset;
    std::string  key;
    std::string  serialized;
};
std::vector<std::vector<SavedValue>> s_undo_stack;

Slic3r::PresetBundle& bundle() { return *Slic3r::GUI::wxGetApp().preset_bundle; }

DynamicPrintConfig& edited_config(Preset::Type type)
{
    return type == Preset::TYPE_PRINT ? bundle().prints.get_edited_preset().config : bundle().filaments.get_edited_preset().config;
}

const Param* find_param(const std::string& id)
{
    for (const Param& p : WHITELIST)
        if (id == p.id)
            return &p;
    return nullptr;
}

// La clé de température de plateau dépend du type de plateau choisi pour le projet.
std::string resolve_key(const Param& p)
{
    if (*p.key != '\0')
        return p.key;
    std::string key;
    if (auto* opt = bundle().project_config.option<Slic3r::ConfigOptionEnum<Slic3r::BedType>>("curr_bed_type"))
        key = Slic3r::get_bed_temp_key(opt->value);
    return key.empty() ? "hot_plate_temp" : key;
}

std::string to_config_string(double value, Kind kind)
{
    if (kind == Kind::Bool)
        return value != 0 ? "1" : "0";
    if (kind == Kind::Int)
        return std::to_string(static_cast<int>(std::lround(value)));
    std::ostringstream out;
    out.imbue(std::locale::classic()); // point décimal, quelle que soit la langue du système
    out << std::setprecision(6) << std::round(value * 1000.) / 1000.;
    return out.str();
}

// Première valeur d'une option (les options « tableau » ont une valeur par filament ou variante d'extrudeur).
std::optional<double> first_value(const DynamicPrintConfig& config, const std::string& key)
{
    const Slic3r::ConfigOption* opt = config.option(key);
    if (opt == nullptr)
        return std::nullopt;
    std::string text = opt->serialize();
    if (opt->is_vector()) {
        auto* vec = static_cast<const Slic3r::ConfigOptionVectorBase*>(opt);
        if (vec->size() == 0 || vec->is_nil(0))
            return std::nullopt;
        text = vec->vserialize().front();
    }
    std::istringstream in(text);
    in.imbue(std::locale::classic());
    double value = 0;
    if (!(in >> value))
        return std::nullopt;
    return value;
}

// Valeur affichée et utilisée pour un delta. Une rétraction filament « nil » hérite de l'imprimante.
std::optional<double> current_value(const Param& p, std::string* note = nullptr)
{
    const std::string key   = resolve_key(p);
    std::optional<double> v = first_value(edited_config(p.preset), key);
    if (!v && key == "filament_retraction_length") {
        v = first_value(bundle().printers.get_edited_preset().config, "retraction_length");
        if (note)
            *note = "valeur de l'imprimante (pas de surcharge filament)";
    }
    return v;
}

// Écrit `text` dans toutes les cases d'une option tableau (ou dans l'option simple).
void set_value(DynamicPrintConfig& config, const std::string& key, const std::string& text)
{
    std::string serialized = text;
    if (const Slic3r::ConfigOption* opt = config.option(key); opt != nullptr && opt->is_vector()) {
        const size_t n = std::max<size_t>(1, static_cast<const Slic3r::ConfigOptionVectorBase*>(opt)->size());
        for (size_t i = 1; i < n; ++i)
            serialized += "," + text;
    }
    config.set_deserialize_strict(key, serialized);
}

std::string format_number(double value, Kind kind)
{
    std::string s = to_config_string(value, kind);
    std::replace(s.begin(), s.end(), '.', ',');
    return s;
}

std::string range_text(const Param& p)
{
    return format_number(p.min, p.kind) + " – " + format_number(p.max, p.kind) + " " + p.unit;
}

// Applique des configs modifiées via Tab::load_config, comme une saisie de l'utilisateur :
// préréglage marqué « modifié », champs rafraîchis, découpe invalidée et reprogrammée.
void load_into_tabs(const std::map<Preset::Type, DynamicPrintConfig>& configs)
{
    for (const auto& [type, config] : configs)
        if (Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(type))
            tab->load_config(config);
}

} // namespace

nlohmann::json read_values()
{
    nlohmann::json params = nlohmann::json::array();
    for (const Param& p : WHITELIST) {
        std::string           note;
        std::optional<double> v = current_value(p, &note);
        nlohmann::json        item{{"id", p.id}, {"label", p.label}, {"key", resolve_key(p)}, {"unit", p.unit},
                                   {"min", p.min}, {"max", p.max}, {"note", note}};
        if (!v)
            item["value"] = nullptr;
        else if (p.kind == Kind::Bool)
            item["value"] = *v != 0;
        else
            item["value"] = *v;
        params.push_back(item);
    }
    return {{"params", params}, {"can_undo", !s_undo_stack.empty()}};
}

nlohmann::json apply_changes(const nlohmann::json& changes)
{
    if (!changes.is_array() || changes.empty())
        return {{"ok", false}, {"text", "Refusé : aucune modification reçue."}};

    struct Planned { const Param* param; std::string key; double value; };
    std::vector<Planned> planned;

    // 1. Validation complète avant toute écriture (tout ou rien).
    for (const nlohmann::json& change : changes) {
        const std::string id    = change.is_object() ? change.value("id", std::string()) : std::string();
        const Param*      param = find_param(id);
        if (param == nullptr)
            return {{"ok", false}, {"text", "Refusé : « " + id + " » ne fait pas partie des paramètres modifiables."}};

        double value = 0;
        if (change.contains("value") && change["value"].is_boolean())
            value = change["value"].get<bool>() ? 1 : 0;
        else if (change.contains("value") && change["value"].is_number())
            value = change["value"].get<double>();
        else if (change.contains("delta") && change["delta"].is_number()) {
            std::optional<double> current = current_value(*param);
            if (!current)
                return {{"ok", false}, {"text", std::string("Refusé : valeur actuelle de « ") + param->label + " » illisible."}};
            value = *current + change["delta"].get<double>();
        } else
            return {{"ok", false}, {"text", std::string("Refusé : valeur manquante ou invalide pour « ") + param->label + " »."}};

        if (!std::isfinite(value) || value < param->min - 1e-9 || value > param->max + 1e-9)
            return {{"ok", false},
                    {"text", std::string("Refusé : ") + param->label + " à " + format_number(value, param->kind) + " " + param->unit +
                                 " est hors de la plage autorisée (" + range_text(*param) + "). Aucune modification appliquée."}};

        planned.push_back({param, resolve_key(*param), value});
    }

    // 2. Mémorise les valeurs d'avant (pour l'annulation), puis prépare les nouvelles configs.
    std::vector<SavedValue>                     saved;
    std::map<Preset::Type, DynamicPrintConfig> configs;
    std::string                                 summary;
    for (const Planned& p : planned) {
        const Preset::Type type = p.param->preset;
        if (!configs.count(type))
            configs.emplace(type, edited_config(type));
        saved.push_back({type, p.key, edited_config(type).opt_serialize(p.key)});
        set_value(configs[type], p.key, to_config_string(p.value, p.param->kind));
        summary += std::string(summary.empty() ? "" : ", ") + p.param->label + " → " +
                   (p.param->kind == Kind::Bool ? (p.value != 0 ? "oui" : "non") : format_number(p.value, p.param->kind) + " " + p.param->unit);
    }

    // 3. Écriture.
    load_into_tabs(configs);
    s_undo_stack.push_back(std::move(saved));
    BOOST_LOG_TRIVIAL(info) << "Plyo: modifications appliquées : " << summary;
    return {{"ok", true}, {"text", "Appliqué : " + summary + "."}};
}

nlohmann::json undo_last()
{
    if (s_undo_stack.empty())
        return {{"ok", false}, {"text", "Rien à annuler."}};

    std::map<Preset::Type, DynamicPrintConfig> configs;
    for (const SavedValue& v : s_undo_stack.back()) {
        if (!configs.count(v.preset))
            configs.emplace(v.preset, edited_config(v.preset));
        configs[v.preset].set_deserialize_strict(v.key, v.serialized);
    }
    s_undo_stack.pop_back();
    load_into_tabs(configs);
    return {{"ok", true}, {"text", "Annulé : valeurs d'avant restaurées."}};
}

}} // namespace Plyo::SettingsBridge
