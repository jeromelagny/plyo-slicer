#include "PlyoPrinterSetup.hpp"
#include "PlyoDiscoveryLogic.hpp"
#include "PlyoJson.hpp"
#include "PlyoStore.hpp"

#include "libslic3r/AppConfig.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/I18N.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/UnsavedChangesDialog.hpp"

#include <boost/algorithm/string.hpp>
#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <algorithm>
#include <map>
#include <set>
#include <vector>

namespace Plyo { namespace PrinterSetup {

namespace fs = boost::filesystem;
using Slic3r::GUI::wxGetApp;

namespace {

struct Model
{
    std::string              vendor; // nom du fichier de la marque (« Creality »)
    std::string              name;   // nom du modèle (« Creality K2 »)
    std::vector<std::string> nozzles;
    std::vector<std::string> materials; // filaments installés avec le modèle
};

std::vector<std::string> split(const std::string& list)
{
    std::vector<std::string> out;
    boost::split(out, list, boost::is_any_of(";"));
    for (std::string& s : out)
        boost::trim(s);
    out.erase(std::remove(out.begin(), out.end(), std::string()), out.end());
    return out;
}

// Catalogue lu une fois dans resources/profiles : <Marque>.json liste ses modèles (machine_model_list),
// chaque fichier de modèle donne ses buses et ses filaments par défaut.
const std::vector<Model>& models()
{
    static std::vector<Model> cache;
    static bool               loaded = false;
    if (loaded)
        return cache;
    loaded = true;
    const fs::path            root = fs::path(Slic3r::resources_dir()) / "profiles";
    boost::system::error_code ec;
    for (const fs::directory_entry& entry : fs::directory_iterator(root, ec)) {
        const fs::path& index = entry.path();
        if (index.extension() != ".json")
            continue;
        const nlohmann::json vendor = Store::read(index);
        if (!vendor.is_object() || !vendor.contains("machine_model_list") || !vendor["machine_model_list"].is_array())
            continue;
        const std::string vendor_name = index.stem().string();
        for (const nlohmann::json& item : vendor["machine_model_list"]) {
            const std::string sub = Json::str(item, "sub_path");
            if (sub.empty() || sub.find("..") != std::string::npos)
                continue;
            const nlohmann::json m = Store::read(root / vendor_name / sub);
            if (!m.is_object() || Json::str(m, "machine_tech") != "FFF")
                continue;
            Model model{vendor_name, Json::str(m, "name"), split(Json::str(m, "nozzle_diameter")), split(Json::str(m, "default_materials"))};
            if (!model.name.empty() && !model.nozzles.empty())
                cache.push_back(std::move(model));
        }
    }
    std::sort(cache.begin(), cache.end(), [](const Model& a, const Model& b) { return a.name < b.name; });
    BOOST_LOG_TRIVIAL(info) << "Plyo: catalogue des imprimantes, " << cache.size() << " modèles";
    return cache;
}

const Model* find_model(const std::string& vendor, const std::string& name)
{
    for (const Model& m : models())
        if (m.vendor == vendor && m.name == name)
            return &m;
    return nullptr;
}

nlohmann::json to_json(const Model& m) { return {{"vendor", m.vendor}, {"model", m.name}, {"nozzles", m.nozzles}}; }

} // namespace

bool needs_printer() { return wxGetApp().preset_bundle != nullptr && wxGetApp().preset_bundle->printers.only_default_printers(); }

nlohmann::json catalog()
{
    nlohmann::json out = nlohmann::json::array();
    for (const Model& m : models())
        out.push_back(to_json(m));
    return out;
}

nlohmann::json identify(const nlohmann::json& printer)
{
    Discovery::Printer p;
    p.name                 = Json::str(printer, "name");
    p.brand                = Json::str(printer, "brand");
    const std::string hint = Discovery::model_hint(p);
    if (hint.empty())
        return nullptr;
    for (const Model& m : models())
        if (Discovery::profile_matches(m.name, hint))
            return to_json(m);
    return nullptr;
}

nlohmann::json install(const std::string& vendor, const std::string& name, const std::string& nozzle)
{
    const Model* model = find_model(vendor, name);
    if (model == nullptr || std::find(model->nozzles.begin(), model->nozzles.end(), nozzle) == model->nozzles.end())
        return {{"ok", false}};
    Slic3r::GUI::GUI_App& app    = wxGetApp();
    Slic3r::AppConfig*    config = app.app_config;

    // Comme l'assistant d'Orca : des réglages modifiés et non enregistrés sont gardés ou enregistrés d'abord.
    bool keep_changes = false;
    if (!app.check_and_keep_current_preset_changes(_L("Configuration package changed"), _L("The configuration package is changed in previous Config Guide"),
                                                   Slic3r::GUI::ActionButtons::KEEP | Slic3r::GUI::ActionButtons::SAVE, &keep_changes))
        return {{"ok", false}, {"cancelled", true}};

    // Les imprimantes et filaments déjà installés restent ; on ajoute le modèle choisi et ses filaments par défaut.
    Slic3r::AppConfig::VendorMap vendors = config->vendors();
    vendors[vendor][name].insert(nozzle);
    std::map<std::string, std::string> filaments =
        config->has_section(Slic3r::AppConfig::SECTION_FILAMENTS) ? config->get_section(Slic3r::AppConfig::SECTION_FILAMENTS) : std::map<std::string, std::string>();
    for (const std::string& f : model->materials)
        filaments[f] = "true";

    config->set("firstguide", "finish", true); // l'assistant d'Orca ne se relance plus au démarrage
    if (!app.preset_bundle->apply_vendor_config(vendors, filaments, config, true, name, nozzle)) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: installation de « " << name << " » en échec";
        return {{"ok", false}};
    }
    if (keep_changes)
        app.apply_keeped_preset_modifications();
    config->set_legacy_datadir(false);
    app.update_mode();
    if (Slic3r::GUI::Plater* plater = app.plater())
        plater->normalize_bed_types(false);
    // Fin de l'assistant d'Orca (GUI_App::run_wizard) : listes de profils et barre latérale rafraîchies.
    app.load_current_presets();
    app.update_publish_status();
    if (app.mainframe != nullptr)
        app.mainframe->refresh_plugin_tips();
    config->save();
    const std::string preset = app.preset_bundle->printers.get_selected_preset().name;
    BOOST_LOG_TRIVIAL(info) << "Plyo: imprimante installée « " << name << " » buse " << nozzle << ", profil « " << preset << " »";
    return {{"ok", true}, {"preset", preset}};
}

}} // namespace Plyo::PrinterSetup
