#include "PlyoAssistant.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoCalibration.hpp"
#include "PlyoCommands.hpp"
#include "PlyoConversations.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoHighlight.hpp"
#include "PlyoJournal.hpp"
#include "PlyoLoginDialog.hpp"
#include "PlyoMakerWorldImport.hpp"
#include "PlyoMakerWorldWindow.hpp"
#include "PlyoMemory.hpp"
#include "PlyoModelImport.hpp"
#include "PlyoPhoneDialog.hpp"
#include "PlyoPlateActions.hpp"
#include "PlyoPreflight.hpp"
#include "PlyoSession.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/DockPanel.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Widgets/SideButton.hpp"
#include "slic3r/GUI/Widgets/StateColor.hpp"

#include <boost/filesystem/path.hpp>
#include <boost/log/trivial.hpp>
#include <boost/nowide/fstream.hpp>
#include <nlohmann/json.hpp>

#include <wx/aui/framemanager.h>
#include <wx/gdicmn.h>
#include <wx/panel.h>
#include <wx/sizer.h>
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
wxWeakRef<SideButton> s_topbar_button;

// Bouton de la barre du haut : plein quand le panneau est ouvert, cerné quand il est fermé.
void refresh_topbar_button()
{
    if (!s_topbar_button)
        return;
    const wxColour bar     = StateColor::darkModeColorFor(wxColour("#3B4446"));
    const wxColour teal    = wxColour(0, 150, 136);
    const wxColour hovered = wxColour(38, 166, 154);
    StateColor     bg;
    bg.append(wxColour(0, 137, 123), StateColor::Pressed);
    bg.append(hovered, StateColor::Hovered);
    bg.append(s_panel ? teal : bar, StateColor::Normal);
    StateColor border;
    border.append(hovered, StateColor::Hovered);
    border.append(teal, StateColor::Normal);
    s_topbar_button->SetBackgroundColor(bg);
    s_topbar_button->SetBorderColor(border);
    s_topbar_button->Refresh();
}

std::string read_resource(const std::string& name)
{
    const boost::filesystem::path path = boost::filesystem::path(Slic3r::resources_dir()) / "web" / "plyo" / name;
    boost::nowide::ifstream       file(path.string(), std::ios::binary);
    if (!file) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible de lire " << path.string();
        return std::string();
    }
    std::ostringstream content;
    content << file.rdbuf();
    return content.str();
}

// La page est chargée comme texte (sans adresse de base dans resources/web/plyo) : les scripts annexes
// sont insérés à la place de leurs marqueurs « <!--plyo-include:nom.js--> ».
std::string load_page()
{
    std::string page = read_resource("index.html");
    if (page.empty())
        return "<h3>Assistant Plyo</h3><p>Page introuvable : resources/web/plyo/index.html</p>";
    for (const char* name : {"fiches.js", "premiers-pas.js", "rich-text.js", "assistant-logic.js", "preflight.js"}) {
        const std::string marker = std::string("<!--plyo-include:") + name + "-->";
        if (const size_t at = page.find(marker); at != std::string::npos)
            page.replace(at, marker.size(), "<script>\n" + read_resource(name) + "\n</script>");
    }
    return page;
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
    const std::string type = data.is_object() ? Json::str(data, "type") : std::string();
    try {
        if (type == "ready") {
            send({{"type", "status"}, {"text", "Connecté au slicer."}});
            send_values();
        } else if (type == "get_values")
            send_values();
        else if (type == "apply") {
            // Chaque application réussie est notée dans la mémoire de la machine (imprimante + filament).
            const nlohmann::json before = SettingsBridge::read_values();
            const nlohmann::json result = SettingsBridge::apply_changes(data.contains("changes") ? data["changes"] : nlohmann::json());
            if (Json::boolean(result, "ok", false)) {
                const nlohmann::json ask = data.contains("ask") ? data["ask"] : nlohmann::json();
                const std::string    key = Memory::note_applied(before, SettingsBridge::read_values(), Json::str(data, "why"), ask);
                SettingsBridge::set_memory_key(Json::integer(result, "undo_id", 0), key);
                // Réglages venus d'une réponse de l'IA : notés aussi dans le journal de la pièce.
                const nlohmann::json noted = Memory::for_current();
                if (ask.is_object() && !key.empty() && !noted.empty())
                    Journal::set_changes(Json::str(ask, "conv"), Json::arr(noted[0], "changes"));
            }
            send_result(result);
        } else if (type == "undo") {
            // `undo_id` : l'annulation d'une fiche précise ; sans, le dernier lot (menu « ⋯ »).
            const nlohmann::json result = SettingsBridge::undo_last(Json::integer(data, "undo_id", 0));
            if (Json::boolean(result, "ok", false))
                Journal::clear_changes(Memory::forget(Json::str(result, "memory_key")));
            send_result(result);
        } else if (type == "ai_context")
            // Juste avant une demande à l'IA : le plateau et ce qui a déjà été appliqué sur cette machine.
            send({{"type", "ai_context"}, {"plate", PlateActions::context()}, {"memory", Memory::for_current()}});
        else if (type == "outcome_pending")
            send({{"type", "outcome_pending"}, {"items", Memory::pending()}});
        else if (type == "outcome_set") {
            const std::string note = Json::str(data, "note");
            Journal::set_outcome(Json::str(data, "conv"), Json::str(data, "outcome"), note);
            send({{"type", "outcome_saved"},
                  {"ok", Memory::set_outcome(Json::str(data, "machine"), Json::str(data, "at"), Json::str(data, "outcome"), note)}});
        } else if (type == "journal_add")
            Journal::record(data);
        else if (type == "journal_list")
            send({{"type", "journal"}, {"events", Journal::list()}});
        else if (type == "preflight")
            // Après un découpage (ou sur demande) : mesures du plateau pour la vérification avant impression.
            send({{"type", "preflight"}, {"data", Preflight::measure()}});
        else if (type == "plate_action") {
            const std::string kind = Json::str(data, "kind");
            nlohmann::json    done = kind == "undo" ? PlateActions::undo(Json::integer(data, "undo_token", -1LL)) : PlateActions::run(kind);
            done["type"]           = "plate_action";
            done["kind"]           = kind;
            done["request"]        = Json::integer(data, "request", 0); // pour retrouver le bouton qui a demandé l'action
            send(done);
        } else if (type == "commands") {
            // Ordres de l'IA (« penche la pièce de 20° ») : exécutés aussitôt, annulables d'un clic (plate_action « undo »).
            nlohmann::json done = Commands::run(data.contains("commands") ? data["commands"] : nlohmann::json());
            done["type"]        = "commands";
            done["request"]     = Json::integer(data, "request", 0);
            send(done);
        } else if (type == "open_tool") {
            nlohmann::json done = Commands::open_tool(Json::str(data, "tool"));
            done["type"]        = "open_tool";
            send(done);
        } else if (type == "show_setting") {
            const std::string key = Json::str(data, "key");
            Highlight::show_setting(key, [key](const nlohmann::json& shown) {
                nlohmann::json message = shown;
                message["type"]        = "show_setting";
                message["key"]         = key;
                send(message);
            });
        } else if (type == "conv_list")
            send({{"type", "conv_list"}, {"items", Conversations::list()}});
        else if (type == "conv_load") {
            const std::string id = Json::str(data, "id");
            send({{"type", "conv_loaded"}, {"id", id}, {"conversation", Conversations::load(id)}});
        } else if (type == "conv_save") {
            // Enregistrement silencieux : le panneau n'attend pas de réponse, un échec est seulement journalisé.
            if (!Conversations::save(Json::str(data, "id"), Json::any(data, "conversation"))) {
                BOOST_LOG_TRIVIAL(warning) << "Plyo: conversation non enregistrée";
                send({{"type", "conv_save_failed"}, {"id", Json::str(data, "id")}});
            }
        } else if (type == "conv_delete") {
            Conversations::remove(Json::str(data, "id"));
            send({{"type", "conv_list"}, {"items", Conversations::list()}});
        }
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
            const nlohmann::json link    = Json::any(data, "link");
            if (!s_phone_open && session.is_object() && link.is_object() && link.contains("id") && link["id"].is_string()) {
                s_phone_open = true;
                PhoneDialog dialog(Slic3r::GUI::wxGetApp().mainframe, session["access_token"].get<std::string>(), link);
                const int result = dialog.ShowModal();
                s_phone_open = false;
                if (result == wxID_OK)
                    send({{"type", "phone_batch_ready"}});
            }
        } else if (type == "makerworld") {
            // Page MakerWorld dans une fenêtre Plyo ; le lien « Ouvrir dans … » est importé par Orca.
            const std::string url = Json::str(data, "url");
            if (MakerWorldWindow::is_makerworld_url(url)) {
                auto* window = new MakerWorldWindow(Slic3r::GUI::wxGetApp().mainframe, url, [](const std::string& open_url) {
                    send({{"type", "makerworld_opened"}});
                    // Import synchrone, puis fiche « créateur → toi » si le projet a apporté ses réglages.
                    const nlohmann::json imported = MakerWorldImport::import_link(open_url);
                    if (!imported.is_null())
                        send(imported);
                });
                window->Show();
            } else
                send_result({{"ok", false}, {"text", "Adresse MakerWorld non reconnue."}});
        } else if (type == "makerworld_apply")
            send_result(MakerWorldImport::apply(Json::boolean(data, "keep_filaments", false), data.contains("changes") ? data["changes"] : nlohmann::json()));
        else if (type == "makerworld_undo")
            send_result(MakerWorldImport::restore_creator());
        else if (type == "makerworld_mono")
            send_result(MakerWorldImport::use_my_filament_everywhere());
        else if (type == "calib_start") {
            // Calibration guidée : lancé seulement par le bouton « Lancer le test » du panneau.
            nlohmann::json started = Calibration::start_test(Json::str(data, "test"), Json::integer(data, "pass", 1), Json::num(data, "base_value", 0.0));
            if (Json::boolean(started, "ok", false)) {
                started["type"] = "calib_started";
                send(started);
            } else
                send_result(started);
        } else if (type == "calib_save") {
            send_result(Calibration::save_result(Json::str(data, "test"), Json::num(data, "value", 0.0)));
            send({{"type", "calib_history"}, {"items", Calibration::history_for_current()}});
        } else if (type == "calib_restore")
            send_result(Calibration::restore());
        else if (type == "calib_history")
            send({{"type", "calib_history"}, {"items", Calibration::history_for_current()}});
        else if (type == "firststeps_state")
            send({{"type", "firststeps"}, {"state", FirstSteps::state()}});
        else if (type == "firststeps_set") {
            FirstSteps::set_state(Json::obj(data, "patch"));
            send({{"type", "firststeps"}, {"state", FirstSteps::state()}});
        } else if (type == "tour_signals") {
            nlohmann::json signals = FirstSteps::tour_signals();
            signals["type"]        = "tour_signals";
            send(signals);
        } else if (type == "tour_add_benchy")
            send_result(FirstSteps::add_benchy());
        else if (type == "model_add") {
            // Modèle 3D joint dans le panneau (trombone ou glisser-déposer).
            nlohmann::json added = ModelImport::add(Json::str(data, "name"), Json::str(data, "data"));
            added["type"]        = "model_added";
            send(added);
        } else if (type == "show_me") {
            const std::string target = Json::str(data, "target");
            send({{"type", "show_me"}, {"target", target}, {"ok", Json::boolean(Highlight::show(target), "ok", false)}});
        } else if (type == "explain") {
            nlohmann::json fiche = FirstSteps::explain(Json::str(data, "key"));
            fiche["type"]        = "explain";
            send(fiche);
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
        s_panel->CallAfter([data]() { guarded("un message du panneau", [&] { handle_page_message(data); }); });
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

    FirstSteps::set_focus_listener([](const nlohmann::json& focus) {
        nlohmann::json message = focus;
        message["type"]        = "focus_setting";
        send(message);
    });
    auto* panel = new DockPanel(plater, load_page(), on_page_message, [] {}, [] {
        // Panneau détruit (fermé par sa croix ou par le bouton) : le bouton du haut repasse à « fermé ».
        if (s_topbar_button)
            s_topbar_button->CallAfter([] { refresh_topbar_button(); });
    });
    s_panel           = panel;
    s_refresh_pending = false; // un rafraîchissement en attente meurt avec l'ancien panneau
    plater->add_dock_pane(panel, PANE_NAME, "Assistant Plyo", "right", wxSize(380, 600), [panel]() { panel->fire_close(); });
    // La disposition enregistrée par Orca peut garder une largeur minuscule (18 px vu) : le panneau serait
    // à peine visible. On lui impose une largeur minimale, et sa largeur normale si la sienne est trop petite.
    if (wxAuiManager* aui = wxAuiManager::GetManager(panel)) {
        wxAuiPaneInfo& pane  = aui->GetPane(panel);
        const int      min_w = panel->FromDIP(320);
        if (pane.IsOk()) {
            pane.MinSize(wxSize(min_w, -1));
            if (pane.best_size.x < panel->FromDIP(360))
                pane.BestSize(wxSize(panel->FromDIP(380), pane.best_size.y));
            aui->Update();
        }
    }
    refresh_topbar_button();
}

bool is_assistant_shown() { return s_panel; }

wxWindow* create_topbar_button(wxWindow* parent)
{
    auto* holder = new wxPanel(parent, wxID_ANY);
    holder->SetBackgroundColour(StateColor::darkModeColorFor(wxColour("#3B4446")));
    auto* button = new SideButton(holder, "Assistant", "");
    button->SetLayoutStyle(1); // pilule arrondie des deux côtés (le style par défaut est collé à une flèche « ˅ »)
    button->SetTextLayout(SideButton::EHorizontalOrientation::HO_Center, holder->FromDIP(15));
    button->SetCornerRadius(holder->FromDIP(12));
    button->SetExtraSize(wxSize(holder->FromDIP(38), holder->FromDIP(10)));
    button->SetMinSize(wxSize(-1, holder->FromDIP(24)));
    button->SetToolTip("Ouvrir ou fermer l'assistant Plyo");
    button->Bind(wxEVT_BUTTON, [](wxCommandEvent&) {
        // Le panneau vit dans le plateau : depuis un autre onglet, on revient d'abord sur « Préparer ».
        auto* frame = Slic3r::GUI::wxGetApp().mainframe;
        if (!s_panel && frame != nullptr && !frame->is_prepare_or_preview_tab())
            frame->select_tab(TAB_ID_PREPARE);
        toggle_assistant(Slic3r::GUI::wxGetApp().plater());
    });
    auto* sizer = new wxBoxSizer(wxHORIZONTAL);
    sizer->Add(button, 0, wxALIGN_CENTER_VERTICAL);
    holder->SetSizer(sizer);
    s_topbar_button = button;
    refresh_topbar_button();
    return holder;
}

void on_config_changed()
{
    // Orca peut appeler ceci plusieurs fois de suite : on regroupe en un seul envoi.
    if (!s_panel || s_refresh_pending)
        return;
    s_refresh_pending = true;
    s_panel->CallAfter([]() {
        s_refresh_pending = false;
        guarded("la lecture des réglages", [] { send_values(); });
    });
}

} // namespace Plyo
