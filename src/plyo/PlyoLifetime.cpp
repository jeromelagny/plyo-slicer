#include "PlyoLifetime.hpp"
#include "PlyoGuard.hpp"
#include "PlyoLifetimeLogic.hpp"

#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"

#include <wx/app.h>
#include <wx/event.h>
#include <wx/window.h>

#include <utility>

namespace Plyo { namespace Lifetime {

namespace {

// Initialisée avant tout code (atomique constante) et jamais détruite avant la fin du programme : lisible par un fil tardif.
LifetimeLogic::ClosingGate g_gate;
Slic3r::GUI::MainFrame*    g_bound_frame = nullptr; // fil principal seulement

} // namespace

bool closing() { return g_gate.closing(); }

void watch_main_frame()
{
    Slic3r::GUI::MainFrame* frame = Slic3r::GUI::wxGetApp().mainframe;
    if (frame == nullptr || frame == g_bound_frame)
        return;
    g_bound_frame = frame;
    // wxEVT_DESTROY plutôt que wxEVT_CLOSE_WINDOW : une fermeture peut encore être annulée (projet non enregistré), pas une
    // destruction. Une fenêtre recréée par Orca (GUI_App::recreate_GUI) est détruite sans que l'application se ferme.
    frame->Bind(wxEVT_DESTROY, [frame](wxWindowDestroyEvent& e) {
        if (e.GetEventObject() == frame) {
            if (Slic3r::GUI::wxGetApp().is_closing())
                g_gate.close();
            if (g_bound_frame == frame)
                g_bound_frame = nullptr;
        }
        e.Skip();
    });
}

void post(const char* what, std::function<void()> fn)
{
    if (wxTheApp == nullptr)
        return;
    g_gate.post([](std::function<void()> queued) { Slic3r::GUI::wxGetApp().CallAfter(std::move(queued)); },
                [what, fn = std::move(fn)] { guarded(what, fn); });
}

}} // namespace Plyo::Lifetime
