#include "PlyoPlateActions.hpp"
#include "PlyoFirstSteps.hpp"

#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/Event.hpp"
#include "slic3r/GUI/GLToolbar.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Jobs/Worker.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"

#include <wx/event.h>

#include <cmath>

namespace Plyo { namespace PlateActions {

using Slic3r::GUI::wxGetApp;

namespace {

nlohmann::json size_json(const Slic3r::Vec3d& v) { return {std::round(v.x()), std::round(v.y()), std::round(v.z())}; }

Slic3r::Vec3d object_size(const Slic3r::ModelObject& object)
{
    return object.instances.empty() ? Slic3r::Vec3d(0, 0, 0) : object.instance_bounding_box(0).size();
}

} // namespace

Slic3r::Vec3d bed_size()
{
    const Slic3r::DynamicPrintConfig& printer = wxGetApp().preset_bundle->printers.get_edited_preset().config;
    Slic3r::Vec3d                     bed(0, 0, 0);
    if (const auto* area = printer.option<Slic3r::ConfigOptionPoints>("printable_area"); area != nullptr && !area->values.empty()) {
        Slic3r::BoundingBoxf b;
        for (const Slic3r::Vec2d& p : area->values)
            b.merge(p);
        bed.x() = b.size().x();
        bed.y() = b.size().y();
    }
    if (const auto* h = printer.option<Slic3r::ConfigOptionFloat>("printable_height"))
        bed.z() = h->value;
    return bed;
}

bool fits(const Slic3r::Vec3d& size, const Slic3r::Vec3d& bed)
{
    if (bed.x() <= 0 || bed.y() <= 0)
        return true;
    const auto flat = [&](double a, double b) { return a <= bed.x() + 1e-6 && b <= bed.y() + 1e-6; };
    return (flat(size.x(), size.y()) || flat(size.y(), size.x())) && (bed.z() <= 0 || size.z() <= bed.z() + 1e-6);
}

nlohmann::json context()
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return nullptr;
    const nlohmann::json signals = FirstSteps::tour_signals();
    nlohmann::json       objects = nlohmann::json::array();
    for (const Slic3r::ModelObject* object : plater->model().objects) {
        if (objects.size() >= 50)
            break;
        objects.push_back({{"name", object->name.substr(0, 120)}, {"size_mm", size_json(object_size(*object))}});
    }
    return {{"objects", objects}, {"bed_mm", size_json(bed_size())}, {"sliced", signals.value("sliced", false)},
            {"time_s", signals.value("time_s", 0.0)}, {"weight_g", signals.value("weight_g", 0.0)}};
}

nlohmann::json run(const std::string& kind)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return {{"ok", false}, {"text", "Le plateau n'est pas disponible."}};
    if (kind == "undo") {
        plater->undo();
        return {{"ok", true}, {"text", "C'est annulé."}};
    }
    if (plater->model().objects.empty())
        return {{"ok", false}, {"text", "Le plateau est vide : ajoute d'abord un modèle."}};
    // Orienter et organiser tournent en tâche de fond : une seule à la fois, comme dans Orca.
    if (!plater->get_ui_job_worker().is_idle())
        return {{"ok", false}, {"text", "Orca est déjà occupé sur le plateau. Réessaie dans un instant."}};
    if (auto* frame = wxGetApp().mainframe)
        frame->select_tab(TAB_ID_PREPARE);
    if (kind == "orient") {
        plater->select_all();
        plater->orient();
        return {{"ok", true}, {"text", "J'oriente tes pièces au mieux."}};
    }
    if (kind == "arrange") {
        plater->arrange();
        return {{"ok", true}, {"text", "Je range les pièces sur le plateau."}};
    }
    if (kind == "scale_to_fit") {
        bool too_big = false;
        for (const Slic3r::ModelObject* object : plater->model().objects)
            too_big = too_big || !fits(object_size(*object), bed_size());
        if (!too_big)
            return {{"ok", false}, {"text", "Tout tient déjà sur le plateau : rien à réduire."}};
        plater->select_all();
        plater->scale_selection_to_fit_print_volume();
        return {{"ok", true}, {"text", "J'ai réduit les pièces pour qu'elles tiennent sur le plateau."}};
    }
    if (kind == "slice") {
        wxPostEvent(plater, Slic3r::GUI::SimpleEvent(Slic3r::GUI::EVT_GLTOOLBAR_SLICE_PLATE));
        return {{"ok", true}, {"text", "Je découpe la plaque : le temps d'impression s'affichera dans l'aperçu."}};
    }
    return {{"ok", false}, {"text", "Action inconnue."}};
}

}} // namespace Plyo::PlateActions
