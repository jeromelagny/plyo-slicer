#pragma once

#include "slic3r/GUI/Widgets/WebViewHostDialog.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <memory>
#include <string>

class wxWindow;

// Fenêtre « Photos depuis le téléphone » : affiche le QR code d'une session créée par plyo-api et suit
// l'envoi du téléphone (page resources/web/plyo/phone.html). Quand le téléphone a envoyé ses photos,
// ShowModal() renvoie wxID_OK et session_id() donne la session à récupérer par le panneau.
namespace Plyo {

class PhoneDialog : public Slic3r::GUI::WebViewHostDialog
{
public:
    PhoneDialog(wxWindow* parent, std::string access_token);
    ~PhoneDialog() override;

    const std::string& session_id() const { return m_session_id; }

private:
    void add_user_scripts() override;
    void on_script_message(const nlohmann::json& payload) override;
    void handle_command(const nlohmann::json& payload);

    std::string                        m_access_token;
    std::string                        m_session_id;
    std::shared_ptr<std::atomic<bool>> m_alive = std::make_shared<std::atomic<bool>>(true);
    bool                               m_closing{false};
};

} // namespace Plyo
