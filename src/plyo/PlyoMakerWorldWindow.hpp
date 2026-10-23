#pragma once

#include <functional>
#include <string>

#include <wx/frame.h>

class wxWebView;
class wxWebViewEvent;

namespace Plyo {

// PROTOTYPE (lot MakerWorld) : fenêtre qui affiche une page MakerWorld. L'utilisateur s'y connecte
// et clique lui-même sur « Ouvrir dans Bambu Studio » ; la fenêtre capte ce lien (bambustudioopen://…)
// au lieu de le laisser partir vers macOS, et le confie au téléchargement existant d'Orca.
// Aucune lecture de la page par Plyo ni par l'IA (conditions d'utilisation de MakerWorld).
class MakerWorldWindow : public wxFrame
{
public:
    // `on_open` est appelé avec le lien capté, juste avant la fermeture de la fenêtre.
    MakerWorldWindow(wxWindow* parent, const std::string& url, std::function<void(const std::string&)> on_open);

    // Adresse acceptée : une page https de makerworld.com.
    static bool is_makerworld_url(const std::string& url);

private:
    void on_navigating(wxWebViewEvent& evt);
    void on_new_window(wxWebViewEvent& evt);
    void on_loaded(wxWebViewEvent& evt);
    bool capture(const std::string& url);

    wxWebView*                              m_browser = nullptr;
    std::function<void(const std::string&)> m_on_open;
    bool                                    m_captured = false;
    std::string                             m_model_url;
};

} // namespace Plyo
