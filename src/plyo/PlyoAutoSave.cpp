#include "PlyoAutoSave.hpp"
#include "PlyoCalibration.hpp"
#include "PlyoGuard.hpp"
#include "PlyoProfiles.hpp"
#include "PlyoProjectFiles.hpp"
#include "PlyoSpools.hpp"
#include "PlyoSpoolsLogic.hpp"

#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/calib.hpp"
#include "slic3r/GUI/BackgroundSlicingProcess.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/PrintHostDialogs.hpp"

#include <boost/log/trivial.hpp>

#include <wx/dialog.h>
#include <wx/timer.h>
#include <wx/toplevel.h>

#include <algorithm>
#include <chrono>
#include <string>
#include <utility>
#include <vector>

namespace Plyo { namespace AutoSave {

namespace {

using Clock = std::chrono::steady_clock;

constexpr int TICK_MS = 500;

// Pointeur nu : jamais détruit par la fin du programme (après wxWidgets) ; stop() le détruit avec le panneau.
wxTimer*                 s_timer = nullptr;
Clock::time_point        s_last_change = Clock::now();
unsigned long long       s_changes     = 0;  // nombre de changements notés (pour ne pas réessayer sans nouveauté)
std::string              s_dirty_name;       // préréglage vu modifié au tic précédent ("" : rien de modifié)
Clock::time_point        s_dirty_since;      // depuis quand il est vu modifié
bool                     s_has_skip = false; // un essai a échoué (ou a été écarté) pour ce préréglage…
std::string              s_skip_name;
unsigned long long       s_skip_at = 0;      // …à ce numéro de changement : on attend un nouveau changement
bool                     s_saving  = false;

long long ms_since(Clock::time_point t) { return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t).count(); }

// Une fenêtre modale d'Orca est ouverte (« Transférer ou ignorer ? », enregistrement…) : on n'y touche pas.
bool modal_open_impl()
{
    for (wxWindowList::compatibility_iterator node = wxTopLevelWindows.GetFirst(); node; node = node->GetNext()) {
        const wxDialog* dialog = wxDynamicCast(node->GetData(), wxDialog);
        if (dialog != nullptr && dialog->IsModal())
            return true;
    }
    return false;
}

// Export du G-code en cours (fichier ou envoi, qui l'exporte d'abord), ou un envoi encore dans la file d'Orca : le même
// relevé qu'Orca fait avant de fermer (GUI_App, get_active_jobs).
bool sending_impl(Slic3r::GUI::Plater* plater)
{
    if (plater->is_export_gcode_scheduled())
        return true;
    Slic3r::GUI::MainFrame* frame = Slic3r::GUI::wxGetApp().mainframe;
    if (frame == nullptr || frame->printhost_queue_dlg() == nullptr)
        return false;
    std::vector<std::pair<std::string, std::string>> jobs;
    frame->printhost_queue_dlg()->get_active_jobs(jobs);
    return !jobs.empty();
}

// Une calibration change le filament pour son test sans l'enregistrer : ces valeurs ne doivent pas entrer dans la bobine.
// Plyo : son test en cours (Calibration::active). Orca (menu Calibration, aussi appelé par les tests de Plyo) : le mode
// de calibration du Print (calib_pa, calib_retraction…, remis à Calib_None au prochain chargement de fichier), le motif
// de pressure advance, ou une pièce du plateau chargée depuis resources/calib (calib_flowrate et calib_temp ne
// donnent pas de mode : seules leurs pièces les trahissent).
bool calibrating_impl(Slic3r::GUI::Plater* plater)
{
    if (Calibration::active())
        return true;
    const Slic3r::Print* print = plater->background_process().fff_print();
    if (print != nullptr && print->calib_mode() != Slic3r::CalibMode::Calib_None)
        return true;
    const Slic3r::Model& model = plater->model();
    if (model.calib_pa_pattern)
        return true;
    const std::string calib_dir = (boost::filesystem::path(Slic3r::resources_dir()) / "calib").lexically_normal().generic_string() + "/";
    for (const Slic3r::ModelObject* object : model.objects) {
        if (object->input_file.empty())
            continue;
        const std::string file = boost::filesystem::path(object->input_file).lexically_normal().generic_string();
        if (file.compare(0, calib_dir.size(), calib_dir) == 0)
            return true;
    }
    return false;
}

// Mêmes couples que Tab::validate_filament_temperature_pairs (un test de source vérifie qu'ils n'ont pas changé).
std::vector<SpoolsLogic::TempPair> temperature_pairs(const Slic3r::DynamicPrintConfig& config)
{
    std::vector<std::pair<std::string, std::string>> keys = {{"nozzle_temperature_initial_layer", "nozzle_temperature"}};
    std::vector<int>                                 caps = {30};
    for (int bt = static_cast<int>(Slic3r::btPC); bt < static_cast<int>(Slic3r::btCount); ++bt) {
        const Slic3r::BedType bed = static_cast<Slic3r::BedType>(bt);
        keys.emplace_back(Slic3r::get_bed_temp_1st_layer_key(bed), Slic3r::get_bed_temp_key(bed));
        caps.push_back(15);
    }
    std::vector<SpoolsLogic::TempPair> pairs;
    for (size_t i = 0; i < keys.size(); ++i) {
        if (keys[i].first.empty() || keys[i].second.empty())
            continue;
        const auto* first = config.option<Slic3r::ConfigOptionInts>(keys[i].first);
        const auto* other = config.option<Slic3r::ConfigOptionInts>(keys[i].second);
        if (first == nullptr || other == nullptr || first->values.empty() || other->values.empty())
            continue;
        pairs.push_back({first->get_at(0), other->get_at(0), caps[i]});
    }
    return pairs;
}

void skip(const std::string& name)
{
    s_has_skip  = true;
    s_skip_name = name;
    s_skip_at   = s_changes;
}

void tick()
{
    // Un projet de conversation est en train d'être rouvert : son filament (celui du 3MF) va être remplacé par la bobine.
    if (s_saving || ProjectFiles::opening())
        return;
    Slic3r::GUI::GUI_App& app    = Slic3r::GUI::wxGetApp();
    Slic3r::GUI::Plater*  plater = app.plater();
    if (app.preset_bundle == nullptr || plater == nullptr)
        return;
    Slic3r::PresetCollection& filaments = app.preset_bundle->filaments;
    if (!filaments.current_is_dirty()) {
        s_dirty_name.clear();
        return;
    }
    const std::string name = filaments.get_selected_preset_name();
    if (name != s_dirty_name) {
        s_dirty_name  = name;
        s_dirty_since = Clock::now();
    }
    if (s_has_skip && s_skip_name == name && s_skip_at == s_changes)
        return; // déjà essayé sans succès, ou écarté : rien n'a changé depuis

    SpoolsLogic::AutoSaveState state;
    state.filament_dirty = true;
    state.slicing        = plater->is_background_process_slicing();
    state.sending        = sending_impl(plater);
    // Le calme compte depuis le dernier changement, et au moins depuis que le préréglage est vu modifié.
    state.quiet_ms = std::min(ms_since(s_last_change), ms_since(s_dirty_since));
    // Calibration (parcours du plateau) puis registre (en mémoire après sa première lecture) : consultés seulement une
    // fois le calme atteint, hors découpe et envoi.
    const bool ready  = state.quiet_ms >= SpoolsLogic::AUTOSAVE_QUIET_MS && !state.slicing && !state.sending;
    state.calibrating = ready && calibrating_impl(plater);
    // Le registre (en mémoire après sa première lecture) n'est consulté qu'une fois tout le reste prêt.
    state.is_spool = ready && !state.calibrating &&
                     filaments.get_selected_preset().can_overwrite() && Spools::is_spool_preset(name);
    if (!SpoolsLogic::should_save_spool(state) || modal_open_impl())
        return;

    // Orca ouvrirait sa fenêtre « Temperature Safety Check » : on laisse le préréglage modifié (Orca demandera à la
    // fermeture, comme pour tout préréglage), sans fenêtre de notre part.
    if (!SpoolsLogic::temperature_pairs_ok(temperature_pairs(filaments.get_edited_preset().config))) {
        BOOST_LOG_TRIVIAL(warning) << "Plyo: préréglage de bobine « " << name
                                   << " » non enregistré automatiquement : écart de températures refusé par Orca";
        skip(name);
        return;
    }

    s_saving                          = true;
    const Profiles::SaveOutcome saved = Profiles::save_current_as(false, name);
    s_saving                          = false;
    if (saved != Profiles::SaveOutcome::Ok) {
        skip(name); // déjà noté dans le journal ; nouvel essai au prochain changement
        return;
    }
    s_has_skip = false;
    s_dirty_name.clear();
    BOOST_LOG_TRIVIAL(info) << "Plyo: préréglage de bobine enregistré automatiquement « " << name << " »";
}

} // namespace

bool modal_open() { return modal_open_impl(); }

bool sending()
{
    Slic3r::GUI::Plater* plater = Slic3r::GUI::wxGetApp().plater();
    return plater != nullptr && sending_impl(plater);
}

bool calibrating()
{
    Slic3r::GUI::Plater* plater = Slic3r::GUI::wxGetApp().plater();
    return plater != nullptr && calibrating_impl(plater);
}

bool save_spool_now()
{
    Slic3r::GUI::GUI_App& app = Slic3r::GUI::wxGetApp();
    if (app.preset_bundle == nullptr)
        return false;
    Slic3r::PresetCollection& filaments = app.preset_bundle->filaments;
    if (!filaments.current_is_dirty())
        return true;
    const std::string name = filaments.get_selected_preset_name();
    if (!filaments.get_selected_preset().can_overwrite() || !Spools::is_spool_preset(name) || calibrating())
        return false;
    if (!SpoolsLogic::temperature_pairs_ok(temperature_pairs(filaments.get_edited_preset().config)))
        return false;
    s_saving                          = true;
    const Profiles::SaveOutcome saved = Profiles::save_current_as(false, name);
    s_saving                          = false;
    if (saved != Profiles::SaveOutcome::Ok)
        return false;
    s_has_skip = false;
    s_dirty_name.clear();
    BOOST_LOG_TRIVIAL(info) << "Plyo: préréglage de bobine enregistré (avant de quitter le projet) « " << name << " »";
    return true;
}

void start()
{
    if (s_timer)
        return;
    s_timer = new wxTimer();
    s_timer->Bind(wxEVT_TIMER, [](wxTimerEvent&) { guarded("l'enregistrement automatique de la bobine", [] { tick(); }); });
    s_timer->Start(TICK_MS);
}

void stop()
{
    if (!s_timer)
        return;
    s_timer->Stop();
    delete s_timer;
    s_timer = nullptr;
}

void note_change()
{
    s_last_change = Clock::now();
    ++s_changes;
}

}} // namespace Plyo::AutoSave
