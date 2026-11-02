#include "PlyoProject.hpp"

#include "PlyoFirstSteps.hpp"
#include "PlyoJson.hpp"
#include "PlyoProjectLogic.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Tab.hpp"
#include "slic3r/Utils/PrintHost.hpp"

#include <boost/log/trivial.hpp>

#include <wx/string.h>

#include <algorithm>
#include <memory>
#include <thread>
#include <vector>

namespace Plyo { namespace Project {

using Slic3r::GUI::wxGetApp;
using Slic3r::Preset;

namespace {

Slic3r::PresetBundle& bundle() { return *wxGetApp().preset_bundle; }

// Valeur d'un réglage de la liste de l'assistant (« nozzle_temp », « bed_temp »…), null si illisible.
nlohmann::json param_value(const nlohmann::json& values, const char* id)
{
    const nlohmann::json* params = Json::field(values, "params");
    if (params == nullptr || !params->is_array())
        return nullptr;
    for (const nlohmann::json& p : *params)
        if (Json::str(p, "id") == id && p.contains("value"))
            return p["value"];
    return nullptr;
}

bool select(Preset::Type type, const std::string& name)
{
    Slic3r::GUI::Tab* tab = wxGetApp().get_tab(type);
    return tab != nullptr && tab->select_preset(name, false, "", true);
}

} // namespace

nlohmann::json state()
{
    const nlohmann::json values = SettingsBridge::read_values();
    const nlohmann::json* ctx   = Json::field(values, "context");
    const nlohmann::json  none  = nlohmann::json::object();
    return {{"printer_preset", Json::str(ctx != nullptr ? *ctx : none, "printer")},
            {"filament_preset", Json::str(ctx != nullptr ? *ctx : none, "filament")},
            {"nozzle_temp", param_value(values, "nozzle_temp")},
            {"bed_temp", param_value(values, "bed_temp")}};
}

nlohmann::json printers()
{
    nlohmann::json out = nlohmann::json::array();
    for (const Preset& preset : bundle().printers.get_presets()) {
        if (!preset.is_visible || preset.is_default)
            continue;
        const bool linked = preset.config.has("print_host") && !preset.config.opt_string("print_host").empty();
        out.push_back({{"preset", preset.name}, {"name", preset.name}, {"linked", linked}});
    }
    return out;
}

void reachable(const std::string& preset, std::function<void(bool)> done)
{
    const Preset* p = bundle().printers.find_preset(preset, false);
    if (p == nullptr || !p->config.has("print_host") || p->config.opt_string("print_host").empty()) {
        done(false);
        return;
    }
    // Copie du profil : le test se fait hors du fil principal, sans toucher aux profils d'Orca.
    auto config = std::make_shared<Slic3r::DynamicPrintConfig>(p->config);
    std::thread([config, done = std::move(done)]() {
        bool ok = false;
        try {
            std::unique_ptr<Slic3r::PrintHost> host(Slic3r::PrintHost::get_print_host(config.get()));
            wxString                           message;
            ok = host != nullptr && host->test(message);
        } catch (const std::exception& e) {
            BOOST_LOG_TRIVIAL(info) << "Plyo: imprimante injoignable : " << e.what();
        }
        wxGetApp().CallAfter([done, ok] { done(ok); });
    }).detach();
}

nlohmann::json restore(const nlohmann::json& project, bool discard_unsaved)
{
    const std::vector<std::string> todo = ProjectLogic::missing(project);
    if (!todo.empty() && (std::find(todo.begin(), todo.end(), "printer") != todo.end() || std::find(todo.begin(), todo.end(), "filament") != todo.end()))
        return {{"ok", false}, {"text", "Le projet n'a pas encore d'imprimante ou de filament."}};

    const std::string printer  = Json::str(*Json::field(project, "printer"), "preset");
    const std::string filament = Json::str(*Json::field(project, "filament"), "preset");
    if (bundle().printers.find_preset(printer, false) == nullptr)
        return {{"ok", false}, {"text", "L'imprimante de ce projet n'existe plus dans Orca. Choisis-en une dans la fiche."}};
    if (bundle().filaments.find_preset(filament, false) == nullptr)
        return {{"ok", false}, {"text", "Le filament de ce projet n'existe plus dans Orca. Choisis-le à nouveau dans la fiche."}};

    const nlohmann::json now      = state();
    const bool           changing = Json::str(now, "printer_preset") != printer || Json::str(now, "filament_preset") != filament;
    const bool           dirty    = bundle().printers.current_is_dirty() || bundle().prints.current_is_dirty() || bundle().filaments.current_is_dirty();
    if (changing && dirty && !discard_unsaved)
        return {{"ok", false}, {"needs_confirmation", true}, {"text", "Tu as des réglages non enregistrés dans Orca."}};

    if (changing) {
        // Sans modifications non enregistrées, Orca ne pose aucune question en changeant de profil.
        bundle().printers.discard_current_changes();
        bundle().prints.discard_current_changes();
        bundle().filaments.discard_current_changes();
        SettingsBridge::clear_undo(); // ses entrées viseraient les anciens profils
        if (Json::str(now, "printer_preset") != printer && !select(Preset::TYPE_PRINTER, printer))
            return {{"ok", false}, {"text", "Je n'ai pas pu sélectionner l'imprimante de ce projet."}};
        if (Json::str(state(), "filament_preset") != filament)
            FirstSteps::select_filament(filament);
    }

    // Températures de la fiche, seulement si elles diffèrent de celles du profil (un lot annulable par Plyo).
    const nlohmann::json after = state();
    const nlohmann::json& f    = *Json::field(project, "filament");
    nlohmann::json        changes = nlohmann::json::array();
    auto add = [&](const char* id, const char* initial, const char* field_name, const nlohmann::json& current) {
        if (!f.contains(field_name) || !f[field_name].is_number())
            return;
        if (current.is_number() && current.get<double>() == f[field_name].get<double>())
            return;
        changes.push_back({{"id", id}, {"value", f[field_name]}});
        changes.push_back({{"id", initial}, {"value", f[field_name]}});
    };
    add("nozzle_temp", "nozzle_temp_initial", "nozzle_temp", after["nozzle_temp"]);
    add("bed_temp", "bed_temp_initial", "bed_temp", after["bed_temp"]);
    if (!changes.empty()) {
        const nlohmann::json applied = SettingsBridge::apply_changes(changes);
        if (!Json::boolean(applied, "ok", false))
            return {{"ok", false}, {"text", Json::str(applied, "text")}};
    }
    return {{"ok", true}, {"text", "Projet remis dans Orca."}};
}

}} // namespace Plyo::Project
