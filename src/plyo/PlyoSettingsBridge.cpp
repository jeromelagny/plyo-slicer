#include "PlyoSettingsBridge.hpp"
#include "PlyoAutoSave.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoConfigRulesLogic.hpp"
#include "PlyoContextLogic.hpp"
#include "PlyoJson.hpp"
#include "PlyoLimits.hpp"

#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Tab.hpp"

#include <boost/log/trivial.hpp>

#include <algorithm>
#include <cmath>
#include <deque>
#include <iomanip>
#include <locale>
#include <map>
#include <optional>
#include <set>
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
    {"brim_type",        "Type de bordure",             Preset::TYPE_PRINT,    "brim_type",                  Kind::Enum,  0,   0,   ""},
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
    {"wall_loops",            "Nombre de parois",            Preset::TYPE_PRINT, "wall_loops",            Kind::Int,     1, 10,  ""},
    {"sparse_infill_density", "Taux de remplissage",         Preset::TYPE_PRINT, "sparse_infill_density", Kind::Percent, 5, 100, "%"},
    {"top_shell_layers",      "Couches pleines (dessus)",    Preset::TYPE_PRINT, "top_shell_layers",      Kind::Int,     2, 10,  ""},
    {"bottom_shell_layers",   "Couches pleines (dessous)",   Preset::TYPE_PRINT, "bottom_shell_layers",   Kind::Int,     2, 10,  ""},
    {"elephant_foot_comp", "Compensation du pied d'éléphant", Preset::TYPE_PRINT, "elefant_foot_compensation", Kind::Float, 0, 0.5, "mm"},
    {"bridge_speed",       "Vitesse des ponts",               Preset::TYPE_PRINT, "bridge_speed",              Kind::Float, 10, 100, "mm/s"},
    {"bridge_flow",        "Débit des ponts",                 Preset::TYPE_PRINT, "bridge_flow",               Kind::Float, 0.5, 1.5, ""},
    {"overhang_fan_speed", "Ventilation des ponts et surplombs", Preset::TYPE_FILAMENT, "overhang_fan_speed",  Kind::Int,   0, 100, "%"},
};

// Valeurs permises pour les réglages à choix. Les modes de support « manual » ne gardent que les zones peintes
// (outil « Peindre les supports ») ; le style doit correspondre au type : les styles arborescents sont pour tree.
std::vector<std::string> allowed_values(const std::string& id, const std::string& support_type)
{
    if (id == "brim_type")
        return {"auto_brim", "outer_only", "no_brim"};
    if (id == "ironing_type")
        return {"no ironing", "top", "topmost", "solid"};
    if (id == "support_type")
        return {"normal(auto)", "tree(auto)", "normal(manual)", "tree(manual)"};
    if (id == "support_style")
        return support_type.rfind("tree(", 0) == 0 ? std::vector<std::string>{"default", "organic", "tree_slim", "tree_strong", "tree_hybrid"}
                                            : std::vector<std::string>{"default", "grid", "snug"};
    return {};
}

// Une valeur d'avant modification, sous forme sérialisée Orca (restaure exactement, y compris « nil »), et celle que le lot
// a laissée (`after`) : l'annulation ne touche pas un réglage retouché depuis.
struct SavedValue
{
    Preset::Type preset;
    std::string  key;
    std::string  serialized;
    std::string  preset_name; // préréglage modifié : l'annulation n'écrit jamais dans un autre
    std::string  after;
};
// Un lot appliqué : son identifiant (rendu au panneau), les valeurs d'avant (celles du lot et celles qu'Orca a changées en
// plus), et l'entrée de la mémoire de la machine qu'il a créée (vide sinon), retirée s'il est annulé.
struct UndoEntry
{
    int                     id;
    std::vector<SavedValue> saved;
    std::string             memory_key;
    bool                    print_dropped = false; // ses réglages d'impression sont restés avec un autre projet
};
// Un lot qui ne peut plus être annulé, et pourquoi : le refus d'annulation le dit et propose ses valeurs d'avant.
struct DroppedEntry
{
    int                     id;
    DropReason              reason;
    std::vector<SavedValue> saved;
};
std::vector<UndoEntry>   s_undo_stack;
std::deque<DroppedEntry> s_dropped;
constexpr size_t         MAX_DROPPED    = 20;
int                      s_next_undo_id = 1;

Slic3r::PresetBundle& bundle() { return *Slic3r::GUI::wxGetApp().preset_bundle; }

std::string edited_name(Preset::Type type)
{
    return type == Preset::TYPE_PRINT ? bundle().prints.get_edited_preset().name : bundle().filaments.get_edited_preset().name;
}

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

// Type de plateau en cours : celui de la plaque en cours s'il lui est propre (réglages de plaque), sinon celui du projet.
Slic3r::BedType current_bed_type()
{
    Slic3r::BedType type = Slic3r::btDefault;
    if (Slic3r::GUI::Plater* plater = Slic3r::GUI::wxGetApp().plater())
        if (const Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate())
            type = plate->get_bed_type();
    if (type == Slic3r::btDefault)
        if (auto* opt = bundle().project_config.option<Slic3r::ConfigOptionEnum<Slic3r::BedType>>("curr_bed_type"))
            type = opt->value;
    return type;
}

// Les clés de température de plateau dépendent du type de plateau en cours.
std::string resolve_key(const Param& p)
{
    if (*p.key != '\0')
        return p.key;
    const bool            initial = std::string(p.id) == "bed_temp_initial";
    const Slic3r::BedType type    = current_bed_type();
    std::string key = initial ? Slic3r::get_bed_temp_1st_layer_key(type) : Slic3r::get_bed_temp_key(type);
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

// Configurations lues (celles en cours d'édition).
struct Configs
{
    const DynamicPrintConfig& print;
    const DynamicPrintConfig& filament;
    const DynamicPrintConfig& printer;

    const DynamicPrintConfig& of(Preset::Type type) const { return type == Preset::TYPE_PRINT ? print : filament; }
};

Configs edited_configs()
{
    return {bundle().prints.get_edited_preset().config, bundle().filaments.get_edited_preset().config,
            bundle().printers.get_edited_preset().config};
}

// Lissage calibré (calibration guidée) : quand le filament porte ses propres valeurs de lissage, elles remplacent
// celles du profil d'impression (Fill.cpp) ; le pont lit et modifie alors la clé du filament.
std::optional<std::string> filament_ironing_key(const Param& p, const DynamicPrintConfig& filament)
{
    const std::string id = p.id;
    if (id != "ironing_flow" && id != "ironing_spacing" && id != "ironing_speed")
        return std::nullopt;
    const std::string           key = "filament_" + id;
    const Slic3r::ConfigOption* opt = filament.option(key);
    if (opt == nullptr || !opt->is_vector())
        return std::nullopt;
    const auto* vec = static_cast<const Slic3r::ConfigOptionVectorBase*>(opt);
    return vec->size() > 0 && !vec->is_nil(0) ? std::optional<std::string>(key) : std::nullopt;
}

// Préréglage et clé réellement utilisés pour un paramètre.
std::pair<Preset::Type, std::string> target(const Param& p, const Configs& configs)
{
    if (auto key = filament_ironing_key(p, configs.filament))
        return {Preset::TYPE_FILAMENT, *key};
    return {p.preset, resolve_key(p)};
}

// Valeur textuelle d'un réglage à choix (ex. « no ironing », « tree(auto) »).
std::string enum_value(const Param& p, const Configs& configs)
{
    const Slic3r::ConfigOption* opt = configs.of(p.preset).option(resolve_key(p));
    return opt ? opt->serialize() : std::string();
}

std::string enum_value(const Param& p) { return enum_value(p, edited_configs()); }

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
std::optional<double> current_value(const Param& p, const Configs& configs, std::string* note = nullptr)
{
    const auto [type, key]  = target(p, configs);
    std::optional<double> v = first_value(configs.of(type), key);
    if (!v && key == "filament_retraction_length") {
        v = first_value(configs.printer, "retraction_length");
        if (note)
            *note = "valeur de l'imprimante (pas de surcharge filament)";
    }
    return v;
}

std::optional<double> current_value(const Param& p, std::string* note = nullptr) { return current_value(p, edited_configs(), note); }

// Plage réellement autorisée : la hauteur de couche reste sous 75 % du diamètre de buse (au-delà, Orca refuse de
// découper : « Largeur de ligne trop petite », ou couches mal collées).
double max_of(const Param& p, const Configs& configs)
{
    if (std::string(p.id) == "layer_height")
        if (const std::optional<double> nozzle = first_value(configs.printer, "nozzle_diameter"); nozzle && *nozzle > 0)
            return std::min(p.max, std::floor(*nozzle * 0.75 * 100 + 1e-6) / 100);
    return p.max;
}

// Valeurs de la liste blanche lues dans `configs`, au format envoyé au panneau.
nlohmann::json read_params(const Configs& configs)
{
    nlohmann::json params = nlohmann::json::array();
    for (const Param& p : WHITELIST) {
        std::string           note;
        std::optional<double> v = current_value(p, configs, &note);
        nlohmann::json        item{{"id", p.id}, {"label", p.label}, {"key", target(p, configs).second}, {"unit", p.unit},
                                   {"min", p.min}, {"max", max_of(p, configs)}, {"note", note}};
        if (p.kind == Kind::Enum) {
            item["value"] = enum_value(p, configs);
            // Choix acceptés par apply_changes (le style de support dépend du type de support).
            item["values"] = allowed_values(p.id, enum_value(*find_param("support_type"), configs));
        }
        else if (!v)
            item["value"] = nullptr;
        else if (p.kind == Kind::Bool)
            item["value"] = *v != 0;
        else
            item["value"] = *v;
        params.push_back(item);
    }
    return params;
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

const char* scope_name(Preset::Type type) { return type == Preset::TYPE_PRINT ? "print" : "filament"; }

std::string label_of(const std::string& key)
{
    return ConfigRules::label_of(key, [](const std::string& k) { return Catalog::policy().title(k); });
}


// Valeur à montrer pour un texte d'Orca : typée pour une clé du catalogue (première case d'un tableau), sinon le texte.
nlohmann::json shown_value(Preset::Type type, const std::string& key, const std::string& serialized)
{
    DynamicPrintConfig tmp;
    try {
        tmp.set_deserialize_strict(key, serialized);
    } catch (const std::exception&) {
        return serialized;
    }
    const std::string kind = Catalog::policy().kind(scope_name(type), key);
    if (!kind.empty())
        return typed_value_of(tmp, key, kind);
    const Slic3r::ConfigOption* opt = tmp.option(key);
    if (opt != nullptr && opt->is_vector()) {
        const auto* vec = static_cast<const Slic3r::ConfigOptionVectorBase*>(opt);
        return vec->size() == 0 || vec->is_nil(0) ? nlohmann::json(nullptr) : nlohmann::json(vec->vserialize().front());
    }
    return opt ? nlohmann::json(opt->serialize()) : nlohmann::json(serialized);
}

// Texte d'Orca d'une option (première case d'un tableau), vide si l'option manque ou si la case est vide (« nil »). Lecture seule.
std::string first_text(const DynamicPrintConfig& config, const std::string& key)
{
    const Slic3r::ConfigOption* opt = config.option(key);
    if (opt == nullptr)
        return std::string();
    if (!opt->is_vector())
        return opt->serialize();
    const auto* vec = static_cast<const Slic3r::ConfigOptionVectorBase*>(opt);
    return vec->size() == 0 || vec->is_nil(0) ? std::string() : vec->vserialize().front();
}

// Valeur actuelle d'une clé du catalogue, comme dans le relevé envoyé à l'IA (un « nil » du filament : celle de l'imprimante).
nlohmann::json snapshot_value(Preset::Type type, const std::string& key, const std::string& kind)
{
    nlohmann::json value = typed_value_of(edited_config(type), key, kind);
    if (value.is_null() && key.rfind("filament_", 0) == 0)
        value = typed_value_of(edited_configs().printer, key.substr(9), kind);
    return value;
}

// Valeurs d'avant à proposer une par une quand l'annulation est refusée (« Remettre … à … ») : clés du catalogue seulement.
nlohmann::json restore_offer(const std::vector<SavedValue>& saved)
{
    const Catalog::Policy& policy = Catalog::policy();
    nlohmann::json         out    = nlohmann::json::array();
    std::set<std::string>  seen;
    for (const SavedValue& v : saved) {
        const char* scope = scope_name(v.preset);
        if (!policy.allows(scope, v.key) || !seen.insert(v.key).second)
            continue;
        const nlohmann::json value = shown_value(v.preset, v.key, v.serialized);
        if (value.is_null())
            continue;
        out.push_back({{"key", v.key}, {"scope", scope}, {"label", label_of(v.key)}, {"value", value}});
        if (out.size() >= 8)
            break;
    }
    return out;
}

void drop(UndoEntry entry, std::vector<SavedValue> saved, DropReason reason)
{
    s_dropped.push_back({entry.id, reason, std::move(saved)});
    while (s_dropped.size() > MAX_DROPPED)
        s_dropped.pop_front();
}

const char* const ORCA_DIALOG_TEXT = "Orca attend ta réponse dans une fenêtre ouverte : réponds-y d'abord, puis réessaie. Aucune modification appliquée.";

// Une fenêtre d'Orca est ouverte : écrire maintenant relancerait ses contrôles par-dessus. null si l'écriture est permise.
nlohmann::json orca_dialog_refusal()
{
    if (!AutoSave::modal_open())
        return nullptr;
    return {{"ok", false}, {"text", ORCA_DIALOG_TEXT}, {"code", "orca_dialog"}};
}

std::optional<int> first_int(const DynamicPrintConfig& config, const std::string& key)
{
    const auto* opt = config.option<Slic3r::ConfigOptionInts>(key);
    if (opt == nullptr || opt->values.empty())
        return std::nullopt;
    return opt->get_at(0);
}

// Règles d'Orca sur l'état prévu (`configs` : les configs modifiées par le lot) : refus, ou réglages à ajouter. Les contrôles
// d'un onglet ne tournent que s'il est modifié ; les couples de températures sont ceux qu'Orca vérifie en enregistrant.
ConfigRules::Outcome orca_rules(const std::map<Preset::Type, DynamicPrintConfig>& configs, const std::set<std::string>& requested)
{
    const auto                title    = [](const std::string& k) { return Catalog::policy().title(k); };
    const bool                print    = configs.count(Preset::TYPE_PRINT) > 0;
    const bool                filament = configs.count(Preset::TYPE_FILAMENT) > 0;
    const DynamicPrintConfig& p        = print ? configs.at(Preset::TYPE_PRINT) : edited_config(Preset::TYPE_PRINT);
    const DynamicPrintConfig& f        = filament ? configs.at(Preset::TYPE_FILAMENT) : edited_config(Preset::TYPE_FILAMENT);
    ConfigRules::Values       state;
    for (const std::string& key : ConfigRules::print_keys())
        if (p.option(key) != nullptr)
            state[key] = p.opt_serialize(key);
    for (const std::string& key : ConfigRules::filament_keys())
        if (f.option(key) != nullptr)
            state[key] = f.opt_serialize(key);
    const auto* belt = edited_configs().printer.option<Slic3r::ConfigOptionBool>("belt_printer");
    ConfigRules::Outcome out = ConfigRules::complete(state, requested, print, filament, belt != nullptr && belt->value, title);
    if (!out.ok || !filament)
        return out;
    const std::vector<ConfigRules::PairKeys> keys = AutoSave::temperature_pair_keys();
    std::map<std::string, int>               before, after;
    for (const ConfigRules::PairKeys& k : keys)
        for (const std::string& key : {k.first, k.other}) {
            if (const auto v = first_int(edited_config(Preset::TYPE_FILAMENT), key))
                before[key] = *v;
            if (const auto v = first_int(f, key))
                after[key] = *v;
        }
    const ConfigRules::Outcome pairs = ConfigRules::temperature_pairs(keys, before, after, requested, title);
    if (!pairs.ok)
        return pairs;
    out.added.insert(out.added.end(), pairs.added.begin(), pairs.added.end());
    return out;
}

// Écriture d'un lot, puis relecture. Avant/après comparés sur les deux onglets : toute clé changée entre dans l'annulation
// (`saved`), celles qu'Orca a changées en plus du lot sont rendues (`also`). Une clé du lot qu'Orca a remise ou modifiée
// (ou une exception) : tout ce qui a changé est remis comme avant, et le refus le dit (tout ou rien).
struct Batch
{
    bool                    ok = false;
    std::string             text;
    nlohmann::json          orca_refused = nlohmann::json::array();
    std::vector<SavedValue> saved;
    nlohmann::json          also = nlohmann::json::array();
};

Batch write_batch(const std::map<Preset::Type, DynamicPrintConfig>& configs, const std::vector<std::pair<Preset::Type, std::string>>& planned)
{
    Batch                                      out;
    std::map<Preset::Type, DynamicPrintConfig> before;
    std::map<Preset::Type, std::string>        names;
    for (const Preset::Type type : {Preset::TYPE_PRINT, Preset::TYPE_FILAMENT}) {
        before.emplace(type, edited_config(type));
        names[type] = edited_name(type);
    }
    std::string error;
    try {
        load_into_tabs(configs);
    } catch (const std::exception& e) {
        error = e.what();
    }

    const auto id_of = [](Preset::Type type, const std::string& key) { return std::string(scope_name(type)) + "/" + key; };
    std::map<std::string, std::pair<Preset::Type, std::string>> where;
    std::set<std::string>                                       changed;
    for (const auto& [type, config] : before)
        for (const std::string& key : config.diff(edited_config(type))) {
            changed.insert(id_of(type, key));
            where[id_of(type, key)] = {type, key};
        }
    std::map<std::string, ConfigRules::Written> written;
    for (const auto& [type, key] : planned)
        if (const auto it = configs.find(type); it != configs.end()) {
            written[id_of(type, key)] = {it->second.opt_serialize(key), edited_config(type).opt_serialize(key)};
            where[id_of(type, key)]   = {type, key};
        }
    const ConfigRules::Verdict verdict = ConfigRules::verify(written, changed);

    if (!error.empty() || !verdict.refused.empty()) {
        std::map<Preset::Type, DynamicPrintConfig> back;
        for (const std::string& id : changed) {
            const auto& [type, key] = where[id];
            if (!back.count(type))
                back.emplace(type, edited_config(type));
            if (const Slic3r::ConfigOption* opt = before.at(type).option(key))
                back[type].set_key_value(key, opt->clone());
        }
        try {
            load_into_tabs(back);
        } catch (const std::exception& e) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: réglages d'avant non remis après un refus d'Orca : " << e.what();
        }
        if (!error.empty()) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: erreur d'Orca pendant l'écriture d'un lot : " << error;
            out.text = "Orca a rencontré une erreur en écrivant ces réglages : j'ai tout remis comme avant. Aucune modification appliquée.";
            return out;
        }
        std::string list;
        for (const std::string& id : verdict.refused) {
            const auto& [type, key]          = where[id];
            const ConfigRules::Written& w    = written[id];
            out.orca_refused.push_back({{"key", key}, {"label", label_of(key)}, {"value", shown_value(type, key, w.expected)},
                                        {"orca_value", shown_value(type, key, w.actual)}});
            list += (list.empty() ? "« " : ", « ") + label_of(key) + " »";
        }
        BOOST_LOG_TRIVIAL(warning) << "Plyo: Orca a refusé une partie du lot (" << list << ") : lot défait";
        out.text = "Orca n'a pas accepté " + list + " : j'ai remis tout le lot comme avant. Aucune modification appliquée.";
        return out;
    }
    for (const std::string& id : changed) {
        const auto& [type, key] = where[id];
        out.saved.push_back({type, key, before.at(type).opt_serialize(key), names[type], edited_config(type).opt_serialize(key)});
    }
    for (const std::string& id : verdict.also) {
        const auto& [type, key] = where[id];
        out.also.push_back({{"key", key}, {"scope", scope_name(type)}, {"label", label_of(key)},
                            {"before", shown_value(type, key, before.at(type).opt_serialize(key))},
                            {"after", shown_value(type, key, edited_config(type).opt_serialize(key))}});
    }
    if (!out.also.empty())
        BOOST_LOG_TRIVIAL(info) << "Plyo: Orca a changé " << out.also.size() << " réglage(s) en plus du lot : ajoutés à l'annulation";
    out.ok = true;
    return out;
}

// « Orca a aussi réglé : Parois 3 → 1, … » ajouté au texte d'un lot appliqué ou annulé.
std::string also_text(const nlohmann::json& also)
{
    if (also.empty())
        return std::string();
    const auto show = [](const nlohmann::json& v) {
        return v.is_boolean() ? std::string(v.get<bool>() ? "oui" : "non") : v.is_string() ? v.get<std::string>() : v.is_null() ? std::string("—") : v.dump();
    };
    std::string text;
    for (const nlohmann::json& a : also)
        text += std::string(text.empty() ? "" : ", ") + a.value("label", std::string()) + " " + show(a["before"]) + " → " + show(a["after"]);
    return " Orca a aussi réglé : " + text + ".";
}

// Ce qu'un lot a laissé, tel qu'Orca l'écrit : le panneau retient ainsi les réglages posés par l'assistant pour ce projet et
// ne les présente plus comme des modifications manuelles (comparés au champ `now` de Profiles::manual_edits).
nlohmann::json written_of(const std::vector<SavedValue>& saved)
{
    nlohmann::json out = nlohmann::json::array();
    for (const SavedValue& v : saved)
        out.push_back({{"scope", scope_name(v.preset)}, {"key", v.key}, {"value", v.after}});
    return out;
}

} // namespace

void clear_undo(DropReason reason)
{
    for (UndoEntry& e : s_undo_stack)
        drop(e, e.saved, reason);
    s_undo_stack.clear();
}

void forget_scope(bool print, bool filament, DropReason reason)
{
    std::vector<UndoEntry> kept;
    for (UndoEntry& e : s_undo_stack) {
        const std::vector<SavedValue> all = e.saved;
        std::vector<SavedValue>       left;
        for (const SavedValue& v : e.saved) {
            // Impression oubliée : toutes ses valeurs. Filament oublié : seulement celles qu'il n'a plus (un lot enregistré dans
            // la bobine y est encore, et reste annulable).
            const bool gone = v.preset == Preset::TYPE_PRINT ? print
                                                              : filament && edited_config(Preset::TYPE_FILAMENT).opt_serialize(v.key) != v.after;
            if (!gone)
                left.push_back(v);
            else if (v.preset == Preset::TYPE_PRINT)
                e.print_dropped = true;
        }
        if (left.empty()) {
            drop(e, all, reason);
            continue;
        }
        e.saved = std::move(left);
        kept.push_back(std::move(e));
    }
    s_undo_stack = std::move(kept);
}

nlohmann::json read_values()
{
    const nlohmann::json params = read_params(edited_configs());
    // Noms des préréglages en cours, transmis au service Plyo (type de filament, imprimante).
    nlohmann::json context{{"printer", bundle().printers.get_edited_preset().name},
                                 {"filament", bundle().filaments.get_edited_preset().name},
                                 {"process", bundle().prints.get_edited_preset().name}};
    // Diamètre de buse : l'IA en déduit la hauteur de couche maximale (75 % de la buse).
    if (const std::optional<double> nozzle = first_value(bundle().printers.get_edited_preset().config, "nozzle_diameter"))
        context["nozzle_mm"] = *nozzle;
    return {{"params", params}, {"context", context}, {"can_undo", !s_undo_stack.empty()}};
}

nlohmann::json ai_context()
{
    // Lectures seules des préréglages en cours (filament et imprimante) : rien n'est écrit, la politique d'écriture ne change pas
    // (filament_type et filament_vendor restent interdits à l'écriture).
    const Configs        configs = edited_configs();
    ContextLogic::Raw    raw;
    const Slic3r::BedType type   = current_bed_type();
    if (type != Slic3r::btDefault)
        raw.bed_type = Slic3r::ConfigOptionEnum<Slic3r::BedType>(type).serialize();
    // Les clés que lit vraiment le plateau en cours : celles que résout la liste blanche (même résolution, première couche comprise).
    for (const char* id : {"bed_temp", "bed_temp_initial"})
        if (const Param* p = find_param(id))
            raw.bed_temp_keys.push_back(resolve_key(*p));
    raw.filament_type     = first_text(configs.filament, "filament_type");
    raw.filament_vendor   = first_text(configs.filament, "filament_vendor");
    raw.nozzle_type       = first_text(configs.printer, "nozzle_type");
    raw.extruder_type     = first_text(configs.printer, "extruder_type");
    raw.printer_structure = first_text(configs.printer, "printer_structure");
    return ContextLogic::context_extras(raw);
}

nlohmann::json apply_changes(const nlohmann::json& changes)
{
    if (!changes.is_array() || changes.empty())
        return {{"ok", false}, {"text", "Refusé : aucune modification reçue."}};
    if (const nlohmann::json busy = orca_dialog_refusal(); !busy.is_null())
        return busy;

    struct Planned { const Param* param; std::string key; double value; std::string text; Preset::Type type; };
    std::vector<Planned> planned;

    // Type de support final (demandé dans ce lot, sinon actuel), pour vérifier la cohérence du style.
    std::string support_type = enum_value(*find_param("support_type"));
    for (const nlohmann::json& change : changes)
        if (change.is_object() && Json::str(change, "id") == "support_type" && change.contains("value") && change["value"].is_string())
            support_type = change["value"].get<std::string>();

    // 1. Validation complète avant toute écriture (tout ou rien).
    for (const nlohmann::json& change : changes) {
        const std::string id    = change.is_object() ? Json::str(change, "id") : std::string();
        const Param*      param = find_param(id);
        if (param == nullptr)
            return {{"ok", false}, {"text", "Refusé : ce réglage ne fait pas partie des paramètres modifiables. Aucune modification appliquée."}};

        if (param->kind == Kind::Enum) {
            const std::string text = change.contains("value") && change["value"].is_string() ? change["value"].get<std::string>() : std::string();
            const auto allowed = allowed_values(id, support_type);
            if (std::find(allowed.begin(), allowed.end(), text) == allowed.end())
                return {{"ok", false},
                        {"text", std::string("Refusé : « ") + text + " » n'est pas un choix autorisé pour « " + param->label + " ». Aucune modification appliquée."}};
            planned.push_back({param, resolve_key(*param), 0, text, param->preset});
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
        if (const double max = max_of(*param, edited_configs()); value > max + 1e-9)
            return {{"ok", false},
                    {"text", std::string("Refusé : ") + param->label + " à " + format_number(value, param->kind) + " " + param->unit +
                                 " est trop haute pour ta buse (" + format_number(max, param->kind) + " " + param->unit + " au plus). Aucune modification appliquée."}};

        // Limites du fabricant : refus, sauf si l'utilisateur a coché la ligne lui-même (sortie de plage confirmée).
        const Limits::Verdict verdict = Limits::check(id, value, Limits::current());
        if (verdict != Limits::Verdict::Ok && !(change.contains("confirmed_outside_range") && change["confirmed_outside_range"] == true))
            return {{"ok", false},
                    {"text", std::string("Refusé : ") + param->label + " à " + format_number(value, param->kind) + " " + param->unit +
                                 (verdict == Limits::Verdict::Below ? " est sous" : " est au-dessus de") +
                                 " la plage du fabricant de ton filament. Aucune modification appliquée."}};

        const auto [type, key] = target(*param, edited_configs());
        planned.push_back({param, key, value, to_config_string(value, param->kind), type});
    }

    // 2. Nouvelles configs.
    std::map<Preset::Type, DynamicPrintConfig> configs;
    std::vector<std::pair<Preset::Type, std::string>> keys;
    std::set<std::string>                       requested;
    std::string                                 summary;
    for (const Planned& p : planned) {
        const Preset::Type type = p.type;
        if (!configs.count(type))
            configs.emplace(type, edited_config(type));
        set_value(configs[type], p.key, p.text);
        keys.push_back({type, p.key});
        requested.insert(p.key);
        const std::string shown = p.param->kind == Kind::Enum ? p.text
                                : p.param->kind == Kind::Bool ? (p.value != 0 ? "oui" : "non")
                                                              : format_number(p.value, p.param->kind) + " " + p.param->unit;
        summary += std::string(summary.empty() ? "" : ", ") + p.param->label + " → " + shown;
    }

    // 3. Règles d'Orca : refus avant toute écriture, ou réglages ajoutés (première couche qui suit la température).
    const ConfigRules::Outcome rules = orca_rules(configs, requested);
    if (!rules.ok)
        return {{"ok", false}, {"text", rules.text}, {"code", "orca_rule"}};
    std::string added_text;
    for (const ConfigRules::Added& a : rules.added) {
        const Preset::Type type = a.scope == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
        if (!Catalog::policy().allows(a.scope, a.key) || edited_config(type).option(a.key) == nullptr)
            return {{"ok", false}, {"code", "orca_rule"},
                    {"text", "Refusé : il faudrait aussi changer « " + label_of(a.key) + " » (" + a.why + "), un réglage que l'assistant ne modifie pas. Aucune modification appliquée."}};
        if (const Catalog::CheckResult hard = Catalog::check_hard(label_of(a.key), a.key, {Catalog::policy().kind(a.scope, a.key), {}, {}, {}}, a.value, nullptr, 0); !hard.ok)
            return {{"ok", false}, {"text", hard.text}, {"code", "orca_rule"}};
        if (!configs.count(type))
            configs.emplace(type, edited_config(type));
        set_value(configs[type], a.key, a.serialized);
        keys.push_back({type, a.key});
        added_text += std::string(added_text.empty() ? "" : ", ") + label_of(a.key) + " → " + a.serialized + " (" + a.why + ")";
    }

    // 4. Écriture, relecture, annulation.
    const Batch batch = write_batch(configs, keys);
    if (!batch.ok)
        return {{"ok", false}, {"text", batch.text}, {"code", "orca_refused"}, {"orca_refused", batch.orca_refused}};
    const int id = s_next_undo_id++;
    s_undo_stack.push_back({id, batch.saved, std::string()});
    BOOST_LOG_TRIVIAL(info) << "Plyo: modifications appliquées : " << summary;
    return {{"ok", true}, {"text", "Appliqué : " + summary + "." + (added_text.empty() ? "" : " J'ai aussi réglé : " + added_text + ".") + also_text(batch.also)},
            {"undo_id", id}, {"also_changed", batch.also}, {"written", written_of(batch.saved)}};
}

nlohmann::json typed_value_of(const DynamicPrintConfig& config, const std::string& key, const std::string& kind)
{
    const Slic3r::ConfigOption* opt = config.option(key);
    if (opt == nullptr)
        return nullptr;
    std::string text = opt->serialize();
    if (opt->is_vector()) {
        const auto* vec = static_cast<const Slic3r::ConfigOptionVectorBase*>(opt);
        text            = vec->size() == 0 || vec->is_nil(0) ? std::string("nil") : vec->vserialize().front();
    }
    return Catalog::typed_value(kind, text);
}

void retarget_undo(bool print, const std::string& from, const std::string& to)
{
    const Preset::Type type = print ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
    for (UndoEntry& e : s_undo_stack)
        for (SavedValue& v : e.saved)
            if (v.preset == type && v.preset_name == from)
                v.preset_name = to;
}

nlohmann::json read_snapshot()
{
    const Catalog::Policy& policy   = Catalog::policy();
    nlohmann::json         snapshot = nlohmann::json::object();
    for (const char* scope : {"print", "filament"}) {
        const DynamicPrintConfig& config = edited_config(std::string(scope) == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT);
        for (const std::string& key : policy.keys(scope))
            if (config.option(key) != nullptr)
                // Surcharge du filament « nil » (ex. rétraction) : la valeur qui compte est celle de l'imprimante.
                snapshot[key] = snapshot_value(std::string(scope) == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT, key, policy.kind(scope, key));
    }
    return snapshot;
}

nlohmann::json check_profiles(const std::string& printer_name, const std::string& print_name, const std::string& filament_name)
{
    const bool same = (printer_name.empty() || printer_name == bundle().printers.get_edited_preset().name) &&
                      (print_name.empty() || print_name == edited_name(Preset::TYPE_PRINT)) &&
                      (filament_name.empty() || filament_name == edited_name(Preset::TYPE_FILAMENT));
    if (same)
        return nullptr;
    return {{"ok", false},
            {"text", "Tu as changé d'imprimante ou de profil depuis la proposition : redemande-moi, je regarde les réglages d'aujourd'hui. Aucune modification appliquée."}};
}

void discard_entry(int undo_id)
{
    s_undo_stack.erase(std::remove_if(s_undo_stack.begin(), s_undo_stack.end(), [undo_id](const UndoEntry& e) { return e.id == undo_id; }),
                       s_undo_stack.end());
}

std::map<std::string, std::string> written_values(bool print)
{
    const Preset::Type                 type = print ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
    const std::string                  name = edited_name(type);
    std::map<std::string, std::string> out;
    for (const UndoEntry& e : s_undo_stack)
        for (const SavedValue& v : e.saved)
            if (v.preset == type && v.preset_name == name)
                out[v.key] = v.after; // le lot le plus récent l'emporte (la pile va du plus ancien au plus récent)
    return out;
}

nlohmann::json snapshot_raw()
{
    const Catalog::Policy& policy = Catalog::policy();
    nlohmann::json         out    = {{"print", nlohmann::json::object()}, {"filament", nlohmann::json::object()}};
    for (const char* scope : {"print", "filament"}) {
        const Preset::Type        type   = std::string(scope) == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
        const DynamicPrintConfig& config = edited_config(type);
        for (const std::string& key : policy.keys(scope))
            if (config.option(key) != nullptr)
                out[scope][key] = config.opt_serialize(key);
    }
    return out;
}

nlohmann::json preview_values(const nlohmann::json& values)
{
    // Mêmes règles que restore_values : clés du catalogue présentes dans le profil, et seulement celles qui changeraient.
    const Catalog::Policy& policy = Catalog::policy();
    nlohmann::json         out    = nlohmann::json::array();
    for (const char* scope : {"print", "filament"}) {
        const Preset::Type   type = std::string(scope) == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
        const nlohmann::json one  = Json::obj(values, scope);
        for (const auto& [key, value] : one.items()) {
            if (!value.is_string() || !policy.allows(scope, key) || edited_config(type).option(key) == nullptr)
                continue;
            const std::string now = edited_config(type).opt_serialize(key);
            if (now == value.get<std::string>())
                continue;
            out.push_back({{"key", key}, {"scope", scope}, {"label", label_of(key)}, {"before", shown_value(type, key, now)},
                           {"after", shown_value(type, key, value.get<std::string>())}});
        }
    }
    return out;
}

nlohmann::json restore_values(const nlohmann::json& values)
{
    if (const nlohmann::json busy = orca_dialog_refusal(); !busy.is_null())
        return busy;
    const Catalog::Policy&                            policy = Catalog::policy();
    std::vector<std::pair<Preset::Type, std::string>> keys;
    std::map<Preset::Type, DynamicPrintConfig>        configs;
    for (const char* scope : {"print", "filament"}) {
        const Preset::Type type = std::string(scope) == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
        const nlohmann::json one = Json::obj(values, scope);
        for (const auto& [key, value] : one.items()) {
            if (!value.is_string() || !policy.allows(scope, key) || edited_config(type).option(key) == nullptr)
                continue;
            if (edited_config(type).opt_serialize(key) == value.get<std::string>())
                continue;
            if (!configs.count(type))
                configs.emplace(type, edited_config(type));
            try {
                configs[type].set_deserialize_strict(key, value.get<std::string>());
            } catch (const std::exception&) {
                return {{"ok", false}, {"text", "Je n'ai pas pu relire « " + label_of(key) + " » dans tes réglages réussis : rien n'a été remis."}};
            }
            keys.push_back({type, key});
        }
    }
    if (keys.empty())
        return {{"ok", true}, {"text", "Tes réglages du filament sont déjà ceux de ta dernière impression réussie."}};
    const size_t count = keys.size();
    const Batch  batch = write_batch(configs, keys);
    if (!batch.ok)
        return {{"ok", false}, {"text", batch.text}, {"code", "orca_refused"}, {"orca_refused", batch.orca_refused}};
    const int id = s_next_undo_id++;
    s_undo_stack.push_back({id, batch.saved, std::string()});
    return {{"ok", true},
            {"text", std::to_string(count) + (count > 1 ? " réglages remis" : " réglage remis") + " du filament comme lors de ta dernière impression réussie." + also_text(batch.also)},
            {"undo_id", id}, {"also_changed", batch.also}, {"written", written_of(batch.saved)}};
}

nlohmann::json apply_catalog_changes(const nlohmann::json& changes, const std::string& print_name, const std::string& filament_name)
{
    // `key` : le réglage en cause (le panneau propose « Montre-moi ce réglage ») ; `code` : needs_confirmation (une
    // confirmation suffirait), orca_rule (règle d'Orca), orca_refused (Orca l'a remis après l'écriture), orca_dialog.
    const auto refused = [](const std::string& text, const std::string& code = std::string(), const std::string& key = std::string()) {
        nlohmann::json out{{"ok", false}, {"text", text}};
        if (!code.empty())
            out["code"] = code;
        if (!key.empty())
            out["key"] = key;
        return out;
    };
    if (!changes.is_array() || changes.empty())
        return refused("Refusé : aucune modification reçue.");
    if (const nlohmann::json busy = orca_dialog_refusal(); !busy.is_null())
        return busy;
    // Un autre profil que celui de la proposition : les valeurs d'avant ne seraient plus les bonnes.
    if (print_name != edited_name(Preset::TYPE_PRINT) || filament_name != edited_name(Preset::TYPE_FILAMENT))
        return refused("Tu as changé de profil depuis la proposition : redemande-moi, je regarde les réglages d'aujourd'hui. Aucune modification appliquée.");

    const Catalog::Policy& policy = Catalog::policy();
    const Limits::Range    limits = Limits::current();
    const double           nozzle = first_value(edited_configs().printer, "nozzle_diameter").value_or(0);
    struct Planned { std::string key, label, text, kind; Preset::Type type; nlohmann::json value, before; bool confirmed; std::string why; };
    std::vector<Planned>   planned;

    // Ce que la vérification lit d'Orca pour une clé : définition (type, bornes, valeurs permises) et valeurs actuelles.
    const Catalog::ProbeFn probe = [&policy](const std::string& scope, const std::string& key) -> std::optional<Catalog::Probe> {
        const Preset::Type             type   = scope == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
        const DynamicPrintConfig&      config = edited_config(type);
        const Slic3r::ConfigOptionDef* def    = config.def() ? config.def()->get(key) : nullptr;
        if (def == nullptr || config.option(key) == nullptr)
            return std::nullopt;
        Catalog::OptionInfo info{policy.kind(scope, key), std::nullopt, std::nullopt, def->enum_values};
        if (def->min > -1e9f) info.min = def->min;
        if (def->max < 1e9f) info.max = def->max;
        return Catalog::Probe{info, snapshot_value(type, key, info.kind), typed_value_of(config, key, info.kind)};
    };
    const auto to_planned = [](const Catalog::Planned& c) {
        return Planned{c.key, c.label, c.text, c.kind, c.scope == "print" ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT, c.value, c.before, c.confirmed, ""};
    };
    // Contrôle d'un changement ajouté par une règle d'Orca, comme ceux du lot (Catalog::check_planned). Rend un refus, ou null.
    const auto check = [&](const std::string& key, const std::string& scope, const nlohmann::json& value, const std::string& label,
                           bool confirmed, Planned& out) -> nlohmann::json {
        Catalog::Planned c;
        if (const std::optional<Catalog::Refusal> bad = Catalog::check_planned(policy, probe(scope, key), key, scope, value, label, nozzle, limits, false, confirmed, c))
            return refused(bad->text, bad->code, bad->key);
        out = to_planned(c);
        return nullptr;
    };

    // 1. Validation complète avant toute écriture (tout ou rien) : Catalog::check_lot, testée sans Orca.
    {
        std::vector<Catalog::Planned> checked;
        if (const std::optional<Catalog::Refusal> bad = Catalog::check_lot(policy, changes, probe, label_of, nozzle, limits, checked))
            return refused(bad->text, bad->code, bad->key);
        for (const Catalog::Planned& c : checked)
            planned.push_back(to_planned(c));
    }

    // 2. Règles d'Orca sur l'état prévu : refus, ou réglages ajoutés (contrôlés comme les autres, avec la confirmation du
    // réglage qui les exige).
    std::map<Preset::Type, DynamicPrintConfig> configs;
    std::set<std::string>                      requested;
    for (const Planned& p : planned) {
        if (!configs.count(p.type))
            configs.emplace(p.type, edited_config(p.type));
        set_value(configs[p.type], p.key, p.text);
        requested.insert(p.key);
    }
    const ConfigRules::Outcome rules = orca_rules(configs, requested);
    if (!rules.ok)
        return refused(rules.text, "orca_rule");
    for (const ConfigRules::Added& a : rules.added) {
        const auto trigger = std::find_if(planned.begin(), planned.end(), [&](const Planned& p) { return p.key == a.trigger; });
        if (!policy.allows(a.scope, a.key))
            return refused("Refusé : " + (trigger != planned.end() ? "« " + trigger->label + " »" : std::string("ce lot")) + " demande aussi de changer « " +
                               label_of(a.key) + " » (" + a.why + "), un réglage que l'assistant ne modifie pas. Fais ce changement dans Orca : il te "
                               "proposera de tout régler d'un coup. Aucune modification appliquée.",
                           "orca_rule", a.trigger);
        Planned p;
        const nlohmann::json bad = check(a.key, a.scope, a.value, label_of(a.key), trigger != planned.end() && trigger->confirmed, p);
        if (!bad.is_null())
            return bad;
        p.why = a.why;
        if (!configs.count(p.type))
            configs.emplace(p.type, edited_config(p.type));
        set_value(configs[p.type], p.key, p.text);
        planned.push_back(p);
    }

    // 3. Écriture (le profil est marqué « modifié » ; l'enregistrement vient après), relecture, annulation.
    std::vector<std::pair<Preset::Type, std::string>> keys;
    for (const Planned& p : planned)
        keys.push_back({p.type, p.key});
    const Batch batch = write_batch(configs, keys);
    if (!batch.ok) {
        nlohmann::json out = refused(batch.text, "orca_refused", batch.orca_refused.empty() ? std::string() : batch.orca_refused[0].value("key", std::string()));
        out["orca_refused"] = batch.orca_refused;
        return out;
    }
    nlohmann::json applied = nlohmann::json::array();
    std::string    summary, added;
    for (const Planned& p : planned) {
        nlohmann::json a = {{"id", p.key}, {"label", p.label}, {"before", p.before}, {"after", p.value}};
        if (!p.why.empty()) {
            a["added"] = p.why;
            added += std::string(added.empty() ? "" : ", ") + p.label + " → " + p.text + " (" + p.why + ")";
        } else
            summary += std::string(summary.empty() ? "" : ", ") + p.label + " → " + p.text;
        applied.push_back(a);
    }
    const int id = s_next_undo_id++;
    s_undo_stack.push_back({id, batch.saved, std::string()});
    BOOST_LOG_TRIVIAL(info) << "Plyo: réglages du catalogue appliqués : " << summary << (added.empty() ? "" : " ; ajoutés : " + added);
    return {{"ok", true},
            {"text", "Appliqué : " + summary + "." + (added.empty() ? "" : " J'ai aussi réglé : " + added + ".") + also_text(batch.also)},
            {"undo_id", id}, {"applied", applied}, {"also_changed", batch.also}, {"written", written_of(batch.saved)}};
}

void set_memory_key(int undo_id, const std::string& key)
{
    for (UndoEntry& e : s_undo_stack)
        if (e.id == undo_id)
            e.memory_key = key;
}

nlohmann::json undo_last(int expected_id)
{
    if (const nlohmann::json busy = orca_dialog_refusal(); !busy.is_null())
        return busy;
    const bool known = std::any_of(s_undo_stack.begin(), s_undo_stack.end(), [&](const UndoEntry& e) { return e.id == expected_id; });
    if (s_undo_stack.empty() || (expected_id > 0 && !known)) {
        // Pourquoi il n'est plus là, et ses valeurs d'avant, à remettre une par une si l'utilisateur le veut.
        const auto dropped = std::find_if(s_dropped.rbegin(), s_dropped.rend(), [&](const DroppedEntry& d) { return expected_id > 0 && d.id == expected_id; });
        if (dropped == s_dropped.rend())
            return {{"ok", false}, {"code", "undo_gone"}, {"text", "Ce changement ne peut plus être annulé ici : Plyo a été relancé depuis, ou il est trop ancien."}};
        const char* why = dropped->reason == DropReason::Project      ? "un autre projet a été ouvert dans Orca depuis"
                        : dropped->reason == DropReason::Conversation ? "tu es passé à un autre projet de l'assistant depuis, et ces réglages sont restés avec le précédent"
                        : dropped->reason == DropReason::Import       ? "un fichier a été ouvert depuis, et ses réglages ont remplacé ceux-là"
                        : dropped->reason == DropReason::Calibration  ? "une calibration a remis ses propres réglages depuis"
                                                                      : "tu as changé d'imprimante ou de filament depuis";
        const nlohmann::json offer = restore_offer(dropped->saved);
        return {{"ok", false}, {"code", "undo_gone"}, {"restore", offer},
                {"text", std::string("Ce changement ne peut plus être annulé ici : ") + why + "." +
                             (offer.empty() ? "" : " Je peux remettre les valeurs d'avant, une à une.")}};
    }
    if (expected_id > 0 && s_undo_stack.back().id != expected_id)
        return {{"ok", false}, {"code", "undo_newer"}, {"text", "Un changement plus récent a été appliqué depuis : annule-le d'abord."}};

    // Changement de filament ou de profil depuis : remettre les anciennes valeurs écrirait dans le mauvais préréglage.
    for (const SavedValue& v : s_undo_stack.back().saved)
        if (v.preset_name != edited_name(v.preset)) {
            const nlohmann::json offer = restore_offer(s_undo_stack.back().saved);
            return {{"ok", false}, {"code", "undo_profile"}, {"restore", offer},
                    {"text", "Tu as changé de " + std::string(v.preset == Preset::TYPE_PRINT ? "profil d'impression" : "filament") +
                                 " depuis : je ne peux plus annuler ce lot sans risque." +
                                 (offer.empty() ? std::string() : " Je peux remettre les valeurs d'avant sur « " + edited_name(v.preset) + " », une à une.")}};
        }

    // Un réglage retouché à la main depuis le lot n'est pas écrasé : il est laissé tel quel, et la réponse le dit.
    const UndoEntry                    entry = s_undo_stack.back();
    std::map<std::string, std::string> after, current;
    const auto                         id_of = [](const SavedValue& v) { return std::string(scope_name(v.preset)) + "/" + v.key; };
    for (const SavedValue& v : entry.saved) {
        after[id_of(v)]   = v.after;
        current[id_of(v)] = edited_config(v.preset).opt_serialize(v.key);
    }
    const std::vector<std::string>                    touched = ConfigRules::retouched(after, current);
    std::map<Preset::Type, DynamicPrintConfig>        configs;
    std::vector<std::pair<Preset::Type, std::string>> keys;
    nlohmann::json                                    kept = nlohmann::json::array();
    for (const SavedValue& v : entry.saved) {
        if (std::find(touched.begin(), touched.end(), id_of(v)) != touched.end()) {
            kept.push_back({{"key", v.key}, {"label", label_of(v.key)}, {"value", shown_value(v.preset, v.key, current[id_of(v)])}});
            continue;
        }
        if (!configs.count(v.preset))
            configs.emplace(v.preset, edited_config(v.preset));
        configs[v.preset].set_deserialize_strict(v.key, v.serialized);
        keys.push_back({v.preset, v.key});
    }
    std::string kept_text;
    for (const nlohmann::json& k : kept)
        kept_text += (kept_text.empty() ? "« " : ", « ") + k.value("label", std::string()) + " »";
    const std::string after_text = (kept_text.empty() ? std::string() : " J'ai laissé tels quels les réglages que tu as retouchés depuis : " + kept_text + ".") +
                                   (entry.print_dropped ? " Les réglages d'impression de ce lot sont restés avec le projet d'avant." : "");
    Batch batch;
    batch.ok = true;
    if (!keys.empty()) {
        batch = write_batch(configs, keys);
        if (!batch.ok)
            return {{"ok", false}, {"code", "orca_refused"}, {"orca_refused", batch.orca_refused}, {"text", batch.text}};
    }
    s_undo_stack.pop_back();
    const std::string text = keys.empty() ? "Rien à remettre : tu as retouché ces réglages depuis, je les laisse tels quels."
                                          : "Annulé : valeurs d'avant remises." + after_text + also_text(batch.also);
    return {{"ok", true}, {"text", text}, {"undone_id", entry.id}, {"memory_key", entry.memory_key}, {"kept", kept}, {"also_changed", batch.also}};
}

bool filament_only(const nlohmann::json& changes)
{
    if (!changes.is_array() || changes.empty())
        return false;
    const Catalog::Policy& policy = Catalog::policy();
    for (const nlohmann::json& c : changes) {
        if (!c.is_object())
            return false;
        // Mode catalogue : la portée vient du catalogue (une clé des deux portées compte comme Impression, comme à l'écriture).
        if (c.contains("key")) {
            const std::string key = Json::str(c, "key");
            if (policy.allows("print", key) || !policy.allows("filament", key))
                return false;
            continue;
        }
        const Param* p = find_param(Json::str(c, "id"));
        if (p == nullptr || p->preset != Preset::TYPE_FILAMENT)
            return false;
    }
    return true;
}

nlohmann::json whitelist_range(const std::string& key)
{
    // La température de plateau a une clé par type de plateau (hot_plate_temp, textured_plate_temp…).
    const bool        bed     = key.size() > 10 && key.find("plate_temp") != std::string::npos;
    const std::string bed_id  = key.find("initial_layer") != std::string::npos ? "bed_temp_initial" : "bed_temp";
    for (const Param& p : WHITELIST) {
        if (p.kind == Kind::Bool || p.kind == Kind::Enum)
            continue;
        if (bed ? bed_id == p.id : key == p.key)
            return {{"min", p.min}, {"max", p.max}, {"unit", p.unit}};
    }
    return nullptr;
}

nlohmann::json object_override(const std::string& id, const nlohmann::json& value, DynamicPrintConfig& out)
{
    const Param* param = find_param(id);
    // Une pièce seule ne reçoit que des réglages d'impression : jamais ceux du filament ni de l'imprimante.
    if (param == nullptr || param->preset != Preset::TYPE_PRINT)
        return {{"ok", false}, {"text", "Refusé : " + (param != nullptr ? "« " + std::string(param->label) + " »" : std::string("ce réglage")) + " ne peut pas être réglé pour une seule pièce."}};
    std::string serialized, shown;
    if (param->kind == Kind::Enum) {
        const std::string text    = value.is_string() ? value.get<std::string>() : std::string();
        const auto        allowed = allowed_values(id, enum_value(*find_param("support_type")));
        if (std::find(allowed.begin(), allowed.end(), text) == allowed.end())
            return {{"ok", false}, {"text", "Refusé : « " + text + " » n'est pas un choix possible pour " + param->label + "."}};
        serialized = shown = text;
    } else if (param->kind == Kind::Bool) {
        if (!value.is_boolean())
            return {{"ok", false}, {"text", std::string("Refusé : valeur attendue oui ou non pour ") + param->label + "."}};
        serialized = value.get<bool>() ? "1" : "0";
        shown      = value.get<bool>() ? "oui" : "non";
    } else {
        if (!value.is_number() || value.get<double>() < param->min || value.get<double>() > param->max)
            return {{"ok", false}, {"text", std::string("Refusé : ") + param->label + " doit rester entre " + range_text(*param) + "."}};
        if (value.get<double>() > max_of(*param, edited_configs()) + 1e-9)
            return {{"ok", false}, {"text", std::string("Refusé : ") + param->label + " trop haute pour ta buse."}};
        serialized = to_config_string(value.get<double>(), param->kind);
        shown      = format_number(value.get<double>(), param->kind) + (*param->unit ? std::string(" ") + param->unit : std::string());
    }
    out.set_deserialize_strict(resolve_key(*param), serialized);
    return {{"ok", true}, {"key", resolve_key(*param)}, {"text", std::string(param->label) + " : " + shown}};
}

nlohmann::json spiral_leftovers()
{
    const Catalog::Policy&    policy  = Catalog::policy();
    const DynamicPrintConfig& current = edited_config(Preset::TYPE_PRINT);
    const DynamicPrintConfig& profile = bundle().prints.get_selected_preset().config;
    ConfigRules::Values       now, reference;
    for (const std::string& key : ConfigRules::spiral_keys()) {
        if (current.option(key) != nullptr)
            now[key] = current.opt_serialize(key);
        if (profile.option(key) != nullptr)
            reference[key] = profile.opt_serialize(key);
    }
    // Le dernier lot encore annulable qui a activé le mode vase sur ce profil : ses valeurs d'avant passent en premier.
    for (auto e = s_undo_stack.rbegin(); e != s_undo_stack.rend(); ++e) {
        const auto spiral = std::find_if(e->saved.begin(), e->saved.end(), [](const SavedValue& v) {
            return v.preset == Preset::TYPE_PRINT && v.key == "spiral_mode" && v.after == "1";
        });
        if (spiral == e->saved.end() || spiral->preset_name != edited_name(Preset::TYPE_PRINT))
            continue;
        for (const SavedValue& v : e->saved)
            if (v.preset == Preset::TYPE_PRINT && reference.count(v.key))
                reference[v.key] = v.serialized;
        break;
    }
    nlohmann::json out = nlohmann::json::array();
    for (const auto& [key, text] : ConfigRules::spiral_leftovers(now, reference)) {
        const std::string kind = policy.kind("print", key);
        if (kind.empty())
            continue; // hors catalogue (timelapse, couches de supports forcées) : l'assistant n'y touche pas
        const nlohmann::json value = shown_value(Preset::TYPE_PRINT, key, text);
        if (value.is_null())
            continue;
        out.push_back({{"key", key}, {"label", label_of(key)}, {"value", value}, {"now", typed_value_of(current, key, kind)}});
    }
    return out;
}

}} // namespace Plyo::SettingsBridge
