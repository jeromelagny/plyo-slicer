#include "PlyoPrinterLink.hpp"
#include "PlyoDiscoveryLogic.hpp"
#include "PlyoJson.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/ConfigWizard.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/PhysicalPrinterDialog.hpp"
#include "slic3r/GUI/Tab.hpp"
#include "slic3r/Utils/Http.hpp"
#include "slic3r/Utils/PrintHost.hpp"

#include <boost/log/trivial.hpp>

#include <wx/string.h>

#include <algorithm>
#include <memory>
#include <thread>
#include <vector>

namespace Plyo { namespace PrinterLink {

using Slic3r::GUI::wxGetApp;
using Slic3r::Preset;

namespace {

// L'imprimante envoyée par le panneau, vérifiée : type de connexion connu et adresse du réseau local.
bool read_printer(const nlohmann::json& in, Discovery::Printer& out)
{
    out.ip        = Json::str(in, "ip");
    out.name      = Json::str(in, "name");
    out.brand     = Json::str(in, "brand");
    out.host_type = Json::str(in, "host_type");
    out.host      = Json::str(in, "host");
    return Discovery::allowed_host_type(out.host_type) && Discovery::valid_host(out.host) && Discovery::is_private_ipv4(out.ip);
}

Slic3r::DynamicPrintConfig& edited_printer() { return wxGetApp().preset_bundle->printers.get_edited_preset().config; }

std::string printer_model(const Slic3r::DynamicPrintConfig& config)
{
    return config.has("printer_model") ? config.opt_string("printer_model") : std::string();
}

std::string host_type_of(const Slic3r::DynamicPrintConfig& config)
{
    const auto* opt = config.option<Slic3r::ConfigOptionEnum<Slic3r::PrintHostType>>("host_type");
    if (opt == nullptr)
        return std::string();
    for (const auto& [name, value] : Slic3r::ConfigOptionEnum<Slic3r::PrintHostType>::get_enum_values())
        if (value == int(opt->value))
            return name;
    return std::string();
}

// Les réglages de connexion, prêts pour Tab::load_config (comme une saisie de l'utilisateur).
Slic3r::DynamicPrintConfig connection(const std::string& host_type, const std::string& host, const std::string& webui = std::string())
{
    Slic3r::DynamicPrintConfig c;
    const auto&                values = Slic3r::ConfigOptionEnum<Slic3r::PrintHostType>::get_enum_values();
    c.set_key_value("print_host", new Slic3r::ConfigOptionString(host));
    c.set_key_value("host_type", new Slic3r::ConfigOptionEnum<Slic3r::PrintHostType>(Slic3r::PrintHostType(values.at(host_type))));
    c.set_key_value("print_host_webui", new Slic3r::ConfigOptionString(webui));
    return c;
}

// Page web de l'imprimante pour l'onglet « Appareil » : la racine (Mainsail, Fluidd…) ou le port 4408/4409 des
// Creality (K1, K2…, dont la racine répond 404). Vide si aucune ne répond : Orca se rabat sur l'adresse de connexion.
std::string find_webui(const std::string& ip)
{
    for (const std::string& url : {"http://" + ip + "/", "http://" + ip + ":4408/", "http://" + ip + ":4409/"}) {
        bool ok = false;
        Slic3r::Http::get(url)
            .timeout_connect(2)
            .timeout_max(3)
            .on_complete([&ok](std::string, unsigned status) { ok = status == 200; })
            .on_error([](std::string, std::string, unsigned) {})
            .perform_sync();
        if (ok)
            return url.substr(0, url.size() - 1);
    }
    return std::string();
}

// Une page web acceptée par save() : http:// suivi d'une adresse du réseau local (avec port éventuel).
bool valid_webui(const std::string& webui)
{
    const std::string prefix = "http://";
    return webui.empty() || (webui.rfind(prefix, 0) == 0 && Discovery::valid_host(webui.substr(prefix.size())));
}

} // namespace

nlohmann::json check(const nlohmann::json& in)
{
    Discovery::Printer p;
    if (!read_printer(in, p))
        return {{"ok", false}};
    const Preset&     current = wxGetApp().preset_bundle->printers.get_edited_preset();
    const std::string hint    = Discovery::model_hint(p);
    // Modèle inconnu (« Imprimante Klipper ») : on ne peut pas vérifier, on garde le profil en cours.
    const bool matches = hint.empty() || Discovery::profile_matches(printer_model(current.config), hint);
    const bool linked  = current.config.opt_string("print_host") == p.host && host_type_of(current.config) == p.host_type;

    std::vector<std::string> candidates;
    if (!matches) {
        for (const Preset& preset : wxGetApp().preset_bundle->printers.get_presets())
            if (preset.is_system && preset.is_visible && Discovery::profile_matches(printer_model(preset.config), hint))
                candidates.push_back(preset.name);
        // La buse de 0,4 mm, la plus courante, en premier.
        std::stable_sort(candidates.begin(), candidates.end(), [](const std::string& a, const std::string& b) {
            return (a.find("0.4") != std::string::npos) > (b.find("0.4") != std::string::npos);
        });
        if (candidates.size() > 4)
            candidates.resize(4);
    }
    nlohmann::json list = nlohmann::json::array();
    for (const std::string& c : candidates)
        list.push_back(c);
    return {{"ok", true}, {"current", current.name}, {"matches", matches}, {"linked", linked}, {"candidates", list}};
}

nlohmann::json select_profile(const std::string& name)
{
    const Preset* preset = wxGetApp().preset_bundle->printers.find_preset(name, false);
    if (preset == nullptr || !preset->is_visible)
        return {{"ok", false}};
    Slic3r::GUI::Tab* tab = wxGetApp().get_tab(Preset::TYPE_PRINTER);
    return {{"ok", tab != nullptr && tab->select_preset(name)}};
}

void test(const nlohmann::json& in, std::function<void(nlohmann::json)> done)
{
    Discovery::Printer p;
    if (!read_printer(in, p)) {
        done({{"ok", false}, {"message", "Imprimante invalide."}});
        return;
    }
    // Copie du profil (clés, certificats…) avec la connexion de l'imprimante trouvée : le profil n'est pas touché.
    auto config = std::make_shared<Slic3r::DynamicPrintConfig>(edited_printer());
    config->apply(connection(p.host_type, p.host));
    std::thread([config, done = std::move(done)]() {
        nlohmann::json result;
        try {
            std::unique_ptr<Slic3r::PrintHost> host(Slic3r::PrintHost::get_print_host(config.get()));
            wxString                           message;
            const bool                         ok = host != nullptr && host->test(message);
            result = {{"ok", ok}, {"message", message.utf8_string()}, {"webui", ok ? find_webui(config->opt_string("print_host").substr(0, config->opt_string("print_host").find(':'))) : std::string()}};
        } catch (const std::exception& e) {
            result = {{"ok", false}, {"message", e.what()}};
        }
        wxGetApp().CallAfter([done, result] { done(result); });
    }).detach();
}

nlohmann::json save(const nlohmann::json& in, const std::string& webui)
{
    Discovery::Printer p;
    if (!read_printer(in, p) || !valid_webui(webui))
        return {{"ok", false}};
    Slic3r::GUI::Tab* tab = wxGetApp().get_tab(Preset::TYPE_PRINTER);
    if (tab == nullptr)
        return {{"ok", false}};
    const Preset& current = wxGetApp().preset_bundle->printers.get_edited_preset();
    // Profil à soi : on le met à jour. Profil système (non modifiable) : « Ma <profil> », plus parlant que « - Copie ».
    const std::string name = current.is_system || current.is_default ? "Ma " + current.name : current.name;
    tab->load_config(connection(p.host_type, p.host, webui));
    tab->save_preset(name);
    const bool ok = wxGetApp().preset_bundle->printers.get_edited_preset().name == name;
    BOOST_LOG_TRIVIAL(info) << "Plyo: connexion de l'imprimante enregistrée dans « " << name << " » : " << (ok ? "oui" : "non");
    return {{"ok", ok}, {"profile", name}};
}

nlohmann::json open_dialog(const nlohmann::json& in)
{
    Discovery::Printer p;
    if (!read_printer(in, p))
        return {{"ok", false}, {"saved", false}};
    Slic3r::GUI::Tab* tab = wxGetApp().get_tab(Preset::TYPE_PRINTER);
    if (tab == nullptr)
        return {{"ok", false}, {"saved", false}};
    const Slic3r::DynamicPrintConfig& current = edited_printer();
    const std::string                 old_type = host_type_of(current);
    const Slic3r::DynamicPrintConfig  before   = old_type.empty() ? Slic3r::DynamicPrintConfig() :
                                                     connection(old_type, current.opt_string("print_host"), current.opt_string("print_host_webui"));
    tab->load_config(connection(p.host_type, p.host));
    Slic3r::GUI::PhysicalPrinterDialog dialog(wxGetApp().mainframe);
    const bool                          saved = dialog.ShowModal() == wxID_OK;
    if (!saved && !old_type.empty())
        tab->load_config(before);
    BOOST_LOG_TRIVIAL(info) << "Plyo: connexion de l'imprimante " << (saved ? "enregistrée" : "annulée");
    return {{"ok", true}, {"saved", saved}};
}

void open_printer_wizard() { wxGetApp().run_wizard(Slic3r::GUI::ConfigWizard::RR_USER, Slic3r::GUI::ConfigWizard::SP_PRINTERS); }

}} // namespace Plyo::PrinterLink
