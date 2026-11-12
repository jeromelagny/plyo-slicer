#include "PlyoSpools.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoJson.hpp"
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

bool save(const nlohmann::json& reg) { return Store::write(path_of(), SpoolsLogic::sanitize(reg)); }

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

// Crée « <bobine> — <machine> » depuis le profil système de la matière, compatible avec cette seule imprimante, et le
// choisi. Renvoie son nom, ou vide avec `text` (refus) ou `cancelled` (fenêtre d'Orca annulée) dans `out`.
std::string create_preset(const std::string& spool, const std::string& material, const std::string& printer,
                          const std::string& recorded, nlohmann::json& out)
{
    Slic3r::PresetCollection& filaments = bundle()->filaments;
    const Preset*             base      = system_base(material);
    if (base == nullptr) {
        out = refuse("Je ne trouve pas de profil " + material + " pour cette imprimante dans Orca.");
        return "";
    }
    const std::string base_name = base->name; // le pointeur ne survit pas aux changements de la collection
    std::vector<std::string> existing;
    for (const Preset& p : filaments)
        existing.push_back(p.name);
    // Seul le nom déjà noté pour cette bobine sur cette machine peut être repris (son préréglage a disparu d'Orca).
    std::vector<std::string> ours;
    if (!recorded.empty())
        ours.push_back(recorded);
    const std::string name = SpoolsLogic::preset_name(spool, SpoolsLogic::machine_label(printer), existing, ours);

    // L'onglet d'abord : si le filament en cours a des modifications, Orca demande quoi en faire, et l'utilisateur peut annuler.
    if (!FirstSteps::select_filament(base_name)) {
        out = {{"ok", false}, {"cancelled", true}};
        return "";
    }
    // Valeurs ENREGISTRÉES du profil de la matière (pas l'édité, qui peut porter des valeurs transférées d'un autre filament).
    Slic3r::DynamicPrintConfig cfg = filaments.get_selected_preset().config;
    cfg.set_key_value("compatible_printers", new Slic3r::ConfigOptionStrings({printer}));
    Slic3r::GUI::Tab* tab = Slic3r::GUI::wxGetApp().get_tab(Preset::TYPE_FILAMENT);
    if (tab == nullptr) {
        out = refuse("L'onglet Filament d'Orca n'est pas disponible.");
        return "";
    }
    const std::time_t started = std::time(nullptr);
    try {
        tab->load_config(cfg);
        tab->save_preset(name); // nom fourni : aucune fenêtre
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: préréglage de bobine « " << name << " » impossible : " << e.what();
        out = refuse("Orca n'a pas pu écrire le préréglage « " + name + " ».");
        return "";
    }
    // Orca peut refuser sans le dire (températures incohérentes) ou ne pas écrire le fichier (disque) : on vérifie tout.
    const Preset* saved = filaments.find_preset(name, false);
    if (saved == nullptr || filaments.get_selected_preset_name() != name || filaments.current_is_dirty()) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: le préréglage de bobine « " << name << " » n'a pas été enregistré par Orca";
        out = refuse("Orca a refusé d'enregistrer le préréglage « " + name + " ».");
        return "";
    }
    if (!Profiles::written_since(saved->file, started - 2)) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: le fichier du préréglage de bobine « " << name << " » n'a pas été écrit : " << saved->file;
        out = refuse("Orca n'a pas pu écrire le préréglage « " + name + " ».");
        return "";
    }
    if (saved->inherits() != base_name) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: le préréglage de bobine « " << name << " » hérite de « " << saved->inherits()
                                 << " » au lieu de « " << base_name << " »";
        out = refuse("Le préréglage « " + name + " » n'est pas relié au profil « " + base_name + " » d'Orca : je ne le retiens pas.");
        return "";
    }
    FirstSteps::select_filament(name); // comme un choix dans la liste du plateau (aucune question : rien n'est modifié)
    BOOST_LOG_TRIVIAL(info) << "Plyo: préréglage de bobine créé « " << name << " » depuis « " << base_name << " »";
    return name;
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

    const std::string recorded = SpoolsLogic::preset_for(reg, id, printer);
    if (!recorded.empty() && bundle()->filaments.find_preset(recorded, false) != nullptr) {
        if (!FirstSteps::select_filament(recorded))
            return {{"ok", false}, {"cancelled", true}, {"id", id}, {"name", spool}, {"created", created}};
        out["preset"] = recorded;
        return out;
    }

    // La bobine garde sa matière d'origine (« sunlu pla+ noir » retrouvée reste du PLA).
    nlohmann::json    failure;
    const std::string preset = create_preset(spool, material_of(reg, id), printer, recorded, failure);
    if (preset.empty()) {
        failure["id"]      = id;
        failure["name"]    = spool;
        failure["created"] = created;
        return failure;
    }
    if (!save(SpoolsLogic::set_preset(reg, id, printer, preset))) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: registre des bobines non écrit après la création de « " << preset << " »";
        return {{"ok", false}, {"id", id}, {"name", spool}, {"preset", preset}, {"created", created},
                {"text", "Le préréglage « " + preset + " » est créé, mais je n'ai pas pu le noter dans la liste de tes bobines."}};
    }
    out["preset"] = preset;
    return out;
}

nlohmann::json current()
{
    if (bundle() == nullptr)
        return nlohmann::json::object();
    const std::string filament = bundle()->filament_presets.empty() ? bundle()->filaments.get_selected_preset_name()
                                                                    : bundle()->filament_presets.front();
    const nlohmann::json reg = load();
    const std::string    id  = SpoolsLogic::spool_of_preset(reg, filament);
    if (id.empty())
        return nlohmann::json::object();
    return {{"id", id}, {"name", SpoolsLogic::spool_name(reg, id)}};
}

}} // namespace Plyo::Spools
