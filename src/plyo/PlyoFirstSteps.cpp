#include "PlyoFirstSteps.hpp"
#include "PlyoAssistant.hpp"
#include "PlyoWelcomeDialog.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/WebGuideDialog.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <wx/timer.h>
#include <wx/toplevel.h>

#include <fstream>

namespace Plyo { namespace FirstSteps {

namespace fs = boost::filesystem;
using Slic3r::GUI::wxGetApp;

namespace {

fs::path state_path() { return fs::path(Slic3r::data_dir()) / "plyo" / "premiers-pas.json"; }

nlohmann::json defaults() { return {{"seen", false}, {"level", nullptr}, {"panel_closed", false}, {"tour_step", nullptr}}; }

nlohmann::json load_state()
{
    nlohmann::json s = defaults();
    std::ifstream  in(state_path().string(), std::ios::binary);
    if (!in)
        return s;
    const nlohmann::json stored = nlohmann::json::parse(in, nullptr, false);
    if (stored.is_object())
        for (auto& [key, value] : s.items())
            if (stored.contains(key))
                value = stored[key];
    return s;
}

void store_state(const nlohmann::json& s)
{
    const fs::path            path = state_path();
    const fs::path            tmp  = path.string() + ".tmp";
    boost::system::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    {
        std::ofstream out(tmp.string(), std::ios::binary | std::ios::trunc);
        if (!out)
            return;
        out << s.dump(2);
    }
    fs::permissions(tmp, fs::owner_read | fs::owner_write, ec);
    fs::rename(tmp, path, ec);
    if (ec)
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible d'enregistrer l'état des premiers pas : " << ec.message();
}

Slic3r::GUI::GuideFrame* visible_guide()
{
    for (wxWindow* w : wxTopLevelWindows)
        if (auto* guide = dynamic_cast<Slic3r::GUI::GuideFrame*>(w); guide != nullptr && guide->IsShown())
            return guide;
    return nullptr;
}

void open_panel_unless_closed()
{
    auto* frame = wxGetApp().mainframe;
    if (frame != nullptr && !load_state().value("panel_closed", false) && !is_assistant_shown())
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
        auto* frame = wxGetApp().mainframe;
        if (frame == nullptr || !frame->IsShown())
            return;
        Slic3r::GUI::GuideFrame* guide = visible_guide();
        if (m_first_run && !m_welcomed) {
            if (guide != nullptr) {
                m_welcomed  = true;
                m_saw_guide = true;
                wxWindow* parent = guide;
                wxGetApp().CallAfter([parent] { show_welcome(parent, true); });
                return;
            }
            // Pas d'écran de configuration en vue (Orca déjà configuré, ou délai dépassé) : accueil sur la fenêtre principale.
            const int wait_ticks = m_expect_guide ? 60 : 8; // 18 s ou 2,4 s
            if (m_ticks < wait_ticks)
                return;
            m_welcomed = true;
            wxGetApp().CallAfter([this] {
                show_welcome(wxGetApp().mainframe, false);
                finish();
            });
            return;
        }
        if (m_saw_guide && guide != nullptr)
            return; // l'écran de configuration est encore ouvert
        if (!m_first_run || m_saw_guide)
            finish();
    }

private:
    void finish()
    {
        if (m_done)
            return;
        m_done = true;
        Stop();
        wxGetApp().CallAfter([] { open_panel_unless_closed(); });
    }

    bool m_first_run    = false;
    bool m_expect_guide = false;
    bool m_welcomed     = false;
    bool m_saw_guide    = false;
    bool m_done         = false;
    int  m_ticks        = 0;
};

StartupWatcher* s_watcher = nullptr;

} // namespace

void on_startup()
{
    if (s_watcher != nullptr || !wxGetApp().is_editor())
        return;
    s_watcher = new StartupWatcher(!load_state().value("seen", false)); // vit autant que l'application
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
    store_state(s);
}

}} // namespace Plyo::FirstSteps
