#include "PlyoSpools.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoJson.hpp"
#include "PlyoProfiles.hpp"
#include "PlyoProfilesLogic.hpp"
#include "PlyoSpoolsLogic.hpp"
#include "PlyoStore.hpp"

#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Tab.hpp"

#include <boost/log/trivial.hpp>

#include <ctime>
#include <exception>
#include <vector>

namespace Plyo { namespace Spools {

using Slic3r::Preset;

namespace {

boost::filesystem::path path_of() { return Store::dir() / "bobines.json"; }

nlohmann::json load() { return SpoolsLogic::sanitize(Store::read(path_of())); }

// Copie du registre pour is_spool_preset (fil principal seulement). Seul Plyo écrit bobines.json : chaque écriture,
// réussie ou non, oblige à le relire.
bool           s_cache_valid = false;
nlohmann::json s_cache;

bool save(const nlohmann::json& reg)
{
    s_cache_valid = false;
    return Store::write(path_of(), SpoolsLogic::sanitize(reg));
}

Slic3r::PresetBundle* bundle() { return Slic3r::GUI::wxGetApp().preset_bundle; }

std::string current_printer() { return bundle() != nullptr ? bundle()->printers.get_selected_preset_name() : std::string(); }

std::string material_of(const nlohmann::json& reg, const std::string& id)
{
    for (const nlohmann::json& s : reg["spools"])
        if (s["id"] == id)
            return s["material"];
    return "";
}

nlohmann::json refuse(const std::string& text) { return {{"ok", false}, {"text", text}}; }

// Point de départ d'un nouveau préréglage : le profil système de la matière pour la machine en cours. Un préréglage de
// bobine doit hériter d'un profil système (sinon Orca avertit à l'ouverture d'un projet) : un profil utilisateur retenu
// par best_filament est remplacé par son parent système.
const Preset* system_base(const std::string& material)
{
    Slic3r::PresetCollection& filaments = bundle()->filaments;
    const Preset*             p         = filaments.find_preset(FirstSteps::best_filament(material), false);
    if (p != nullptr && !p->is_system)
        p = filaments.get_preset_parent(*p);
    return p != nullptr && p->is_system && p->is_visible && p->is_compatible ? p : nullptr;
}

// Enregistre `name` (créé ou écrasé) depuis le profil système `base_name`, compatible avec cette seule imprimante, et le
// choisit. Faux avec `text` (refus) ou `cancelled` (fenêtre d'Orca annulée) dans `out`.
bool save_spool_preset(const std::string& base_name, const std::string& name, const std::string& printer, nlohmann::json& out)
{
    Slic3r::PresetCollection& filaments = bundle()->filaments;
    // L'onglet d'abord : si le filament en cours a des modifications, Orca demande quoi en faire, et l'utilisateur peut annuler.
    if (!FirstSteps::select_filament(base_name)) {
        out = {{"ok", false}, {"cancelled", true}};
        return false;
    }
    // Valeurs ENREGISTRÉES du profil de la matière (pas l'édité, qui peut porter des valeurs transférées d'un autre filament).
    Slic3r::DynamicPrintConfig cfg = filaments.get_selected_preset().config;
    cfg.set_key_value("compatible_printers", new Slic3r::ConfigOptionStrings({printer}));
    // Pour un nouveau préréglage, Orca relie lui-même la copie au profil système ; pour un préréglage écrasé (nouvel essai
    // après un échec), il garde l'`inherits` de la config : on le donne donc explicitement.
    cfg.option<Slic3r::ConfigOptionString>("inherits", true)->value = base_name;
    Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(Preset::TYPE_FILAMENT);
    if (tab == nullptr) {
        out = refuse("L'onglet Filament d'Orca n'est pas disponible.");
        return false;
    }
    try {
        tab->load_config(cfg);
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: préréglage de bobine « " << name << " » impossible : " << e.what();
        out = refuse("Orca n'a pas pu écrire le préréglage « " + name + " ».");
        return false;
    }
    // Mêmes vérifications que save_applied : choisi sous ce nom, plus modifié, fichier réécrit.
    switch (Profiles::save_current_as(false, name)) {
    case Profiles::SaveOutcome::Ok: break;
    case Profiles::SaveOutcome::Refused:
        out = refuse("Orca a refusé d'enregistrer le préréglage « " + name + " ».");
        return false;
    default:
        out = refuse("Orca n'a pas pu écrire le préréglage « " + name + " ».");
        return false;
    }
    const Preset* saved = filaments.find_preset(name, false);
    if (saved == nullptr) {
        out = refuse("Orca a refusé d'enregistrer le préréglage « " + name + " ».");
        return false;
    }
    if (saved->inherits() != base_name) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: le préréglage de bobine « " << name << " » hérite de « " << saved->inherits()
                                 << " » au lieu de « " << base_name << " »";
        out = refuse("Le préréglage « " + name + " » n'est pas relié au profil « " + base_name + " » d'Orca : je ne le retiens pas.");
        return false;
    }
    // Comme un choix dans la liste du plateau (aucune question attendue : rien n'est modifié).
    if (!FirstSteps::select_filament(name)) {
        out = refuse("Le préréglage « " + name + " » est enregistré, mais Orca ne l'a pas choisi. Choisis-le dans la liste des filaments.");
        return false;
    }
    BOOST_LOG_TRIVIAL(info) << "Plyo: préréglage de bobine enregistré « " << name << " » depuis « " << base_name << " »";
    return true;
}

} // namespace

nlohmann::json list(const std::string& printer_preset)
{
    return SpoolsLogic::for_machine(load(), printer_preset.empty() ? current_printer() : printer_preset);
}

nlohmann::json create_or_choose(const std::string& name, const std::string& material, const std::string& printer_preset)
{
    if (bundle() == nullptr)
        return refuse("Orca n'est pas prêt.");
    const std::string printer = printer_preset.empty() ? current_printer() : printer_preset;
    // Le profil de départ est pris pour la machine en cours : jamais pour une autre (point de vigilance 3).
    if (printer.empty() || printer != current_printer())
        return refuse("Choisis d'abord cette imprimante dans Orca.");

    const nlohmann::json added = SpoolsLogic::add(load(), name, material);
    const std::string    id    = Json::str(added, "id");
    if (id.empty())
        return refuse("Je n'ai pas pu retenir cette bobine : écris sa marque et son type (au moins 3 lettres) et choisis sa matière.");
    nlohmann::json reg     = added["reg"];
    const bool     created = Json::boolean(added, "created");
    if (created && !save(reg))
        return refuse("Je n'ai pas pu enregistrer la liste de tes bobines.");
    const std::string spool = SpoolsLogic::spool_name(reg, id);
    nlohmann::json    out   = {{"ok", true}, {"id", id}, {"name", spool}, {"created", created}};

    Slic3r::PresetCollection& filaments = bundle()->filaments;
    const std::string         recorded  = SpoolsLogic::preset_for(reg, id, printer);
    const bool                pending   = SpoolsLogic::is_pending(reg, id, printer);
    if (!recorded.empty() && !pending && filaments.find_preset(recorded, false) != nullptr) {
        if (!FirstSteps::select_filament(recorded))
            return {{"ok", false}, {"cancelled", true}, {"id", id}, {"name", spool}, {"created", created}};
        out["preset"]         = recorded;
        out["printer"]        = printer;
        out["preset_created"] = false;
        return out;
    }

    // La bobine garde sa matière d'origine (« sunlu pla+ noir » retrouvée reste du PLA).
    const std::string material_kept = material_of(reg, id);
    const Preset*     base          = system_base(material_kept);
    if (base == nullptr)
        return {{"ok", false}, {"id", id}, {"name", spool}, {"created", created},
                {"text", "Je ne trouve pas de profil " + material_kept + " pour cette imprimante dans Orca."}};
    const std::string base_name = base->name; // le pointeur ne survit pas aux changements de la collection

    // Nom réservé au registre AVANT l'enregistrement par Orca : si celui-ci échoue en laissant le préréglage dans Orca,
    // le nouvel essai retrouve ce nom (seul nom noté pour cette bobine sur cette machine) et l'écrase, sans « … 2 ».
    std::vector<std::string> existing;
    for (const Preset& p : filaments)
        existing.push_back(p.name);
    std::vector<std::string> ours;
    if (!recorded.empty())
        ours.push_back(recorded);
    const std::string preset = SpoolsLogic::preset_name(spool, SpoolsLogic::machine_label(printer), existing, ours);
    if (!save(SpoolsLogic::set_preset(reg, id, printer, preset, true)))
        return {{"ok", false}, {"id", id}, {"name", spool}, {"created", created}, {"text", "Je n'ai pas pu enregistrer la liste de tes bobines."}};

    nlohmann::json failure;
    if (!save_spool_preset(base_name, preset, printer, failure)) {
        failure["id"]      = id;
        failure["name"]    = spool;
        failure["created"] = created;
        return failure;
    }
    if (!save(SpoolsLogic::set_preset(reg, id, printer, preset))) {
        // L'entrée reste « en attente » sous ce nom : le prochain choix le réécrit, sans doublon.
        BOOST_LOG_TRIVIAL(error) << "Plyo: registre des bobines non écrit après l'enregistrement de « " << preset << " »";
        return {{"ok", false}, {"id", id}, {"name", spool}, {"preset", preset}, {"created", created},
                {"text", "Le préréglage « " + preset + " » est enregistré, mais je n'ai pas pu le noter dans la liste de tes bobines. Choisis à nouveau ta bobine."}};
    }
    out["preset"]         = preset;
    out["printer"]        = printer;
    out["preset_created"] = true; // parti du profil de la matière : ses températures sont à vérifier
    return out;
}

namespace {

std::string first_filament()
{
    if (bundle() == nullptr)
        return "";
    return bundle()->filament_presets.empty() ? bundle()->filaments.get_selected_preset_name() : bundle()->filament_presets.front();
}

// Matière d'un préréglage de l'utilisateur (« filament_type », première valeur), si Plyo la connaît ; sinon "".
std::string adoptable_material(const std::string& filament_preset)
{
    if (bundle() == nullptr || filament_preset.empty() || filament_preset != first_filament())
        return "";
    const Preset* p = bundle()->filaments.find_preset(filament_preset, false);
    if (p == nullptr || p->is_system || p->is_default || is_spool_preset(filament_preset))
        return "";
    const auto* type = p->config.option<Slic3r::ConfigOptionStrings>("filament_type");
    const std::string material = type != nullptr && !type->values.empty() ? type->values.front() : std::string();
    for (const char* known : {"PLA", "PETG", "ABS", "ASA", "TPU"})
        if (material == known)
            return material;
    return "";
}

} // namespace

nlohmann::json adopt_offer(const std::string& filament_preset)
{
    const std::string material = adoptable_material(filament_preset);
    return {{"preset", filament_preset}, {"offer", !material.empty()}, {"material", material}};
}

nlohmann::json adopt(const std::string& filament_preset, const std::string& name)
{
    const std::string material = adoptable_material(filament_preset);
    if (material.empty())
        return {{"ok", false}, {"preset", filament_preset}, {"text", "Je ne peux pas retenir « " + filament_preset + " » comme bobine : choisis-le d'abord comme filament 1 dans Orca."}};
    const nlohmann::json r  = SpoolsLogic::adopt(load(), filament_preset, name, material, current_printer());
    const std::string    id = Json::str(r, "id");
    if (id.empty())
        return {{"ok", false}, {"preset", filament_preset}, {"text", "Tu as déjà une bobine de ce nom sur cette imprimante : choisis-la à l'étape Filament."}};
    if (r["reg"] != load() && !save(r["reg"]))
        return {{"ok", false}, {"preset", filament_preset}, {"text", "Je n'ai pas pu enregistrer la liste de tes bobines."}};
    BOOST_LOG_TRIVIAL(info) << "Plyo: préréglage « " << filament_preset << " » retenu comme bobine";
    return {{"ok", true}, {"id", id}, {"name", SpoolsLogic::spool_name(r["reg"], id)}, {"preset", filament_preset}};
}

bool is_spool_preset(const std::string& filament_preset)
{
    if (filament_preset.empty())
        return false;
    if (!s_cache_valid) {
        s_cache       = load();
        s_cache_valid = true;
    }
    return !SpoolsLogic::spool_of_preset(s_cache, filament_preset).empty();
}

nlohmann::json current()
{
    const nlohmann::json full = current_full();
    if (full.empty())
        return full;
    return {{"id", full["id"]}, {"name", full["name"]}};
}

nlohmann::json current_full()
{
    if (bundle() == nullptr)
        return nlohmann::json::object();
    const std::string filament = bundle()->filament_presets.empty() ? bundle()->filaments.get_selected_preset_name()
                                                                    : bundle()->filament_presets.front();
    const nlohmann::json reg = load();
    const std::string    id  = SpoolsLogic::spool_of_preset(reg, filament);
    if (id.empty())
        return nlohmann::json::object();
    return {{"id", id}, {"name", SpoolsLogic::spool_name(reg, id)}, {"printer", current_printer()}, {"preset", filament}};
}

nlohmann::json preset_values(const std::string& preset)
{
    nlohmann::json out = nlohmann::json::object();
    if (bundle() == nullptr || preset.empty())
        return out;
    Slic3r::PresetCollection& filaments = bundle()->filaments;
    const Preset*             saved     = filaments.find_preset(preset, false);
    if (saved == nullptr)
        return out;
    // Le préréglage ouvert dans l'onglet : ses valeurs du moment (ce qui part à l'imprimante), pas seulement l'enregistré.
    const Slic3r::DynamicPrintConfig& config = filaments.get_edited_preset().name == preset ? filaments.get_edited_preset().config
                                                                                             : saved->config;
    for (const std::string& key : Catalog::policy().keys("filament"))
        if (config.option(key) != nullptr)
            out[key] = config.opt_serialize(key);
    return out;
}

nlohmann::json read_version(bool ok, const std::string& id, const std::string& printer)
{
    if (id.empty() || printer.empty())
        return nlohmann::json::object();
    const nlohmann::json v = SpoolsLogic::sanitize_version(
        Store::read(Store::dir(ok ? "fiable" : "essai") / (SpoolsLogic::version_stem(id, printer) + ".json")));
    // Le nom du fichier vient d'une empreinte : on vérifie aussi que c'est bien cette bobine sur cette imprimante.
    if (v.empty() || v["spool"] != id || v["printer"] != printer)
        return nlohmann::json::object();
    return v;
}

bool write_version(bool ok, const nlohmann::json& version)
{
    const nlohmann::json v = SpoolsLogic::sanitize_version(version);
    if (v.empty())
        return false;
    return Store::write(Store::dir(ok ? "fiable" : "essai") / (SpoolsLogic::version_stem(v["spool"], v["printer"]) + ".json"), v);
}

nlohmann::json read_last_sent() { return SpoolsLogic::last_sent(Store::read(Store::dir("essai") / "dernier-envoi.json")); }

bool write_last_sent(const nlohmann::json& pointer)
{
    const nlohmann::json p = SpoolsLogic::last_sent(pointer);
    return !p.empty() && Store::write(Store::dir("essai") / "dernier-envoi.json", p);
}

std::string name_of(const std::string& id) { return SpoolsLogic::spool_name(load(), id); }

bool note_outcome(const std::string& id, const std::string& printer, const std::string& outcome, const std::string& date)
{
    const nlohmann::json reg  = load();
    const nlohmann::json next = SpoolsLogic::set_outcome(reg, id, printer, outcome, date);
    return next != reg && save(next);
}

nlohmann::json success_for(const std::string& id, const std::string& printer)
{
    const nlohmann::json none = {{"available", false}, {"date", ""}, {"differs", false}, {"summary", ""}};
    const nlohmann::json ok   = read_version(true, id, printer);
    if (ok.empty())
        return none;
    const nlohmann::json               before = preset_values(SpoolsLogic::preset_for(load(), id, printer));
    std::map<std::string, std::string> titles, kinds;
    for (const auto& [key, value] : ok["values"].items()) {
        titles[key] = Catalog::policy().title(key);
        kinds[key]  = Catalog::policy().kind("filament", key);
    }
    const nlohmann::json diff = SpoolsLogic::success_summary(before, ok["values"], titles, kinds);
    return {{"available", true}, {"date", ok["date"]}, {"differs", diff["differs"]}, {"summary", diff["summary"]}};
}

}} // namespace Plyo::Spools
