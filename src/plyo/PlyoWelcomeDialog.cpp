#include "PlyoWelcomeDialog.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"

#include "slic3r/GUI/GUI_App.hpp"

#include <wx/sizer.h>
#include <wx/stattext.h>

namespace Plyo {

WelcomeDialog::WelcomeDialog(wxWindow* parent, bool with_setup_tips)
    : WebViewHostDialog(parent, wxID_ANY, wxEmptyString, wxDefaultPosition, wxDefaultSize, wxSYSTEM_MENU | wxCAPTION | wxCLOSE_BOX)
    , m_with_setup_tips(with_setup_tips)
{
    if (!create_webview("web/plyo/welcome.html", wxString::FromUTF8("Bienvenue dans Plyo"), wxSize(560, 500), wxSize(480, 440))) {
        auto* sizer = new wxBoxSizer(wxVERTICAL);
        sizer->Add(new wxStaticText(this, wxID_ANY, wxS("wxWebView unavailable")), wxSizerFlags().Border(wxALL, FromDIP(20)));
        SetSizerAndFit(sizer);
    }
    Slic3r::GUI::wxGetApp().UpdateDlgDarkUI(this);
}

WelcomeDialog::~WelcomeDialog() { m_alive->store(false, std::memory_order_release); }

void WelcomeDialog::on_script_message(const nlohmann::json& payload)
{
    Slic3r::GUI::wxGetApp().CallAfter([this, alive = m_alive, payload] {
        if (alive->load(std::memory_order_acquire) && !m_closing)
            guarded("la fenêtre d'accueil", [&] { handle_command(payload); });
    });
}

void WelcomeDialog::handle_command(const nlohmann::json& payload)
{
    if (!payload.is_object())
        return;
    const std::string command = Json::str(payload, "command");
    if (command == "welcome_ready") {
        run_script(m_with_setup_tips ? "plyoWelcomeSetup(true)" : "plyoWelcomeSetup(false)");
        return;
    }
    if (command == "welcome_choice") {
        const std::string choice = Json::str(payload, "choice");
        if (choice == "beginner" || choice == "expert")
            m_choice = choice;
        m_closing = true;
        EndModal(wxID_OK);
        return;
    }
    if (handle_common_script_command(payload, wxID_CANCEL))
        m_closing = true;
}

} // namespace Plyo
