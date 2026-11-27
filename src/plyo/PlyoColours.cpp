// Sous Windows, boost (asio, via PlyoCanvas → PlyoCC2) doit être inclus avant les en-têtes de wxWidgets.
#include "PlyoColours.hpp"
#include "PlyoCanvas.hpp"

#include "PlyoAutoSave.hpp"
#include "PlyoColoursLogic.hpp"
#include "PlyoJson.hpp"
#include "PlyoProjectFiles.hpp"
#include "PlyoProjectLogic.hpp"
#include "PlyoSlots.hpp"

#include "libslic3r/Config.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/ObjectID.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/miniz_extension.hpp"
#include "slic3r/GUI/GLCanvas3D.hpp"
#include "slic3r/GUI/GUI.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/GUI_ObjectList.hpp"
#include "slic3r/GUI/Gizmos/GLGizmosManager.hpp"
#include "slic3r/GUI/Jobs/Worker.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/ObjectDataViewModel.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Selection.hpp"
#include "slic3r/GUI/Tab.hpp"
#include "slic3r/Utils/UndoRedo.hpp"

#include <boost/log/trivial.hpp>
#include <wx/colour.h>
#include <wx/dataview.h>
#include <wx/string.h>

#include <algorithm>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace Plyo { namespace Colours {

using Slic3r::GUI::wxGetApp;
namespace CL = ColoursLogic;

namespace {

constexpr size_t MAX_PIECES = 50;

Slic3r::PresetBundle& bundle() { return *wxGetApp().preset_bundle; }

nlohmann::json refuse(const std::string& reason, const std::string& text) { return {{"ok", false}, {"reason", reason}, {"text", text}}; }

const char* const GONE_TEXT = "Cette pièce n'est plus sur la plaque : touche « Vérifier à nouveau ». Rien n'a été modifié.";

// Rangs (dans le modèle) des pièces posées sur la plaque en cours.
std::vector<int> plate_objects(Slic3r::GUI::Plater& plater)
{
    std::vector<int>            out;
    Slic3r::GUI::PartPlateList& plates  = plater.get_partplate_list();
    const int                   current = plates.get_curr_plate_index();
    const auto&                 objects = plater.model().objects;
    for (size_t i = 0; i < objects.size() && out.size() < MAX_PIECES; ++i)
        if (!objects[i]->instances.empty() && plates.find_instance(static_cast<int>(i), 0) == current)
            out.push_back(static_cast<int>(i));
    return out;
}

// La pièce `ref` (identifiant stable de l'objet, comme les ordres du plateau), si elle est sur la plaque en cours.
std::optional<int> object_on_plate(Slic3r::GUI::Plater& plater, const std::string& ref)
{
    if (ref.empty() || ref.size() > 18 || ref.find_first_not_of("0123456789") != std::string::npos)
        return std::nullopt;
    const size_t id = std::stoull(ref);
    for (int idx : plate_objects(plater))
        if (plater.model().objects[idx]->id().id == id)
            return idx;
    return std::nullopt;
}

std::vector<int> model_parts(const Slic3r::ModelObject& object)
{
    std::vector<int> out;
    for (size_t v = 0; v < object.volumes.size(); ++v)
        if (object.volumes[v]->is_model_part())
            out.push_back(static_cast<int>(v));
    return out;
}

// Clé « extruder » d'Orca (dès 1, 0 ou absente : la première) ramenée à une couleur du projet dès 0.
int object_t(const Slic3r::ModelObject& object)
{
    const Slic3r::ConfigOption* opt = object.config.option("extruder");
    return std::max(opt != nullptr ? opt->getInt() : 1, 1) - 1;
}

CL::Piece piece_of(const Slic3r::ModelObject& object, bool selected)
{
    CL::Piece p;
    p.ref      = std::to_string(object.id().id);
    p.name     = Json::utf8_prefix(object.name, 120);
    p.selected = selected;
    p.t        = object_t(object);
    const std::vector<int> parts = model_parts(object);
    for (int v : parts) {
        const Slic3r::ModelVolume& volume = *object.volumes[v];
        for (size_t e : volume.get_extruders_from_multi_material_painting()) // dès 0, comme t
            p.painted.push_back(static_cast<int>(e));
        if (parts.size() > 1)
            p.parts.push_back({std::to_string(volume.id().id), Json::utf8_prefix(volume.name, 120), std::max(volume.extruder_id(), 1) - 1});
    }
    // Une seule partie faite de plusieurs morceaux séparés (lot 3 : « Séparer pour colorier chaque morceau »).
    p.splittable = parts.size() == 1 && object.volumes.size() == 1 && object.volumes[parts.front()]->is_splittable();
    return p;
}

CL::Busy busy_now(Slic3r::GUI::Plater& plater)
{
    CL::Busy b;
    b.other_conversation      = ProjectFiles::edits_blocked();
    b.other_conversation_text = std::string(ProjectFiles::busy_text()) + " Rien n'a été modifié.";
    b.job                     = !plater.get_ui_job_worker().is_idle();
    b.slicing                 = plater.is_background_process_slicing();
    b.sending                 = AutoSave::sending();
    b.calibrating             = AutoSave::calibrating();
    b.modal                   = AutoSave::modal_open();
    return b;
}

Slic3r::GUI::Selection& selection(Slic3r::GUI::Plater& plater) { return plater.get_view3D_canvas3D()->get_selection(); }

// Comme un clic sur la pièce (PlyoCommands, select_object) ou sur une de ses parties dans la vue 3D.
void select_target(Slic3r::GUI::Plater& plater, int obj_idx, int vol_idx)
{
    Slic3r::GUI::Selection& sel = selection(plater);
    if (vol_idx < 0) {
        sel.set_mode(Slic3r::GUI::Selection::Instance);
        sel.add_object(static_cast<unsigned int>(obj_idx), true);
    } else {
        sel.set_mode(Slic3r::GUI::Selection::Volume);
        sel.add_volume(static_cast<unsigned int>(obj_idx), static_cast<unsigned int>(vol_idx), 0, true);
    }
    wxGetApp().obj_list()->update_selections();
}

// La sélection de la liste des objets, celle que lit set_extruder_for_selected_items, désigne-t-elle bien la cible ? Pour une
// partie, le numéro lu par Orca dans la liste (get_item_config : GetVolumeIdByItem) doit être celui de la partie du modèle.
bool list_targets(int obj_idx, int vol_idx)
{
    Slic3r::GUI::ObjectList*          list  = wxGetApp().obj_list();
    Slic3r::GUI::ObjectDataViewModel* model = list->GetModel();
    wxDataViewItemArray               sels;
    list->GetSelections(sels);
    if (sels.empty() || (vol_idx >= 0 && sels.size() != 1))
        return false;
    for (const wxDataViewItem& item : sels) {
        const Slic3r::GUI::ItemType type = model->GetItemType(item);
        if (vol_idx >= 0) {
            if (!(type & Slic3r::GUI::itVolume) || model->GetObjectIdByItem(item) != obj_idx || model->GetVolumeIdByItem(item) != vol_idx ||
                model->get_real_volume_index_in_3d(obj_idx, vol_idx) != vol_idx)
                return false;
            continue;
        }
        const wxDataViewItem object = (type & Slic3r::GUI::itInstance) ? model->GetObject(item) : item;
        if (!(model->GetItemType(object) & Slic3r::GUI::itObject) || model->GetObjectIdByItem(object) != obj_idx)
            return false;
    }
    return true;
}

// Sélection de la liste mise directement sur la cible (la liste gardait par exemple un réglage de la pièce sélectionné).
void select_in_list(int obj_idx, int vol_idx)
{
    Slic3r::GUI::ObjectList*          list  = wxGetApp().obj_list();
    Slic3r::GUI::ObjectDataViewModel* model = list->GetModel();
    wxDataViewItemArray               items;
    items.Add(vol_idx < 0 ? model->GetItemById(obj_idx) : model->GetItemByVolumeId(obj_idx, model->get_real_volume_index_in_ui(obj_idx, vol_idx)));
    if (!items[0].IsOk())
        return;
    list->select_items(items);
    list->selection_changed(); // la vue 3D suit
}

// Ce qui était sélectionné avant : les pièces, par leur identifiant (une partie sélectionnée revient à sa pièce).
std::vector<Slic3r::ObjectID> selected_objects(Slic3r::GUI::Plater& plater)
{
    std::vector<Slic3r::ObjectID> out;
    for (const auto& [obj_idx, instances] : selection(plater).get_content())
        if (obj_idx >= 0 && obj_idx < static_cast<int>(plater.model().objects.size()))
            out.push_back(plater.model().objects[obj_idx]->id());
    return out;
}

void restore_selection(Slic3r::GUI::Plater& plater, const std::vector<Slic3r::ObjectID>& ids)
{
    Slic3r::GUI::Selection& sel = selection(plater);
    sel.remove_all();
    sel.set_mode(Slic3r::GUI::Selection::Instance);
    bool first = true;
    for (const Slic3r::ObjectID& id : ids) {
        const auto& objects = plater.model().objects;
        for (size_t i = 0; i < objects.size(); ++i)
            if (objects[i]->id() == id) {
                sel.add_object(static_cast<unsigned int>(i), first);
                first = false;
            }
    }
    wxGetApp().obj_list()->update_selections();
}

int volume_index(const Slic3r::ModelObject& object, const std::string& ref)
{
    if (ref.empty() || ref.size() > 18 || ref.find_first_not_of("0123456789") != std::string::npos)
        return -1;
    const size_t id = std::stoull(ref);
    for (int v : model_parts(object))
        if (object.volumes[v]->id().id == id)
            return v;
    return -1;
}

// La couleur de la cible relue dans le modèle (dès 0).
int target_t(const Slic3r::ModelObject& object, int vol_idx)
{
    if (vol_idx >= 0)
        return std::max(object.volumes[vol_idx]->extruder_id(), 1) - 1;
    for (int v : model_parts(object)) // une pièce entière : toutes ses parties ont pris sa couleur
        if (std::max(object.volumes[v]->extruder_id(), 1) - 1 != object_t(object))
            return -1;
    return object_t(object);
}

// Fil principal, la bobine relue : `slots_state` au format commun des emplacements.
nlohmann::json finish(const nlohmann::json& request, const nlohmann::json& slots_state)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return refuse("failed", "Le plateau n'est pas disponible.");
    if (const std::string busy = CL::busy_refusal(busy_now(*plater)); !busy.empty())
        return refuse("busy", busy);
    const std::optional<int> found = object_on_plate(*plater, Json::str(request, "object"));
    if (!found)
        return refuse("gone", GONE_TEXT);
    const int            obj_idx  = *found;
    Slic3r::ModelObject* object   = plater->model().objects[obj_idx];
    const std::string    part_ref = Json::str(request, "part");
    const int            vol_idx  = part_ref.empty() ? -1 : volume_index(*object, part_ref);
    if (!part_ref.empty() && vol_idx < 0)
        return refuse("gone", "Cette partie n'est plus dans la pièce : touche « Vérifier à nouveau ». Rien n'a été modifié.");
    if (vol_idx < 0 && !Json::boolean(request, "all_parts", false) && CL::piece_colour(piece_of(*object, false)) < 0)
        return refuse("mixed", "Les parties de cette pièce n'ont pas la même couleur : change-les une par une. Rien n'a été modifié.");

    const nlohmann::json slot = Json::obj(request, "slot");
    const CL::Slot       wanted{static_cast<int>(Json::integer(slot, "canvas_id", -1)), static_cast<int>(Json::integer(slot, "tray_id", -1))};
    const std::string    type = Json::str(slot, "type", 30), color = Json::str(slot, "color", 16);
    if (std::string refused = CL::slot_refusal(slots_state, wanted, type, color); !refused.empty())
        return refuse("slot", refused);

    std::vector<int> used;
    for (const nlohmann::json& c : Canvas::colours())
        used.push_back(static_cast<int>(Json::integer(c, "t", 0)));
    const int        count  = static_cast<int>(bundle().filament_presets.size());
    const nlohmann::json canvas = Json::arr(request, "canvas");
    const CL::Choice choice = CL::filament_for(canvas, used, count, wanted, CL::MAX_COLOURS);
    if (!choice.refusal.empty())
        return refuse("full", choice.refusal);
    // Sidebar::add_custom_filament range une couleur ajoutée avant les couleurs mélangées et renumérote les pièces, et ouvre une
    // fenêtre sur un G-code ouvert en aperçu : dans ces deux cas, rien n'est ajouté.
    if (choice.add && (bundle().num_mixed_filaments() > 0 || plater->using_exported_file() || plater->gcode_settings_loaded()))
        return refuse("full", "Je ne peux pas ajouter de couleur à ce projet ici : choisis une bobine déjà utilisée, ou ajoute la couleur dans Plyo Slicer. Rien n'a été modifié.");

    if (auto* frame = wxGetApp().mainframe)
        frame->select_tab(TAB_ID_PREPARE);
    plater->get_view3D_canvas3D()->get_gizmos_manager().reset_all_states();

    const std::vector<Slic3r::ObjectID> before    = selected_objects(*plater);
    const Slic3r::ObjectID              object_id = object->id();
    long long                           undo_token = -1;
    std::string                         failure;
    std::string                         preset;
    bool                                added = false;
    {
        // Une seule étape d'annulation, comme les ordres du plateau : « Annuler » remet la couleur de la pièce.
        Slic3r::GUI::Plater::TakeSnapshot snapshot(plater, "Plyo assistant");
        undo_token = static_cast<long long>(plater->undo_redo_stack_main().active_snapshot_time());
        if (choice.add) {
            // Non annulable chez Orca (les couleurs du projet ne sont pas dans son historique) : la couleur ajoutée reste,
            // sans effet tant qu'aucune pièce ne l'utilise. L'assistant n'en retire jamais.
            plater->sidebar().add_filament();
            added = static_cast<int>(bundle().filament_presets.size()) == count + 1;
            if (!added)
                failure = "Je n'ai pas pu ajouter de couleur au projet. Rien n'a été modifié sur la pièce.";
        }
        // La première couleur est le filament du projet, réglé à la confirmation des bobines (onglet Filament) : pas ici.
        if (failure.empty() && choice.t != 0) {
            nlohmann::json entry = {{"t", choice.t}, {"type", type}, {"color", color}};
            if (const std::string brand = Json::str(slot, "preset", 200); !brand.empty())
                entry["preset"] = brand;
            const nlohmann::json applied = Canvas::apply(nlohmann::json::array({entry}));
            if (!Json::boolean(applied, "ok", false))
                failure = Json::str(applied, "text");
            else if (!Json::arr(applied, "presets").empty())
                preset = Json::str(Json::arr(applied, "presets")[0], "preset", 200);
        }
        if (failure.empty()) {
            const int idx = [&] { // un ajout de couleur ne déplace pas les pièces, mais on relit le rang par l'identifiant
                const auto& objects = plater->model().objects;
                for (size_t i = 0; i < objects.size(); ++i)
                    if (objects[i]->id() == object_id)
                        return static_cast<int>(i);
                return -1;
            }();
            if (idx < 0)
                failure = GONE_TEXT;
            else {
                select_target(*plater, idx, vol_idx);
                if (!list_targets(idx, vol_idx)) {
                    select_in_list(idx, vol_idx);
                    if (!list_targets(idx, vol_idx))
                        failure = "Je n'arrive pas à sélectionner cette pièce dans Plyo Slicer : touche-la dans la vue 3D, puis réessaie. Rien n'a été modifié.";
                }
                if (failure.empty()) {
                    wxGetApp().obj_list()->set_extruder_for_selected_items(choice.t + 1);
                    if (target_t(*plater->model().objects[idx], vol_idx) != choice.t)
                        failure = "Plyo Slicer n'a pas changé la couleur de cette pièce. Réessaie, ou change-la dans la liste des objets.";
                }
            }
        }
        restore_selection(*plater, before);
    }
    plater->get_view3D_canvas3D()->set_as_dirty();
    if (!failure.empty()) {
        BOOST_LOG_TRIVIAL(info) << "Plyo: couleur de pièce non changée : " << failure;
        nlohmann::json out = refuse("failed", failure);
        out["added"]       = added;
        return out;
    }
    // L'association ne garde que les couleurs encore utilisées : sinon la vérification d'avant l'envoi (panneau) la refuserait.
    std::vector<int> used_after;
    for (const nlohmann::json& c : Canvas::colours())
        used_after.push_back(static_cast<int>(Json::integer(c, "t", 0)));
    return {{"ok", true}, {"t", choice.t}, {"added", added}, {"undo_token", undo_token}, {"preset", preset},
            {"canvas", CL::only_used(CL::canvas_with(canvas, choice.t, wanted), used_after)}};
}

// Une entrée du 3MF (zip), `max_bytes` au plus ; nullopt si elle manque, est trop grande ou ne se lit pas. miniz alloue d'après
// la taille annoncée et échoue si le contenu réel la dépasse (comme Project::read_3mf_settings).
std::optional<std::string> zip_entry(mz_zip_archive& zip, const char* name, size_t max_bytes)
{
    const int                index = mz_zip_reader_locate_file(&zip, name, nullptr, 0);
    mz_zip_archive_file_stat stat;
    if (index < 0 || !mz_zip_reader_file_stat(&zip, static_cast<mz_uint>(index), &stat) || stat.m_uncomp_size > max_bytes)
        return std::nullopt;
    size_t size = 0;
    void*  data = mz_zip_reader_extract_to_heap(&zip, static_cast<mz_uint>(index), &size, 0);
    if (data == nullptr)
        return std::nullopt;
    std::string out(static_cast<const char*>(data), size);
    mz_free(data);
    return out;
}

bool zip_has(mz_zip_archive& zip, const char* name) { return mz_zip_reader_locate_file(&zip, name, nullptr, 0) >= 0; }

// Couleurs (dès 0) que portent les pièces `objects` : pièce, parties, zones peintes.
std::vector<int> used_by(const Slic3r::Model& model, const std::vector<size_t>& objects)
{
    std::set<int> out;
    for (size_t idx : objects) {
        if (idx >= model.objects.size())
            continue;
        const Slic3r::ModelObject& object = *model.objects[idx];
        out.insert(object_t(object));
        for (int v : model_parts(object)) {
            out.insert(std::max(object.volumes[v]->extruder_id(), 1) - 1);
            for (size_t e : object.volumes[v]->get_extruders_from_multi_material_painting())
                out.insert(static_cast<int>(e));
        }
    }
    return std::vector<int>(out.begin(), out.end());
}

// Partie d'un 3MF ordinaire nommée par Orca d'après sa pièce (« Pièce », « Pièce_2 »…, bbs_3mf.cpp) : elle reprend le nom
// qu'elle porte dans le fichier.
bool named_after_object(const std::string& volume, const std::string& object, size_t rank)
{
    return volume == object || volume == object + "_" + std::to_string(rank + 1);
}

// Les pièces que le lecteur d'Orca vient de créer (`added`) correspondent-elles au fichier (nombre de pièces et de parties) ?
bool parts_match(Slic3r::GUI::Plater& plater, const std::vector<size_t>& added, const CL::FileColours& file)
{
    const auto& objects = plater.model().objects;
    if (added.size() != file.objects.size())
        return false;
    for (size_t i = 0; i < added.size(); ++i)
        if (added[i] >= objects.size() || model_parts(*objects[added[i]]).size() != file.objects[i].parts.size())
            return false;
    return true;
}

// Couleurs du fichier données aux parties de ces pièces (parts_match vrai). Les couleurs du projet doivent déjà exister : Orca
// ramène à la première tout numéro qui les dépasse dès que leur nombre change (ObjectList::update_filament_values_for_items).
// Machine connue pour n'imprimer qu'une bobine à la fois (retour d'essai, 22/11 : 7 couleurs d'un 3MF reprises sur une
// CR-10 SE) : une seule tête, aucun système d'emplacements lu par Plyo (CFS, Canvas, IFS, U1) ni saisi à la main, et pas
// une Bambu Lab (un AMS y est possible sans que Plyo le lise). Dans le doute, la machine n'est pas « à une bobine ».
bool single_spool_machine()
{
    const Slic3r::Preset& printer = bundle().printers.get_edited_preset();
    if (const auto* nozzles = printer.config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter"); nozzles != nullptr && nozzles->values.size() > 1)
        return false;
    if (bundle().is_bbl_vendor() || !Canvas::translator_of(printer.config).empty())
        return false;
    return Json::arr(Slots::manual_get(bundle().printers.get_selected_preset_name()), "trays").empty();
}

// Une bobine : les pièces posées prennent toutes le filament 1 (pièce et parties), comme « Changer de filament » d'Orca.
// Orca a pu lire la couleur de chaque partie d'un projet Bambu Studio ou Orca : elle ne vaut rien sans bobine pour elle.
void one_filament(Slic3r::GUI::Plater& plater, const std::vector<size_t>& added)
{
    auto&                             objects = plater.model().objects;
    Slic3r::GUI::ObjectDataViewModel* model   = wxGetApp().obj_list()->GetModel();
    for (size_t idx : added) {
        if (idx >= objects.size())
            continue;
        Slic3r::ModelObject& object = *objects[idx];
        object.config.set_key_value("extruder", new Slic3r::ConfigOptionInt(1));
        for (Slic3r::ModelVolume* volume : object.volumes)
            if (volume->config.has("extruder"))
                volume->config.erase("extruder");
        model->SetExtruder(wxString::Format("%d", 1), model->GetItemById(static_cast<int>(idx)));
    }
}

void assign_parts(Slic3r::GUI::Plater& plater, const std::vector<size_t>& added, const CL::FileColours& file)
{
    auto&                             objects = plater.model().objects;
    Slic3r::GUI::ObjectList*          list  = wxGetApp().obj_list();
    Slic3r::GUI::ObjectDataViewModel* model = list->GetModel();
    for (size_t i = 0; i < added.size(); ++i) {
        const int                 obj_idx = static_cast<int>(added[i]);
        Slic3r::ModelObject&      object  = *objects[obj_idx];
        const std::vector<int>    parts   = model_parts(object);
        const CL::FileObject&     fo      = file.objects[i];
        if (fo.parts.empty())
            continue;
        // Toutes les parties d'une même couleur : la couleur va à la pièce, comme « Changer de filament » d'Orca sur une pièce.
        const bool same = std::all_of(fo.parts.begin(), fo.parts.end(), [&](const CL::FilePart& p) { return p.t == fo.parts.front().t; });
        if (same && fo.parts.front().t >= 0) {
            object.config.set_key_value("extruder", new Slic3r::ConfigOptionInt(fo.parts.front().t + 1));
            for (int v : parts)
                if (object.volumes[v]->config.has("extruder"))
                    object.volumes[v]->config.erase("extruder");
            model->SetExtruder(wxString::Format("%d", fo.parts.front().t + 1), model->GetItemById(obj_idx));
        }
        for (size_t k = 0; k < parts.size(); ++k) {
            Slic3r::ModelVolume& volume = *object.volumes[parts[k]];
            const wxDataViewItem item   = parts.size() > 1 ? model->GetItemByVolumeId(obj_idx, model->get_real_volume_index_in_ui(obj_idx, parts[k])) : wxDataViewItem();
            if (!same && fo.parts[k].t >= 0) {
                volume.config.set_key_value("extruder", new Slic3r::ConfigOptionInt(fo.parts[k].t + 1));
                if (item.IsOk())
                    model->SetExtruder(wxString::Format("%d", fo.parts[k].t + 1), item);
            }
            const std::string& name = fo.parts[k].name;
            if (parts.size() > 1 && !name.empty() && name != object.name && named_after_object(volume.name, object.name, k)) {
                volume.name = name;
                if (item.IsOk())
                    model->SetName(Slic3r::GUI::from_u8(name), item);
            }
        }
    }
}

} // namespace

nlohmann::json from_file(const std::string& path_utf8, const std::vector<size_t>& added)
{
    nlohmann::json       none = {{"file_colours", nlohmann::json::array()}};
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr || added.empty())
        return none;
    constexpr size_t MAX_SETTINGS_BYTES = 8 * 1024 * 1024;
    constexpr size_t MAX_MODEL_BYTES    = 512 * 1024 * 1024;
    std::vector<std::string> colours;
    std::optional<CL::FileColours> parts; // 3MF ordinaire : couleurs des parties, à poser
    {
        mz_zip_archive zip;
        mz_zip_zero_struct(&zip);
        if (!Slic3r::open_zip_reader(&zip, path_utf8))
            return none;
        // Projet de Bambu Studio, d'Orca ou de PrusaSlicer : Orca garde déjà la couleur de chaque partie (model_settings.config) ;
        // seules les teintes manquent (elles sont dans les réglages du projet, que l'import de la pièce seule ne lit pas).
        const bool project_file = zip_has(zip, "Metadata/model_settings.config") || zip_has(zip, "Metadata/Slic3r_PE_model.config");
        if (const auto settings = zip_entry(zip, "Metadata/project_settings.config", MAX_SETTINGS_BYTES))
            colours = ProjectLogic::file_colours(*settings);
        if (!project_file)
            if (const auto xml = zip_entry(zip, "3D/3dmodel.model", MAX_MODEL_BYTES)) {
                parts   = CL::model_colours(*xml);
                colours = parts->colours;
            }
        Slic3r::close_zip_reader(&zip);
    }
    size_t valid = 0;
    for (const std::string& c : colours)
        valid += c.empty() ? 0 : 1;
    if (valid < 2)
        return none; // une couleur (ou aucune) : la pièce prend la bobine choisie, comme avant
    if (single_spool_machine()) {
        // Une seule bobine : rien n'est ajouté au projet, tout s'imprime dans la bobine choisie ; le panneau le dit.
        {
            Slic3r::GUI::Plater::SuppressSnapshots quiet(plater);
            one_filament(*plater, added);
        }
        wxGetApp().obj_list()->Refresh();
        plater->update();
        BOOST_LOG_TRIVIAL(info) << "Plyo: couleurs du 3MF non reprises (" << valid << ") : machine à une seule bobine";
        return {{"file_colours", nlohmann::json::array()}, {"colours_ignored", static_cast<int>(valid)}};
    }

    // Les pièces de la plaque qui n'arrivent pas avec ce fichier gardent leurs couleurs.
    std::vector<size_t> others;
    for (size_t i = 0; i < plater->model().objects.size(); ++i)
        if (std::find(added.begin(), added.end(), i) == added.end())
            others.push_back(i);
    const std::vector<int> used_before = used_by(plater->model(), others);
    {
        // Rendre le fichier tel qu'il est fait partie de l'import : pas d'étape d'annulation à part (« Annuler » de l'import, ou
        // celui du remplacement de la pièce, défait aussi ces couleurs).
        Slic3r::GUI::Plater::SuppressSnapshots quiet(plater);
        if (parts && !parts_match(*plater, added, *parts)) {
            BOOST_LOG_TRIVIAL(warning) << "Plyo: couleurs du 3MF non reprises : les pièces posées ne correspondent pas au fichier";
            return none;
        }
        // Comme l'import d'Orca (Plater::load_files) : une couleur de projet de plus pour chaque couleur du fichier qui manque, avant
        // d'affecter les parties.
        int needed = 0;
        if (parts) {
            for (const CL::FileObject& o : parts->objects)
                for (const CL::FilePart& p : o.parts)
                    needed = std::max(needed, p.t + 1);
        } else if (const std::vector<int> used = used_by(plater->model(), added); !used.empty())
            needed = used.back() + 1;
        int count = static_cast<int>(bundle().filament_presets.size());
        while (count < needed && count < CL::MAX_COLOURS) {
            const std::string c = count < static_cast<int>(colours.size()) && !colours[count].empty() ? colours[count]
                                                                                                      : Slic3r::GUI::Plater::get_next_color_for_filament().GetAsString(wxC2S_HTML_SYNTAX).ToStdString();
            bundle().set_num_filaments(static_cast<unsigned int>(count + 1), c);
            plater->on_filament_count_change(static_cast<size_t>(count + 1));
            ++count;
        }
        if (Slic3r::GUI::Tab* tab = wxGetApp().get_tab(Slic3r::Preset::TYPE_PRINT))
            tab->update();
        if (parts)
            assign_parts(*plater, added, *parts);
        const std::vector<int> used_now = used_by(plater->model(), added);
        for (const auto& [t, c] : CL::colours_to_set(colours, used_now, used_before))
            if (t < count)
                Canvas::set_project_colour(static_cast<size_t>(t), c);
    }
    wxGetApp().obj_list()->Refresh();
    plater->update();
    plater->get_view3D_canvas3D()->set_as_dirty();
    BOOST_LOG_TRIVIAL(info) << "Plyo: couleurs du 3MF reprises : " << valid << " couleurs";
    nlohmann::json out = nlohmann::json::array();
    for (const std::string& c : colours)
        out.push_back(c);
    return {{"file_colours", out}};
}

nlohmann::json state()
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return {{"ok", false}};
    std::set<int> selected;
    for (const auto& [obj_idx, instances] : selection(*plater).get_content())
        selected.insert(obj_idx);
    std::vector<CL::Piece> pieces;
    for (int idx : plate_objects(*plater))
        pieces.push_back(piece_of(*plater->model().objects[idx], selected.count(idx) > 0));
    return {{"ok", true}, {"pieces", CL::to_json(pieces)}, {"colours", Canvas::colours()}, {"count", bundle().filament_presets.size()}};
}

bool select(const std::string& ref)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return false;
    const std::optional<int> idx = object_on_plate(*plater, ref);
    if (!idx)
        return false;
    select_target(*plater, *idx, -1);
    plater->get_view3D_canvas3D()->set_as_dirty();
    return true;
}

void set_colour(const nlohmann::json& request, std::function<void(nlohmann::json)> done)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr) {
        done(refuse("failed", "Le plateau n'est pas disponible."));
        return;
    }
    // D'abord ce qui se dit sans relire l'imprimante (refus immédiat).
    if (const std::string busy = CL::busy_refusal(busy_now(*plater)); !busy.empty()) {
        done(refuse("busy", busy));
        return;
    }
    if (!object_on_plate(*plater, Json::str(request, "object"))) {
        done(refuse("gone", GONE_TEXT));
        return;
    }
    const std::string preset = Json::str(request, "preset", 200);
    if (preset.empty() || preset != bundle().printers.get_selected_preset_name()) {
        done(refuse("gone", "Plyo Slicer n'est plus sur l'imprimante de ce projet : remets le projet, puis réessaie. Rien n'a été modifié."));
        return;
    }
    // Saisie manuelle : la bobine doit être dans ce que tu as dit ; sinon relue sur l'imprimante (réseau local).
    if (Json::str(request, "source") == "manual") {
        done(finish(request, Slots::manual_get(preset)));
        return;
    }
    Canvas::read(preset, [request, done](nlohmann::json read) { done(finish(request, read)); });
}

}} // namespace Plyo::Colours
