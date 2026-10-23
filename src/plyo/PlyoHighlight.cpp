#include "PlyoHighlight.hpp"

#include "libslic3r/Preset.hpp"
#include "slic3r/GUI/GLCanvas3D.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/I18N.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/PresetComboBoxes.hpp"
#include "slic3r/GUI/Widgets/SideButton.hpp"

#include <wx/glcanvas.h>
#include <wx/popupwin.h>
#include <wx/timer.h>

#include <array>
#include <functional>

namespace Plyo { namespace Highlight {

using Slic3r::GUI::wxGetApp;

namespace {

// Premier descendant (parcours en profondeur) visible à l'écran qui satisfait `match`.
wxWindow* find_window(wxWindow* root, const std::function<bool(wxWindow*)>& match)
{
    if (root == nullptr)
        return nullptr;
    if (root->IsShownOnScreen() && match(root))
        return root;
    for (wxWindow* child : root->GetChildren())
        if (wxWindow* found = find_window(child, match))
            return found;
    return nullptr;
}

wxWindow* find_target(const std::string& target)
{
    wxWindow* frame = wxGetApp().mainframe;
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (frame == nullptr || plater == nullptr)
        return nullptr;
    if (target == "printer")
        return find_window(frame, [](wxWindow* w) {
            auto* combo = dynamic_cast<Slic3r::GUI::PlaterPresetComboBox*>(w);
            return combo != nullptr && combo->get_type() == Slic3r::Preset::TYPE_PRINTER;
        });
    if (target == "filament") {
        auto& combos = plater->sidebar().combos_filament();
        return !combos.empty() && combos.front()->IsShownOnScreen() ? combos.front() : nullptr;
    }
    // Boutons « Trancher » / « Imprimer » : les deux seuls SideButton à libellé de la barre du haut.
    const wxString slice_plate = _L("Slice plate"), slice_all = _L("Slice all");
    if (target == "slice")
        return find_window(frame, [&](wxWindow* w) {
            return dynamic_cast<SideButton*>(w) != nullptr && (w->GetLabel() == slice_plate || w->GetLabel() == slice_all);
        });
    if (target == "print")
        return find_window(frame, [&](wxWindow* w) {
            return dynamic_cast<SideButton*>(w) != nullptr && !w->GetLabel().empty() && w->GetLabel() != slice_plate &&
                   w->GetLabel() != slice_all;
        });
    if (target == "plate")
        if (Slic3r::GUI::GLCanvas3D* canvas = plater->get_current_canvas3D())
            return canvas->get_wxglcanvas() != nullptr && canvas->get_wxglcanvas()->IsShownOnScreen() ? canvas->get_wxglcanvas() : nullptr;
    return nullptr;
}

// Quatre bandes de couleur autour du rectangle (fenêtres popup : elles ne prennent pas le focus).
class Frame : public wxTimer
{
public:
    explicit Frame(const wxRect& r)
    {
        const int     t = 4, m = 3;
        const wxRect  outer(r.GetX() - m - t, r.GetY() - m - t, r.GetWidth() + 2 * (m + t), r.GetHeight() + 2 * (m + t));
        const wxColour colour(0, 150, 136);
        const std::array<wxRect, 4> bands = {wxRect(outer.GetX(), outer.GetY(), outer.GetWidth(), t),
                                             wxRect(outer.GetX(), outer.GetBottom() - t + 1, outer.GetWidth(), t),
                                             wxRect(outer.GetX(), outer.GetY(), t, outer.GetHeight()),
                                             wxRect(outer.GetRight() - t + 1, outer.GetY(), t, outer.GetHeight())};
        for (size_t i = 0; i < bands.size(); ++i) {
            m_bands[i] = new wxPopupWindow(wxGetApp().mainframe, wxBORDER_NONE);
            m_bands[i]->SetBackgroundColour(colour);
            m_bands[i]->SetSize(bands[i]);
            m_bands[i]->Show();
        }
        StartOnce(3000);
    }

    void Notify() override { close(); }

    void close()
    {
        for (wxPopupWindow*& band : m_bands)
            if (band != nullptr) {
                band->Destroy();
                band = nullptr;
            }
    }

private:
    std::array<wxPopupWindow*, 4> m_bands{};
};

Frame* s_frame = nullptr; // jamais détruit à la fermeture d'Orca (minuterie wx après l'application)

} // namespace

nlohmann::json show(const std::string& target)
{
    if (s_frame != nullptr) {
        s_frame->Stop();
        s_frame->close();
        delete s_frame;
        s_frame = nullptr;
    }
    wxWindow* window = find_target(target);
    if (window == nullptr)
        return {{"ok", false}};
    const wxRect rect = window->GetScreenRect();
    if (rect.IsEmpty())
        return {{"ok", false}};
    s_frame = new Frame(rect);
    return {{"ok", true}};
}

}} // namespace Plyo::Highlight
