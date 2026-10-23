#include "PlyoMakerWorldWindow.hpp"

#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Widgets/WebView.hpp"

#include <boost/log/trivial.hpp>

#include <regex>

#include <wx/button.h>
#include <wx/sizer.h>
#include <wx/timer.h>
#include <wx/stattext.h>
#include <wx/webview.h>
#include <wx/weakref.h>

namespace Plyo {

namespace {
// Navigateur ordinaire : la signature « BBL-Slicer » d'Orca ferait servir à MakerWorld sa version intégrée
// à Bambu Studio (sans connexion ni navigation complète, la connexion y passant par le slicer).
constexpr const char* BROWSER_USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

// Adresse sans paramètres pour le journal (les liens signés et jetons n'y sont jamais écrits).
std::string loggable(const std::string& url) { return url.substr(0, url.find_first_of("?#")); }
} // namespace

bool MakerWorldWindow::is_makerworld_url(const std::string& url)
{
    static const std::regex re(R"(^https://(www\.)?makerworld\.com(/[^\s]*)?$)", std::regex_constants::icase);
    return std::regex_match(url, re);
}

MakerWorldWindow::MakerWorldWindow(wxWindow* parent, const std::string& url, std::function<void(const std::string&)> on_open)
    : wxFrame(parent, wxID_ANY, wxS("MakerWorld"), wxDefaultPosition, wxDefaultSize,
              wxDEFAULT_FRAME_STYLE | wxFRAME_FLOAT_ON_PARENT)
    , m_on_open(std::move(on_open))
    , m_model_url(url)
{
    auto* sizer = new wxBoxSizer(wxVERTICAL);

    // Barre de navigation : la fenêtre n'a ni barre d'adresse ni boutons du navigateur.
    auto* bar     = new wxBoxSizer(wxHORIZONTAL);
    auto* back    = new wxButton(this, wxID_ANY, wxString::FromUTF8("← Retour"));
    auto* model   = new wxButton(this, wxID_ANY, wxString::FromUTF8("Page du modèle"));
    bar->Add(back, 0, wxRIGHT | wxALIGN_CENTER_VERTICAL, FromDIP(6));
    bar->Add(model, 0, wxRIGHT | wxALIGN_CENTER_VERTICAL, FromDIP(16));

    // Guide d'import, hors de la page (on ne modifie pas le site) : étapes et repère du bouton à cliquer.
    m_guide = new wxStaticText(this, wxID_ANY, wxEmptyString);
    m_pill  = new wxStaticText(this, wxID_ANY, wxString::FromUTF8("  Ouvrir dans Bambu Studio  "));
    m_pill->SetBackgroundColour(wxColour(0, 174, 66)); // vert proche du bouton du site, dessiné par nous
    m_pill->SetForegroundColour(*wxWHITE);
    m_pill->SetFont(m_pill->GetFont().Bold());
    bar->Add(m_guide, 0, wxRIGHT | wxALIGN_CENTER_VERTICAL, FromDIP(6));
    bar->Add(m_pill, 0, wxALIGN_CENTER_VERTICAL);
    sizer->Add(bar, 0, wxALL, FromDIP(8));

    // Créée vide, pour que la première page soit déjà demandée avec la signature d'un navigateur ordinaire.
    m_browser = ::WebView::CreateWebView(this, wxEmptyString);
    if (m_browser) {
        sizer->Add(m_browser, 1, wxEXPAND);
        m_browser->Bind(wxEVT_WEBVIEW_NAVIGATING, &MakerWorldWindow::on_navigating, this);
        m_browser->Bind(wxEVT_WEBVIEW_NEWWINDOW, &MakerWorldWindow::on_new_window, this);
        m_browser->Bind(wxEVT_WEBVIEW_LOADED, &MakerWorldWindow::on_loaded, this);
        m_browser->SetUserAgent(wxString::FromUTF8(BROWSER_USER_AGENT));
        m_browser->LoadURL(wxString::FromUTF8(url));
        back->Bind(wxEVT_BUTTON, [this](wxCommandEvent&) {
            if (m_browser->CanGoBack())
                m_browser->GoBack();
        });
        model->Bind(wxEVT_BUTTON, [this](wxCommandEvent&) { m_browser->LoadURL(wxString::FromUTF8(m_model_url)); });
        // Le site change de page sans rechargement : on suit l'adresse (seule information lue) chaque seconde.
        m_url_timer.SetOwner(this);
        Bind(wxEVT_TIMER, [this](wxTimerEvent&) { update_guide(m_browser->GetCurrentURL().utf8_string()); });
        m_url_timer.Start(1000);
    } else
        sizer->Add(new wxStaticText(this, wxID_ANY, wxS("wxWebView unavailable")), wxSizerFlags().Border(wxALL, FromDIP(20)));
    SetSizer(sizer);
    SetSize(FromDIP(wxSize(1100, 800)));
    CentreOnParent();
    update_guide(url);
}

MakerWorldWindow::~MakerWorldWindow() { m_url_timer.Stop(); }

void MakerWorldWindow::update_guide(const std::string& url)
{
    if (m_captured || m_guide == nullptr)
        return;
    const bool on_model = loggable(url).find("/models/") != std::string::npos;
    const wxString text = wxString::FromUTF8(on_model ? "① Choisis un profil d'impression   ② Clique sur" : "Ouvre la page d'un modèle pour l'importer dans Plyo.");
    if (m_guide->GetLabel() == text)
        return;
    m_guide->SetLabel(text);
    m_pill->Show(on_model);
    Layout();
}

// Lien « Ouvrir dans … » cliqué par l'utilisateur : on le garde pour Orca au lieu de l'ouvrir dans macOS.
bool MakerWorldWindow::capture(const std::string& url)
{
    if (!Slic3r::is_supported_open_protocol(url))
        return false;
    if (m_captured)
        return true;
    m_captured = true;
    if (m_guide != nullptr) {
        m_guide->SetLabel(wxString::FromUTF8("Modèle reçu, ouverture dans Plyo…"));
        m_pill->Hide();
        Layout();
    }
    BOOST_LOG_TRIVIAL(info) << "Plyo: lien MakerWorld capté (" << url.substr(0, url.find(':')) << ")";
    // Hors du callback de la vue web : fermeture de la fenêtre puis téléchargement par Orca.
    Slic3r::GUI::wxGetApp().CallAfter([self = wxWeakRef<wxFrame>(this), url, on_open = m_on_open] {
        if (self)
            self->Close(true);
        if (on_open)
            on_open(url);
    });
    return true;
}

void MakerWorldWindow::on_navigating(wxWebViewEvent& evt)
{
    const std::string url = evt.GetURL().utf8_string();
    BOOST_LOG_TRIVIAL(info) << "Plyo: MakerWorld navigue vers " << loggable(url);
    if (capture(url))
        evt.Veto();
}

void MakerWorldWindow::on_loaded(wxWebViewEvent& evt)
{
    BOOST_LOG_TRIVIAL(info) << "Plyo: MakerWorld a chargé " << loggable(evt.GetURL().utf8_string());
}

// Les liens ouverts dans un nouvel onglet (connexion comprise) restent dans cette fenêtre.
void MakerWorldWindow::on_new_window(wxWebViewEvent& evt)
{
    const std::string url = evt.GetURL().utf8_string();
    BOOST_LOG_TRIVIAL(info) << "Plyo: MakerWorld demande une nouvelle fenêtre vers " << loggable(url);
    if (!capture(url) && url.rfind("https://", 0) == 0)
        m_browser->LoadURL(evt.GetURL());
    evt.Veto();
}

} // namespace Plyo
