#include "PlyoPreflight.hpp"
#include "PlyoPlateActions.hpp"

#include "libslic3r/Model.hpp"
#include "libslic3r/ObjectID.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintBase.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <vector>

namespace Plyo { namespace Preflight {

using Slic3r::GUI::wxGetApp;

namespace {

// Surface (mm²) des faces tournées vers le bas et posées sur le plateau, pour la première instance.
double contact_area(const Slic3r::ModelObject& object)
{
    const indexed_triangle_set its = object.raw_indexed_triangle_set();
    const Slic3r::Transform3d  m   = object.instances[0]->get_transformation().get_matrix();
    std::vector<Slic3r::Vec3d> v;
    v.reserve(its.vertices.size());
    double zmin = std::numeric_limits<double>::max();
    for (const auto& p : its.vertices) {
        v.push_back(m * p.cast<double>());
        zmin = std::min(zmin, v.back().z());
    }
    double area = 0;
    for (const auto& f : its.indices) {
        const Slic3r::Vec3d &a = v[f[0]], &b = v[f[1]], &c = v[f[2]];
        if (std::max({a.z(), b.z(), c.z()}) > zmin + 0.05)
            continue;
        const Slic3r::Vec3d n   = (b - a).cross(c - a);
        const double        len = n.norm();
        if (len > 0 && n.z() / len < -0.995)
            area += 0.5 * len;
    }
    return area;
}

// Pièces pour lesquelles le dernier découpage a signalé des parties dans le vide (supports désactivés).
// Le découpage travaille sur sa propre copie du modèle : on compare les identifiants, que la copie conserve.
std::set<Slic3r::ObjectID> needing_support(Slic3r::GUI::Plater& plater)
{
    std::set<Slic3r::ObjectID> out;
    Slic3r::GUI::PartPlate*              plate = plater.get_partplate_list().get_curr_plate();
    if (plate == nullptr || !plate->is_slice_result_valid())
        return out;
    for (const Slic3r::PrintObject* po : plater.get_partplate_list().get_current_fff_print().objects()) {
        const auto state = po->step_state_with_warnings(Slic3r::posSupportMaterial);
        for (const auto& w : state.warnings)
            if (w.current && w.message_id == Slic3r::PrintStateBase::SlicingNeedSupportOn)
                out.insert(po->model_object()->id());
    }
    return out;
}

} // namespace

nlohmann::json measure()
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return nullptr;
    const Slic3r::DynamicPrintConfig& print = wxGetApp().preset_bundle->prints.get_edited_preset().config;
    nlohmann::json                    settings{
        {"brim_type", print.has("brim_type") ? print.opt_serialize("brim_type") : std::string("no_brim")},
        {"brim_width", print.opt_float("brim_width")},
        {"support", print.opt_bool("enable_support")},
    };
    const auto           floating = needing_support(*plater);
    const Slic3r::Vec3d  bed      = PlateActions::bed_size();
    nlohmann::json       objects  = nlohmann::json::array();
    // Seulement la plaque en cours : c'est elle qui est découpée, et que corrigent « Orienter » et « Réduire ».
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate == nullptr)
        return nullptr;
    for (const Slic3r::ModelObject* object : plate->get_objects_on_this_plate()) {
        if (objects.size() >= 50)
            break;
        if (object->instances.empty())
            continue;
        const Slic3r::Vec3d size = object->instance_bounding_box(0).size();
        objects.push_back({{"name", object->name.substr(0, 120)},
                           {"height", std::round(size.z() * 10) / 10},
                           {"foot", {std::round(size.x() * 10) / 10, std::round(size.y() * 10) / 10}},
                           {"contact_mm2", std::round(contact_area(*object))},
                           {"needs_support", floating.count(object->id()) > 0},
                           {"fits", PlateActions::fits(size, bed)}});
    }
    return {{"settings", settings}, {"objects", objects}, {"sliced", plate != nullptr && plate->is_slice_result_valid()}};
}

}} // namespace Plyo::Preflight
