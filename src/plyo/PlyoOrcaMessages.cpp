#include "PlyoOrcaMessages.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoOrcaMessagesLogic.hpp"
#include "PlyoOrcaWindows.hpp"
#include "PlyoPlateActions.hpp"
#include "PlyoSendLogic.hpp"
#include "PlyoSettingsBridge.hpp"

#include "libslic3r/Exception.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/ObjectID.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintBase.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/BackgroundSlicingProcess.hpp"
#include "slic3r/GUI/GCodeViewer.hpp"
#include "slic3r/GUI/GLCanvas3D.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/I18N.hpp"
#include "slic3r/GUI/NotificationManager.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"

#include <boost/filesystem/path.hpp>
#include <boost/format.hpp>

#include <wx/stdpaths.h>
#include <wx/timer.h>
#include <wx/utils.h>

#include <algorithm>
#include <exception>
#include <functional>
#include <iterator>
#include <new>
#include <string>
#include <utility>
#include <vector>

namespace Plyo { namespace OrcaMessages {

using Slic3r::GUI::wxGetApp;
namespace OML = OrcaMessagesLogic;
using Issue    = OrcaMessagesLogic::Issue;

namespace {

std::function<void(const nlohmann::json&)> s_listener;
std::string                                s_last_error_type; // type de l'exception de la dernière fin de traitement, "" sans erreur

// Problème trouvé par Plyo lui-même sur la plaque (sans texte d'Orca : le panneau l'explique).
Issue plyo_issue(const char* code)
{
    Issue issue;
    issue.source = "validate_error";
    issue.level  = "error";
    issue.code   = code;
    return issue;
}

void notify(const nlohmann::json& message)
{
    if (s_listener)
        s_listener(message);
}

// Noms des étapes, dans l'ordre des énumérations d'Orca (Print.hpp). Si Orca en ajoute, la compilation s'arrête ici.
static_assert(Slic3r::psCount == 4, "PrintStep a changé : mettre PRINT_STEPS à jour");
static_assert(Slic3r::posCount == 13, "PrintObjectStep a changé : mettre OBJECT_STEPS à jour");
const char* const PRINT_STEPS[]  = {"psWipeTower", "psSkirtBrim", "psGCodeExport", "psConflictCheck"};
const char* const OBJECT_STEPS[] = {"posSlice", "posPerimeters", "posEstimateCurledExtrusions", "posPrepareInfill", "posInfill", "posIroning",
                                    "posContouring", "posSupportMaterial", "posSimplifyPath", "posSimplifySupportPath", "posDetectOverhangsForLift",
                                    "posSimplifyWall", "posSimplifyInfill"};

// Chemins à retirer d'un texte d'Orca : dossier personnel, dossier temporaire, dossier de données, et ceux donnés.
std::vector<std::string> private_paths(std::vector<std::string> extra = {})
{
    extra.push_back(wxGetHomeDir().ToUTF8().data());
    extra.push_back(wxStandardPaths::Get().GetTempDir().ToUTF8().data());
    extra.push_back(Slic3r::data_dir());
    return extra;
}

// La pièce désignée par Orca (pièce découpée, pièce du modèle ou exemplaire), comme Plater::priv::process_validation_warning.
const Slic3r::ModelObject* model_object_of(const Slic3r::ObjectBase* base)
{
    if (const auto* po = dynamic_cast<const Slic3r::PrintObjectBase*>(base))
        return po->model_object();
    if (const auto* mo = dynamic_cast<const Slic3r::ModelObject*>(base))
        return mo;
    if (const auto* mi = dynamic_cast<const Slic3r::ModelInstance*>(base))
        return mi->get_object();
    return nullptr;
}

// Référence et nom de la pièce comme PlateActions::context() : l'identifiant de l'objet, que la copie du découpage garde.
void name_object(Issue& issue, size_t id, const std::string& fallback_name)
{
    if (id == 0)
        return;
    issue.object_ref  = std::to_string(id);
    issue.object_name = Json::utf8_prefix(fallback_name, 120);
    if (Slic3r::GUI::Plater* plater = wxGetApp().plater())
        for (const Slic3r::ModelObject* o : plater->model().objects)
            if (o->id().id == id)
                issue.object_name = Json::utf8_prefix(o->name, 120);
}

// Ce que l'assistant peut faire du réglage : print ou filament (catalogue), printer (préréglage imprimante, jamais modifié).
std::string scope_of(const std::string& key)
{
    if (key.empty())
        return std::string();
    const Catalog::Policy& policy = Catalog::policy();
    if (policy.allows("print", key))
        return "print";
    if (policy.allows("filament", key))
        return "filament";
    if (wxGetApp().preset_bundle != nullptr && wxGetApp().preset_bundle->printers.get_edited_preset().config.has(key))
        return "printer";
    return std::string();
}

double min_nozzle(const Slic3r::Print& print)
{
    const auto& values = print.config().nozzle_diameter.values;
    return values.empty() ? 0 : *std::min_element(values.begin(), values.end());
}

// Un refus ou un avertissement de Print::validate, avec ses faits lus sur la plaque (jamais sur le texte).
Issue from_validation(const Slic3r::StringObjectException& e, bool warning, const Slic3r::Print& print)
{
    Issue issue;
    issue.source  = warning ? "validate_warning" : "validate_error";
    issue.level   = warning ? "warning" : "error";
    issue.opt_key = e.opt_key;
    issue.scope   = scope_of(e.opt_key);
    issue.text    = OML::clean_text(e.string, private_paths());
    const Slic3r::ModelObject* mo = model_object_of(e.object);
    if (mo != nullptr)
        name_object(issue, mo->id().id, mo->name);

    OML::ValidateFacts facts;
    const double     nozzle = min_nozzle(print);
    const auto*      po     = dynamic_cast<const Slic3r::PrintObject*>(e.object);
    if (e.opt_key == "layer_height")
        facts.over_nozzle = po != nullptr && nozzle > 0 && po->config().layer_height.value > nozzle;
    else if (e.opt_key == "initial_layer_print_height")
        facts.over_nozzle = nozzle > 0 && print.config().initial_layer_print_height.value > nozzle;
    const auto objects  = print.objects();
    facts.several_objects = print.config().print_sequence != Slic3r::PrintSequence::ByObject &&
                            (objects.size() > 1 || (!objects.empty() && objects.front()->instances().size() > 1));
    if (mo != nullptr && !mo->instances.empty()) {
        const double height = PlateActions::bed_size().z();
        facts.too_tall      = height > 0 && mo->instance_bounding_box(0).size().z() >= height - 2.0;
    }
    issue.code = OML::validate_code(static_cast<int>(e.type), e.opt_key, mo != nullptr, facts);

    // Correction sûre, seulement pour un réglage d'impression que la pièce ne remplace pas par le sien.
    const bool overridden = mo != nullptr && mo->config.has(e.opt_key);
    if (!warning && issue.scope == "print" && !overridden) {
        if (issue.code == "layer_height_over_nozzle") {
            if (const double safe = OML::safe_layer_height(nozzle); safe > 0)
                issue.fix = {{"key", e.opt_key}, {"value", safe}};
        } else if (issue.code == "vase_several_objects")
            // Avec les réglages que le mode vase avait imposés (parois, couches du dessus, remplissage…) : désactivé seul, il
            // laisserait une pièce creuse et ouverte.
            issue.fix = {{"key", "spiral_mode"}, {"value", false}, {"also", SettingsBridge::spiral_leftovers()}};
    }
    return issue;
}

Slic3r::GUI::PartPlate* current_plate()
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    return plater != nullptr ? plater->get_partplate_list().get_curr_plate() : nullptr;
}

std::vector<Issue> step_issues(const Slic3r::Print& print)
{
    std::vector<Issue> out;
    for (const StepWarning& w : step_warnings(print)) {
        Issue issue;
        issue.source   = "step_warning";
        issue.level    = "warning";
        issue.code     = OML::step_warning_code(w.message_id);
        issue.critical = w.critical;
        issue.text     = OML::clean_text(w.text, private_paths());
        name_object(issue, w.object_id, std::string());
        out.push_back(issue);
    }
    return out;
}

// Trajet hors plateau ou plus haut que l'imprimante : même lecture que l'alerte d'Orca (GLCanvas3D::_set_warning_notification_if_needed).
struct ViewerCheck { bool outside = false, too_high = false; };
ViewerCheck viewer_check(Slic3r::GUI::Plater& plater)
{
    ViewerCheck out;
    Slic3r::GUI::GLCanvas3D* preview = plater.get_preview_canvas3D();
    if (preview == nullptr)
        return out;
    const Slic3r::GUI::GCodeViewer& viewer = preview->get_gcode_viewer();
    if (!viewer.has_data())
        return out;
    const std::vector<double> zs  = viewer.get_layers_zs();
    const double              max = viewer.get_max_print_height();
    const bool                top_known = !zs.empty() && max > 0 && !viewer.is_machine_frame_transform_active();
    out.too_high = top_known && zs.back() - max >= 1e-6;
    out.outside  = !viewer.is_contained_in_bed() && !out.too_high;
    return out;
}

std::vector<Issue> gcode_issues(Slic3r::GUI::Plater& plater, Slic3r::GUI::PartPlate& plate)
{
    std::vector<Issue> out;
    if (!plate.is_slice_result_valid())
        return out;
    const auto add = [&](const char* code, const std::string& text) {
        Issue issue;
        issue.source = "gcode_check";
        issue.level  = "error";
        issue.code   = code;
        issue.text   = OML::clean_text(text);
        out.push_back(issue);
    };
    const ViewerCheck view = viewer_check(plater);
    if (view.outside)
        add("toolpath_outside", _u8L("A G-code path goes beyond plate boundaries."));
    if (view.too_high)
        add("height_outside", _u8L("A G-code path goes beyond the max print height."));
    if (Slic3r::GCodeProcessorResult* result = plate.get_slice_result()) { // has_value() n'est pas const chez Orca
        if (result->gcode_check_result.error_code & 1)
            add("nozzle_area", std::string());
        if (result->gcode_check_result.error_code & (1 << 1))
            add("nozzle_height", std::string());
        if (result->filament_printable_reuslt.has_value()) {
            std::string list;
            for (int f : result->filament_printable_reuslt.conflict_filament)
                list += (list.empty() ? "" : " ") + std::to_string(f + 1);
            add("filament_bed_surface", (boost::format(_u8L("Filament %s cannot be printed directly on the surface of this plate.")) % list).str());
        }
    }
    if (out.empty() && !plate.is_slice_result_ready_for_print())
        add("not_printable", std::string());
    return out;
}

// ---------- Notifications d'Orca (ERR-11) : lues par leur type, jamais par leur texte ----------
using NoticeType = Slic3r::GUI::NotificationType;
#define PLYO_NOTICE(name) {NoticeType::name, #name}
// Nom de chaque type, pour la logique pure (PlyoOrcaMessagesLogic). Si Orca en ajoute, la compilation s'arrête ici : classer
// le nouveau type dans PlyoOrcaMessagesLogic.cpp (gardé, déjà couvert ou écarté), puis l'ajouter à cette liste.
const std::pair<NoticeType, const char*> NOTICE_NAMES[] = {
    PLYO_NOTICE(CustomNotification), PLYO_NOTICE(ExportFinished), PLYO_NOTICE(Mouse3dDisconnected), PLYO_NOTICE(NewAppAvailable),
    PLYO_NOTICE(NewAlphaAvailable), PLYO_NOTICE(NewBetaAvailable), PLYO_NOTICE(PresetUpdateAvailable), PLYO_NOTICE(PresetUpdateFinished),
    PLYO_NOTICE(ValidateError), PLYO_NOTICE(ValidateWarning), PLYO_NOTICE(SlicingError), PLYO_NOTICE(SlicingSeriousWarning),
    PLYO_NOTICE(SlicingWarning), PLYO_NOTICE(BBLGeneralError), PLYO_NOTICE(PlaterError), PLYO_NOTICE(LeftExtruderUnprintableError),
    PLYO_NOTICE(RightExtruderUnprintableError), PLYO_NOTICE(PlaterWarning), PLYO_NOTICE(ProgressBar), PLYO_NOTICE(PrintHostUpload),
    PLYO_NOTICE(SlicingProgress), PLYO_NOTICE(EmptyColorChangeCode), PLYO_NOTICE(CustomSupportsAndSeamRemovedAfterRepair),
    PLYO_NOTICE(EmptyAutoColorChange), PLYO_NOTICE(SignDetected), PLYO_NOTICE(QuitSLAManualMode), PLYO_NOTICE(DesktopIntegrationSuccess),
    PLYO_NOTICE(DesktopIntegrationFail), PLYO_NOTICE(UndoDesktopIntegrationSuccess), PLYO_NOTICE(UndoDesktopIntegrationFail),
    PLYO_NOTICE(MmSegmentationExceededExtrudersLimit), PLYO_NOTICE(DidYouKnowHint), PLYO_NOTICE(UpdatedItemsInfo),
    PLYO_NOTICE(ProgressIndicator), PLYO_NOTICE(SimplifySuggestion), PLYO_NOTICE(UnknownFont), PLYO_NOTICE(CgalFinished),
    PLYO_NOTICE(ExportOngoing), PLYO_NOTICE(URLDownload), PLYO_NOTICE(ArrangeOngoing), PLYO_NOTICE(BBLPlateInfo), PLYO_NOTICE(BBL3MFInfo),
    PLYO_NOTICE(BBLObjectInfo), PLYO_NOTICE(BBLSliceEmptyLayer), PLYO_NOTICE(BBLNeedSupportON), PLYO_NOTICE(BBLGcodeOverlap),
    PLYO_NOTICE(BBLSeqPrintInfo), PLYO_NOTICE(BBLPluginInstallHint), PLYO_NOTICE(BBLFlushingVolumeZero), PLYO_NOTICE(BBLMixedFilamentBroken),
    PLYO_NOTICE(BBLPluginUpdateAvailable), PLYO_NOTICE(BBLPreviewOnlyMode), PLYO_NOTICE(BBLPrinterConfigUpdateAvailable),
    PLYO_NOTICE(BBLUserPresetExceedLimit), PLYO_NOTICE(BBLFilamentPrintableError), PLYO_NOTICE(BBLSliceLimitError),
    PLYO_NOTICE(BBLSliceMultiExtruderHeightOutside), PLYO_NOTICE(BBLBedFilamentIncompatible), PLYO_NOTICE(BBLMixUsePLAAndPETG),
    PLYO_NOTICE(BBLNozzleFilamentIncompatible), PLYO_NOTICE(BBLSingleExtruderMixedFilamentRisk), PLYO_NOTICE(OrcaSharedProfilesAvailable),
    PLYO_NOTICE(OrcaCloudAPIError), PLYO_NOTICE(OrcaSyncConflict), PLYO_NOTICE(OrcaLocalPluginMissingError),
    PLYO_NOTICE(OrcaCloudPluginMissingError), PLYO_NOTICE(OrcaPluginInactiveError), PLYO_NOTICE(OrcaPluginCapabilityUnavailableError),
};
#undef PLYO_NOTICE
static_assert(std::size(NOTICE_NAMES) == static_cast<size_t>(NoticeType::NotificationTypeCount),
              "NotificationType a changé : compléter NOTICE_NAMES et classer le type dans PlyoOrcaMessagesLogic.cpp");

std::string notice_name(NoticeType type)
{
    for (const auto& [t, name] : NOTICE_NAMES)
        if (t == type)
            return name;
    return std::string();
}

std::string notice_level(Slic3r::GUI::NotificationManager::NotificationLevel level)
{
    using Level = Slic3r::GUI::NotificationManager::NotificationLevel;
    if (level == Level::ErrorNotificationLevel)
        return "error";
    if (level == Level::WarningNotificationLevel || level == Level::SeriousWarningNotificationLevel)
        return "warning";
    return "info";
}

// Les notifications affichées par Orca (pas encore finies), textes nettoyés comme tout message d'Orca (clean_for_panel).
std::vector<OML::Notice> read_notices(Slic3r::GUI::Plater& plater)
{
    std::vector<OML::Notice> out;
    Slic3r::GUI::NotificationManager* manager = plater.get_notification_manager();
    if (manager == nullptr)
        return out;
    const std::vector<std::string> prefixes{_u8L("Error:"), _u8L("Warning:"), _u8L("WARNING:")};
    for (const Slic3r::GUI::NotificationManager::PlyoNotice& n : manager->plyo_notices()) {
        OML::Notice notice;
        notice.type  = notice_name(n.type);
        notice.level = notice_level(n.level);
        notice.text  = clean_for_panel(OML::strip_notice_prefix(n.text, prefixes));
        notice.gray  = n.gray;
        out.push_back(notice);
    }
    return out;
}

// Faits qui départagent un type partagé, lus comme Orca les calcule (GLCanvas3D::reload_scene, Plater::show_object_info).
OML::NoticeFacts notice_facts(Slic3r::GUI::Plater& plater, Slic3r::GUI::PartPlate& plate)
{
    OML::NoticeFacts facts;
    // Tour de purge hors plateau : même contrôle que l'alerte « The prime tower extends beyond the plate boundary ».
    Slic3r::GUI::GLCanvas3D* canvas = plater.get_view3D_canvas3D();
    if (canvas != nullptr && plate.fff_print() != nullptr && plate.fff_print()->is_step_done(Slic3r::psWipeTower))
        facts.prime_tower_outside = !canvas->get_volumes().check_wipe_tower_outside_state(plater.build_volume(), plater.get_partplate_list().get_curr_plate_index());
    // Maillage abîmé (arêtes ouvertes) : ce qui fait proposer « Réparer » dans la fiche de la pièce.
    for (const Slic3r::ModelObject* o : plate.get_objects_on_this_plate())
        if (!o->get_object_stl_stats().manifold()) {
            facts.mesh_object_ref  = std::to_string(o->id().id);
            facts.mesh_object_name = Json::utf8_prefix(o->name, 120);
            break;
        }
    return facts;
}

// Étape restée « commencée » au moment de l'erreur (Orca ne la marque finie qu'en la réussissant) ; pour « posSlice », la
// pièce sans aucune couche.
OML::SliceFacts slice_facts(const Slic3r::Print& print, std::vector<size_t>& object_ids)
{
    OML::SliceFacts facts;
    facts.wipe_tower = print.has_wipe_tower();
    for (const Slic3r::PrintObject* po : print.objects())
        for (int s = 0; s < Slic3r::posCount && facts.step.empty(); ++s)
            if (po->step_state_with_timestamp(static_cast<Slic3r::PrintObjectStep>(s)).state == Slic3r::PrintStateBase::STARTED) {
                facts.step = OBJECT_STEPS[s];
                if (s == Slic3r::posSlice && po->layer_count() == 0 && object_ids.empty())
                    object_ids.push_back(po->model_object()->id().id);
            }
    for (int s = 0; s < Slic3r::psCount && facts.step.empty(); ++s)
        if (print.step_state_with_timestamp(static_cast<Slic3r::PrintStep>(s)).state == Slic3r::PrintStateBase::STARTED)
            facts.step = PRINT_STEPS[s];
    facts.has_object = !object_ids.empty();
    return facts;
}

// Type C++ de l'exception, le plus précis d'abord (les classes d'Orca dérivent les unes des autres, Exception.hpp).
std::string exception_type(const Slic3r::SlicingProcessCompletedEvent& evt)
{
    try {
        evt.rethrow_exception();
    } catch (const std::bad_alloc&) {
        return "bad_alloc";
    } catch (const Slic3r::HardCrash&) {
        return "HardCrash";
    } catch (const Slic3r::PlaceholderParserError&) {
        return "PlaceholderParserError";
    } catch (const Slic3r::SlicingErrors&) {
        return "SlicingErrors";
    } catch (const Slic3r::SlicingError&) {
        return "SlicingError";
    } catch (const Slic3r::ExportError&) {
        return "ExportError";
    } catch (const Slic3r::FileIOError&) {
        return "FileIOError";
    } catch (const Slic3r::HostNetworkError&) {
        return "HostNetworkError";
    } catch (const Slic3r::IOError&) {
        return "IOError";
    } catch (const Slic3r::RuntimeError&) {
        return "RuntimeError";
    } catch (const Slic3r::LogicError&) {
        return "LogicError";
    } catch (const Slic3r::Exception&) {
        return "Exception";
    } catch (const std::exception&) {
        return "std_exception";
    } catch (...) {
    }
    return "unknown";
}

// Minuterie à un coup sur le fil de l'interface, jamais détruite (minuterie wx après la fermeture d'Orca).
class OneShot : public wxTimer
{
public:
    void start(int ms, std::function<void()> fn)
    {
        m_fn = std::move(fn);
        StartOnce(ms);
    }
    void Notify() override
    {
        std::function<void()> fn = std::move(m_fn);
        m_fn                     = nullptr;
        if (fn)
            fn();
    }

private:
    std::function<void()> m_fn;
};
OneShot* s_finish_timer = nullptr;

constexpr int FINISH_RETRY_MS  = 250;
constexpr int FINISH_MAX_TRIES = 12; // 3 s au plus

// Fin d'une découpe finie ou annulée, lue une fois qu'Orca a terminé son traitement. Une autre découpe qui suit vraiment
// (« Tout découper », découpe relancée) parlera à sa fin ; la minuterie d'Orca en attente (souvent juste après une découpe)
// n'en est pas une : on relit un peu plus tard, puis on envoie.
void read_finish(bool cancelled, int tries)
{
    guarded("la lecture de la fin de découpe", [cancelled, tries] {
        Slic3r::GUI::Plater* p = wxGetApp().plater();
        if (p == nullptr)
            return;
        const bool slicing = p->is_background_process_slicing() || p->background_process().running();
        switch (OML::finish_read(slicing, p->is_background_process_update_scheduled(), tries, FINISH_MAX_TRIES)) {
        case OML::FinishRead::Skip: return;
        case OML::FinishRead::Retry:
            if (s_finish_timer == nullptr)
                s_finish_timer = new OneShot();
            s_finish_timer->start(FINISH_RETRY_MS, [cancelled, tries] { read_finish(cancelled, tries + 1); });
            return;
        case OML::FinishRead::Send: break;
        }
        if (cancelled) {
            notify({{"type", "slice_result"}, {"status", "cancelled"}, {"issues", nlohmann::json::array()}});
            return;
        }
        nlohmann::json r = report();
        r["type"]        = "slice_result";
        r["status"]      = "finished";
        notify(r);
    });
}

} // namespace

void set_listener(std::function<void(const nlohmann::json&)> listener) { s_listener = std::move(listener); }

std::vector<StepWarning> step_warnings(const Slic3r::Print& print)
{
    std::vector<StepWarning> out;
    const auto keep = [&](const Slic3r::PrintStateBase::StateWithWarnings& state, const char* step, size_t object_id) {
        for (const Slic3r::PrintStateBase::Warning& w : state.warnings)
            if (w.current)
                out.push_back({w.message_id, w.level == Slic3r::PrintStateBase::WarningLevel::CRITICAL, w.message, object_id, step});
    };
    for (int s = 0; s < Slic3r::psCount; ++s)
        keep(print.step_state_with_warnings(static_cast<Slic3r::PrintStep>(s)), PRINT_STEPS[s], 0);
    for (const Slic3r::PrintObject* po : print.objects())
        for (int s = 0; s < Slic3r::posCount; ++s)
            keep(po->step_state_with_warnings(static_cast<Slic3r::PrintObjectStep>(s)), OBJECT_STEPS[s], po->model_object()->id().id);
    return out;
}

Validation validate_plate()
{
    Validation out;
    Slic3r::GUI::Plater*    plater = wxGetApp().plater();
    Slic3r::GUI::PartPlate* plate  = current_plate();
    if (plater == nullptr || plate == nullptr)
        return out;
    // Pendant une découpe, le fil de fond modifie le Print : on ne le lit pas.
    if (plater->is_background_process_slicing() || plater->background_process().running()) {
        out.busy = true;
        return out;
    }
    out.pending = plater->is_background_process_update_scheduled();
    std::vector<Issue> issues;
    if (plate->get_objects_on_this_plate().empty()) {
        issues.push_back(plyo_issue("plate_empty"));
        OML::merge_notices(issues, read_notices(*plater), notice_facts(*plater, *plate)); // G-code ouvert en aperçu, 3MF…
        out.issues = OML::to_json(issues);
        return out;
    }
    const Slic3r::Print&                        print = plater->get_partplate_list().get_current_fff_print();
    std::vector<Slic3r::StringObjectException> warnings;
    Slic3r::StringObjectException               err = print.validate(&warnings); // publique et const : aucun effet sur Orca
    plater->post_process_string_object_exception(err);                          // complète le texte (plateau et filament), comme Orca
    if (!err.string.empty())
        issues.push_back(from_validation(err, false, print));
    for (const Slic3r::StringObjectException& w : warnings)
        if (!w.string.empty())
            issues.push_back(from_validation(w, true, print));
    // Orca refuse la plaque sans erreur de validation (son dernier contrôle est plus récent, ou une pièce sort de la vraie
    // forme du plateau : PartPlate::can_slice) : dit sans deviner plus.
    if (err.string.empty() && !out.pending) {
        if (plate->is_apply_result_invalid())
            issues.push_back(plyo_issue("plate_refused"));
        else if (!plate->can_slice())
            issues.push_back(plyo_issue("object_outside"));
    }
    // Bulles d'Orca sur la plaque et la pièce (ERR-11), sans doublon avec ce qui précède ; une raison précise du refus
    // (filament, buse, extension) remplace la supposition « object_outside ».
    OML::merge_notices(issues, read_notices(*plater), notice_facts(*plater, *plate));
    out.issues = OML::to_json(issues);
    return out;
}

std::vector<std::string> notice_codes()
{
    Slic3r::GUI::Plater*    plater = wxGetApp().plater();
    Slic3r::GUI::PartPlate* plate  = current_plate();
    if (plater == nullptr || plate == nullptr)
        return {};
    return OML::notice_codes(read_notices(*plater), notice_facts(*plater, *plate));
}

bool ready_for_print()
{
    Slic3r::GUI::Plater*    plater = wxGetApp().plater();
    Slic3r::GUI::PartPlate* plate  = current_plate();
    if (plater == nullptr || plate == nullptr || !plate->is_slice_result_valid() || !plate->is_slice_result_ready_for_print())
        return false;
    const ViewerCheck view = viewer_check(*plater);
    return !view.outside && !view.too_high;
}

nlohmann::json report()
{
    Slic3r::GUI::Plater*    plater = wxGetApp().plater();
    Slic3r::GUI::PartPlate* plate  = current_plate();
    nlohmann::json          out{{"issues", nlohmann::json::array()}, {"busy", false}, {"pending", false}, {"sliced", false}, {"ready_for_print", false}};
    if (plater == nullptr || plate == nullptr)
        return out;
    const Validation v = validate_plate();
    out["busy"]        = v.busy;
    out["pending"]     = v.pending;
    if (v.busy)
        return out;
    // Validation d'abord (forme JSON), puis ce que la découpe a trouvé ; la liste est rebornée à la fin.
    std::vector<Issue> all;
    for (const nlohmann::json& j : v.issues) {
        Issue i;
        i.source      = Json::str(j, "source");
        i.code        = Json::str(j, "code");
        i.level       = Json::str(j, "level");
        i.text        = Json::str(j, "text");
        i.opt_key     = Json::str(j, "opt_key");
        i.scope       = Json::str(j, "scope");
        i.object_ref  = Json::str(j, "object_ref");
        i.object_name = Json::str(j, "object_name");
        i.critical    = Json::boolean(j, "critical", false);
        i.fix         = Json::any(j, "fix");
        all.push_back(i);
    }
    if (plate->is_slice_result_valid()) {
        out["sliced"]          = true;
        out["ready_for_print"] = ready_for_print();
        for (Issue& i : step_issues(plater->get_partplate_list().get_current_fff_print()))
            all.push_back(i);
        for (Issue& i : gcode_issues(*plater, *plate))
            all.push_back(i);
    }
    out["issues"] = OML::to_json(all);
    return out;
}

nlohmann::json export_failure(const std::string& error, const std::string& path)
{
    std::vector<std::string> paths;
    if (!path.empty()) {
        paths.push_back(path);
        paths.push_back(boost::filesystem::path(path).parent_path().string());
    }
    return {{"kind", OML::export_kind(s_last_error_type)}, {"text", OML::clean_text(error, private_paths(paths))}};
}

std::string clean_for_panel(const std::string& text)
{
    std::vector<std::string> hosts, secrets;
    if (const Slic3r::PresetBundle* bundle = wxGetApp().preset_bundle) {
        const Slic3r::DynamicPrintConfig& printer = bundle->printers.get_edited_preset().config;
        const auto value = [&printer](const char* key) { return printer.has(key) ? printer.opt_string(key) : std::string(); };
        for (const char* key : {"print_host", "print_host_webui"}) {
            std::string host = value(key);
            if (host.empty())
                continue;
            hosts.push_back(host);
            // Le nom ou l'adresse seuls, sans schéma, port ni chemin (« octopi » dans « http://octopi:5000/ »).
            if (const size_t scheme = host.find("://"); scheme != std::string::npos)
                host = host.substr(scheme + 3);
            host = host.substr(0, host.find_first_of("/:"));
            hosts.push_back(host);
        }
        for (const char* key : {"printhost_apikey", "flashforge_serial_number", "printhost_user", "printhost_password"})
            secrets.push_back(value(key));
    }
    return OML::clean_text(SendLogic::scrub_network(text, hosts, secrets), private_paths());
}

void on_slicing_done(const Slic3r::SlicingProcessCompletedEvent& evt)
{
    guarded("la fin de la découpe", [&] {
        s_last_error_type.clear();
        Slic3r::GUI::Plater* plater = wxGetApp().plater();
        if (plater == nullptr)
            return;
        // Fin d'un export (lancé par le panneau ou par Orca) : le crochet d'export qui suit s'en charge (export_failure).
        const bool exporting = plater->background_process().is_export_scheduled();
        if (evt.error()) {
            s_last_error_type = exception_type(evt);
            // Orca montre aussi cette erreur dans sa fenêtre (show_error, juste après) : le panneau l'explique déjà (lot 10).
            if (evt.critical_error())
                OrcaWindows::cover(exporting ? "export" : "slice_result", 5000);
            if (exporting)
                return;
            // Lu tout de suite : l'événement et l'état du Print ne valent que maintenant.
            Issue issue;
            issue.source = "slicing_error";
            issue.level  = "error";
            const auto           message = evt.format_error_message();
            const Slic3r::Print* print   = plater->background_process().fff_print();
            std::vector<size_t>  ids;
            // Pièces nommées par l'erreur (SlicingError seulement : pour les autres, le second champ n'est pas une pièce).
            if (print != nullptr && (s_last_error_type == "SlicingError" || s_last_error_type == "SlicingErrors"))
                for (size_t oid : message.second)
                    if (const Slic3r::PrintObject* po = print->get_object(Slic3r::ObjectID(oid)))
                        ids.push_back(po->model_object()->id().id);
            const OML::SliceFacts facts = print != nullptr ? slice_facts(*print, ids) : OML::SliceFacts{};
            issue.code = OML::slicing_code(s_last_error_type, facts);
            issue.text = OML::clean_text(message.first, private_paths());
            if (!ids.empty())
                name_object(issue, ids.front(), std::string());
            notify({{"type", "slice_result"}, {"status", "error"}, {"critical", evt.critical_error()}, {"issues", OML::to_json({issue})}});
            return;
        }
        if (exporting)
            return;
        // Fini ou annulé : Orca termine son traitement (validité de la plaque, aperçu) avant que l'on lise.
        const bool cancelled = evt.cancelled();
        if (s_finish_timer != nullptr)
            s_finish_timer->Stop(); // une lecture encore en attente vise une fin plus ancienne
        wxGetApp().CallAfter([cancelled] { read_finish(cancelled, 0); });
    });
}

}} // namespace Plyo::OrcaMessages
