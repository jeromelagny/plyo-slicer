#include "PlyoPlateActions.hpp"
#include "PlyoJson.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoOrcaMessages.hpp"
#include "PlyoOrcaMessagesLogic.hpp"

#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/Event.hpp"
#include "slic3r/GUI/GLToolbar.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Jobs/Worker.hpp"
#include "slic3r/GUI/GLCanvas3D.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Selection.hpp"
#include "slic3r/Utils/UndoRedo.hpp"

#include <wx/event.h>

#include <algorithm>
#include <cmath>
#include <vector>

namespace Plyo { namespace PlateActions {

using Slic3r::GUI::wxGetApp;

namespace {

nlohmann::json size_json(const Slic3r::Vec3d& v) { return {std::round(v.x()), std::round(v.y()), std::round(v.z())}; }

Slic3r::Vec3d object_size(const Slic3r::ModelObject& object)
{
    return object.instances.empty() ? Slic3r::Vec3d(0, 0, 0) : object.instance_bounding_box(0).size();
}

// Taille mesurée de chaque pièce de la plaque en cours : c'est elle que l'on découpe et que l'on réduit.
std::vector<Slic3r::Vec3d> plate_sizes(Slic3r::GUI::Plater& plater)
{
    std::vector<Slic3r::Vec3d> sizes;
    if (Slic3r::GUI::PartPlate* plate = plater.get_partplate_list().get_curr_plate())
        for (const Slic3r::ModelObject* object : plate->get_objects_on_this_plate())
            if (!object->instances.empty())
                sizes.push_back(object_size(*object));
    return sizes;
}

bool all_fit(const std::vector<Slic3r::Vec3d>& sizes, const Slic3r::Vec3d& bed)
{
    return std::all_of(sizes.begin(), sizes.end(), [&](const Slic3r::Vec3d& size) { return fits(size, bed); });
}

// Au centième de millimètre : une réduction a eu lieu ou non, un arrondi ne compte pas.
bool same_sizes(const std::vector<Slic3r::Vec3d>& a, const std::vector<Slic3r::Vec3d>& b)
{
    if (a.size() != b.size())
        return false;
    for (size_t i = 0; i < a.size(); ++i)
        if ((a[i] - b[i]).norm() > 0.01)
            return false;
    return true;
}

// Découpe vouée au refus d'Orca, dite avant de la lancer : une pièce plus grande que le plateau (avec sa mesure pour la carte du
// panneau), ou une plaque qu'Orca n'accepte pas, avec sa vraie raison (Print::validate, lue par OrcaMessages). null si tout va bien.
nlohmann::json slice_refusal(Slic3r::GUI::Plater& plater)
{
    Slic3r::GUI::PartPlate* plate = plater.get_partplate_list().get_curr_plate();
    if (plate == nullptr)
        return nullptr;
    const Slic3r::Vec3d bed      = bed_size();
    const auto          objects = plate->get_objects_on_this_plate();
    for (const Slic3r::ModelObject* object : objects) {
        const Slic3r::Vec3d size = object_size(*object);
        if (!fits(size, bed))
            return {{"ok", false}, {"reason", "too_big"}, {"text", "« " + Json::utf8_prefix(object->name, 120) + " » ne tient pas sur le plateau : je ne lance pas la découpe."},
                    {"name", Json::utf8_prefix(object->name, 120)}, {"count", objects.size()}, {"size_mm", size_json(size)}, {"bed_mm", size_json(bed)}, {"fits", false}};
    }
    // Un réglage changé à l'instant n'est pas encore lu par Orca (pending) : sa découpe le lira, on ne refuse pas d'après l'ancien
    // état. Orca qui découpe déjà (busy) : il garde la main.
    const OrcaMessages::Validation checked = OrcaMessages::validate_plate();
    if (!checked.busy && !checked.pending && OrcaMessagesLogic::has_error(checked.issues))
        return {{"ok", false}, {"reason", "orca_refused"}, {"issues", checked.issues},
                {"text", "Orca refuse de découper cette plaque pour l'instant : je t'explique pourquoi juste en dessous."}};
    return nullptr;
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
    // `ref` (identifiant stable de l'objet) désigne la pièce dans les ordres de l'assistant (PlyoCommands) ; la sélection et la plaque
    // l'aident à savoir de quelle pièce parle l'utilisateur.
    const auto&                           selected = plater->get_view3D_canvas3D()->get_selection().get_content();
    Slic3r::GUI::PartPlateList&           plates   = plater->get_partplate_list();
    const std::vector<Slic3r::ModelObject*>& model_objects = plater->model().objects;
    for (size_t i = 0; i < model_objects.size() && objects.size() < 50; ++i) {
        const Slic3r::ModelObject* object = model_objects[i];
        nlohmann::json item{{"ref", std::to_string(object->id().id)}, {"name", Json::utf8_prefix(object->name, 120)}, {"size_mm", size_json(object_size(*object))},
                            {"copies", std::max<size_t>(1, std::min<size_t>(object->instances.size(), 200))}};
        if (selected.count(static_cast<int>(i)))
            item["selected"] = true;
        if (const int plate = plates.find_instance(static_cast<int>(i), 0); plate >= 0 && plate < 100)
            item["plate"] = plate + 1;
        objects.push_back(item);
    }
    // Ce qu'Orca dit de la plaque (refus, avertissements, contrôles du G-code), 10 au plus, textes nettoyés : l'IA l'explique.
    return {{"objects", objects}, {"bed_mm", size_json(bed_size())}, {"sliced", Json::boolean(signals, "sliced", false)},
            {"time_s", Json::num(signals, "time_s", 0.0)}, {"weight_g", Json::num(signals, "weight_g", 0.0)}, {"issues", OrcaMessages::report()["issues"]}};
}

nlohmann::json run(const std::string& kind)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return {{"ok", false}, {"text", "Le plateau n'est pas disponible."}};
    if (plater->model().objects.empty())
        return {{"ok", false}, {"text", "Le plateau est vide : ajoute d'abord un modèle."}};
    // Orienter et organiser tournent en tâche de fond : une seule à la fois, comme dans Orca.
    if (!plater->get_ui_job_worker().is_idle())
        return {{"ok", false}, {"reason", "busy"}, {"text", "Orca est déjà occupé sur le plateau. Réessaie dans un instant."}};
    if (auto* frame = wxGetApp().mainframe)
        frame->select_tab(TAB_ID_PREPARE);
    // Une action annulable prend un instantané d'Orca ; s'il n'y en a pas de nouveau, rien n'a été fait.
    const auto snapshot = [&]() { return static_cast<long long>(plater->undo_redo_stack_main().active_snapshot_time()); };
    const auto done     = [&](long long before, const char* text, const char* nothing) -> nlohmann::json {
        const long long after = snapshot();
        if (after == before)
            return {{"ok", false}, {"text", nothing}};
        return {{"ok", true}, {"text", text}, {"undo_token", after}};
    };
    const bool one = plater->model().objects.size() == 1; // accord au singulier quand il n'y a qu'une pièce
    if (kind == "orient") {
        plater->select_all();
        const long long before = snapshot();
        plater->orient();
        return done(before, one ? "J'oriente ta pièce au mieux." : "J'oriente tes pièces au mieux.", "Je n'ai pas pu lancer l'orientation. Réessaie dans un instant.");
    }
    if (kind == "arrange") {
        const long long before = snapshot();
        plater->arrange();
        return done(before, one ? "Je place la pièce sur le plateau." : "Je range les pièces sur le plateau.", "Je n'ai pas pu ranger le plateau. Réessaie dans un instant.");
    }
    if (kind == "scale_to_fit") {
        const Slic3r::Vec3d              bed          = bed_size();
        const std::vector<Slic3r::Vec3d> sizes_before = plate_sizes(*plater);
        // Orca agrandirait aussi une pièce qui tient : on ne l'appelle que s'il y a vraiment quelque chose à réduire.
        if (all_fit(sizes_before, bed))
            return {{"ok", false}, {"text", one ? "La pièce tient déjà sur le plateau : rien à réduire." : "Les pièces de cette plaque tiennent déjà : rien à réduire."}};
        plater->select_all();
        const long long before = snapshot();
        plater->scale_selection_to_fit_print_volume();
        // La mesure dit la vérité : un instantané pris n'a pas toujours réduit la pièce (vue encore sur une plaque refusée par Orca).
        const std::vector<Slic3r::Vec3d> sizes_after = plate_sizes(*plater);
        if (same_sizes(sizes_before, sizes_after))
            return {{"ok", false}, {"reason", "no_effect"}, {"text", "Je n'ai pas réussi à réduire la pièce : sa taille n'a pas changé. Réessaie dans un instant."}};
        if (!all_fit(sizes_after, bed))
            return {{"ok", false}, {"reason", "still_too_big"}, {"text", "J'ai réduit la pièce, mais elle ne tient toujours pas sur le plateau."}};
        return done(before, one ? "J'ai réduit la pièce pour qu'elle tienne sur le plateau." : "J'ai réduit les pièces de cette plaque pour qu'elles tiennent.",
                    "Je n'ai pas réussi à réduire la pièce : sa taille n'a pas changé. Réessaie dans un instant.");
    }
    if (kind == "slice") {
        if (nlohmann::json refused = slice_refusal(*plater); !refused.is_null())
            return refused;
        wxPostEvent(plater, Slic3r::GUI::SimpleEvent(Slic3r::GUI::EVT_GLTOOLBAR_SLICE_PLATE));
        return {{"ok", true}, {"text", "Je découpe la plaque : le temps d'impression s'affichera dans l'aperçu."}};
    }
    return {{"ok", false}, {"text", "Action inconnue."}};
}

nlohmann::json undo(long long undo_token)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return {{"ok", false}, {"text", "Le plateau n'est pas disponible."}};
    if (!plater->get_ui_job_worker().is_idle())
        return {{"ok", false}, {"text", "Attends la fin de l'opération en cours, puis réessaie."}};
    if (static_cast<long long>(plater->undo_redo_stack_main().active_snapshot_time()) != undo_token)
        return {{"ok", false}, {"text", "Le plateau a changé depuis : utilise « Annuler » du slicer (Cmd/Ctrl + Z) pour revenir en arrière pas à pas."}};
    plater->undo();
    return {{"ok", true}, {"text", "C'est annulé."}};
}

}} // namespace Plyo::PlateActions
