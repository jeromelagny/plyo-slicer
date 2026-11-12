#include "PlyoProject.hpp"
#include "PlyoAutoSave.hpp"

#include "PlyoCanvas.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoJson.hpp"
#include "PlyoProjectLogic.hpp"
#include "PlyoProfiles.hpp"
#include "PlyoProjectFiles.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/miniz_extension.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Tab.hpp"
#include "slic3r/Utils/PrintHost.hpp"

#include <boost/log/trivial.hpp>

#include <wx/string.h>

#include <algorithm>
#include <cmath>
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

// Réglages du projet 3MF ({clé: texte ou liste}) ; objet vide si le fichier n'en a pas ou est illisible.
nlohmann::json read_3mf_settings(const std::string& path_utf8)
{
    constexpr size_t MAX_SETTINGS_BYTES = 8 * 1024 * 1024;
    mz_zip_archive   zip;
    mz_zip_zero_struct(&zip);
    if (!Slic3r::open_zip_reader(&zip, path_utf8))
        return nlohmann::json::object();
    nlohmann::json out = nlohmann::json::object();
    // Taille lue avant d'extraire : un 3MF piégé ne doit pas remplir la mémoire. miniz alloue d'après cette taille annoncée et
    // échoue si le contenu réel la dépasse.
    const int                index = mz_zip_reader_locate_file(&zip, "Metadata/project_settings.config", nullptr, 0);
    mz_zip_archive_file_stat stat;
    if (index >= 0 && mz_zip_reader_file_stat(&zip, static_cast<mz_uint>(index), &stat) && stat.m_uncomp_size <= MAX_SETTINGS_BYTES) {
        size_t size = 0;
        if (void* data = mz_zip_reader_extract_to_heap(&zip, static_cast<mz_uint>(index), &size, 0)) {
            const nlohmann::json parsed = nlohmann::json::parse(static_cast<const char*>(data), static_cast<const char*>(data) + size, nullptr, false);
            if (parsed.is_object())
                out = parsed;
            mz_free(data);
        }
    }
    Slic3r::close_zip_reader(&zip);
    return out;
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
        nlohmann::json item = {{"preset", preset.name}, {"name", preset.name}, {"linked", linked},
                               {"host", linked ? preset.config.opt_string("print_host") : std::string()}};
        // Traducteur des emplacements (canvas, cfs, ifs, u1) : l'étape Filament propose alors de les lire.
        std::string slots_reason;
        if (const std::string slots = Canvas::translator_of(preset.config, &slots_reason); !slots.empty())
            item["slots"] = slots;
        if (!slots_reason.empty())
            item["slots_reason"] = slots_reason;
        // Taille du plateau (mm) : sert à dire sur quelle machine une pièce tient.
        if (const auto* area = preset.config.option<Slic3r::ConfigOptionPoints>("printable_area"); area != nullptr && !area->values.empty()) {
            double x0 = area->values.front().x(), x1 = x0, y0 = area->values.front().y(), y1 = y0;
            for (const auto& pt : area->values) {
                x0 = std::min(x0, pt.x()); x1 = std::max(x1, pt.x());
                y0 = std::min(y0, pt.y()); y1 = std::max(y1, pt.y());
            }
            item["bed_mm"] = {std::round(x1 - x0), std::round(y1 - y0)};
            if (const auto* height = preset.config.option<Slic3r::ConfigOptionFloat>("printable_height"))
                item["bed_mm"].push_back(std::round(height->value)); // une pièce trop haute ne tient pas non plus
        }
        out.push_back(item);
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
    // La machine suffit (le projet peut être arrêté avant le choix du filament) ; le filament est remis s'il est déjà choisi.
    if (std::find(todo.begin(), todo.end(), "printer") != todo.end())
        return {{"ok", false}, {"text", "Le projet n'a pas encore d'imprimante."}};
    const bool has_filament = std::find(todo.begin(), todo.end(), "filament") == todo.end();

    const std::string printer  = Json::str(*Json::field(project, "printer"), "preset");
    const std::string filament = has_filament ? Json::str(*Json::field(project, "filament"), "preset") : std::string();
    if (bundle().printers.find_preset(printer, false) == nullptr)
        return {{"ok", false}, {"text", "L'imprimante de ce projet n'existe plus dans Orca. Choisis-en une dans la fiche."}};

    const nlohmann::json now      = state();
    const bool           changing = Json::str(now, "printer_preset") != printer || (has_filament && !ProjectLogic::same_filament(filament, Json::str(now, "filament_preset")));
    // Réglages d'impression d'un plateau de conversation : ce sont ceux de la pièce. Un changement de filament ne les touche
    // pas ; un changement de machine les vide, et cela se demande comme pour tout réglage non enregistré.
    const bool           printer_changing = Json::str(now, "printer_preset") != printer;
    // La bobine en cours est écrite d'abord : ses réglages ne comptent plus comme « non enregistrés », et ne sont jamais
    // jetés par « Les abandonner ». Si elle ne peut pas l'être maintenant, rien ne change.
    if (changing && AutoSave::flush_spool() == SpoolsLogic::Flush::Refuse)
        return {{"ok", false}, {"text", SpoolsLogic::FLUSH_REFUSED_TEXT}};
    const bool           keep_prints      = ProjectFiles::owns_print_edits() && !printer_changing;
    const bool           dirty    = bundle().printers.current_is_dirty() || (bundle().prints.current_is_dirty() && !keep_prints) || bundle().filaments.current_is_dirty();
    if (changing && dirty && !discard_unsaved)
        return {{"ok", false}, {"needs_confirmation", true}, {"text", "Tu as des réglages non enregistrés dans Orca."}};

    if (changing) {
        // Sans modifications non enregistrées, Orca ne pose aucune question en changeant de profil.
        bundle().printers.discard_current_changes();
        if (!keep_prints)
            bundle().prints.discard_current_changes();
        bundle().filaments.discard_current_changes();
        SettingsBridge::clear_undo(SettingsBridge::DropReason::Profile); // ses entrées viseraient les anciens profils
        // L'imprimante d'abord : même si le filament a disparu, Orca revient sur la machine du projet.
        if (Json::str(now, "printer_preset") != printer && !select(Preset::TYPE_PRINTER, printer))
            return {{"ok", false}, {"text", "Je n'ai pas pu sélectionner l'imprimante de ce projet."}};
        if (has_filament) {
            if (bundle().filaments.find_preset(filament, false) == nullptr)
                return {{"ok", false}, {"text", "Le filament de ce projet n'existe plus dans Orca. Choisis-le à nouveau dans la fiche."}};
            if (!ProjectLogic::same_filament(filament, Json::str(state(), "filament_preset")))
                FirstSteps::select_filament(filament);
            if (!ProjectLogic::same_filament(filament, Json::str(state(), "filament_preset")))
                return {{"ok", false}, {"text", "Je n'ai pas pu sélectionner le filament de ce projet."}};
        }
    }

    // Couleurs 2 et suivantes choisies par les emplacements du Canvas.
    if (has_filament)
        Canvas::select_extra(ProjectLogic::extra_filaments(project));

    // Températures de la fiche, seulement si elles diffèrent de celles du profil (un lot annulable par Plyo).
    if (!has_filament)
        return {{"ok", true}, {"text", "Machine du projet remise dans Orca."}};
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

nlohmann::json adapt_file(const std::string& path_utf8, const nlohmann::json& project)
{
    const std::vector<std::string> todo = ProjectLogic::missing(project);
    if (std::find(todo.begin(), todo.end(), "printer") != todo.end() || std::find(todo.begin(), todo.end(), "filament") != todo.end())
        return nlohmann::json::object();
    // Orca doit être sur l'imprimante et le filament du projet : sinon les réglages iraient dans le profil d'un autre projet.
    const nlohmann::json now = state();
    if (const std::string refused = ProjectLogic::edit_refusal(project, Json::str(now, "printer_preset"), Json::str(now, "filament_preset")); !refused.empty())
        return {{"adapted", nlohmann::json::array()}, {"dropped", nlohmann::json::array()}, {"undo_id", 0}, {"error", refused}};
    const nlohmann::json flat = ProjectLogic::first_values(read_3mf_settings(path_utf8));
    if (flat.empty())
        return nlohmann::json::object();

    const Catalog::Policy&            policy = Catalog::policy();
    const Slic3r::DynamicPrintConfig& config = bundle().prints.get_edited_preset().config;
    nlohmann::json                    file_values = nlohmann::json::object();
    for (auto it = flat.begin(); it != flat.end(); ++it) {
        if (!policy.allows("print", it.key()))
            continue; // le filament est celui de la fiche, l'imprimante et le G-code ne sont pas à l'assistant
        const nlohmann::json typed = Catalog::typed_value(policy.kind("print", it.key()), it.value().get<std::string>());
        if (!typed.is_null())
            file_values[it.key()] = typed;
    }
    auto range_of = [&](const std::string& key) -> nlohmann::json {
        const Slic3r::ConfigOptionDef* def = config.def() ? config.def()->get(key) : nullptr;
        if (def == nullptr || config.option(key) == nullptr)
            return nullptr;
        nlohmann::json range = nlohmann::json::object();
        if (def->min > -1e9f)
            range["min"] = def->min;
        if (def->max < 1e9f)
            range["max"] = def->max;
        return range;
    };
    const ProjectLogic::Adaptation plan = ProjectLogic::adapt_3mf(file_values, project, range_of);

    nlohmann::json dropped = nlohmann::json::array();
    for (const nlohmann::json& d : plan.dropped) {
        const std::string label = policy.title(d["key"].get<std::string>());
        dropped.push_back({{"label", label.empty() ? d["key"] : nlohmann::json(label)}, {"reason", d["reason"]}});
    }
    nlohmann::json changes = nlohmann::json::array();
    for (const nlohmann::json& c : plan.apply) {
        const std::string key = c["key"].get<std::string>();
        if (!policy.allows("print", key))
            continue; // les températures sont déjà celles de la fiche (filament)
        if (SettingsBridge::typed_value_of(config, key, policy.kind("print", key)) == c["value"])
            continue; // déjà la bonne valeur : rien à signaler
        // Valeurs du fichier que l'utilisateur a choisi lui-même : confirmées par ce choix (écart et réglage sensible) ; les
        // bornes strictes et les règles d'Orca restent vérifiées par apply_catalog_changes.
        changes.push_back({{"key", key}, {"value", c["value"]}, {"label", policy.title(key)}, {"confirmed", true}});
    }
    nlohmann::json out = {{"adapted", nlohmann::json::array()}, {"dropped", dropped}, {"undo_id", 0}};
    if (changes.empty())
        return out;

    nlohmann::json result = SettingsBridge::apply_catalog_changes(changes, bundle().prints.get_edited_preset().name, bundle().filaments.get_edited_preset().name);
    if (!Json::boolean(result, "ok", false)) {
        out["error"] = Json::str(result, "text"); // tout ou rien : aucun réglage du fichier n'a été appliqué
        return out;
    }
    const nlohmann::json saved = Profiles::save_applied(); // comme pour les réglages de l'assistant : le profil modifié est enregistré
    out["saved"]               = saved["saved"]; // le panneau suit un éventuel renommage « (Plyo) » du filament
    for (const nlohmann::json& a : Json::arr(result, "applied"))
        out["adapted"].push_back({{"label", a["label"]}, {"before", a["before"]}, {"after", a["after"]}});
    out["undo_id"] = Json::integer(result, "undo_id", 0);
    return out;
}

}} // namespace Plyo::Project
