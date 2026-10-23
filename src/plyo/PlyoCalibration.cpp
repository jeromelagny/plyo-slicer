#include "PlyoCalibration.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/Format/STL.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/calib.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Tab.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <algorithm>
#include <cmath>
#include <ctime>
#include <fstream>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

namespace Plyo { namespace Calibration {

namespace fs = boost::filesystem;
using Slic3r::DynamicPrintConfig;
using Slic3r::Preset;

namespace {

const std::string CALIBRATED_SUFFIX = " (calibré Plyo)";

Slic3r::PresetBundle& bundle() { return *Slic3r::GUI::wxGetApp().preset_bundle; }
Slic3r::GUI::Plater*  plater() { return Slic3r::GUI::wxGetApp().plater(); }
fs::path              plyo_dir() { return fs::path(Slic3r::data_dir()) / "plyo"; }

// État de l'utilisateur avant le test : projet (s'il y en avait un) et préréglages, modifications comprises.
struct Snapshot
{
    bool                     has_project = false;
    std::string              printer, print;
    std::vector<std::string> filaments;
    DynamicPrintConfig       printer_config, print_config, filament_config;
};

std::optional<Snapshot> s_before;

bool select(Preset::Type type, const std::string& name)
{
    Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(type);
    return tab != nullptr && tab->select_preset(name, false, "", true);
}

// Sans modifications non enregistrées, Orca ne pose aucune question en changeant de préréglage ou de projet.
void discard_unsaved_changes()
{
    bundle().printers.discard_current_changes();
    bundle().prints.discard_current_changes();
    bundle().filaments.discard_current_changes();
}

std::string printer_name() { return s_before ? s_before->printer : bundle().printers.get_selected_preset_name(); }
std::string filament_name() { return s_before && !s_before->filaments.empty() ? s_before->filaments.front() : bundle().filaments.get_selected_preset_name(); }

// Nom du filament d'origine d'un préréglage calibré (« X — Imprimante (calibré Plyo) » → « X »).
std::string origin_filament(const std::string& name)
{
    const std::string suffix = " — " + printer_name() + CALIBRATED_SUFFIX;
    return name.size() > suffix.size() && name.compare(name.size() - suffix.size(), suffix.size(), suffix) == 0 ? name.substr(0, name.size() - suffix.size()) : name;
}

std::string calibrated_name() { return origin_filament(filament_name()) + " — " + printer_name() + CALIBRATED_SUFFIX; }

// Capture puis projet vide, sans fenêtre : Orca n'a plus de projet ni de préréglage modifié à signaler.
void capture()
{
    if (!s_before) {
        Snapshot snap;
        snap.printer         = bundle().printers.get_selected_preset_name();
        snap.print           = bundle().prints.get_selected_preset_name();
        snap.filaments       = bundle().filament_presets;
        snap.printer_config  = bundle().printers.get_edited_preset().config;
        snap.print_config    = bundle().prints.get_edited_preset().config;
        snap.filament_config = bundle().filaments.get_edited_preset().config;
        if (!plater()->model().objects.empty()) {
            boost::system::error_code ec;
            fs::create_directories(plyo_dir(), ec);
            snap.has_project = plater()->export_3mf_copy(plyo_dir() / "avant-calibration.3mf");
        }
        s_before = std::move(snap);
    }
    discard_unsaved_changes();
    plater()->new_project(true, true);
}

std::string filament_type()
{
    const auto* types = bundle().filaments.get_edited_preset().config.option<Slic3r::ConfigOptionStrings>("filament_type");
    return types != nullptr && !types->values.empty() ? types->values.front() : std::string("PLA");
}

bool direct_drive()
{
    const auto* types = bundle().printers.get_edited_preset().config.option<Slic3r::ConfigOptionEnumsGeneric>("extruder_type");
    return types == nullptr || types->values.empty() || types->values.front() == Slic3r::etDirectDrive;
}

std::string number(double v, int decimals)
{
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out.setf(std::ios::fixed);
    out.precision(decimals);
    out << v;
    std::string s = out.str();
    std::replace(s.begin(), s.end(), '.', ',');
    return s;
}

nlohmann::json section(int index, const std::string& label, double value) { return {{"index", index}, {"label", label}, {"value", value}}; }

// Tour de température : un bloc tous les 5 °C, le plus chaud en bas (Plater::calib_temp).
nlohmann::json temperature_test()
{
    static const std::map<std::string, std::pair<int, int>> ranges{{"PLA", {230, 190}}, {"PETG", {260, 220}}, {"ABS", {270, 230}},
                                                                   {"ASA", {270, 230}}, {"TPU", {240, 200}}, {"PA", {290, 250}},
                                                                   {"PC", {300, 260}}};
    const auto it              = ranges.find(filament_type());
    const auto [start, end]    = it != ranges.end() ? it->second : std::pair<int, int>{230, 190};
    Slic3r::Calib_Params params;
    params.mode  = Slic3r::CalibMode::Calib_Temp_Tower;
    params.start = start;
    params.end   = end;
    plater()->calib_temp(params);
    nlohmann::json sections = nlohmann::json::array();
    for (int t = start, i = 0; t >= end; t -= 5, ++i)
        sections.push_back(section(i, std::to_string(t) + " °C (bloc " + std::to_string(i + 1) + " depuis le bas)", t));
    return {{"sections", sections},
            {"instructions", "Imprime la tour, puis photographie-la de face, bien éclairée, avec les températures lisibles sur le côté."}};
}

// Carrés de débit : chaque objet porte son modificateur dans son nom (Plater::calib_flowrate).
nlohmann::json flow_test(int pass, double base_value)
{
    plater()->calib_flowrate(false, pass);
    auto* ratio = bundle().filaments.get_edited_preset().config.option<Slic3r::ConfigOptionFloats>("filament_flow_ratio");
    if (ratio == nullptr || ratio->values.empty())
        return {{"ok", false}, {"text", "Débit du filament illisible."}};
    // Passe fine : elle s'affine autour du gagnant de la passe 1, posé en mémoire après la création du test.
    if (pass == 2 && base_value > 0) {
        DynamicPrintConfig cfg = bundle().filaments.get_edited_preset().config;
        cfg.option<Slic3r::ConfigOptionFloats>("filament_flow_ratio")->values.assign(ratio->values.size(), base_value);
        if (Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(Preset::TYPE_FILAMENT))
            tab->load_config(cfg);
    }
    const double   base     = pass == 2 && base_value > 0 ? base_value : ratio->values.front();
    nlohmann::json sections = nlohmann::json::array();
    int            i        = 0;
    for (const Slic3r::ModelObject* obj : plater()->model().objects) {
        double mod = 0;
        try {
            mod = std::stod(obj->name);
        } catch (...) {
            continue;
        }
        const double value = std::round(base * (1.0 + mod / 100.0) * 1000.0) / 1000.0;
        sections.push_back(section(i++, "carré « " + obj->name + " » (" + number(value, 3) + ")", value));
    }
    return {{"sections", sections},
            {"instructions", "Imprime les carrés, puis photographie leur dessus en lumière rasante, avec les numéros gravés lisibles."}};
}

// Tour de rétraction : longueur = départ + ⌊z − 0,4⌋ × pas (une bande par millimètre), sans numéros.
nlohmann::json retraction_test()
{
    const bool           dd = direct_drive();
    Slic3r::Calib_Params params;
    params.mode  = Slic3r::CalibMode::Calib_Retraction_tower;
    params.start = 0;
    params.end   = dd ? 2.0 : 6.0;
    params.step  = dd ? 0.1 : 0.3;
    plater()->calib_retraction(params);
    nlohmann::json sections = nlohmann::json::array();
    const int      count    = static_cast<int>(std::lround((params.end - params.start) / params.step));
    for (int i = 0; i <= count; ++i) {
        const double value = std::round((params.start + i * params.step) * 1000.0) / 1000.0;
        sections.push_back(section(i, "bande " + std::to_string(i + 1) + " depuis le bas (" + number(value, 1) + " mm)", value));
    }
    return {{"sections", sections},
            {"instructions", "Imprime la tour, puis photographie-la de près, sur fond sombre, pour bien voir les fils entre les deux piliers. "
                             "Elle n'a pas de numéros : une bande par millimètre de hauteur, en comptant depuis le bas."}};
}

// Motif de pressure advance numéroté (Plater::calib_pa, valeurs par défaut d'Orca selon l'extrudeur).
nlohmann::json pressure_advance_test()
{
    const bool           dd = direct_drive();
    Slic3r::Calib_Params params;
    params.mode          = Slic3r::CalibMode::Calib_PA_Pattern;
    params.start         = 0;
    params.end           = dd ? 0.08 : 1.0;
    params.step          = dd ? 0.005 : 0.05;
    params.print_numbers = true;
    plater()->calib_pa(params);
    nlohmann::json sections = nlohmann::json::array();
    const int      count    = static_cast<int>(std::lround((params.end - params.start) / params.step));
    for (int i = 0; i <= count; ++i) {
        const double value = std::round((params.start + i * params.step) * 10000.0) / 10000.0;
        sections.push_back(section(i, "ligne " + number(value, dd ? 3 : 2), value));
    }
    return {{"sections", sections},
            {"instructions", "Imprime le motif, puis photographie-le de dessus, bien éclairé, avec les numéros lisibles."}};
}

// Plaque de lissage Plyo : 3 × 3 carrés plats, débit en colonnes, espacement en lignes ; languette sur le carré
// en haut à gauche pour orienter la photo. Les surcharges de lissage du filament sont vidées pour le test.
nlohmann::json ironing_test()
{
    const std::vector<double> flows{10, 15, 20};      // %
    const std::vector<double> spacings{0.1, 0.15, 0.2}; // mm
    const double              side = 20, height = 1.2, gap = 6;

    boost::system::error_code ec;
    fs::create_directories(plyo_dir(), ec);
    const fs::path square_path = plyo_dir() / "lissage-carre.stl";
    const fs::path tab_path    = plyo_dir() / "lissage-repere.stl";
    Slic3r::TriangleMesh square(Slic3r::its_make_cube(side, side, height));
    Slic3r::TriangleMesh marker(Slic3r::its_make_cube(side + 8, side, height)); // carré avec languette
    if (!Slic3r::store_stl(square_path.string().c_str(), &square, true) || !Slic3r::store_stl(tab_path.string().c_str(), &marker, true))
        return {{"ok", false}, {"text", "Impossible de préparer la plaque de lissage."}};

    DynamicPrintConfig filament = bundle().filaments.get_edited_preset().config;
    for (const char* key : {"filament_ironing_flow", "filament_ironing_spacing", "filament_ironing_speed", "filament_ironing_inset"})
        filament.set_deserialize_strict(key, "nil");
    if (Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(Preset::TYPE_FILAMENT))
        tab->load_config(filament);

    nlohmann::json      sections = nlohmann::json::array();
    std::vector<size_t> changed;
    int                 index = 0;
    for (size_t row = 0; row < spacings.size(); ++row)
        for (size_t col = 0; col < flows.size(); ++col) {
            const bool first = row == 0 && col == 0;
            plater()->add_model(false, (first ? tab_path : square_path).string());
            Slic3r::ModelObject* obj = plater()->model().objects.back();
            obj->name                = "lissage " + std::to_string(index + 1);
            obj->config.set_key_value("ironing_type", new Slic3r::ConfigOptionEnum<Slic3r::IroningType>(Slic3r::IroningType::TopSurfaces));
            obj->config.set_key_value("ironing_flow", new Slic3r::ConfigOptionPercent(flows[col]));
            obj->config.set_key_value("ironing_spacing", new Slic3r::ConfigOptionFloat(spacings[row]));
            // Rangée 1 en haut (vers l'arrière du plateau), colonne 1 à gauche.
            obj->instances.front()->set_offset(Slic3r::Vec3d(col * (side + gap + 8) + 40, 150 - row * (side + gap), height / 2));
            obj->ensure_on_bed();
            changed.push_back(plater()->model().objects.size() - 1);
            sections.push_back(section(index++, "rangée " + std::to_string(row + 1) + ", colonne " + std::to_string(col + 1) + " (débit " +
                                                    number(flows[col], 0) + " %, espacement " + number(spacings[row], 2) + " mm)",
                                       static_cast<double>(row * flows.size() + col)));
        }
    plater()->changed_objects(changed);
    return {{"sections", sections},
            {"flows", flows},
            {"spacings", spacings},
            {"instructions", "Imprime la plaque, puis photographie-la de dessus en lumière rasante. Le carré avec une languette est en haut à "
                             "gauche : il sert de repère."}};
}

// --- Historique : datadir/plyo/calibrations.json, clé = filament d'origine + imprimante ---

fs::path history_path() { return plyo_dir() / "calibrations.json"; }

nlohmann::json load_history()
{
    std::ifstream        in(history_path().string(), std::ios::binary);
    const nlohmann::json h = in ? nlohmann::json::parse(in, nullptr, false) : nlohmann::json();
    return h.is_object() ? h : nlohmann::json::object();
}

void store_history(const nlohmann::json& history)
{
    const fs::path            path = history_path();
    const fs::path            tmp  = path.string() + ".tmp";
    boost::system::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    {
        std::ofstream out(tmp.string(), std::ios::binary | std::ios::trunc);
        if (!out)
            return;
        out << history.dump(2);
    }
    fs::permissions(tmp, fs::owner_read | fs::owner_write, ec);
    fs::rename(tmp, path, ec);
    if (ec)
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible d'enregistrer l'historique de calibration : " << ec.message();
}

std::string history_key() { return origin_filament(filament_name()) + " | " + printer_name(); }

std::string today()
{
    const std::time_t now = std::time(nullptr);
    char              buf[16];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d", std::localtime(&now));
    return buf;
}

// Valeurs écrites dans le préréglage pour chaque test, avec les plages vérifiées.
struct KeyRange
{
    const char* key;
    double      min, max;
};

std::vector<std::pair<KeyRange, double>> keys_for(const std::string& test, double value, const nlohmann::json& active)
{
    if (test == "temperature")
        return {{{"nozzle_temperature", 170, 300}, value}, {{"nozzle_temperature_initial_layer", 170, 300}, value}};
    if (test == "flow")
        return {{{"filament_flow_ratio", 0.7, 1.3}, value}};
    if (test == "retraction")
        return {{{"filament_retraction_length", 0, 8}, value}};
    if (test == "pressure_advance")
        return {{{"pressure_advance", 0, 1.5}, value}, {{"enable_pressure_advance", 1, 1}, 1}};
    if (test == "ironing" && active.contains("flows") && active.contains("spacings")) {
        // La valeur est l'index du carré : rangée = espacement, colonne = débit.
        const auto   flows    = active["flows"].get<std::vector<double>>();
        const auto   spacings = active["spacings"].get<std::vector<double>>();
        const size_t idx      = static_cast<size_t>(std::lround(value));
        if (flows.empty() || idx >= flows.size() * spacings.size())
            return {};
        return {{{"filament_ironing_flow", 1, 40}, flows[idx % flows.size()]}, {{"filament_ironing_spacing", 0.05, 0.4}, spacings[idx / flows.size()]}};
    }
    return {};
}

nlohmann::json s_active; // test en cours (pour retrouver la grille du lissage)

} // namespace

nlohmann::json start_test(const std::string& test, int pass, double base_value)
{
    static const std::vector<std::string> known{"temperature", "flow", "retraction", "pressure_advance", "ironing"};
    if (std::find(known.begin(), known.end(), test) == known.end())
        return {{"ok", false}, {"text", "Test de calibration inconnu."}};

    capture();
    nlohmann::json result;
    if (test == "temperature")
        result = temperature_test();
    else if (test == "flow")
        result = flow_test(pass == 2 ? 2 : 1, base_value);
    else if (test == "retraction")
        result = retraction_test();
    else if (test == "pressure_advance")
        result = pressure_advance_test();
    else
        result = ironing_test();
    if (result.contains("ok") && !result["ok"].get<bool>())
        return result;
    result["ok"]   = true;
    result["test"] = test;
    result["pass"] = test == "flow" ? (pass == 2 ? 2 : 1) : 1;
    s_active       = result;
    SettingsBridge::clear_undo();
    BOOST_LOG_TRIVIAL(info) << "Plyo: test de calibration lancé (" << test << ")";
    return result;
}

nlohmann::json save_result(const std::string& test, double value)
{
    if (!s_before)
        return {{"ok", false}, {"text", "Aucun test en cours."}};
    const auto keys = keys_for(test, value, s_active);
    if (keys.empty())
        return {{"ok", false}, {"text", "Refusé : valeur de test invalide."}};
    for (const auto& [range, v] : keys)
        if (!(v >= range.min - 1e-9 && v <= range.max + 1e-9))
            return {{"ok", false}, {"text", std::string("Refusé : ") + range.key + " hors des limites de Plyo."}};

    // Base : le préréglage de filament ENREGISTRÉ de l'utilisateur (pas l'édité, qui porte les réglages du test).
    const std::string base_name = filament_name();
    const Preset*     base      = bundle().filaments.find_preset(base_name, false);
    if (base == nullptr)
        return {{"ok", false}, {"text", "Refusé : ton filament d'avant le test est introuvable."}};
    const std::string name = calibrated_name();

    discard_unsaved_changes();
    if (!select(Preset::TYPE_PRINTER, s_before->printer) || !select(Preset::TYPE_FILAMENT, base_name))
        return {{"ok", false}, {"text", "Refusé : impossible de reprendre ton imprimante ou ton filament."}};
    DynamicPrintConfig cfg = bundle().filaments.get_selected_preset().config;
    for (const auto& [range, v] : keys) {
        std::ostringstream text;
        text.imbue(std::locale::classic());
        text << v;
        std::string serialized = text.str();
        if (std::string(range.key) == "filament_ironing_flow")
            serialized += "%";
        if (const auto* opt = cfg.option(range.key); opt != nullptr && opt->is_vector()) {
            const size_t n = std::max<size_t>(1, static_cast<const Slic3r::ConfigOptionVectorBase*>(opt)->size());
            std::string  all = serialized;
            for (size_t i = 1; i < n; ++i)
                all += "," + serialized;
            serialized = all;
        }
        cfg.set_deserialize_strict(range.key, serialized);
    }
    cfg.set_key_value("compatible_printers", new Slic3r::ConfigOptionStrings({s_before->printer}));

    Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(Preset::TYPE_FILAMENT);
    if (tab == nullptr)
        return {{"ok", false}, {"text", "Onglet filament indisponible."}};
    tab->load_config(cfg);
    tab->save_preset(name); // nom fourni : pas de fenêtre ; crée ou met à jour le préréglage calibré

    // « Remettre ma pièce » reprendra le préréglage calibré à la place du filament d'avant.
    if (!s_before->filaments.empty())
        s_before->filaments.front() = name;
    s_before->filament_config = bundle().filaments.get_edited_preset().config;

    nlohmann::json history = load_history();
    nlohmann::json& entry  = history[history_key()];
    entry[test]            = {{"value", value}, {"date", today()}, {"preset", name}};
    if (test == "ironing")
        entry[test]["value"] = keys.front().second; // débit retenu, plus parlant que l'index du carré
    store_history(history);
    BOOST_LOG_TRIVIAL(info) << "Plyo: calibration enregistrée (" << test << ") dans « " << name << " »";
    return {{"ok", true}, {"text", "Enregistré dans « " + name + " »."}};
}

nlohmann::json restore()
{
    if (!s_before)
        return {{"ok", false}, {"text", "Rien à remettre."}};
    const Snapshot snap = *s_before;
    s_before.reset();
    s_active = nullptr;

    discard_unsaved_changes();
    if (snap.has_project)
        plater()->load_project(wxString::FromUTF8((plyo_dir() / "avant-calibration.3mf").string()));
    else
        plater()->new_project(true, true);

    discard_unsaved_changes();
    select(Preset::TYPE_PRINTER, snap.printer);
    select(Preset::TYPE_PRINT, snap.print);
    if (!snap.filaments.empty()) {
        select(Preset::TYPE_FILAMENT, snap.filaments.front());
        for (size_t i = 1; i < snap.filaments.size() && i < bundle().filament_presets.size(); ++i)
            bundle().set_filament_preset(i, snap.filaments[i]);
        plater()->sidebar().update_presets(Preset::TYPE_FILAMENT);
    }
    for (auto [type, config] : {std::pair{Preset::TYPE_PRINTER, &snap.printer_config}, std::pair{Preset::TYPE_PRINT, &snap.print_config},
                                std::pair{Preset::TYPE_FILAMENT, &snap.filament_config}})
        if (Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(type))
            tab->load_config(*config);
    SettingsBridge::clear_undo();
    return {{"ok", true}, {"text", snap.has_project ? "Ta pièce et tes réglages sont de retour." : "Tes réglages sont de retour."}};
}

nlohmann::json history_for_current()
{
    const nlohmann::json history = load_history();
    nlohmann::json       list    = nlohmann::json::array();
    const auto           it      = history.find(history_key());
    if (it != history.end() && it->is_object())
        for (const auto& [test, item] : it->items())
            list.push_back({{"test", test}, {"value", item.value("value", 0.0)}, {"date", item.value("date", std::string())}});
    return list;
}

}} // namespace Plyo::Calibration
