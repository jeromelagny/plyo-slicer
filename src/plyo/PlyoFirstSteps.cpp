#include "PlyoFirstSteps.hpp"
#include "PlyoStore.hpp"
#include "PlyoSanitize.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoOrcaMessages.hpp"
#include "PlyoAssistant.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoWelcomeDialog.hpp"
#include "PlyoPrinterSetup.hpp"
#include "PlyoSelfTest.hpp"
#include "PlyoSend.hpp"

#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/BackgroundSlicingProcess.hpp"
#include "slic3r/GUI/Field.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/GLToolbar.hpp"
#include "slic3r/GUI/GUI_Factories.hpp"
#include "slic3r/GUI/I18N.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Tab.hpp"
#include "slic3r/GUI/WebGuideDialog.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <wx/stdpaths.h>
#include <wx/timer.h>
#include <wx/toplevel.h>

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <set>
#include <vector>

namespace Plyo { namespace FirstSteps {

namespace fs = boost::filesystem;
using Slic3r::GUI::wxGetApp;

namespace {

fs::path state_path() { return fs::path(Slic3r::data_dir()) / "plyo" / "premiers-pas.json"; }

// Chaque champ est relu avec son type (Sanitize::first_steps) : une valeur inattendue, venue du panneau ou d'un
// fichier modifié à la main, ne peut pas faire planter le démarrage.
nlohmann::json load_state() { return Sanitize::first_steps(Store::read(state_path())); }

void store_state(const nlohmann::json& s) { Store::write(state_path(), Sanitize::first_steps(s)); }

Slic3r::GUI::GuideFrame* visible_guide()
{
    for (wxWindow* w : wxTopLevelWindows)
        if (auto* guide = dynamic_cast<Slic3r::GUI::GuideFrame*>(w); guide != nullptr && guide->IsShown())
            return guide;
    return nullptr;
}

// Le panneau s'ouvre à chaque lancement ; le bouton « Assistant » de la barre du haut le ferme d'un clic.
void open_panel_at_startup()
{
    auto* frame = wxGetApp().mainframe;
    if (frame == nullptr || is_assistant_shown())
        return;
    // Le panneau vit dans le plateau : Orca démarre sur l'Accueil, où il resterait caché. On passe sur « Préparer ».
    if (!frame->is_prepare_or_preview_tab())
        frame->select_tab(TAB_ID_PREPARE);
    toggle_assistant(wxGetApp().plater());
}

void show_welcome(wxWindow* parent, bool with_setup_tips)
{
    nlohmann::json s = load_state();
    s["seen"]        = true; // écrit avant d'afficher : un écran d'Orca annulé ne fait pas revenir l'accueil
    store_state(s);
    WelcomeDialog dialog(parent, with_setup_tips);
    dialog.ShowModal();
    s          = load_state();
    s["level"] = dialog.choice();
    if (dialog.choice() == "beginner")
        s["tour_step"] = "model";
    store_state(s);
    BOOST_LOG_TRIVIAL(info) << "Plyo: accueil terminé (" << dialog.choice() << ")";
}

std::function<void(const nlohmann::json&)> s_focus_listener;
std::string                                s_focused_key;
const Slic3r::Preset::Type                 TAB_TYPES[] = {Slic3r::Preset::TYPE_PRINT, Slic3r::Preset::TYPE_FILAMENT, Slic3r::Preset::TYPE_PRINTER};

bool is_ancestor_or_self(const wxWindow* ancestor, const wxWindow* w)
{
    for (; w != nullptr; w = w->GetParent())
        if (w == ancestor)
            return true;
    return false;
}

// Champ de réglage qui contient la fenêtre focalisée : clé de configuration, ou "" (champ inconnu, hors onglet).
std::string focused_setting(Slic3r::GUI::Tab* tab, const wxWindow* focused)
{
    const Slic3r::PresetCollection* presets = tab->get_presets();
    if (presets == nullptr || focused == nullptr)
        return std::string();
    for (const std::string& key : presets->get_edited_preset().config.keys()) {
        for (int index : {-1, 0}) {
            Slic3r::GUI::Field* field = tab->get_field(key, index);
            if (field != nullptr && field->getWindow() != nullptr && is_ancestor_or_self(field->getWindow(), focused))
                return key;
        }
    }
    return std::string();
}

// wxEVT_CHILD_FOCUS remonte jusqu'à l'onglet quand un de ses champs prend le focus : rien n'est ajouté à Orca.
bool bind_tabs(std::set<Slic3r::GUI::Tab*>& bound)
{
    bool all = true;
    for (Slic3r::Preset::Type type : TAB_TYPES) {
        Slic3r::GUI::Tab* tab = wxGetApp().get_tab(type);
        if (tab == nullptr) {
            all = false;
            continue;
        }
        if (!bound.insert(tab).second)
            continue;
        tab->Bind(wxEVT_CHILD_FOCUS, [tab](wxChildFocusEvent& evt) {
            evt.Skip();
            const std::string key = focused_setting(tab, wxWindow::FindFocus());
            if (key.empty() || key == s_focused_key || !s_focus_listener)
                return;
            s_focused_key                     = key;
            const Slic3r::ConfigOptionDef* def = Slic3r::print_config_def.get(key);
            const std::string label = def != nullptr ? _u8L(def->full_label.empty() ? def->label : def->full_label) : key;
            s_focus_listener({{"key", key}, {"label", label}});
        });
    }
    return all;
}

// Le démarrage d'Orca se poursuit après le constructeur de MainFrame : l'écran de configuration (GuideFrame, modal)
// s'ouvre plus tard, dans post_init. On l'attend en lisant la liste des fenêtres, sans toucher à Orca.
class StartupWatcher : public wxTimer
{
public:
    explicit StartupWatcher(bool first_run) : m_first_run(first_run)
    {
        // L'écran de configuration d'Orca va s'ouvrir quand il n'y a encore que les imprimantes par défaut
        // (même condition que GUI_App::config_wizard_startup).
        // L'assistant de configuration d'Orca n'est plus lancé au démarrage : l'accueil n'a pas à l'attendre.
        m_expect_guide = false;
        Start(300);
    }

    void Notify() override
    {
        ++m_ticks;
        if (!m_tabs_bound)
            m_tabs_bound = bind_tabs(m_bound);
        auto* frame = wxGetApp().mainframe;
        if (frame == nullptr || !frame->IsShown())
            return;
        Slic3r::GUI::GuideFrame* guide = visible_guide();
        if (m_first_run && !m_welcomed) {
            if (guide != nullptr) {
                m_welcomed  = true;
                m_saw_guide = true;
                wxWindow* parent = guide;
                wxGetApp().CallAfter([parent] { guarded("l'accueil", [&] { show_welcome(parent, true); }); });
                return;
            }
            // Pas d'écran de configuration en vue (Orca déjà configuré, ou délai dépassé) : accueil sur la fenêtre principale.
            const int wait_ticks = m_expect_guide ? 60 : 8; // 18 s ou 2,4 s
            if (m_ticks < wait_ticks)
                return;
            m_welcomed = true;
            wxGetApp().CallAfter([this] {
                guarded("l'accueil", [] { show_welcome(wxGetApp().mainframe, PrinterSetup::needs_printer()); });
                finish();
            });
            return;
        }
        if (m_saw_guide && guide != nullptr)
            return; // l'écran de configuration est encore ouvert
        if (!m_first_run || m_saw_guide || m_done)
            finish();
    }

private:
    void finish()
    {
        if (!m_done) {
            m_done = true;
            wxGetApp().CallAfter([] { guarded("l'ouverture du panneau", [] { open_panel_at_startup(); }); });
        }
        if (m_tabs_bound)
            Stop();
    }

    bool m_first_run    = false;
    bool m_expect_guide = false;
    bool m_welcomed     = false;
    bool m_saw_guide    = false;
    bool m_done         = false;
    bool m_tabs_bound   = false;
    int  m_ticks        = 0;
    std::set<Slic3r::GUI::Tab*> m_bound;
};

const wxWindow* s_watched_frame = nullptr;

// Valeur d'une option comme nombre (premier élément d'une liste, « % » retiré) ou texte ; null si absente ou vide.
nlohmann::json option_value(const Slic3r::DynamicPrintConfig& config, const std::string& key)
{
    const Slic3r::ConfigOption* opt = config.option(key);
    if (opt == nullptr || opt->is_nil())
        return nullptr;
    std::string text = opt->serialize();
    if (opt->is_vector())
        text = text.substr(0, text.find(','));
    if (!text.empty() && text.back() == '%')
        text.pop_back();
    if (text.empty() || text == "nil")
        return nullptr;
    char*        end    = nullptr;
    const double number = std::strtod(text.c_str(), &end);
    return end != nullptr && *end == '\0' ? nlohmann::json(number) : nlohmann::json(text);
}

} // namespace

void on_startup()
{
    // Appelé dans le constructeur de MainFrame : wxGetApp().mainframe n'est affecté qu'après, d'où le report.
    // Une fois par fenêtre principale (Orca la recrée au changement de langue).
    wxGetApp().CallAfter([] {
        const wxWindow* frame = wxGetApp().mainframe;
        if (frame == nullptr || frame == s_watched_frame || !wxGetApp().is_editor())
            return;
        s_watched_frame = frame;
        // Banc d'essai (PLYO_SELFTEST) : jamais l'accueil modal, le panneau s'ouvre directement ; hors banc, inchangé.
        const bool first_run = !SelfTest::active() && !Json::boolean(load_state(), "seen", false);
        new StartupWatcher(first_run); // s'arrête seul ; vit autant que l'application
    });
}

nlohmann::json state() { return load_state(); }

void set_state(const nlohmann::json& patch)
{
    if (!patch.is_object())
        return;
    nlohmann::json s = load_state();
    for (auto& [key, value] : s.items())
        if (patch.contains(key))
            value = patch[key];
    store_state(s); // nettoyé à l'écriture : un mauvais type est remplacé par la valeur par défaut
}

nlohmann::json tour_signals()
{
    nlohmann::json      signals = {{"objects", 0}, {"sliced", false}, {"time_s", 0}, {"weight_g", 0}, {"linked", false}};
    // Imprimante reliée (adresse de connexion dans le profil) : l'étape « Imprimer » n'est pas la même.
    if (wxGetApp().preset_bundle != nullptr) {
        const Slic3r::DynamicPrintConfig& printer = wxGetApp().preset_bundle->printers.get_edited_preset().config;
        signals["linked"] = printer.has("print_host") && !printer.opt_string("print_host").empty();
    }
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return signals;
    signals["objects"]            = plater->model().objects.size();
    // Nom de la première pièce (fichier d'origine si l'objet n'a pas de nom) : la fiche du projet s'en sert quand la pièce
    // vient du menu d'Orca et non du panneau.
    if (!plater->model().objects.empty()) {
        const Slic3r::ModelObject* first = plater->model().objects.front();
        std::string                name  = first->name;
        if (name.empty())
            name = boost::filesystem::path(first->input_file).filename().string();
        signals["part_name"] = Json::utf8_prefix(name, 120);
    }
    // Orca découpe en ce moment : une découpe demandée qui n'a pas démarré a été refusée sans un mot (le panneau demande pourquoi).
    signals["slicing"]            = plater->is_background_process_slicing();
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate != nullptr && plate->is_slice_result_valid()) {
        signals["sliced"] = true;
        // Découpée mais pas imprimable (trajet hors plateau, filament refusé par la surface…) : le parcours ne propose pas d'imprimer.
        signals["ready_for_print"] = OrcaMessages::ready_for_print();
        if (const Slic3r::GCodeProcessorResult* result = plate->get_slice_result())
            signals["time_s"] = result->print_statistics.modes[static_cast<size_t>(Slic3r::PrintEstimatedStatistics::ETimeMode::Normal)].time;
        signals["weight_g"] = plater->get_partplate_list().get_current_fff_print().print_statistics().total_weight;
    }
    return signals;
}

nlohmann::json add_benchy()
{
    const auto& models = Slic3r::GUI::MenuFactory::handy_models();
    for (size_t i = 0; i < models.size(); ++i)
        if (std::string(models[i].key) == "3dbenchy") {
            if (auto* frame = wxGetApp().mainframe)
                frame->select_tab(TAB_ID_PREPARE); // le plateau, si Orca est sur l'accueil
            Slic3r::GUI::MenuFactory::load_handy_model(i);
            return {{"ok", true}, {"text", "Le petit bateau est sur le plateau."}};
        }
    return {{"ok", false}, {"text", "Le petit bateau est introuvable dans Orca."}};
}

std::string best_filament(const std::string& type)
{
    if (type.empty() || wxGetApp().preset_bundle == nullptr)
        return std::string();
    Slic3r::PresetBundle& bundle = *wxGetApp().preset_bundle;
    // Le plus simple d'abord : « Generic PLA @… » plutôt que « Generic PLA Silk » ou une marque.
    const Slic3r::Preset* best       = nullptr;
    int                   best_score = -1;
    for (const Slic3r::Preset& p : bundle.filaments.get_presets()) {
        if (!p.is_visible || !p.is_compatible || p.is_default)
            continue;
        const auto* t = p.config.option<Slic3r::ConfigOptionStrings>("filament_type");
        if (t == nullptr || t->values.empty() || t->values.front() != type)
            continue;
        int score = p.is_system ? 1 : 0;
        if (p.name.rfind("Generic " + type, 0) == 0)
            score += 2;
        if (p.name.rfind("Generic " + type + " @", 0) == 0 || p.name == "Generic " + type)
            score += 4;
        if (score > best_score) {
            best       = &p;
            best_score = score;
        }
    }
    return best != nullptr ? best->name : std::string();
}

nlohmann::json choose_filament(const std::string& type)
{
    static const std::vector<std::string> TYPES = {"PLA", "PETG", "ABS", "ASA", "TPU"};
    if (std::find(TYPES.begin(), TYPES.end(), type) == TYPES.end())
        return {{"ok", false}};
    const std::string name = best_filament(type);
    if (name.empty())
        return {{"ok", false}};
    if (!select_filament(name))
        return {{"ok", false}, {"cancelled", true}};
    return {{"ok", true}, {"name", name}};
}

bool select_filament(const std::string& name, size_t idx)
{
    Slic3r::PresetBundle& bundle = *wxGetApp().preset_bundle;
    if (idx == 0) {
        // Premier filament : l'onglet d'abord. Orca peut demander d'enregistrer un filament modifié, et l'utilisateur peut
        // annuler. La liste du plateau ne change qu'ensuite, sinon elle et l'onglet ne diraient plus la même chose.
        Slic3r::GUI::Tab* tab = wxGetApp().get_tab(Slic3r::Preset::TYPE_FILAMENT);
        if (tab == nullptr || !tab->select_preset(name))
            return false;
    }
    // Puis comme un choix dans la liste du plateau (Plater::priv::on_select_preset).
    bundle.set_filament_preset(idx, name);
    if (Slic3r::GUI::Plater* plater = wxGetApp().plater()) {
        if (idx == 0)
            plater->sidebar().update_presets(Slic3r::Preset::TYPE_FILAMENT); // l'onglet l'a rafraîchie avec l'ancien nom
        plater->update_project_dirty_from_presets();
        plater->sidebar().update_dynamic_filament_list();
        plater->on_filament_change(idx);
    }
    bundle.export_selections(*wxGetApp().app_config);
    return true;
}

namespace {

std::function<void(nlohmann::json)> s_export_done; // export en cours : qui prévenir à sa fin

// Orca propose le dernier dossier d'export, à défaut celui du projet, qui est ici le dossier interne des modèles posés
// par le panneau (plyo/modeles). On lui donne le Bureau à la place, sans toucher à un dossier choisi par l'utilisateur.
void prefer_user_folder()
{
    Slic3r::AppConfig& config  = *wxGetApp().app_config;
    const std::string  current = config.get_last_output_dir(std::string(), false);
    const std::string  inner   = (fs::path(Slic3r::data_dir()) / "plyo").string();
    if (!current.empty() && current.rfind(inner, 0) != 0)
        return;
    const std::string desktop = wxStandardPaths::Get().GetUserDir(wxStandardPaths::Dir_Desktop).ToUTF8().data();
    boost::system::error_code ec;
    if (!desktop.empty() && fs::is_directory(desktop, ec))
        config.update_last_output_dir(desktop, false);
}

} // namespace

void export_file(std::function<void(nlohmann::json)> done)
{
    auto* plater = wxGetApp().plater();
    if (plater == nullptr) {
        done({{"ok", false}});
        return;
    }
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate == nullptr || !plate->is_slice_result_valid()) {
        done({{"ok", false}, {"reason", "not_sliced"}});
        return;
    }
    if (s_export_done || plater->is_export_gcode_scheduled()) {
        done({{"ok", false}, {"reason", "busy"}, {"text", "Un export est déjà en cours : attends qu'il se termine."}});
        return;
    }
    prefer_user_folder();
    s_export_done = std::move(done);
    plater->export_gcode(false); // ouvre la fenêtre d'enregistrement et ne revient qu'à sa fermeture
    // Rien de programmé : fenêtre annulée, ou plaque refusée par Orca (qui l'a dit dans sa propre fenêtre).
    if (s_export_done && !plater->is_export_gcode_scheduled()) {
        auto waiting = std::move(s_export_done);
        s_export_done = nullptr;
        waiting({{"ok", false}, {"cancelled", true}});
    }
}

void on_process_completed(const Slic3r::SlicingProcessCompletedEvent& evt, bool export_scheduled, const std::string& output_path)
{
    // Les deux lignes d'avant dans Plater::priv::on_process_completed : les arguments ne sont lus que pendant un export.
    if (export_scheduled)
        on_export_done(evt.success(), evt.error() ? evt.format_error_message().first : std::string(), output_path);
}

void on_export_done(bool finished, const std::string& error, const std::string& path)
{
    if (!s_export_done)
        return; // export lancé depuis les menus d'Orca
    auto waiting = std::move(s_export_done);
    s_export_done = nullptr;
    if (!finished) {
        if (error.empty())
            waiting({{"ok", false}, {"cancelled", true}}); // arrêté par « Annuler » d'Orca
        else {
            // Famille de l'erreur d'après le type de l'exception (lu juste avant par OrcaMessages), texte sans le dossier.
            nlohmann::json failed = OrcaMessages::export_failure(error, path);
            failed["ok"]           = false;
            failed["reason"]       = "error";
            waiting(failed);
        }
        return;
    }
    // Orca peut renommer le fichier en le finalisant : si ce nom n'existe pas, on ne cite que le dossier.
    boost::system::error_code ec;
    const fs::path written(path);
    waiting({{"ok", true}, {"folder", written.parent_path().string()},
             {"file", fs::exists(written, ec) ? written.filename().string() : std::string()}});
}

void start_print(std::function<void(nlohmann::json)> done)
{
    auto* frame  = wxGetApp().mainframe;
    auto* plater = wxGetApp().plater();
    if (frame == nullptr || plater == nullptr) {
        done({{"ok", false}});
        return;
    }
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate == nullptr || !plate->is_slice_result_valid()) {
        done({{"ok", false}, {"reason", "not_sliced"}});
        return;
    }
    // Même chemin que le bouton « Imprimer la plaque » (MainFrame) : Orca vérifie la plaque et ouvre sa confirmation.
    plater->apply_background_progress();
    if (!frame->get_enable_print_status()) {
        // Pourquoi Orca ne laisse pas imprimer : ce qu'il dit de la plaque (ERR-10), expliqué par le panneau.
        const nlohmann::json report = OrcaMessages::report();
        done({{"ok", false}, {"reason", "not_ready"}, {"issues", report.contains("issues") ? report["issues"] : nlohmann::json::array()}});
        return;
    }
    // Même choix que Plater::priv::on_action_print_plate (sentinelle dans test_plyo.cpp) : Bambu Lab et agents d'imprimante
    // ouvrent la fenêtre de leur module, dont Plyo ne lit rien ; les autres passent par la file d'envoi d'Orca, suivie.
    Slic3r::PresetBundle& bundle = *wxGetApp().preset_bundle;
    if (bundle.use_bbl_network() || wxGetApp().app_config->get_bool("use_printer_agents")) {
        wxPostEvent(plater, Slic3r::GUI::SimpleEvent(Slic3r::GUI::EVT_GLTOOLBAR_PRINT_PLATE));
        done({{"ok", true}, {"route", "device"}});
        return;
    }
    Send::from_panel(std::move(done));
}

nlohmann::json explain(const std::string& key)
{
    nlohmann::json out = {{"key", key}, {"label", key}, {"tooltip", ""}, {"value", nullptr}, {"system_value", nullptr},
                          {"min", nullptr}, {"max", nullptr}, {"unit", ""}};
    if (const Slic3r::ConfigOptionDef* def = Slic3r::print_config_def.get(key)) {
        out["label"]   = _u8L(def->full_label.empty() ? def->label : def->full_label);
        out["tooltip"] = def->tooltip.empty() ? std::string() : _u8L(def->tooltip);
        out["unit"]    = def->sidetext.empty() ? std::string() : _u8L(def->sidetext);
    }
    Slic3r::PresetBundle* bundle = wxGetApp().preset_bundle;
    for (Slic3r::PresetCollection* presets : std::initializer_list<Slic3r::PresetCollection*>{&bundle->prints, &bundle->filaments, &bundle->printers}) {
        if (!presets->get_edited_preset().config.has(key))
            continue;
        out["value"] = option_value(presets->get_edited_preset().config, key);
        if (const Slic3r::Preset* parent = presets->get_selected_preset_parent())
            out["system_value"] = option_value(parent->config, key);
        break;
    }
    const nlohmann::json range = SettingsBridge::whitelist_range(key);
    if (range.is_object()) {
        out["min"]  = range["min"];
        out["max"]  = range["max"];
        out["unit"] = range["unit"];
    }
    return out;
}

void set_focus_listener(std::function<void(const nlohmann::json&)> listener) { s_focus_listener = std::move(listener); }

}} // namespace Plyo::FirstSteps
