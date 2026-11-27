#include "PlyoBrands.hpp"
#include "PlyoBrandsLogic.hpp"
#include "PlyoCanvasLogic.hpp"
#include "PlyoFirstSteps.hpp"

#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"

#include <boost/log/trivial.hpp>

#include <vector>

namespace Plyo { namespace Brands {

using Slic3r::Preset;
using Slic3r::GUI::wxGetApp;

namespace {

std::string first_text(const Slic3r::DynamicPrintConfig& config, const char* key)
{
    const auto* opt = config.option<Slic3r::ConfigOptionStrings>(key);
    return opt != nullptr && !opt->values.empty() ? opt->values.front() : std::string();
}

} // namespace

nlohmann::json groups(const std::string& material)
{
    Slic3r::PresetBundle* bundle = wxGetApp().preset_bundle;
    if (bundle == nullptr || material.empty())
        return nlohmann::json::array();
    // Marque de l'imprimante : celle de son paquet de profils (un profil copié par l'utilisateur la tient de son parent).
    const Slic3r::VendorProfile*        printer_vendor = bundle->printers.get_edited_preset_with_vendor_profile().vendor;
    std::vector<BrandsLogic::Candidate> list;
    for (const Preset& p : bundle->filaments.get_presets()) {
        // Mêmes conditions que FirstSteps::best_filament (compatible, pas le préréglage par défaut, même matière), plus : un
        // profil fourni seulement. Pas de condition de visibilité : les profils de marque ne sont souvent pas cochés.
        if (!p.is_system || p.is_default || !p.is_compatible || first_text(p.config, "filament_type") != material)
            continue;
        BrandsLogic::Candidate c;
        c.preset         = p.name;
        c.vendor         = first_text(p.config, "filament_vendor");
        c.printer_bundle = printer_vendor != nullptr && p.vendor == printer_vendor;
        list.push_back(c);
    }
    return BrandsLogic::group(list, printer_vendor != nullptr ? printer_vendor->name : std::string());
}

nlohmann::json for_type(const std::string& type)
{
    for (const std::string& candidate : CanvasLogic::profile_types(type))
        if (!FirstSteps::best_filament(candidate).empty())
            return {{"material", candidate}, {"brands", groups(candidate)}};
    return {{"material", ""}, {"brands", nlohmann::json::array()}};
}

nlohmann::json check(const std::string& material, const std::string& preset)
{
    return BrandsLogic::find(groups(material), preset);
}

bool is_current_printer(const std::string& printer_preset)
{
    const Slic3r::PresetBundle* bundle = wxGetApp().preset_bundle;
    return bundle != nullptr && !printer_preset.empty() && printer_preset == bundle->printers.get_selected_preset_name();
}

void keep_visible(const std::string& preset)
{
    Slic3r::PresetBundle* bundle = wxGetApp().preset_bundle;
    Slic3r::AppConfig*    config = wxGetApp().app_config;
    if (bundle == nullptr || config == nullptr)
        return;
    Preset* p = bundle->filaments.find_preset(preset, false);
    if (p == nullptr || !p->is_system)
        return;
    // Comme PresetBundle::load_installed_filaments : « true » dans la section des filaments installés.
    if (config->get(Slic3r::AppConfig::SECTION_FILAMENTS, preset).empty()) {
        config->set(Slic3r::AppConfig::SECTION_FILAMENTS, preset, "true");
        BOOST_LOG_TRIVIAL(info) << "Plyo: profil de marque « " << preset << " » coché comme installé";
    }
    p->is_visible = true;
}

}} // namespace Plyo::Brands
