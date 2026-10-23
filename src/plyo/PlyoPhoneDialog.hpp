#pragma once

#include "slic3r/GUI/Widgets/WebViewHostDialog.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <memory>
#include <string>

class wxWindow;

// Fenêtre « Photos depuis le téléphone » : affiche le QR code du lien téléphone de la conversation (créé
// par le panneau via plyo-api) et suit le téléphone (page resources/web/plyo/phone.html). Elle se ferme
// d'elle-même au premier envoi du téléphone : ShowModal() renvoie alors wxID_OK.
namespace Plyo {

class PhoneDialog : public Slic3r::GUI::WebViewHostDialog
{
public:
    // `link` : { id, qr_svg } du lien téléphone, transmis tel quel à la page.
    PhoneDialog(wxWindow* parent, std::string access_token, nlohmann::json link);
    ~PhoneDialog() override;

private:
    void add_user_scripts() override;
    void on_script_message(const nlohmann::json& payload) override;
    void handle_command(const nlohmann::json& payload);

    std::string                        m_access_token;
    nlohmann::json                     m_link;
    std::shared_ptr<std::atomic<bool>> m_alive = std::make_shared<std::atomic<bool>>(true);
    bool                               m_closing{false};
};

} // namespace Plyo
