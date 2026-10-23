#include "PlyoMakerWorldImport.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/Model.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/DownloaderFileGet.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Tab.hpp"

#include <boost/log/trivial.hpp>
#include <boost/regex.hpp>

#include <optional>
#include <string>
#include <vector>

namespace Plyo { namespace MakerWorldImport {

using Slic3r::DynamicPrintConfig;
using Slic3r::Preset;

namespace {

Slic3r::PresetBundle& bundle() { return *Slic3r::GUI::wxGetApp().preset_bundle; }

// Préréglages sélectionnés (noms) ; avec les configurations éditées pour la capture du créateur.
struct Selection
{
    std::string              printer;
    std::string              print;
    std::vector<std::string> filaments;
};

struct CreatorCapture
{
    Selection          names;
    DynamicPrintConfig printer, print, filament;
};

Selection                     s_mine;    // profil de l'utilisateur, noté avant l'import
std::optional<CreatorCapture> s_creator; // réglages du créateur, capturés après l'import

Selection current_selection()
{
    return {bundle().printers.get_selected_preset_name(), bundle().prints.get_selected_preset_name(), bundle().filament_presets};
}

// Lien de téléchargement transmis à Orca, préparé comme dans Downloader::start_download (Downloader.cpp:161-176).
std::optional<std::string> download_info(const std::string& open_url)
{
    static const boost::regex re(R"(^(orcaslicer|prusaslicer|bambustudio|cura):\/\/open[\/]?\?file=)", boost::regbase::icase);
    static const boost::regex re2(R"(^(bambustudioopen):\/\/)", boost::regex::icase);
    boost::smatch results;
    if (!boost::regex_search(open_url, results, re) && !boost::regex_search(open_url, results, re2))
        return std::nullopt;
    return Slic3r::GUI::FileGet::escape_url(open_url.substr(results.length()));
}

// Abandonne les modifications non enregistrées des trois préréglages : sans cela, Tab::select_preset ouvre la
// fenêtre « modifications non enregistrées » (transférer / enregistrer) même avec force_select (Tab.cpp:7363).
// Les réglages du créateur restent capturés dans s_creator pour Annuler.
void discard_unsaved_changes()
{
    bundle().printers.discard_current_changes();
    bundle().prints.discard_current_changes();
    bundle().filaments.discard_current_changes();
}

bool select(Preset::Type type, const std::string& name)
{
    Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(type);
    return tab != nullptr && tab->select_preset(name, false, "", true);
}

// Emplacements de filament : le premier par l'onglet (préréglage édité), les suivants dans le projet.
void set_filament_slots(const std::vector<std::string>& names)
{
    if (names.empty())
        return;
    select(Preset::TYPE_FILAMENT, names.front());
    for (size_t idx = 1; idx < names.size() && idx < bundle().filament_presets.size(); ++idx)
        bundle().set_filament_preset(idx, names[idx]);
    Slic3r::GUI::Plater* plater = Slic3r::GUI::wxGetApp().plater();
    plater->sidebar().update_presets(Preset::TYPE_FILAMENT);
    plater->sidebar().update_dynamic_filament_list();
    for (size_t idx = 0; idx < bundle().filament_presets.size(); ++idx)
        plater->on_filament_change(idx);
    plater->update_project_dirty_from_presets();
}

bool printer_can_change_colour(const DynamicPrintConfig& printer)
{
    const auto* nozzles = printer.option<Slic3r::ConfigOptionFloats>("nozzle_diameter");
    const auto* semm    = printer.option<Slic3r::ConfigOptionBool>("single_extruder_multi_material");
    return (nozzles != nullptr && nozzles->values.size() > 1) || (semm != nullptr && semm->value);
}

const Preset* find(Slic3r::PresetCollection& collection, const std::string& name) { return collection.find_preset(name, false); }

} // namespace

nlohmann::json import_link(const std::string& open_url)
{
    const std::optional<std::string> info = download_info(open_url);
    if (!info)
        return nullptr;

    const Selection before = current_selection();
    // Si l'on est encore sur les réglages d'un import précédent, « mon profil » reste celui noté avant cet import.
    const bool      still_on_previous_creator = s_creator && before.printer == s_creator->names.printer &&
                                           before.print == s_creator->names.print && before.filaments == s_creator->names.filaments;
    const Selection mine = still_on_previous_creator ? s_mine : before;
    const bool      dirty_before = bundle().printers.current_is_dirty() || bundle().prints.current_is_dirty() || bundle().filaments.current_is_dirty();

    Slic3r::GUI::Plater* plater = Slic3r::GUI::wxGetApp().plater();
    plater->import_model_id(wxString::FromUTF8(*info)); // synchrone : téléchargement puis ouverture du projet

    // Succès : un plateau non vide et des réglages de projet chargés (préréglage changé ou modifié).
    const Selection after       = current_selection();
    const bool      dirty_after = bundle().printers.current_is_dirty() || bundle().prints.current_is_dirty() || bundle().filaments.current_is_dirty();
    const bool      settings_loaded = after.printer != before.printer || after.print != before.print || after.filaments != before.filaments ||
                                 (dirty_after && !dirty_before);
    if (plater->model().objects.empty() || !settings_loaded) {
        BOOST_LOG_TRIVIAL(info) << "Plyo: import MakerWorld sans réglages de projet, pas de fiche";
        return nullptr;
    }

    s_mine    = mine;
    s_creator = CreatorCapture{after, bundle().printers.get_edited_preset().config, bundle().prints.get_edited_preset().config,
                               bundle().filaments.get_edited_preset().config};
    SettingsBridge::clear_undo();

    const Preset* my_printer  = find(bundle().printers, s_mine.printer);
    const Preset* my_print    = find(bundle().prints, s_mine.print);
    const Preset* my_filament = s_mine.filaments.empty() ? nullptr : find(bundle().filaments, s_mine.filaments.front());
    if (my_printer == nullptr || my_print == nullptr || my_filament == nullptr) {
        BOOST_LOG_TRIVIAL(warning) << "Plyo: profil de l'utilisateur introuvable après l'import MakerWorld";
        return nullptr;
    }

    nlohmann::json creator = SettingsBridge::read_values();
    nlohmann::json message{{"type", "makerworld_imported"}};
    message["creator"] = {{"context", creator["context"]}, {"params", creator["params"]}, {"filament_count", after.filaments.size()}};
    message["mine"]    = {{"context", {{"printer", s_mine.printer}, {"filament", s_mine.filaments.front()}, {"process", s_mine.print}}},
                          {"params", SettingsBridge::read_values_from(my_print->config, my_filament->config, my_printer->config)},
                          {"can_multicolor", printer_can_change_colour(my_printer->config)}};
    return message;
}

nlohmann::json apply(bool keep_creator_filaments, const nlohmann::json& changes)
{
    if (!s_creator)
        return {{"ok", false}, {"text", "Refusé : aucun modèle MakerWorld importé."}};
    if (find(bundle().printers, s_mine.printer) == nullptr || find(bundle().prints, s_mine.print) == nullptr ||
        s_mine.filaments.empty() || find(bundle().filaments, s_mine.filaments.front()) == nullptr)
        return {{"ok", false}, {"text", "Refusé : ton profil d'avant l'import n'existe plus. Rien n'a été changé."}};

    const std::vector<std::string> creator_filaments = bundle().filament_presets;
    discard_unsaved_changes();
    if (!select(Preset::TYPE_PRINTER, s_mine.printer) || !select(Preset::TYPE_PRINT, s_mine.print))
        return {{"ok", false}, {"text", "Refusé : impossible de sélectionner ton imprimante ou ton profil d'impression."}};
    // Modèle multicolore : emplacements du créateur conservés ; sinon, le filament de l'utilisateur.
    set_filament_slots(keep_creator_filaments ? creator_filaments : std::vector<std::string>{s_mine.filaments.front()});

    if (changes.is_array() && !changes.empty()) {
        nlohmann::json result = SettingsBridge::apply_changes(changes);
        if (!result.value("ok", false)) {
            restore_creator();
            result["text"] = result.value("text", std::string()) + " Les réglages du créateur ont été remis.";
        }
        return result;
    }
    return {{"ok", true}, {"text", "Appliqué : ton imprimante et ton profil sont de retour."}};
}

nlohmann::json restore_creator()
{
    if (!s_creator)
        return {{"ok", false}, {"text", "Rien à annuler."}};
    discard_unsaved_changes();
    select(Preset::TYPE_PRINTER, s_creator->names.printer);
    select(Preset::TYPE_PRINT, s_creator->names.print);
    set_filament_slots(s_creator->names.filaments);
    // Réglages complets du créateur, modifications non enregistrées comprises.
    for (auto [type, config] : {std::pair{Preset::TYPE_PRINTER, &s_creator->printer}, std::pair{Preset::TYPE_PRINT, &s_creator->print},
                                std::pair{Preset::TYPE_FILAMENT, &s_creator->filament}})
        if (Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(type))
            tab->load_config(*config);
    SettingsBridge::clear_undo();
    return {{"ok", true}, {"text", "Annulé : réglages du créateur restaurés."}};
}

nlohmann::json use_my_filament_everywhere()
{
    if (!s_creator || s_mine.filaments.empty() || find(bundle().filaments, s_mine.filaments.front()) == nullptr)
        return {{"ok", false}, {"text", "Refusé : ton filament d'avant l'import est introuvable."}};
    bundle().filaments.discard_current_changes();
    set_filament_slots(std::vector<std::string>(bundle().filament_presets.size(), s_mine.filaments.front()));
    return {{"ok", true}, {"text", "Appliqué : ton filament dans tous les emplacements."}};
}

}} // namespace Plyo::MakerWorldImport
