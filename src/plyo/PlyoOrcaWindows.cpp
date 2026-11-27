#include "PlyoOrcaWindows.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoOrcaMessages.hpp"

#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/MsgDialog.hpp"
#include "slic3r/GUI/PrintHostDialogs.hpp"

#include <boost/log/trivial.hpp>

#include <wx/dialog.h>
#include <wx/html/htmlwin.h>
#include <wx/stattext.h>
#include <wx/timer.h>
#include <wx/toplevel.h>
#include <wx/weakref.h>

#include <algorithm>
#include <deque>
#include <string>
#include <typeinfo>
#include <utility>
#include <vector>

namespace Plyo { namespace OrcaWindows {

namespace {

using Slic3r::GUI::wxGetApp;
namespace GUI = Slic3r::GUI;

constexpr int    TICK_MS        = 300;
constexpr size_t MAX_HISTORY    = 20;
constexpr int    ISSUE_MINUTES  = 15;
constexpr size_t MAX_ISSUES     = 3;
constexpr size_t MAX_TITLE      = 120;

std::function<void(const nlohmann::json&)> s_listener;
wxTimer*                                   s_timer = nullptr; // pointeur nu : détruit par stop(), jamais à la fin du programme

wxWeakRef<wxDialog> s_dialog; // fenêtre de message suivie (ouverte)
Seen                s_current;
int                 s_next_id = 0;
std::deque<Seen>    s_history; // fenêtres vues, la plus récente à la fin

std::string       s_during;          // action du panneau en cours (Scope)
bool              s_send_seen = false; // la fenêtre d'envoi d'Orca s'est montrée pendant ce Scope
std::string       s_expect;          // action attendue pour les fenêtres qui s'ouvrent bientôt (expect)
Clock::time_point s_expect_until;
std::string       s_cover;           // source qui explique déjà la prochaine fenêtre d'erreur (cover)
Clock::time_point s_cover_until;

void notify(const nlohmann::json& message)
{
    if (s_listener)
        s_listener(message);
}

// Genre d'une fenêtre de message d'Orca ; "" pour toute autre fenêtre (jamais lue). La fenêtre d'envoi (PrintHostSendDialog)
// et les fenêtres de mise à jour dérivent aussi de MsgDialog : elles ne sont pas des messages.
std::string message_kind(wxDialog* dialog)
{
    if (dynamic_cast<GUI::ErrorDialog*>(dialog) != nullptr)
        return "error";
    if (dynamic_cast<GUI::WarningDialog*>(dialog) != nullptr)
        return "warning";
    if (dynamic_cast<GUI::MessageDialog*>(dialog) == nullptr && dynamic_cast<GUI::RichMessageDialog*>(dialog) == nullptr &&
        dynamic_cast<GUI::InfoDialog*>(dialog) == nullptr)
        return std::string();
    // Une question a un choix : Oui / Non, ou Annuler à côté de OK.
    const bool choice = dialog->FindWindow(wxID_YES) != nullptr || dialog->FindWindow(wxID_NO) != nullptr ||
                        dialog->FindWindow(wxID_CANCEL) != nullptr;
    return choice ? "question" : "info";
}

// Texte d'une fenêtre de message (MsgDialog.cpp, add_msg_content) : une page HTML, ou un texte dans une zone qui défile. Les
// textes posés directement sur la fenêtre (« Ne plus afficher ») et les boutons ne comptent pas.
void collect_text(wxWindow* window, wxWindow* dialog, std::vector<std::string>& out, int depth)
{
    for (wxWindow* child : window->GetChildren()) {
        if (child == nullptr)
            continue;
        if (auto* html = dynamic_cast<wxHtmlWindow*>(child))
            out.push_back(html->ToText().utf8_string());
        else if (auto* text = dynamic_cast<wxStaticText*>(child)) {
            if (window != dialog)
                out.push_back(text->GetLabel().utf8_string());
        } else if (depth < 4 && dynamic_cast<wxTopLevelWindow*>(child) == nullptr)
            collect_text(child, dialog, out, depth + 1);
    }
}

std::string dialog_text(wxDialog* dialog)
{
    std::vector<std::string> parts;
    collect_text(dialog, dialog, parts, 0);
    std::string text;
    for (const std::string& p : parts)
        if (!p.empty())
            text += (text.empty() ? "" : "\n") + p;
    return OrcaMessages::clean_for_panel(text);
}

nlohmann::json to_json(const Seen& s, const char* phase)
{
    return {{"type", "orca_dialog"}, {"phase", phase}, {"id", s.id}, {"kind", s.kind}, {"title", s.title}, {"text", s.text},
            {"during", s.during}, {"covered", s.covered}};
}

void remember(const Seen& s)
{
    for (Seen& h : s_history)
        if (h.id == s.id) {
            h = s;
            return;
        }
    s_history.push_back(s);
    while (s_history.size() > MAX_HISTORY)
        s_history.pop_front();
}

// Fenêtre de dialogue modale du dessus (la dernière créée parmi celles montrées), ou nullptr.
wxDialog* top_modal()
{
    wxDialog* top = nullptr;
    for (wxWindow* w : wxTopLevelWindows) {
        auto* dialog = dynamic_cast<wxDialog*>(w);
        if (dialog != nullptr && dialog->IsShown() && dialog->IsModal())
            top = dialog;
    }
    return top;
}

void close_current()
{
    s_current.open = false;
    remember(s_current);
    notify(to_json(s_current, "closed"));
    s_dialog  = nullptr;
    s_current = Seen();
}

void poll()
{
    // La fenêtre suivie est fermée (détruite, cachée ou plus modale).
    if (s_current.id != 0 && (!s_dialog || !s_dialog->IsShown() || !s_dialog->IsModal()))
        close_current();
    wxDialog* top = top_modal();
    if (top == nullptr)
        return;
    if (dynamic_cast<GUI::PrintHostSendDialog*>(top) != nullptr) {
        if (!s_during.empty())
            s_send_seen = true;
        return;
    }
    if (s_current.id != 0) // une fenêtre est déjà suivie (une autre peut s'ouvrir par-dessus : on garde la première)
        return;
    const std::string kind = message_kind(top);
    if (kind.empty())
        return; // pas une fenêtre de message : ni lue, ni touchée
    const Clock::time_point now = Clock::now();
    Seen s;
    s.id     = ++s_next_id;
    s.kind   = kind;
    s.title  = Json::utf8_prefix(OrcaMessages::clean_for_panel(top->GetTitle().utf8_string()), MAX_TITLE);
    s.text   = dialog_text(top);
    s.during = !s_during.empty() ? s_during : (now < s_expect_until ? s_expect : std::string());
    if (kind == "error" && !s_cover.empty() && now < s_cover_until) {
        s.covered = s_cover;
        s_cover.clear();
    }
    s.at      = now;
    s_current = s;
    s_dialog  = top;
    remember(s);
    notify(to_json(s, "open"));
}

void guarded_poll() { guarded("l'observation des fenêtres d'Orca", [] { poll(); }); }

} // namespace

void set_listener(std::function<void(const nlohmann::json&)> listener) { s_listener = std::move(listener); }

void start()
{
    if (s_timer != nullptr)
        return;
    s_timer = new wxTimer();
    // Le minuteur tourne aussi pendant une fenêtre modale (boucle d'événements de la fenêtre).
    s_timer->Bind(wxEVT_TIMER, [](wxTimerEvent&) { guarded_poll(); });
    s_timer->Start(TICK_MS);
}

void stop()
{
    if (s_timer == nullptr)
        return;
    s_timer->Stop();
    delete s_timer;
    s_timer   = nullptr;
    s_dialog  = nullptr;
    s_current = Seen();
}

void poll_now() { guarded_poll(); }

Scope::Scope(const char* during) : m_previous(s_during), m_previous_send_seen(s_send_seen)
{
    s_during    = during != nullptr ? during : "";
    s_send_seen = false;
}

Scope::~Scope()
{
    s_during    = m_previous;
    s_send_seen = m_previous_send_seen || s_send_seen;
}

bool Scope::send_dialog_seen() const { return s_send_seen; }

void expect(const std::string& during, int ms)
{
    s_expect       = during;
    s_expect_until = Clock::now() + std::chrono::milliseconds(ms);
}

void cover(const std::string& source, int ms)
{
    s_cover       = source;
    s_cover_until = Clock::now() + std::chrono::milliseconds(ms);
}

void cover_seen(int id, const std::string& source)
{
    if (s_current.id == id)
        s_current.covered = source;
    for (Seen& h : s_history)
        if (h.id == id)
            h.covered = source;
}

std::optional<Seen> error_since(Clock::time_point since)
{
    poll_now();
    for (auto it = s_history.rbegin(); it != s_history.rend(); ++it)
        if (it->kind == "error" && it->at >= since)
            return *it;
    return std::nullopt;
}

nlohmann::json recent_issues()
{
    nlohmann::json          out   = nlohmann::json::array();
    const Clock::time_point limit = Clock::now() - std::chrono::minutes(ISSUE_MINUTES);
    for (auto it = s_history.rbegin(); it != s_history.rend() && out.size() < MAX_ISSUES; ++it) {
        if (it->at < limit || !it->covered.empty() || (it->kind != "error" && it->kind != "warning") || it->text.empty())
            continue;
        out.push_back({{"source", "dialog"},
                       {"code", (it->kind == "error" ? std::string("error_dialog") : std::string("warning_dialog")) +
                                    (it->during.empty() ? std::string() : ":" + it->during)},
                       {"level", it->kind},
                       {"text", it->text}});
    }
    return out;
}

nlohmann::json windows()
{
    nlohmann::json out = nlohmann::json::array();
    for (wxWindow* w : wxTopLevelWindows) {
        if (w == nullptr || !w->IsShown())
            continue;
        auto*             dialog = dynamic_cast<wxDialog*>(w);
        const bool        main   = w == wxGetApp().mainframe;
        std::string       kind   = main ? "main" : dialog == nullptr ? "frame" : "dialog";
        if (dialog != nullptr && dynamic_cast<GUI::PrintHostSendDialog*>(dialog) != nullptr)
            kind = "send";
        else if (dialog != nullptr && !message_kind(dialog).empty())
            kind = "message:" + message_kind(dialog);
        out.push_back({{"title", w->GetLabel().utf8_string()}, {"main", main}, {"modal", dialog != nullptr && dialog->IsModal()},
                       {"kind", kind}, {"class", typeid(*w).name()}});
    }
    return out;
}

nlohmann::json history()
{
    nlohmann::json out = nlohmann::json::array();
    for (const Seen& s : s_history)
        out.push_back({{"id", s.id}, {"kind", s.kind}, {"title", s.title}, {"text", s.text}, {"during", s.during},
                       {"covered", s.covered}, {"open", s.open}});
    return out;
}

std::string top_modal_kind()
{
    wxDialog* top = top_modal();
    if (top == nullptr)
        return std::string();
    if (dynamic_cast<GUI::PrintHostSendDialog*>(top) != nullptr)
        return "send";
    return message_kind(top).empty() ? "dialog" : "message";
}

nlohmann::json answer_top_modal(const std::string& answer)
{
    wxDialog* top = top_modal();
    if (top == nullptr)
        return {{"ok", false}, {"text", "aucune fenêtre modale"}};
    const std::string kind  = top_modal_kind();
    const std::string title = top->GetTitle().utf8_string();
    const bool        send  = kind == "send";
    // Le bouton qu'un utilisateur cliquerait : « Envoyer » (wxID_OK) dans la fenêtre d'envoi, sinon Oui puis OK ; pour
    // annuler, Annuler puis Non.
    std::vector<int> ids = answer == "ok" ? (send ? std::vector<int>{wxID_OK} : std::vector<int>{wxID_YES, wxID_OK})
                                          : std::vector<int>{wxID_CANCEL, wxID_NO};
    for (int id : ids) {
        wxWindow* button = top->FindWindow(id);
        if (button == nullptr)
            continue;
        // Même chemin qu'un clic : l'événement du bouton, traité par ses gestionnaires (validation comprise).
        wxCommandEvent click(wxEVT_BUTTON, id);
        click.SetEventObject(button);
        button->GetEventHandler()->ProcessEvent(click);
        return {{"ok", true}, {"kind", kind}, {"title", title}, {"button", id}};
    }
    top->EndModal(answer == "ok" ? wxID_OK : wxID_CANCEL);
    return {{"ok", true}, {"kind", kind}, {"title", title}, {"button", 0}};
}

}} // namespace Plyo::OrcaWindows
