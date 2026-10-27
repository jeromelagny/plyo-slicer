#include "PlyoFirstSteps.hpp"
#include "PlyoStore.hpp"
#include "PlyoSanitize.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoAssistant.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoWelcomeDialog.hpp"

#include "libslic3r/Print.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/Field.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/GUI_Factories.hpp"
#include "slic3r/GUI/I18N.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Tab.hpp"
#include "slic3r/GUI/WebGuideDialog.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <wx/timer.h>
#include <wx/toplevel.h>

#include <cstdlib>
#include <fstream>
#include <set>

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
        m_expect_guide = first_run && wxGetApp().preset_bundle != nullptr && wxGetApp().preset_bundle->printers.only_default_printers();
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
                guarded("l'accueil", [] { show_welcome(wxGetApp().mainframe, false); });
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
        new StartupWatcher(!Json::boolean(load_state(), "seen", false)); // s'arrête seul ; vit autant que l'application
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
    nlohmann::json      signals = {{"objects", 0}, {"sliced", false}, {"time_s", 0}, {"weight_g", 0}};
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return signals;
    signals["objects"]            = plater->model().objects.size();
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate != nullptr && plate->is_slice_result_valid()) {
        signals["sliced"] = true;
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
