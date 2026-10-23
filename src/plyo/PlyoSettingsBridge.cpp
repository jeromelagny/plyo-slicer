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

enum class Kind { Int, Float, Percent, Bool, Enum };

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
    {"nozzle_temp",         "Température de buse",                     Preset::TYPE_FILAMENT, "nozzle_temperature",               Kind::Int, 170, 300, "°C"},
    {"nozzle_temp_initial", "Température de buse (première couche)",   Preset::TYPE_FILAMENT, "nozzle_temperature_initial_layer", Kind::Int, 170, 300, "°C"},
    {"bed_temp",            "Température de plateau",                  Preset::TYPE_FILAMENT, "",                                 Kind::Int, 0,   110, "°C"},
    {"bed_temp_initial",    "Température de plateau (première couche)", Preset::TYPE_FILAMENT, "",                                Kind::Int, 0,   110, "°C"},
    {"layer_height",     "Hauteur de couche",           Preset::TYPE_PRINT,    "layer_height",               Kind::Float, 0.05, 0.35, "mm"},
    {"outer_wall_speed", "Vitesse des parois externes", Preset::TYPE_PRINT,    "outer_wall_speed",           Kind::Float, 10,  300, "mm/s"},
    {"retraction",       "Longueur de rétraction",      Preset::TYPE_FILAMENT, "filament_retraction_length", Kind::Float, 0,   8,   "mm"},
    {"brim_width",       "Largeur de bordure",          Preset::TYPE_PRINT,    "brim_width",                 Kind::Float, 0,   20,  "mm"},
    {"support",          "Supports activés",            Preset::TYPE_PRINT,    "enable_support",             Kind::Bool,  0,   1,   ""},
    {"ironing_type",     "Lissage",                     Preset::TYPE_PRINT,    "ironing_type",               Kind::Enum,  0,   0,   ""},
    {"ironing_speed",    "Vitesse de lissage",          Preset::TYPE_PRINT,    "ironing_speed",              Kind::Float, 5,   100, "mm/s"},
    {"ironing_flow",     "Débit de lissage",            Preset::TYPE_PRINT,    "ironing_flow",               Kind::Percent, 1, 40,  "%"},
    {"ironing_spacing",  "Espacement du lissage",       Preset::TYPE_PRINT,    "ironing_spacing",            Kind::Float, 0.05, 0.4, "mm"},
    {"support_type",     "Type de support",             Preset::TYPE_PRINT,    "support_type",               Kind::Enum,  0,   0,   ""},
    {"support_style",    "Style de support",            Preset::TYPE_PRINT,    "support_style",              Kind::Enum,  0,   0,   ""},
    {"support_on_build_plate_only", "Supports sur le plateau uniquement", Preset::TYPE_PRINT, "support_on_build_plate_only", Kind::Bool, 0, 1, ""},
    {"support_threshold_angle", "Angle de déclenchement des supports", Preset::TYPE_PRINT, "support_threshold_angle", Kind::Int, 15, 60, "°"},
};

// Valeurs permises pour les réglages à choix. Les modes de support « manual » (zones peintes) sont exclus,
// et le style doit correspondre au type : les styles arborescents n'existent que pour tree(auto).
std::vector<std::string> allowed_values(const std::string& id, const std::string& support_type)
{
    if (id == "ironing_type")
        return {"no ironing", "top", "topmost", "solid"};
    if (id == "support_type")
        return {"normal(auto)", "tree(auto)"};
    if (id == "support_style")
        return support_type == "tree(auto)" ? std::vector<std::string>{"default", "organic", "tree_slim", "tree_strong", "tree_hybrid"}
                                            : std::vector<std::string>{"default", "grid", "snug"};
    return {};
}

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

// Les clés de température de plateau dépendent du type de plateau choisi pour le projet.
std::string resolve_key(const Param& p)
{
    if (*p.key != '\0')
        return p.key;
    const bool  initial = std::string(p.id) == "bed_temp_initial";
    std::string key;
    if (auto* opt = bundle().project_config.option<Slic3r::ConfigOptionEnum<Slic3r::BedType>>("curr_bed_type"))
        key = initial ? Slic3r::get_bed_temp_1st_layer_key(opt->value) : Slic3r::get_bed_temp_key(opt->value);
    if (!key.empty())
        return key;
    return initial ? "hot_plate_temp_initial_layer" : "hot_plate_temp";
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
    return kind == Kind::Percent ? out.str() + "%" : out.str();
}

// Valeur textuelle d'un réglage à choix (ex. « no ironing », « tree(auto) »).
std::string enum_value(const Param& p)
{
    const Slic3r::ConfigOption* opt = edited_config(p.preset).option(resolve_key(p));
    return opt ? opt->serialize() : std::string();
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

// Nombre affiché à l'utilisateur (virgule décimale, sans « % » : l'unité est ajoutée à part).
std::string format_number(double value, Kind kind)
{
    std::string s = to_config_string(value, kind == Kind::Percent ? Kind::Float : kind);
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
        if (p.kind == Kind::Enum)
            item["value"] = enum_value(p);
        else if (!v)
            item["value"] = nullptr;
        else if (p.kind == Kind::Bool)
            item["value"] = *v != 0;
        else
            item["value"] = *v;
        params.push_back(item);
    }
    // Noms des préréglages en cours, transmis au service Plyo (type de filament, imprimante).
    const nlohmann::json context{{"printer", bundle().printers.get_edited_preset().name},
                                 {"filament", bundle().filaments.get_edited_preset().name},
                                 {"process", bundle().prints.get_edited_preset().name}};
    return {{"params", params}, {"context", context}, {"can_undo", !s_undo_stack.empty()}};
}

nlohmann::json apply_changes(const nlohmann::json& changes)
{
    if (!changes.is_array() || changes.empty())
        return {{"ok", false}, {"text", "Refusé : aucune modification reçue."}};

    struct Planned { const Param* param; std::string key; double value; std::string text; };
    std::vector<Planned> planned;

    // Type de support final (demandé dans ce lot, sinon actuel), pour vérifier la cohérence du style.
    std::string support_type = enum_value(*find_param("support_type"));
    for (const nlohmann::json& change : changes)
        if (change.is_object() && change.value("id", std::string()) == "support_type" && change.contains("value") && change["value"].is_string())
            support_type = change["value"].get<std::string>();

    // 1. Validation complète avant toute écriture (tout ou rien).
    for (const nlohmann::json& change : changes) {
        const std::string id    = change.is_object() ? change.value("id", std::string()) : std::string();
        const Param*      param = find_param(id);
        if (param == nullptr)
            return {{"ok", false}, {"text", "Refusé : « " + id + " » ne fait pas partie des paramètres modifiables."}};

        if (param->kind == Kind::Enum) {
            const std::string text = change.contains("value") && change["value"].is_string() ? change["value"].get<std::string>() : std::string();
            const auto allowed = allowed_values(id, support_type);
            if (std::find(allowed.begin(), allowed.end(), text) == allowed.end())
                return {{"ok", false},
                        {"text", std::string("Refusé : « ") + text + " » n'est pas un choix autorisé pour « " + param->label + " ». Aucune modification appliquée."}};
            planned.push_back({param, resolve_key(*param), 0, text});
            continue;
        }

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

        planned.push_back({param, resolve_key(*param), value, to_config_string(value, param->kind)});
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
        set_value(configs[type], p.key, p.text);
        const std::string shown = p.param->kind == Kind::Enum ? p.text
                                : p.param->kind == Kind::Bool ? (p.value != 0 ? "oui" : "non")
                                                              : format_number(p.value, p.param->kind) + " " + p.param->unit;
        summary += std::string(summary.empty() ? "" : ", ") + p.param->label + " → " + shown;
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
