#pragma once

#include "slic3r/GUI/Widgets/WebViewHostDialog.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <memory>

class wxWindow;

// Fenêtre modale de connexion à Plyo (code reçu par e-mail), centrée sur Orca.
// Même modèle que les fenêtres web d'Orca (WebViewHostDialog) ; page : resources/web/plyo/login.html.
// En cas de succès, la session est enregistrée (PlyoSession) et ShowModal() renvoie wxID_OK.
namespace Plyo {

class LoginDialog : public Slic3r::GUI::WebViewHostDialog
{
public:
    explicit LoginDialog(wxWindow* parent);
    ~LoginDialog() override;

private:
    void add_user_scripts() override;
    void on_script_message(const nlohmann::json& payload) override;
    void handle_command(const nlohmann::json& payload);

    // Les messages de la page sont traités après le callback de la vue web : ce jeton
    // évite de toucher une fenêtre déjà détruite.
    std::shared_ptr<std::atomic<bool>> m_alive = std::make_shared<std::atomic<bool>>(true);
    bool                               m_closing{false};
};

} // namespace Plyo
