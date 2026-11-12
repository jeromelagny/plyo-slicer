#include "PlyoProjectFiles.hpp"
#include "PlyoAssistant.hpp"
#include "PlyoAutoSave.hpp"
#include "PlyoConversations.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoProjectFilesLogic.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoSpools.hpp"
#include "PlyoStore.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/miniz_extension.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/Utils/UndoRedo.hpp"

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>

#include <wx/timer.h>

#include <chrono>
#include <cstdint>
#include <string>
#include <utility>

namespace Plyo { namespace ProjectFiles {

namespace fs = boost::filesystem;
using Clock  = std::chrono::steady_clock;
using Slic3r::GUI::wxGetApp;
using ProjectFilesLogic::Fingerprint;

namespace {

constexpr int TICK_MS = 1000;

// Pointeur nu, comme pour l'enregistrement de la bobine : stop() le détruit avec le panneau.
wxTimer*                                    s_timer = nullptr;
std::string                                 s_conv;              // conversation attachée ("" : aucune)
std::uint64_t                               s_project  = 0;      // numéro de projet de Plyo (nouveau projet ou chargement)
std::uint64_t                               s_settings = 0;      // compteur des changements de réglages
bool                                        s_has_saved = false; // s_saved vaut pour la conversation attachée
Fingerprint                                 s_saved;             // empreinte de la dernière écriture (ou du chargement)
Fingerprint                                 s_seen;              // empreinte vue au tic précédent
Clock::time_point                           s_last_change = Clock::now();
bool                                        s_has_failed = false; // écriture ratée pour cette empreinte : pas de nouvel essai sans changement
Fingerprint                                 s_failed;
bool                                        s_writing = false;
bool                                        s_opening = false;
// Le plateau en place vient d'une conversation et a été écrit dans son 3MF en la quittant : tant que l'utilisateur n'a
// pas changé de projet (même numéro de projet), le remplacer ne perd rien, et Orca n'a rien à demander.
bool                                        s_kept_plate = false;
std::uint64_t                               s_kept_plate_project = 0;
std::function<void(const nlohmann::json&)> s_listener;

Slic3r::GUI::Plater* plater() { return wxGetApp().plater(); }

Fingerprint current()
{
    Slic3r::GUI::Plater* p = plater();
    return {s_project, p != nullptr ? static_cast<std::uint64_t>(p->undo_redo_stack_main().active_snapshot_time()) : 0, s_settings};
}

long long quiet_ms() { return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - s_last_change).count(); }

bool changed() { return !s_conv.empty() && (!s_has_saved || current() != s_saved); }

void notify(const nlohmann::json& message)
{
    if (s_listener)
        s_listener(message);
}

// `kept` : le plateau quitté est bien dans le 3MF de sa conversation (écrit, ou inchangé depuis l'écriture).
void clear_attachment(bool kept)
{
    if (!s_conv.empty()) {
        s_kept_plate         = kept;
        s_kept_plate_project = s_project;
    }
    s_conv.clear();
    s_has_saved  = false;
    s_has_failed = false;
}

// Un 3MF lisible : une archive zip qui contient le modèle. Un fichier abîmé ferait ouvrir à Orca une fenêtre d'erreur.
bool readable_3mf(const fs::path& path)
{
    mz_zip_archive zip;
    mz_zip_zero_struct(&zip);
    if (!Slic3r::open_zip_reader(&zip, path.string()))
        return false;
    const bool ok = mz_zip_reader_locate_file(&zip, "3D/3dmodel.model", nullptr, 0) >= 0;
    Slic3r::close_zip_reader(&zip);
    return ok;
}

// Écrit le 3MF de la conversation attachée (export d'Orca, sur le fil de l'interface), d'abord sous un nom provisoire :
// un fichier coupé en route ne remplace jamais le précédent. Trop lourd : on ne garde que la fiche, et le panneau le dit.
// Vrai si le fichier est écrit.
bool write_now()
{
    Slic3r::GUI::Plater* p = plater();
    if (s_conv.empty() || p == nullptr || s_writing)
        return false;
    const std::string conv  = s_conv;
    const Fingerprint print = current();
    const fs::path    final_path = path_of(conv);
    const fs::path    tmp_path   = final_path.parent_path() / (conv + ".ecriture.3mf");
    boost::system::error_code ec;
    fs::create_directories(final_path.parent_path(), ec);

    s_writing     = true;
    const bool ok = p->export_3mf_copy(tmp_path);
    s_writing     = false;
    if (!ok || !fs::exists(tmp_path, ec)) {
        fs::remove(tmp_path, ec);
        s_has_failed = true;
        s_failed     = print;
        BOOST_LOG_TRIVIAL(error) << "Plyo: projet de la conversation non écrit (export 3MF refusé par Orca)";
        return false;
    }
    const unsigned long long size = fs::file_size(tmp_path, ec);
    if (ec || size > ProjectFilesLogic::MAX_PROJECT_BYTES) {
        fs::remove(tmp_path, ec);
        fs::remove(final_path, ec);
        BOOST_LOG_TRIVIAL(warning) << "Plyo: projet de la conversation trop lourd (" << size << " octets) : seule la fiche est gardée";
        clear_attachment(false);
        notify({{"type", "project_file"}, {"conv", conv}, {"kept", false}});
        return false;
    }
    fs::permissions(tmp_path, fs::owner_read | fs::owner_write, ec);
    fs::rename(tmp_path, final_path, ec);
    if (ec) {
        fs::remove(tmp_path, ec);
        s_has_failed = true;
        s_failed     = print;
        BOOST_LOG_TRIVIAL(error) << "Plyo: projet de la conversation non écrit (renommage refusé)";
        return false;
    }
    s_saved      = print;
    s_has_saved  = true;
    s_has_failed = false;
    BOOST_LOG_TRIVIAL(info) << "Plyo: projet de la conversation écrit (" << size << " octets)";
    return true;
}

// Écrit le plateau attaché s'il a changé, sauf pendant une calibration (son plateau de test n'est pas celui du projet)
// ou une fenêtre modale.
// Vrai si le 3MF est à jour (écrit maintenant, ou rien de changé).
bool write_if_changed()
{
    if (!changed())
        return true;
    return !AutoSave::calibrating() && !AutoSave::modal_open() && write_now();
}

// Oublie les modifications de ces préréglages, comme le bouton « Ignorer » d'Orca (GUI_App, reset_modifications).
void discard(bool print, bool filament)
{
    Slic3r::PresetBundle& bundle = *wxGetApp().preset_bundle;
    if (print)
        bundle.prints.discard_current_changes();
    if (filament)
        bundle.filaments.discard_current_changes();
    wxGetApp().load_current_presets(false);
    SettingsBridge::clear_undo(); // ses entrées viseraient les réglages oubliés
}

void tick()
{
    if (s_conv.empty() || s_writing || s_opening || plater() == nullptr)
        return;
    const Fingerprint now = current();
    if (now != s_seen) {
        s_seen        = now;
        s_last_change = Clock::now();
    }
    ProjectFilesLogic::SaveState state;
    state.attached           = true;
    state.changed_since_save = changed() && !(s_has_failed && s_failed == now);
    state.slicing            = plater()->is_background_process_slicing();
    state.sending            = AutoSave::sending();
    state.quiet_ms           = quiet_ms();
    if (!ProjectFilesLogic::should_save(state))
        return;
    // Parcours du plateau (calibration) et fenêtres : consultés seulement une fois tout le reste prêt.
    if (AutoSave::calibrating() || AutoSave::modal_open())
        return;
    write_now();
}

void ensure_timer()
{
    if (s_timer)
        return;
    s_timer = new wxTimer();
    s_timer->Bind(wxEVT_TIMER, [](wxTimerEvent&) { guarded("l'enregistrement du projet de la conversation", [] { tick(); }); });
    s_timer->Start(TICK_MS);
}

// Bobine de la fiche de la conversation : son préréglage pour la machine du projet, s'il existe et est bien une bobine.
std::string spool_preset_of(const std::string& conv)
{
    const nlohmann::json  c       = Conversations::load(conv);
    const nlohmann::json* project = Json::field(c, "project");
    const nlohmann::json* f       = project != nullptr ? Json::field(*project, "filament") : nullptr;
    if (f == nullptr || !f->is_object() || Json::field(*f, "spool") == nullptr)
        return std::string(); // ancien projet, sans bobine : le filament du 3MF reste tel quel
    const std::string preset = Json::str(*f, "preset");
    if (preset.empty() || wxGetApp().preset_bundle->filaments.find_preset(preset, false) == nullptr || !Spools::is_spool_preset(preset))
        return std::string();
    return preset;
}

} // namespace

fs::path path_of(const std::string& conv) { return Store::dir("projets") / (conv + ".3mf"); }

std::string attached() { return s_conv; }

bool opening() { return s_opening; }

void attach(const std::string& conv)
{
    if (!Conversations::valid_id(conv) || conv == s_conv)
        return;
    if (!s_conv.empty())
        clear_attachment(write_if_changed());
    clear_attachment(false);
    s_conv        = conv;
    s_last_change = Clock::now();
    ensure_timer();
}

void detach(bool forget_print_edits)
{
    if (s_conv.empty())
        return;
    clear_attachment(write_if_changed());
    // Les réglages d'impression de la pièce sont dans son 3MF : ils ne suivent pas la conversation suivante.
    if (forget_print_edits && wxGetApp().preset_bundle != nullptr && wxGetApp().preset_bundle->prints.current_is_dirty())
        discard(true, false);
}

void forget(const std::string& conv)
{
    if (!Conversations::valid_id(conv))
        return;
    if (conv == s_conv)
        clear_attachment(false);
    boost::system::error_code ec;
    fs::remove(path_of(conv), ec);
}

nlohmann::json open(const std::string& conv)
{
    if (!Conversations::valid_id(conv) || plater() == nullptr)
        return {{"ok", false}, {"reason", "absent"}};
    if (AutoSave::calibrating())
        return {{"ok", false}, {"reason", "occupe"}}; // le plateau de test doit rester jusqu'à « Remettre ma pièce »

    const fs::path            path = path_of(conv);
    boost::system::error_code ec;
    const bool                exists = fs::is_regular_file(path, ec);
    const unsigned long long  size   = exists ? fs::file_size(path, ec) : 0;
    const bool                small  = exists && size <= ProjectFilesLogic::MAX_PROJECT_BYTES;
    const std::string         reason = ProjectFilesLogic::open_reason(exists, size, small && readable_3mf(path));
    // Le filament en attente va dans sa bobine, et le projet en cours dans son 3MF, avant tout changement.
    AutoSave::save_spool_now();
    const bool was_attached = !s_conv.empty();
    if (!reason.empty()) {
        detach(true);
        BOOST_LOG_TRIVIAL(info) << "Plyo: projet de la conversation non rouvert (" << reason << ")";
        return {{"ok", false}, {"reason", reason}};
    }
    const bool plyo_plate = was_attached ? write_if_changed() : s_kept_plate && s_kept_plate_project == s_project;
    clear_attachment(plyo_plate);

    s_opening = true;
    struct Done { ~Done() { s_opening = false; } } done; // même si Orca lève une exception
    const ProjectNotificationsPause quiet;              // pour le panneau, la conversation continue
    Slic3r::PresetBundle& bundle = *wxGetApp().preset_bundle;
    if (plyo_plate) {
        // Plateau d'une conversation, déjà écrit dans son 3MF : rien à demander.
        bundle.printers.discard_current_changes();
        bundle.prints.discard_current_changes();
        bundle.filaments.discard_current_changes();
        plater()->new_project(true, true);
    } else {
        // Plateau qui n'est pas celui d'une conversation (projet de l'utilisateur) : Orca demande s'il y a quelque chose
        // à enregistrer, comme pour tout nouveau projet. Rien de modifié : aucune fenêtre.
        if (plater()->new_project(false, true) == wxID_CANCEL)
            return {{"ok", false}, {"reason", "annule"}};
        // Ce que l'utilisateur a choisi de garder serait de toute façon remplacé par les réglages du projet rouvert.
        bundle.printers.discard_current_changes();
        bundle.prints.discard_current_changes();
        bundle.filaments.discard_current_changes();
    }
    // "<silence>" : ni fenêtre de choix (ProjectDropDialog), ni nom de projet (Ctrl+S ne réécrit jamais ce fichier).
    plater()->load_project(wxString::FromUTF8(path.string()), "<silence>");

    // Le filament vient de la bobine (son préréglage a pu progresser depuis), le reste du 3MF : les valeurs du filament
    // du fichier, remises en « modifiées » par Orca, sont oubliées avant que l'enregistrement de la bobine les voie.
    const std::string spool = spool_preset_of(conv);
    if (!spool.empty()) {
        discard(false, true);
        if (bundle.filaments.get_selected_preset_name() != spool)
            FirstSteps::select_filament(spool);
    }
    SettingsBridge::clear_undo();
    AutoSave::note_change();

    s_conv        = conv;
    s_saved       = current();
    s_seen        = s_saved;
    s_has_saved   = true;
    s_last_change = Clock::now();
    ensure_timer();
    BOOST_LOG_TRIVIAL(info) << "Plyo: projet de la conversation rouvert (" << plater()->model().objects.size() << " pièce(s))";
    return {{"ok", true}, {"reason", ""}};
}

bool keeps_project() { return !s_conv.empty() && !s_opening && !AutoSave::calibrating(); }

bool take_preset_changes()
{
    if (!keeps_project() || wxGetApp().preset_bundle == nullptr)
        return false;
    Slic3r::PresetBundle& bundle = *wxGetApp().preset_bundle;
    // Le plateau d'abord : Orca n'a pas posé sa question « projet non enregistré » (keeps_project).
    if (changed() && !write_now())
        return false; // le 3MF n'a pas pu être écrit (ou trop lourd) : les réglages seraient perdus, Orca demande
    if (bundle.printers.current_is_dirty())
        return false; // une machine modifiée n'est pas un réglage de pièce : Orca demande
    if (!AutoSave::save_spool_now())
        return false; // filament qui n'est pas une bobine (préréglage de l'utilisateur) : Orca demande
    // Plus rien n'est attaché : si Orca ne change pas de projet ensuite (assistant de configuration, mise à jour des
    // profils, déconnexion), le 3MF garde les réglages d'impression qui viennent d'être oubliés au lieu d'être réécrit
    // sans eux. Rouvrir la conversation les remet.
    clear_attachment(true);
    if (bundle.prints.current_is_dirty() || bundle.filaments.current_is_dirty())
        discard(true, true);
    return true;
}

void on_project_changed(bool paused)
{
    ++s_project;
    // Nouveau projet ou fichier ouvert par l'utilisateur : ce plateau n'est plus celui de la conversation (ses changements
    // ont été écrits juste avant par take_preset_changes, appelé par la question d'Orca).
    if (!paused) {
        clear_attachment(false);
        s_kept_plate = false;
    }
}

void note_change() { ++s_settings; }

void set_listener(std::function<void(const nlohmann::json&)> listener) { s_listener = std::move(listener); }

void stop()
{
    clear_attachment(false);
    s_listener = nullptr;
    if (!s_timer)
        return;
    s_timer->Stop();
    delete s_timer;
    s_timer = nullptr;
}

}} // namespace Plyo::ProjectFiles
