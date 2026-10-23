#pragma once

#include "slic3r/GUI/Widgets/WebViewHostDialog.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <memory>
#include <string>

class wxWindow;

// Accueil Plyo du premier lancement (page : resources/web/plyo/welcome.html), même modèle que LoginDialog.
// `with_setup_tips` : l'écran de configuration d'Orca suit, la page donne ses trois repères (imprimante, buse, filaments).
namespace Plyo {

class WelcomeDialog : public Slic3r::GUI::WebViewHostDialog
{
public:
    WelcomeDialog(wxWindow* parent, bool with_setup_tips);
    ~WelcomeDialog() override;

    // "beginner", "expert" ou "skipped" (fenêtre fermée sans choix).
    const std::string& choice() const { return m_choice; }

private:
    void on_script_message(const nlohmann::json& payload) override;
    void handle_command(const nlohmann::json& payload);

    bool                               m_with_setup_tips;
    std::string                        m_choice{"skipped"};
    std::shared_ptr<std::atomic<bool>> m_alive = std::make_shared<std::atomic<bool>>(true);
    bool                               m_closing{false};
};

} // namespace Plyo
