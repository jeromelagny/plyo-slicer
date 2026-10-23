#include "PlyoPhoneDialog.hpp"

#include "slic3r/GUI/GUI_App.hpp"

#include <wx/sizer.h>
#include <wx/stattext.h>
#include <wx/webview.h>

namespace Plyo {

PhoneDialog::PhoneDialog(wxWindow* parent, std::string access_token)
    : WebViewHostDialog(parent, wxID_ANY, wxEmptyString, wxDefaultPosition, wxDefaultSize, wxSYSTEM_MENU | wxCAPTION | wxCLOSE_BOX)
    , m_access_token(std::move(access_token))
{
    if (!create_webview("web/plyo/phone.html", wxString::FromUTF8("Photos depuis le téléphone"), wxSize(500, 470), wxSize(460, 440))) {
        auto* sizer = new wxBoxSizer(wxVERTICAL);
        sizer->Add(new wxStaticText(this, wxID_ANY, wxS("wxWebView unavailable")), wxSizerFlags().Border(wxALL, FromDIP(20)));
        SetSizerAndFit(sizer);
    }
    Slic3r::GUI::wxGetApp().UpdateDlgDarkUI(this);
}

PhoneDialog::~PhoneDialog() { m_alive->store(false, std::memory_order_release); }

// Jeton de connexion transmis à la page avant son chargement : elle crée la session et suit son état.
void PhoneDialog::add_user_scripts()
{
    if (wxWebView* view = browser()) {
        const std::string script = "window.PLYO = " + nlohmann::json{{"accessToken", m_access_token}}.dump() + ";";
        view->AddUserScript(wxString::FromUTF8(script));
    }
}

void PhoneDialog::on_script_message(const nlohmann::json& payload)
{
    // Aucun travail sur la fenêtre pendant le callback de la vue web (règle Orca/wxWidgets).
    Slic3r::GUI::wxGetApp().CallAfter([this, alive = m_alive, payload] {
        if (alive->load(std::memory_order_acquire) && !m_closing)
            handle_command(payload);
    });
}

void PhoneDialog::handle_command(const nlohmann::json& payload)
{
    if (!payload.is_object())
        return;
    if (payload.value("command", std::string()) == "phone_done" && payload.contains("session_id") && payload["session_id"].is_string()) {
        m_session_id = payload["session_id"].get<std::string>();
        m_closing    = true;
        EndModal(wxID_OK);
        return;
    }
    if (handle_common_script_command(payload, wxID_CANCEL)) // « close_page » : bouton Fermer
        m_closing = true;
}

} // namespace Plyo
