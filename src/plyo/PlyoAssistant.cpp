#include "PlyoAssistant.hpp"

#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/DockPanel.hpp"
#include "slic3r/GUI/Plater.hpp"

#include <boost/filesystem/path.hpp>
#include <boost/log/trivial.hpp>
#include <nlohmann/json.hpp>

#include <wx/gdicmn.h>
#include <wx/weakref.h>

#include <fstream>
#include <sstream>
#include <string>

namespace Plyo {

using Slic3r::GUI::DockPanel;
using Slic3r::GUI::Plater;

namespace {

constexpr const char* PANE_NAME = "plyo:assistant";

// Le panneau est détruit par Orca quand on le ferme ; wxWeakRef repasse alors à nullptr tout seul.
wxWeakRef<DockPanel> s_panel;

std::string load_page()
{
    const boost::filesystem::path path = boost::filesystem::path(Slic3r::resources_dir()) / "web" / "plyo" / "index.html";
    std::ifstream                 file(path.string(), std::ios::binary);
    if (!file) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible de lire " << path.string();
        return "<h3>Assistant Plyo</h3><p>Page introuvable : resources/web/plyo/index.html</p>";
    }
    std::ostringstream content;
    content << file.rdbuf();
    return content.str();
}

void on_page_message(const nlohmann::json& data)
{
    const std::string type = data.is_object() ? data.value("type", std::string()) : std::string();
    if (type == "ready" && s_panel)
        s_panel->push_message({{"type", "status"}, {"text", "Connecté au slicer."}});
    else
        BOOST_LOG_TRIVIAL(warning) << "Plyo: message inconnu reçu du panneau : " << data.dump();
}

} // namespace

void toggle_assistant(Plater* plater)
{
    if (s_panel) {
        s_panel->request_close();
        return;
    }
    if (plater == nullptr)
        return;

    auto* panel = new DockPanel(plater, load_page(), on_page_message, nullptr, nullptr);
    s_panel     = panel;
    plater->add_dock_pane(panel, PANE_NAME, "Assistant Plyo", "right", wxSize(340, 600), [panel]() { panel->fire_close(); });
}

bool is_assistant_shown() { return s_panel; }

} // namespace Plyo
