#include "PlyoProfiles.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoLimits.hpp"
#include "PlyoMemory.hpp"
#include "PlyoProfilesLogic.hpp"
#include "PlyoSanitize.hpp"
#include "PlyoStore.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Tab.hpp"

#include <boost/date_time/posix_time/posix_time.hpp>
#include <boost/log/trivial.hpp>

#include <ctime>

namespace Plyo { namespace Profiles {

using Slic3r::Preset;

namespace {

Slic3r::PresetCollection& collection(Preset::Type type)
{
    Slic3r::PresetBundle& bundle = *Slic3r::GUI::wxGetApp().preset_bundle;
    return type == Preset::TYPE_PRINT ? bundle.prints : bundle.filaments;
}

boost::filesystem::path reliable_file() { return Store::dir("fiable") / (file_stem(Limits::machine_key()) + ".json"); }
boost::filesystem::path trial_file() { return Store::dir("essai") / (file_stem(Limits::machine_key()) + ".json"); }

const char* scope_of(Preset::Type type) { return type == Preset::TYPE_PRINT ? "print" : "filament"; }

// Valeur typée si la clé est au catalogue, sinon son texte tel qu'Orca l'écrit.
nlohmann::json value_of(const Slic3r::DynamicPrintConfig& config, const std::string& key, const std::string& kind)
{
    if (!kind.empty())
        return SettingsBridge::typed_value_of(config, key, kind);
    const Slic3r::ConfigOption* opt = config.option(key);
    return opt ? nlohmann::json(opt->serialize()) : nlohmann::json(nullptr);
}

} // namespace

nlohmann::json manual_edits()
{
    nlohmann::json out = nlohmann::json::array();
    for (const Preset::Type type : {Preset::TYPE_PRINT, Preset::TYPE_FILAMENT}) {
        Slic3r::PresetCollection& col = collection(type);
        if (!col.current_is_dirty())
            continue;
        const Catalog::Policy&  policy = Catalog::policy();
        const Slic3r::Preset&   saved  = col.get_selected_preset();
        const Slic3r::Preset&   edited = col.get_edited_preset();
        for (const std::string& key : col.current_dirty_options()) {
            const std::string kind = policy.kind(scope_of(type), key);
            out.push_back({{"preset", scope_of(type)}, {"key", key}, {"title", policy.title(key)},
                           {"before", value_of(saved.config, key, kind)}, {"after", value_of(edited.config, key, kind)}});
        }
    }
    return out;
}

nlohmann::json save_applied()
{
    nlohmann::json    saved = nlohmann::json::array();
    std::string       error;
    const std::string old_machine = Limits::machine_key();
    const std::time_t started     = std::time(nullptr);
    for (const Preset::Type type : {Preset::TYPE_PRINT, Preset::TYPE_FILAMENT}) {
        Slic3r::PresetCollection& col = collection(type);
        if (!col.current_is_dirty())
            continue;
        Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(type);
        if (tab == nullptr)
            continue;
        const std::string from    = col.get_selected_preset().name;
        const bool        created = !col.get_selected_preset().can_overwrite();
        std::vector<std::string> existing;
        for (const Slic3r::Preset& p : col)
            existing.push_back(p.name);
        const std::string name = created ? copy_name(from, existing) : from;
        try {
            tab->save_preset(name); // avec un nom : aucune boîte de dialogue ; Orca met l'interface à jour
        } catch (const std::exception& e) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: enregistrement du profil « " << name << " » impossible : " << e.what();
            error = "Orca n'a pas pu écrire le fichier";
            break;
        }
        if (col.current_is_dirty() || col.get_selected_preset().name != name) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: le profil « " << name << " » n'a pas été enregistré par Orca";
            error = "Orca a refusé l'enregistrement";
            break;
        }
        // Orca ne signale pas un disque qui refuse d'écrire : on vérifie que le fichier du profil a bien été écrit.
        if (!written_since(col.get_selected_preset().file, started - 2)) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: le fichier du profil « " << name << " » n'a pas été écrit : " << col.get_selected_preset().file;
            error = "Orca n'a pas pu écrire le fichier";
            break;
        }
        SettingsBridge::retarget_undo(type == Preset::TYPE_PRINT, from, name);
        saved.push_back({{"type", scope_of(type)}, {"name", name}, {"created", created}, {"from", from}});
    }
    // Le couple imprimante + filament change de nom avec une copie : limites et mémoire du profil d'origine la suivent.
    if (const std::string now = Limits::machine_key(); now != old_machine) {
        Limits::carry_over(old_machine);
        Memory::carry_over(old_machine, now);
    }
    return {{"saved", saved}, {"save_error", error}};
}

bool note_trial(const std::string& at)
{
    if (at.empty())
        return false;
    const std::string date = boost::posix_time::to_iso_extended_string(boost::posix_time::second_clock::local_time()).substr(0, 10);
    return Store::write(trial_file(), {{"machine", Limits::machine_key()}, {"date", date}, {"at", at}, {"values", SettingsBridge::snapshot_raw()}});
}

bool mark_reliable(const std::string& at)
{
    // Les réglages qui ont marché sont ceux d'alors (pris juste après l'enregistrement du lot), pas ceux d'aujourd'hui.
    const nlohmann::json trial = Sanitize::reliable(Store::read(trial_file()));
    if (at.empty() || trial.empty() || trial["machine"] != Limits::machine_key() || trial["at"] != at)
        return false;
    return Store::write(reliable_file(), {{"machine", trial["machine"]}, {"date", trial["date"]}, {"at", trial["at"]}, {"values", trial["values"]}});
}

nlohmann::json reliable_info()
{
    const nlohmann::json stored = Sanitize::reliable(Store::read(reliable_file()));
    // Le nom du fichier vient d'une empreinte : on vérifie aussi que c'est bien ce couple imprimante + filament.
    const bool available = !stored.empty() && stored["machine"] == Limits::machine_key();
    return {{"available", available}, {"date", available ? stored["date"] : nlohmann::json("")}};
}

nlohmann::json restore_reliable()
{
    const nlohmann::json stored = Sanitize::reliable(Store::read(reliable_file()));
    if (stored.empty() || stored["machine"] != Limits::machine_key())
        return {{"ok", false}, {"text", "Je n'ai pas de version fiable pour cette imprimante et ce filament."}};
    nlohmann::json result = SettingsBridge::restore_values(stored["values"]);
    if (result.value("ok", false)) {
        const nlohmann::json saved = save_applied();
        result["saved"]            = saved["saved"];
        result["save_error"]       = saved["save_error"];
    }
    return result;
}

}} // namespace Plyo::Profiles
