#include "PlyoLoginDialog.hpp"
#include "PlyoConfig.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoSession.hpp"

#include "slic3r/GUI/GUI_App.hpp"

#include <wx/sizer.h>
#include <wx/stattext.h>
#include <wx/webview.h>

namespace Plyo {

LoginDialog::LoginDialog(wxWindow* parent)
    : WebViewHostDialog(parent, wxID_ANY, wxEmptyString, wxDefaultPosition, wxDefaultSize, wxSYSTEM_MENU | wxCAPTION | wxCLOSE_BOX)
{
    if (!create_webview("web/plyo/login.html", wxString::FromUTF8("Connexion à Plyo"), wxSize(460, 440), wxSize(420, 400))) {
        auto* sizer = new wxBoxSizer(wxVERTICAL);
        sizer->Add(new wxStaticText(this, wxID_ANY, wxS("wxWebView unavailable")), wxSizerFlags().Border(wxALL, FromDIP(20)));
        SetSizerAndFit(sizer);
    }
    Slic3r::GUI::wxGetApp().UpdateDlgDarkUI(this);
}

LoginDialog::~LoginDialog() { m_alive->store(false, std::memory_order_release); }

void LoginDialog::add_user_scripts()
{
    if (wxWebView* view = browser())
        view->AddUserScript(wxString::FromUTF8(Config::api_url_script()));
}

void LoginDialog::on_script_message(const nlohmann::json& payload)
{
    // Aucun travail sur la fenêtre pendant le callback de la vue web (règle Orca/wxWidgets).
    Slic3r::GUI::wxGetApp().CallAfter([this, alive = m_alive, payload] {
        if (alive->load(std::memory_order_acquire) && !m_closing)
            guarded("la fenêtre de connexion", [&] { handle_command(payload); });
    });
}

void LoginDialog::handle_command(const nlohmann::json& payload)
{
    if (!payload.is_object())
        return;
    if (Json::str(payload, "command") == "login_success" && payload.contains("session") &&
        Session::save(payload["session"])) {
        m_closing = true;
        EndModal(wxID_OK);
        return;
    }
    if (handle_common_script_command(payload, wxID_CANCEL)) // « close_page » : bouton Annuler
        m_closing = true;
}

} // namespace Plyo
