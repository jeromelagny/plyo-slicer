#include "PlyoProfiles.hpp"
#include "PlyoAutoSave.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoJson.hpp"
#include "PlyoLimits.hpp"
#include "PlyoMemory.hpp"
#include "PlyoProfilesLogic.hpp"
#include "PlyoProjectFiles.hpp"
#include "PlyoSanitize.hpp"
#include "PlyoStore.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoSpools.hpp"
#include "PlyoSpoolsLogic.hpp"

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

std::string now_iso() { return boost::posix_time::to_iso_extended_string(boost::posix_time::second_clock::local_time()); }
std::string today() { return now_iso().substr(0, 10); }

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
            // `now` : la valeur telle qu'Orca l'écrit, comparée par le panneau à ce que l'assistant a posé (champ `written` d'un lot).
            out.push_back({{"preset", scope_of(type)}, {"key", key}, {"title", policy.title(key)},
                           {"before", value_of(saved.config, key, kind)}, {"after", value_of(edited.config, key, kind)},
                           {"now", edited.config.has(key) ? edited.config.opt_serialize(key) : std::string()}});
        }
    }
    return out;
}

SaveOutcome save_current_as(bool print, const std::string& name)
{
    const Preset::Type        type = print ? Preset::TYPE_PRINT : Preset::TYPE_FILAMENT;
    Slic3r::PresetCollection& col  = collection(type);
    Slic3r::GUI::Tab*         tab  = Slic3r::GUI::wxGetApp().get_tab(type);
    if (tab == nullptr) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: pas d'onglet pour enregistrer le profil « " << name << " »";
        return SaveOutcome::Failed;
    }
    const std::time_t started = std::time(nullptr);
    try {
        tab->save_preset(name); // avec un nom : aucune boîte de dialogue ; Orca met l'interface à jour
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: enregistrement du profil « " << name << " » impossible : " << e.what();
        return SaveOutcome::Failed;
    }
    // Orca peut refuser sans le dire (températures incohérentes) : le profil doit être choisi sous ce nom et plus modifié.
    if (col.current_is_dirty() || col.get_selected_preset().name != name) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: le profil « " << name << " » n'a pas été enregistré par Orca";
        return SaveOutcome::Refused;
    }
    // Orca ne signale pas un disque qui refuse d'écrire : on vérifie que le fichier du profil a bien été écrit.
    if (!written_since(col.get_selected_preset().file, started - 2)) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: le fichier du profil « " << name << " » n'a pas été écrit : " << col.get_selected_preset().file;
        return SaveOutcome::NotWritten;
    }
    return SaveOutcome::Ok;
}

nlohmann::json save_applied()
{
    nlohmann::json    saved = nlohmann::json::array();
    std::string       error;
    bool              error_spool = false; // l'échec vise une bobine : l'enregistrement automatique réessaiera
    const std::string old_machine = Limits::machine_key();
    // Les réglages d'impression sont ceux de la pièce : jamais enregistrés dans le préréglage d'impression partagé (ils
    // suivraient le projet suivant), ni dans une copie « (Plyo) ». Ils restent modifiés : dans le 3MF de la conversation
    // quand son plateau est attaché, sinon Orca les protège par sa question (fermeture, nouveau projet).
    const bool print_dirty = collection(Preset::TYPE_PRINT).current_is_dirty();
    const bool in_project  = print_dirty && ProjectFiles::owns_print_edits();
    Slic3r::PresetCollection& col = collection(Preset::TYPE_FILAMENT);
    // Orca ouvrirait sa fenêtre « Temperature Safety Check » au milieu de l'enregistrement : on n'enregistre pas, on le dit
    // (le lot a été vérifié avant l'écriture ; ceci couvre un écart déjà là avant le lot).
    if (col.current_is_dirty() && !AutoSave::temperatures_ok(col.get_edited_preset().config)) {
        BOOST_LOG_TRIVIAL(warning) << "Plyo: filament « " << col.get_selected_preset().name << " » non enregistré : écart de températures refusé par Orca";
        return {{"saved", saved}, {"save_error", "temperatures"}, {"in_project", in_project}, {"print_edited", print_dirty && !in_project}};
    }
    if (col.current_is_dirty() && Slic3r::GUI::wxGetApp().get_tab(Preset::TYPE_FILAMENT) != nullptr) {
        const std::string from = col.get_selected_preset().name;
        // Une bobine n'a qu'un préréglage par machine : on l'écrase, jamais de copie « (Plyo) ».
        const bool spool   = col.get_selected_preset().can_overwrite() && Spools::is_spool_preset(from);
        const bool created = !spool && !col.get_selected_preset().can_overwrite();
        std::vector<std::string> existing;
        for (const Slic3r::Preset& p : col)
            existing.push_back(p.name);
        const std::string name    = created ? copy_name(from, existing) : from;
        const SaveOutcome outcome = save_current_as(false, name);
        if (outcome != SaveOutcome::Ok) {
            error       = outcome == SaveOutcome::Refused ? "Orca a refusé l'enregistrement" : "Orca n'a pas pu écrire le fichier";
            error_spool = spool;
        }
        else {
            SettingsBridge::retarget_undo(false, from, name);
            saved.push_back({{"type", scope_of(Preset::TYPE_FILAMENT)}, {"name", name}, {"created", created}, {"from", from}});
        }
    }
    // Le couple imprimante + filament change de nom avec une copie : limites et mémoire du profil d'origine la suivent.
    if (const std::string now = Limits::machine_key(); now != old_machine) {
        Limits::carry_over(old_machine);
        Memory::carry_over(old_machine, now);
    }
    return {{"saved", saved}, {"save_error", error}, {"save_spool", error_spool}, {"in_project", in_project}, {"print_edited", print_dirty && !in_project}};
}

namespace {

// Réglages réussis sans bobine : seulement ceux du filament (ROB-07). Ceux d'impression sont ceux de la pièce d'alors.
nlohmann::json filament_values() { return {{"filament", SettingsBridge::snapshot_raw()["filament"]}}; }

// Envoi ou export (ROB-19) : l'essai en cours de ce couple imprimante + filament prend les valeurs qui partent vraiment
// (une retouche faite après le lot et avant l'impression y est). Sans envoi, l'essai pris à l'application reste (repli).
void refresh_trial()
{
    const nlohmann::json trial = Sanitize::reliable(Store::read(trial_file()));
    if (trial.empty() || trial["machine"] != Limits::machine_key() || Json::str(trial, "at").empty())
        return;
    Store::write(trial_file(), {{"machine", trial["machine"]}, {"date", today()}, {"at", trial["at"]}, {"sent", now_iso()}, {"values", filament_values()}});
}

// Ce que la remise changerait : le nombre et les réglages (les principaux d'abord, côté panneau).
nlohmann::json with_preview(nlohmann::json info, const nlohmann::json& values)
{
    const nlohmann::json changes = SettingsBridge::preview_values(values);
    info["count"]                = changes.size();
    info["changes"]              = changes;
    return info;
}

} // namespace

bool note_trial(const std::string& at)
{
    if (at.empty())
        return false;
    return Store::write(trial_file(), {{"machine", Limits::machine_key()}, {"date", today()}, {"at", at}, {"values", filament_values()}});
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
    const nlohmann::json spool = Spools::current_full();
    if (!spool.empty()) {
        const nlohmann::json ok = Spools::read_version(true, spool["id"], spool["printer"]);
        if (ok.empty())
            return {{"available", false}, {"date", ""}};
        return with_preview({{"available", true}, {"date", ok["date"]}}, {{"filament", ok["values"]}});
    }
    const nlohmann::json stored = Sanitize::reliable(Store::read(reliable_file()));
    // Le nom du fichier vient d'une empreinte : on vérifie aussi que c'est bien ce couple imprimante + filament.
    const bool available = !stored.empty() && stored["machine"] == Limits::machine_key();
    if (!available)
        return {{"available", false}, {"date", ""}};
    return with_preview({{"available", true}, {"date", stored["date"]}}, stored["values"]);
}

nlohmann::json restore_reliable()
{
    nlohmann::json    values;
    const nlohmann::json spool = Spools::current_full();
    if (!spool.empty()) {
        const nlohmann::json ok = Spools::read_version(true, spool["id"], spool["printer"]);
        if (ok.empty())
            return {{"ok", false}, {"text", "Je n'ai pas encore de réglages réussis pour la bobine « " + spool["name"].get<std::string>() + " » sur cette imprimante."}};
        // Les valeurs vont dans l'onglet Filament : il doit montrer le préréglage de la bobine (filament 1).
        if (collection(Preset::TYPE_FILAMENT).get_edited_preset().name != spool["preset"])
            return {{"ok", false}, {"text", "Ouvre le filament de la bobine « " + spool["name"].get<std::string>() + " » dans Orca, puis redemande-moi."}};
        values = {{"filament", ok["values"]}};
    } else {
        const nlohmann::json stored = Sanitize::reliable(Store::read(reliable_file()));
        if (stored.empty() || stored["machine"] != Limits::machine_key())
            return {{"ok", false}, {"text", "Je n'ai pas encore de réglages réussis pour cette imprimante et ce filament."}};
        values = stored["values"];
    }
    nlohmann::json result = SettingsBridge::restore_values(values);
    if (result.value("ok", false)) {
        const nlohmann::json saved = save_applied();
        result["saved"]            = saved["saved"];
        result["save_error"]       = saved["save_error"];
        result["in_project"]       = saved["in_project"];
        result["print_edited"]     = saved["print_edited"];
    }
    return result;
}

bool note_sent()
{
    // Plateau de test d'une calibration : ses valeurs ne sont pas celles de la bobine, ce n'est pas un envoi à retenir.
    if (AutoSave::calibrating())
        return false;
    refresh_trial(); // réglages réussis sans bobine : relevés à l'envoi, pas seulement à l'application
    const nlohmann::json spool = Spools::current_full();
    if (spool.empty())
        return false;
    // Les valeurs du moment (modifications pas encore enregistrées comprises) : ce sont elles qui sont parties.
    const nlohmann::json values = Spools::preset_values(spool["preset"]);
    if (values.empty())
        return false;
    const std::string    at      = now_iso();
    const nlohmann::json pointer = {{"spool", spool["id"]}, {"printer", spool["printer"]}, {"date", at.substr(0, 10)}, {"at", at}};
    nlohmann::json       trial   = pointer;
    trial["values"]              = values;
    // L'essai d'abord : le pointeur ne doit jamais viser un essai qui n'a pas été écrit.
    const bool written = Spools::write_version(false, trial) && Spools::write_last_sent(pointer);
    if (!written)
        BOOST_LOG_TRIVIAL(error) << "Plyo: version envoyée de la bobine « " << spool["name"].get<std::string>() << " » non écrite";
    return written;
}

bool mark_spool_success()
{
    const nlohmann::json spool = Spools::current_full();
    if (spool.empty())
        return false;
    // Ce qui a réussi, c'est ce qui est parti à l'imprimante, même si un réglage a changé depuis.
    const nlohmann::json sent = Spools::read_version(false, spool["id"], spool["printer"]);
    if (sent.empty() || !Spools::write_version(true, sent))
        return false;
    Spools::note_outcome(spool["id"], spool["printer"], "ok", sent["date"]);
    BOOST_LOG_TRIVIAL(info) << "Plyo: version réussie retenue pour la bobine « " << spool["name"].get<std::string>() << " » (envoi du "
                            << sent["date"].get<std::string>() << ")";
    return true;
}

namespace {

// Refus honnête d'une réussite (ou d'un échec) dite pour la bobine `expected` de la conversation : le dernier envoi doit
// être le sien, récent, et pas déjà déclaré raté. "" si le dernier envoi peut être marqué. `answered_ok` : un envoi déjà
// déclaré raté peut l'être (un nouvel échec, ou « Oui » juste après « Non » à l'étape Résultat : changement d'avis).
std::string sent_refusal_text(const nlohmann::json& pointer, const std::string& expected, bool answered_ok)
{
    const std::string why = SpoolsLogic::sent_refusal(pointer, expected, now_iso());
    if (why.empty() || (answered_ok && why == "answered"))
        return "";
    if (why == "none")
        return "Je ne retrouve pas d'impression envoyée par Plyo avec cette bobine : je ne retiens rien. Ta prochaine impression réussie la retiendra.";
    if (why == "other") {
        const std::string sent = Spools::name_of(pointer["spool"]);
        return "Ma dernière impression envoyée était avec " + (sent.empty() ? std::string("une autre bobine") : "« " + sent + " »") +
               ", pas avec la bobine de ce projet : je ne retiens rien. Ta prochaine impression réussie avec elle la retiendra.";
    }
    if (why == "answered")
        return "Tu m'as dit que la dernière impression avait raté : je n'en retiens pas les réglages. Ta prochaine impression réussie les retiendra.";
    return "Ma dernière impression envoyée date de plus de 2 jours : je ne sais plus si c'est celle-là, je ne retiens rien. Ta prochaine impression réussie la retiendra.";
}

} // namespace

nlohmann::json mark_sent_success(const std::string& expected_spool, bool change_of_mind)
{
    const nlohmann::json pointer = Spools::read_last_sent();
    if (const std::string refused = sent_refusal_text(pointer, expected_spool, change_of_mind); !refused.empty())
        return {{"ok", false}, {"name", ""}, {"text", refused}};
    const nlohmann::json sent = Spools::read_version(false, pointer["spool"], pointer["printer"]);
    if (!SpoolsLogic::sent_trial_matches(pointer, sent) || !Spools::write_version(true, sent))
        return {{"ok", false}, {"name", ""}, {"text", ""}};
    Spools::note_outcome(pointer["spool"], pointer["printer"], "ok", sent["date"]);
    if (Json::str(pointer, "answered") == "bad") {
        nlohmann::json again = pointer;
        again.erase("answered"); // changement d'avis : cet envoi est réussi
        Spools::write_last_sent(again);
    }
    const std::string name = Spools::name_of(pointer["spool"]);
    BOOST_LOG_TRIVIAL(info) << "Plyo: version réussie retenue pour la bobine « " << name << " » (dernier envoi, " << sent["date"].get<std::string>() << ")";
    return {{"ok", true}, {"name", name}, {"date", sent["date"]}};
}

nlohmann::json mark_sent_failure(const std::string& expected_spool)
{
    const nlohmann::json pointer = Spools::read_last_sent();
    if (const std::string refused = sent_refusal_text(pointer, expected_spool, true); !refused.empty())
        return {{"ok", false}, {"name", ""}, {"text", refused}};
    if (!Spools::note_outcome(pointer["spool"], pointer["printer"], "bad", today()) && Json::str(pointer, "answered") != "bad")
        return {{"ok", false}, {"name", ""}, {"text", ""}};
    // Cet envoi a raté : une réussite dite plus tard ne le marque plus.
    Spools::write_last_sent(SpoolsLogic::answered(pointer, "bad"));
    return {{"ok", true}, {"name", Spools::name_of(pointer["spool"])}};
}

bool mark_spool_failure()
{
    const nlohmann::json spool = Spools::current_full();
    if (spool.empty() || !Spools::note_outcome(spool["id"], spool["printer"], "bad", today()))
        return false;
    // Carte « Ça a marché ? » : « non » pour la bobine du dernier envoi le marque comme déclaré raté.
    const nlohmann::json pointer = Spools::read_last_sent();
    if (!pointer.empty() && pointer["spool"] == spool["id"] && pointer["printer"] == spool["printer"])
        Spools::write_last_sent(SpoolsLogic::answered(pointer, "bad"));
    return true;
}

}} // namespace Plyo::Profiles
