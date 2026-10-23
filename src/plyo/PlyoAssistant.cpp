#include "PlyoAssistant.hpp"
#include "PlyoLoginDialog.hpp"
#include "PlyoPhoneDialog.hpp"
#include "PlyoSession.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/DockPanel.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"

#include <boost/filesystem/path.hpp>
#include <boost/log/trivial.hpp>
#include <nlohmann/json.hpp>

#include <wx/gdicmn.h>
#include <wx/weakref.h>

#include <exception>
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
bool                 s_refresh_pending = false;

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

void send(const nlohmann::json& message)
{
    if (s_panel)
        s_panel->push_message(message);
}

void send_values()
{
    nlohmann::json message = SettingsBridge::read_values();
    message["type"]        = "values";
    // Langue de l'interface d'Orca (ex. « fr_FR ») : l'assistant répond dans cette langue.
    message["locale"]      = Slic3r::GUI::wxGetApp().current_language_code().utf8_string();
    send(message);
}

void send_result(const nlohmann::json& result)
{
    nlohmann::json message = result;
    message["type"]        = "result";
    send(message);
}

void handle_page_message(const nlohmann::json& data)
{
    const std::string type = data.is_object() ? data.value("type", std::string()) : std::string();
    try {
        if (type == "ready") {
            send({{"type", "status"}, {"text", "Connecté au slicer."}});
            send_values();
        } else if (type == "get_values")
            send_values();
        else if (type == "apply")
            send_result(SettingsBridge::apply_changes(data.contains("changes") ? data["changes"] : nlohmann::json()));
        else if (type == "undo")
            send_result(SettingsBridge::undo_last());
        else if (type == "session_load")
            send({{"type", "session"}, {"session", Session::load()}});
        else if (type == "session_save")
            send({{"type", "session_saved"}, {"ok", Session::save(data.contains("session") ? data["session"] : nlohmann::json())}});
        else if (type == "login") {
            // Fenêtre de connexion modale centrée sur Orca ; le panneau reçoit ensuite la session (ou null).
            // Une seule fenêtre à la fois : un double-clic ne doit pas en ouvrir une seconde imbriquée.
            static bool s_login_open = false;
            if (!s_login_open) {
                s_login_open = true;
                LoginDialog dialog(Slic3r::GUI::wxGetApp().mainframe);
                dialog.ShowModal();
                s_login_open = false;
                send({{"type", "session"}, {"session", Session::load()}});
            }
        } else if (type == "phone") {
            // Fenêtre du QR code du lien téléphone (créé par le panneau) ; une seule à la fois.
            // Au premier envoi du téléphone elle se ferme, et le panneau va chercher l'envoi aussitôt.
            static bool s_phone_open = false;
            const nlohmann::json session = Session::load();
            const nlohmann::json link    = data.value("link", nlohmann::json());
            if (!s_phone_open && session.is_object() && link.is_object() && link.contains("id") && link["id"].is_string()) {
                s_phone_open = true;
                PhoneDialog dialog(Slic3r::GUI::wxGetApp().mainframe, session["access_token"].get<std::string>(), link);
                const int result = dialog.ShowModal();
                s_phone_open = false;
                if (result == wxID_OK)
                    send({{"type", "phone_batch_ready"}});
            }
        } else if (type == "session_clear") {
            Session::clear();
            send({{"type", "session"}, {"session", nullptr}});
        }
        else
            BOOST_LOG_TRIVIAL(warning) << "Plyo: message inconnu reçu du panneau : " << data.dump();
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: erreur en traitant « " << type << " » : " << e.what();
        send_result({{"ok", false}, {"text", std::string("Erreur interne : ") + e.what()}});
    }
    // Les valeurs affichées sont rafraîchies par on_config_changed() après une modification.
}

// Appelé pendant le callback de message de la vue web : on ne touche pas à l'interface ici
// (règle Orca/wxWidgets), on reporte le traitement. CallAfter sur le panneau : si le panneau
// est détruit d'ici là, l'appel en attente est abandonné avec lui.
void on_page_message(const nlohmann::json& data)
{
    if (s_panel)
        s_panel->CallAfter([data]() { handle_page_message(data); });
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

    auto* panel       = new DockPanel(plater, load_page(), on_page_message, nullptr, nullptr);
    s_panel           = panel;
    s_refresh_pending = false; // un rafraîchissement en attente meurt avec l'ancien panneau
    plater->add_dock_pane(panel, PANE_NAME, "Assistant Plyo", "right", wxSize(340, 600), [panel]() { panel->fire_close(); });
}

bool is_assistant_shown() { return s_panel; }

void on_config_changed()
{
    // Orca peut appeler ceci plusieurs fois de suite : on regroupe en un seul envoi.
    if (!s_panel || s_refresh_pending)
        return;
    s_refresh_pending = true;
    s_panel->CallAfter([]() {
        s_refresh_pending = false;
        send_values();
    });
}

} // namespace Plyo
