#include "PlyoCommands.hpp"
#include "PlyoJson.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/CutUtils.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/LayOnFace.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/ObjectID.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/3DScene.hpp"
#include "slic3r/GUI/Event.hpp"
#include "slic3r/GUI/GLCanvas3D.hpp"
#include "slic3r/GUI/GLToolbar.hpp"
#include "slic3r/GUI/GUI.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/GUI_Geometry.hpp"
#include "slic3r/GUI/GUI_ObjectList.hpp"
#include "slic3r/GUI/Gizmos/GLGizmosManager.hpp"
#include "slic3r/GUI/Jobs/Worker.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/ObjectDataViewModel.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Selection.hpp"
#include "slic3r/Utils/UndoRedo.hpp"

#include <boost/log/trivial.hpp>
#include <wx/event.h>

#include <cmath>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace Plyo { namespace Commands {

using Slic3r::GUI::wxGetApp;
using Slic3r::Vec3d;

namespace {

// Un ordre refusé ou impossible : le texte est montré tel quel à l'utilisateur.
struct Refused : std::runtime_error
{
    using std::runtime_error::runtime_error;
};

Slic3r::GUI::Plater&     plater() { return *wxGetApp().plater(); }
Slic3r::GUI::GLCanvas3D& canvas() { return *plater().get_view3D_canvas3D(); }
Slic3r::GUI::Selection&  selection() { return canvas().get_selection(); }
Slic3r::Model&           model() { return plater().model(); }

// Opérations lancées en tâche de fond par Orca : une seule par lot, exécutée après les autres.
bool is_background(const std::string& op) { return op == "orient" || op == "arrange" || op == "fill_bed"; }
// Opérations qui portent sur toute la plaque (sans pièce visée).
bool is_plate_wide(const std::string& op) { return op == "orient" || op == "arrange" || op == "scale_to_fit" || op == "slice"; }

int axis_index(const std::string& axis) { return axis == "x" ? 0 : axis == "y" ? 1 : axis == "z" ? 2 : -1; }

double amount(const nlohmann::json& c, const char* key, double lo, double hi)
{
    const auto it = c.find(key);
    if (it == c.end() || !it->is_number() || !std::isfinite(it->get<double>()) || it->get<double>() < lo || it->get<double>() > hi)
        throw Refused("Valeur hors des limites autorisées : ordre ignoré.");
    return it->get<double>();
}

int axis_of(const nlohmann::json& c)
{
    const int axis = axis_index(Json::str(c, "axis"));
    if (axis < 0)
        throw Refused("Axe manquant : ordre ignoré.");
    return axis;
}

// Pièce visée : sa référence (identifiant stable de l'objet d'Orca, envoyé avec le plateau), sinon la pièce
// sélectionnée, sinon la seule. Un identifiant survit aux suppressions et aux coupes faites pendant que l'IA répond,
// contrairement au rang dans la liste.
std::optional<Slic3r::ObjectID> target_of(const std::string& ref)
{
    const auto& objects = model().objects;
    if (!ref.empty()) {
        if (ref.size() > 18 || ref.find_first_not_of("0123456789") != std::string::npos)
            return std::nullopt;
        const size_t id = std::stoull(ref);
        for (const Slic3r::ModelObject* o : objects)
            if (o->id().id == id)
                return o->id();
        return Slic3r::ObjectID(); // identifiant invalide : « Cette pièce n'est plus sur le plateau. »
    }
    if (const int idx = selection().get_object_idx(); idx >= 0 && idx < static_cast<int>(objects.size()))
        return objects[idx]->id();
    if (objects.size() == 1)
        return objects.front()->id();
    return std::nullopt;
}

// Rang actuel d'une pièce (une coupe ou une suppression décale les rangs des suivantes).
int index_of(const Slic3r::ObjectID& id)
{
    const auto& objects = model().objects;
    for (size_t i = 0; i < objects.size(); ++i)
        if (objects[i]->id() == id)
            return static_cast<int>(i);
    throw Refused("Cette pièce n'est plus sur le plateau.");
}

// Sélectionne la pièce dans la vue 3D et dans la liste des objets, comme un clic de l'utilisateur.
void select_object(int idx, bool first_copy_only = false)
{
    Slic3r::GUI::Selection& sel = selection();
    sel.set_mode(Slic3r::GUI::Selection::Instance);
    if (first_copy_only)
        sel.add_instance(static_cast<unsigned int>(idx), 0, true);
    else
        sel.add_object(static_cast<unsigned int>(idx), true);
    wxGetApp().obj_list()->update_selections();
}

void rotate(int idx, int axis, double degrees)
{
    // Tous les exemplaires, chacun autour de son propre centre : Orca ne recopie pas une rotation à plat (axe Z)
    // sur les autres exemplaires.
    select_object(idx);
    Slic3r::GUI::Selection&          sel = selection();
    Slic3r::GUI::TransformationType  type;
    type.set_relative();
    type.set_independent();
    Vec3d rotation = Vec3d::Zero();
    rotation(axis) = degrees * M_PI / 180.0;
    sel.setup_cache();
    sel.rotate(rotation, type);
    canvas().do_rotate("Set Orientation"); // repose aussi la pièce sur le plateau
}

void lay_flat(int idx, const std::string& face)
{
    Slic3r::ModelObject* object = model().objects[idx];
    if (object->instances.empty())
        throw Refused("Cette pièce n'a pas d'exemplaire sur le plateau.");
    const Slic3r::Transform3d matrix = object->instances.front()->get_matrix_no_offset();
    const std::vector<Slic3r::LayOnFacePlane> planes = Slic3r::lay_on_face_planes(*object, matrix);
    if (planes.empty())
        throw Refused("Je ne trouve pas de face plate sur laquelle poser cette pièce.");
    static const std::map<std::string, Vec3d> directions = {
        {"front", Vec3d(0, -1, 0)}, {"back", Vec3d(0, 1, 0)}, {"left", Vec3d(-1, 0, 0)}, {"right", Vec3d(1, 0, 0)}, {"top", Vec3d(0, 0, 1)}};
    int plane = -1;
    if (face.empty())
        plane = Slic3r::find_largest_plane(planes);
    else if (const auto it = directions.find(face); it != directions.end())
        // Direction du plateau ramenée dans le repère de la pièce (les normales des faces y sont exprimées).
        plane = Slic3r::find_plane_by_normal(planes, (matrix.linear().transpose() * it->second).normalized());
    if (plane < 0)
        throw Refused("Je ne trouve pas cette face sur la pièce.");
    select_object(idx); // tous les exemplaires
    selection().flattening_rotate(planes[plane].normal);
    canvas().do_rotate("Gizmo-Place on Face"); // ce nom fait reposer la pièce même si elle s'enfonçait
}

void reset_rotation(int idx)
{
    select_object(idx, true);
    Slic3r::GUI::Selection& sel = selection();
    if (!sel.is_single_full_instance())
        throw Refused("Impossible de remettre cette pièce droite.");
    sel.setup_cache();
    Slic3r::Geometry::Transformation trafo = sel.get_first_volume()->get_instance_transformation();
    trafo.reset_rotation();
    for (unsigned int v : sel.get_volume_idxs())
        const_cast<Slic3r::GLVolume*>(sel.get_volume(v))->set_instance_transformation(trafo);
    sel.synchronize_unselected_instances(Slic3r::GUI::Selection::SyncRotationType::RESET);
    sel.synchronize_unselected_volumes();
    canvas().do_rotate("Reset rotation");
}

void move(int idx, int axis, double mm)
{
    select_object(idx);
    Slic3r::GUI::Selection&         sel = selection();
    Slic3r::GUI::TransformationType type;
    type.set_relative();
    Vec3d shift = Vec3d::Zero();
    shift(axis) = mm;
    sel.setup_cache();
    sel.translate(shift, type);
    canvas().do_move("Move Object");
}

// Agrandit ou réduit d'un facteur (relatif à la taille actuelle), sur un axe ou proportionnellement.
void scale(int idx, int axis, double factor)
{
    select_object(idx); // tous les exemplaires, chacun autour de son centre
    const Vec3d size = model().objects[idx]->instance_bounding_box(0).size();
    for (int i = 0; i < 3; ++i)
        if ((axis < 0 || axis == i) && size(i) * factor > 2000.0)
            throw Refused("La pièce dépasserait 2 m : ordre ignoré.");
    Slic3r::GUI::Selection&         sel = selection();
    Slic3r::GUI::TransformationType type;
    type.set_relative();
    type.set_independent();
    Vec3d factors = Vec3d::Ones();
    if (axis < 0)
        factors *= factor;
    else
        factors(axis) = factor;
    sel.setup_cache();
    sel.scale(factors, type);
    canvas().do_scale("Set Scale");
}

void set_copies(int idx, int wanted)
{
    select_object(idx);
    const int current = static_cast<int>(model().objects[idx]->instances.size());
    if (wanted > current) {
        if (!plater().can_increase_instances())
            throw Refused("Impossible d'ajouter des exemplaires de cette pièce.");
        plater().increase_instances(static_cast<size_t>(wanted - current));
    } else if (wanted < current) {
        if (!plater().can_decrease_instances())
            throw Refused("Impossible de retirer des exemplaires de cette pièce.");
        plater().decrease_instances(static_cast<size_t>(current - wanted));
    }
}

void rename(int idx, const std::string& name)
{
    model().objects[idx]->name = name;
    Slic3r::GUI::ObjectList* list = wxGetApp().obj_list();
    list->GetModel()->SetName(Slic3r::GUI::from_u8(name), list->GetModel()->GetItemById(idx));
}

void set_printable(int idx, bool printable)
{
    select_object(idx);
    if (model().objects[idx]->instances.front()->printable != printable)
        wxGetApp().obj_list()->toggle_printable_state();
}

void split(int idx, const std::string& into)
{
    select_object(idx);
    const bool to_objects = into == "objects";
    if (!plater().can_split(to_objects))
        throw Refused("Cette pièce est d'un seul morceau : rien à séparer.");
    if (to_objects)
        plater().split_object();
    else
        plater().split_volume();
}

void cut_at(int idx, double height, const std::string& keep)
{
    const Slic3r::BoundingBoxf3 box = model().objects[idx]->instance_bounding_box(0);
    if (height <= 0 || height >= box.size().z())
        throw Refused("La hauteur de coupe doit être dans la pièce.");
    using Slic3r::ModelObjectCutAttribute;
    Slic3r::ModelObjectCutAttributes keep_parts = ModelObjectCutAttribute::KeepUpper | ModelObjectCutAttribute::KeepLower;
    if (keep == "keep_top")
        keep_parts = ModelObjectCutAttribute::KeepUpper;
    else if (keep == "keep_bottom")
        keep_parts = ModelObjectCutAttribute::KeepLower;
    // Comme Plater::cut_horizontal (privée) : plan horizontal à la hauteur voulue, pièces remises dans le modèle.
    Slic3r::ModelObject* object = model().objects[idx];
    const Vec3d          offset = object->instances.front()->get_offset();
    Slic3r::Cut          cut(object, 0, Slic3r::Geometry::translation_transform((box.min.z() + height) * Vec3d::UnitZ() - offset), keep_parts);
    plater().apply_cut_object_to_model(static_cast<size_t>(idx), cut.perform_with_plane());
}

std::string object_setting(int idx, const std::string& id, const nlohmann::json& value)
{
    Slic3r::DynamicPrintConfig config;
    const nlohmann::json       checked = SettingsBridge::object_override(id, value, config);
    if (!Json::boolean(checked, "ok", false))
        throw Refused(checked.value("text", std::string("Réglage refusé.")));
    Slic3r::ModelObject* object = model().objects[idx];
    object->config.apply(config);
    Slic3r::GUI::ObjectList* list = wxGetApp().obj_list();
    list->add_settings_item(list->GetModel()->GetItemById(idx), &object->config.get());
    plater().changed_object(idx);
    return Json::str(checked, "text");
}

std::string range_setting(int idx, double from, double to, const std::string& id, const nlohmann::json& value)
{
    Slic3r::ModelObject* object = model().objects[idx];
    if (from < 0 || to <= from || to > object->instance_bounding_box(0).size().z() + 1e-3)
        throw Refused("La tranche de hauteur doit être dans la pièce.");
    for (const auto& [range, config] : object->layer_config_ranges)
        if (range.first < to && from < range.second)
            throw Refused("Cette tranche chevauche une tranche déjà réglée sur la pièce.");
    Slic3r::GUI::ObjectList*   list   = wxGetApp().obj_list();
    Slic3r::DynamicPrintConfig config = list->get_default_layer_config(idx);
    const nlohmann::json       checked = SettingsBridge::object_override(id, value, config);
    if (!Json::boolean(checked, "ok", false))
        throw Refused(checked.value("text", std::string("Réglage refusé.")));
    object->layer_config_ranges[{from, to}].assign_config(config);
    const wxDataViewItem object_item = list->GetModel()->GetItemById(idx);
    const wxDataViewItem layers_item = list->GetModel()->GetLayerRootItem(object_item);
    if (layers_item.IsOk())
        list->add_layer_item({from, to}, layers_item);
    else
        list->add_layer_root_item(object_item);
    plater().changed_object(idx);
    return Json::str(checked, "text");
}

// Deux exemplaires de la même plaque se chevauchent ou se touchent (vus de dessus, à 1 mm près) :
// après une coupe, une séparation, des copies ou un agrandissement, il faut réorganiser la plaque.
bool pieces_overlap()
{
    Slic3r::GUI::PartPlateList&                       plates = plater().get_partplate_list();
    std::map<int, std::vector<Slic3r::BoundingBoxf>> by_plate;
    const auto&                                       objects = model().objects;
    for (size_t o = 0; o < objects.size(); ++o)
        for (size_t i = 0; i < objects[o]->instances.size(); ++i) {
            const Slic3r::BoundingBoxf3 box = objects[o]->instance_bounding_box(i);
            const Slic3r::BoundingBoxf  flat(Slic3r::Vec2d(box.min.x() - 0.5, box.min.y() - 0.5), Slic3r::Vec2d(box.max.x() + 0.5, box.max.y() + 0.5));
            std::vector<Slic3r::BoundingBoxf>& seen = by_plate[plates.find_instance(static_cast<int>(o), static_cast<int>(i))];
            for (const Slic3r::BoundingBoxf& other : seen)
                if (flat.overlap(other))
                    return true;
            seen.push_back(flat);
        }
    return false;
}

// Exécute un ordre ; rend le texte de vérification à ajouter à la phrase de l'IA (réglage appliqué), ou vide.
std::string execute(const nlohmann::json& c, const std::optional<Slic3r::ObjectID>& target)
{
    const std::string op = Json::str(c, "op");
    if (is_plate_wide(op)) {
        if (op == "orient") {
            plater().select_all();
            plater().orient();
        } else if (op == "arrange")
            plater().arrange();
        else if (op == "scale_to_fit") {
            plater().select_all();
            plater().scale_selection_to_fit_print_volume();
        } else
            wxPostEvent(&plater(), Slic3r::GUI::SimpleEvent(Slic3r::GUI::EVT_GLTOOLBAR_SLICE_PLATE));
        return {};
    }
    if (op == "inch_to_mm" && !target) {
        plater().select_all();
        plater().convert_unit(Slic3r::ConversionType::CONV_FROM_INCH);
        return {};
    }
    if (!target)
        throw Refused("Je ne sais pas quelle pièce modifier : clique d'abord sur la pièce, puis redemande-moi.");
    const int idx = index_of(*target);
    if (model().objects[idx]->instances.empty())
        throw Refused("Cette pièce n'a pas d'exemplaire sur le plateau.");
    if (op == "rotate")
        rotate(idx, axis_of(c), amount(c, "amount", -360, 360));
    else if (op == "lay_flat")
        lay_flat(idx, Json::str(c, "text"));
    else if (op == "reset_rotation")
        reset_rotation(idx);
    else if (op == "move") {
        const int axis = axis_of(c);
        if (axis == 2)
            throw Refused("Une pièce reste posée sur le plateau : déplacement vertical ignoré.");
        move(idx, axis, amount(c, "amount", -500, 500));
    } else if (op == "center") {
        select_object(idx);
        plater().center_selection();
    } else if (op == "drop") {
        select_object(idx);
        plater().drop_selection();
    } else if (op == "scale")
        scale(idx, axis_index(Json::str(c, "axis")), amount(c, "amount", 1, 1000) / 100.0);
    else if (op == "scale_to_size") {
        const int    axis = axis_of(c);
        const double size = model().objects[idx]->instance_bounding_box(0).size()(axis);
        if (size <= 0)
            throw Refused("Taille de la pièce inconnue.");
        // « axis_only » : étirer sur cet axe seulement (« plus épaisse »), sinon proportions gardées.
        scale(idx, Json::str(c, "text") == "axis_only" ? axis : -1, amount(c, "amount", 0.1, 2000) / size);
    } else if (op == "mirror") {
        const int axis = axis_of(c);
        select_object(idx);
        plater().mirror(static_cast<Slic3r::Axis>(axis));
    } else if (op == "set_copies")
        set_copies(idx, static_cast<int>(std::lround(amount(c, "amount", 1, 50))));
    else if (op == "fill_bed") {
        select_object(idx);
        plater().fill_bed_with_instances();
    } else if (op == "delete") {
        select_object(idx);
        plater().remove_selected();
    } else if (op == "rename") {
        const std::string name = Json::str(c, "text");
        if (name.empty() || name.size() > 240)
            throw Refused("Nom vide ou trop long : ordre ignoré.");
        rename(idx, name);
    } else if (op == "printable")
        set_printable(idx, amount(c, "amount", 0, 1) >= 0.5);
    else if (op == "split")
        split(idx, Json::str(c, "text"));
    else if (op == "inch_to_mm") {
        select_object(idx);
        plater().convert_unit(Slic3r::ConversionType::CONV_FROM_INCH);
    } else if (op == "cut_height")
        cut_at(idx, amount(c, "amount", 0, 2000), Json::str(c, "text"));
    else if (op == "object_setting")
        return object_setting(idx, Json::str(c, "setting"), c.contains("setting_value") ? c["setting_value"] : nlohmann::json());
    else if (op == "range_setting")
        return range_setting(idx, amount(c, "amount", 0, 2000), amount(c, "amount2", 0, 2000), Json::str(c, "setting"),
                             c.contains("setting_value") ? c["setting_value"] : nlohmann::json());
    else if (op == "select")
        select_object(idx);
    else
        throw Refused("Ordre inconnu : « " + op + " ».");
    return {};
}

} // namespace

nlohmann::json run(const nlohmann::json& commands)
{
    if (!commands.is_array() || commands.empty() || commands.size() > 6)
        return {{"ok", false}, {"text", "Aucun ordre à exécuter."}, {"done", nlohmann::json::array()}};
    if (!plater().get_ui_job_worker().is_idle())
        return {{"ok", false}, {"text", "Orca est déjà occupé sur le plateau. Réessaie dans un instant."}, {"done", nlohmann::json::array()}};
    if (auto* frame = wxGetApp().mainframe)
        frame->select_tab(TAB_ID_PREPARE);
    canvas().get_gizmos_manager().reset_all_states();

    // Ordres d'abord, puis une seule tâche de fond (orienter, organiser, remplir), puis le découpage.
    std::vector<nlohmann::json> ordered, background, slicing;
    for (const nlohmann::json& c : commands) {
        if (!c.is_object())
            continue;
        const std::string op = Json::str(c, "op");
        (op == "slice" ? slicing : is_background(op) ? background : ordered).push_back(c);
    }
    nlohmann::json skipped = nlohmann::json::array();
    while (background.size() > 1) {
        skipped.push_back(Json::str(background.back(), "summary"));
        background.pop_back();
    }
    // Découper pendant qu'Orca range ou oriente la plaque donnerait un résultat périmé.
    if (!background.empty() && !slicing.empty()) {
        skipped.push_back("Découpe la plaque quand Orca a fini : clique sur « Découper la plaque ».");
        slicing.clear();
    }
    ordered.insert(ordered.end(), background.begin(), background.end());
    ordered.insert(ordered.end(), slicing.begin(), slicing.end());

    // Pièces visées résolues avant tout changement : une coupe décale les rangs des pièces suivantes.
    std::vector<std::optional<Slic3r::ObjectID>> targets;
    for (const nlohmann::json& c : ordered)
        targets.push_back(is_plate_wide(Json::str(c, "op")) ? std::nullopt : target_of(Json::str(c, "object")));

    nlohmann::json done = nlohmann::json::array();
    std::string    failure;
    long long      undo_token = -1;
    const size_t   first_async = ordered.size() - background.size() - slicing.size();
    // Après les ordres immédiats : si des pièces se chevauchent, « Organiser » d'Orca les regroupe au plus près
    // (écart minimal calculé par Orca), sauf si l'utilisateur a déjà demandé de ranger ou d'orienter.
    const auto rearrange_if_needed = [&]() {
        if (!failure.empty() || !background.empty() || !pieces_overlap())
            return;
        plater().arrange();
        done.push_back("J'ai réorganisé la plaque : les pièces se chevauchaient, elles sont maintenant regroupées sans se toucher.");
        if (!slicing.empty()) {
            skipped.push_back("Découpe la plaque quand Orca a fini de la ranger : clique sur « Découper la plaque ».");
            ordered.resize(first_async);
        }
    };
    {
        // Une seule étape d'annulation pour tout le lot : « Annuler » remet le plateau comme avant.
        Slic3r::GUI::Plater::TakeSnapshot snapshot(&plater(), "Plyo assistant");
        undo_token = static_cast<long long>(plater().undo_redo_stack_main().active_snapshot_time());
        for (size_t i = 0; i < ordered.size(); ++i) {
            if (i == first_async)
                rearrange_if_needed();
            if (i >= ordered.size())
                break;
            const nlohmann::json& c = ordered[i];
            try {
                const std::string checked = execute(c, targets[i]);
                std::string       said    = Json::str(c, "summary");
                if (!checked.empty())
                    said += " (" + checked + ")";
                done.push_back(said);
            } catch (const Refused& e) {
                failure = e.what();
                break;
            } catch (const std::exception& e) {
                BOOST_LOG_TRIVIAL(error) << "Plyo: ordre " << Json::str(c, "op") << " en échec : " << e.what();
                failure = "Orca n'a pas pu exécuter cet ordre.";
                break;
            }
        }
        if (first_async == ordered.size())
            rearrange_if_needed();
    }
    canvas().set_as_dirty();
    nlohmann::json result{{"ok", failure.empty()}, {"done", done}, {"text", failure}, {"skipped", skipped}};
    if (!done.empty())
        result["undo_token"] = undo_token;
    return result;
}

nlohmann::json open_tool(const std::string& tool)
{
    using EType = Slic3r::GUI::GLGizmosManager::EType;
    static const std::map<std::string, std::pair<EType, const char*>> tools = {
        {"move", {EType::Move, "Déplacer"}},
        {"rotate", {EType::Rotate, "Pivoter"}},
        {"scale", {EType::Scale, "Redimensionner"}},
        {"lay_flat", {EType::Flatten, "Poser sur une face"}},
        {"cut", {EType::Cut, "Couper"}},
        {"boolean", {EType::MeshBoolean, "Opérations booléennes"}},
        {"paint_supports", {EType::FdmSupports, "Peindre les supports"}},
        {"paint_seam", {EType::Seam, "Peinture des coutures"}},
        {"fuzzy_skin", {EType::FuzzySkin, "Surface irrégulière peinte"}},
        {"paint_color", {EType::MmSegmentation, "Mettre en couleur"}},
        {"text", {EType::Emboss, "Embosser"}},
        {"svg", {EType::Svg, "SVG"}},
        {"measure", {EType::Measure, "Mesurer"}},
        {"assembly", {EType::Assembly, "Assemblé"}},
        {"simplify", {EType::Simplify, "Simplifier"}},
        {"brim_ears", {EType::BrimEars, "Bordure à oreilles"}},
    };
    const auto it = tools.find(tool);
    if (it == tools.end())
        return {{"ok", false}, {"text", "Outil inconnu."}};
    const std::optional<Slic3r::ObjectID> target = target_of("");
    if (!target)
        return {{"ok", false}, {"text", "Clique d'abord sur la pièce, puis redemande-moi d'ouvrir l'outil."}};
    if (auto* frame = wxGetApp().mainframe)
        frame->select_tab(TAB_ID_PREPARE);
    const int idx = index_of(*target);
    select_object(idx);
    Slic3r::GUI::GLGizmosManager& gizmos = canvas().get_gizmos_manager();
    // Rouvrir l'outil déjà ouvert le fermerait.
    if (gizmos.get_current_type() != it->second.first && !gizmos.open_gizmo(it->second.first))
        return {{"ok", false}, {"text", std::string("Je n'ai pas pu ouvrir l'outil « ") + it->second.second + " » sur cette pièce."}};
    canvas().set_as_dirty();
    return {{"ok", true}, {"text", std::string("J'ai ouvert l'outil « ") + it->second.second + " » sur « " + model().objects[idx]->name + " »."}};
}

}} // namespace Plyo::Commands
