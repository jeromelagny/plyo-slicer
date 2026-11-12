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

// Pointeur nu, comme pour l'enregistrement de la bobine : détruit seulement à la fermeture d'Orca (stop()).
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
// Les réglages d'impression modifiés en cours sont ceux d'un plateau de conversation (même s'il n'est plus attaché :
// plateau trop lourd, écriture en attente). Ils ne vont jamais dans le préréglage partagé et sont oubliés en quittant.
bool                                        s_owns_edits = false;
// L'utilisateur a chargé un fichier à lui (jusqu'au prochain nouveau projet vide) : ce plateau ne s'attache pas.
bool                                        s_user_loaded = false;
// Le plateau en place vient d'une conversation et a été écrit dans son 3MF en la quittant (empreinte s_kept_fp) : tant
// qu'il n'a pas bougé, le remplacer ne perd rien, et Orca n'a rien à demander.
bool                                        s_kept_plate = false;
Fingerprint                                 s_kept_fp;
// Départ de la conversation demandé mais 3MF pas encore écrit (Orca occupé) : le plateau reste attaché, ses réglages
// restent en place, et le départ se fait à la première écriture réussie.
bool                                        s_pending_detach = false;
bool                                        s_pending_forget = false;
// Orca a vidé les réglages de la pièce sans changer de projet (take_preset_changes) : le panneau est prévenu au calme.
struct Notice
{
    bool          pending = false;
    std::string   conv;
    std::uint64_t project = 0;
    std::string   printer;
};
Notice                                      s_notice;
std::function<void(const nlohmann::json&)> s_listener;

Slic3r::GUI::Plater* plater() { return wxGetApp().is_closing() ? nullptr : wxGetApp().plater(); }

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

Slic3r::PresetBundle& bundle() { return *wxGetApp().preset_bundle; }

bool presets_dirty() { return bundle().printers.current_is_dirty() || bundle().prints.current_is_dirty() || bundle().filaments.current_is_dirty(); }

// Orca découpe, envoie, calibre, ou une fenêtre modale est ouverte : pas d'export 3MF (il tourne sur le fil de l'interface).
bool busy()
{
    Slic3r::GUI::Plater* p = plater();
    if (p == nullptr)
        return true;
    return !ProjectFilesLogic::write_allowed(p->is_background_process_slicing(), AutoSave::sending(), AutoSave::calibrating(), AutoSave::modal_open());
}

bool attachable_now()
{
    Slic3r::GUI::Plater* p = plater();
    return p != nullptr && ProjectFilesLogic::attachable(!p->get_project_filename().empty(), s_user_loaded);
}

// `kept` : le plateau quitté est bien dans le 3MF de sa conversation (écrit, ou inchangé depuis l'écriture).
void clear_attachment(bool kept)
{
    if (!s_conv.empty()) {
        s_kept_plate = kept;
        s_kept_fp    = current();
    }
    s_conv.clear();
    s_has_saved      = false;
    s_has_failed     = false;
    s_pending_detach = false;
    s_pending_forget = false;
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
// Vrai si le fichier est écrit. L'appelant a vérifié que rien n'occupe Orca (busy).
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
        // Plus attaché, mais ses réglages d'impression restent ceux de la pièce (s_owns_edits) : jamais dans le préréglage
        // partagé, oubliés au départ de la conversation.
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

// Vrai si le 3MF du plateau attaché est à jour (écrit maintenant, ou rien de changé). Jamais d'écriture quand Orca est
// occupé : faux, et l'appelant garde les réglages.
bool write_if_changed()
{
    if (s_conv.empty())
        return false;
    if (!changed())
        return true;
    return !busy() && write_now();
}

// Oublie les modifications de ces préréglages, comme le bouton « Ignorer » d'Orca (GUI_App, reset_modifications).
void discard(bool print, bool filament)
{
    if (print)
        bundle().prints.discard_current_changes();
    if (filament)
        bundle().filaments.discard_current_changes();
    wxGetApp().load_current_presets(false);
    SettingsBridge::clear_undo(); // ses entrées viseraient les réglages oubliés
}

// Réglages d'impression de la pièce quittée : ils sont dans son 3MF (ou n'y tenaient pas) et ne suivent pas la suite.
void forget_print_edits()
{
    if (s_owns_edits && bundle().prints.current_is_dirty())
        discard(true, false);
    s_owns_edits = false;
}

// Départ effectif : le 3MF est à jour.
void finish_detach(bool forget)
{
    clear_attachment(true);
    if (forget)
        forget_print_edits();
}

void tick()
{
    if (s_writing || s_opening || plater() == nullptr)
        return;
    // Réglages vidés par Orca sans changement de projet : le panneau est prévenu une fois les fenêtres refermées.
    if (s_notice.pending && s_notice.project != s_project)
        s_notice.pending = false; // Orca a changé de projet ensuite : rien à reprendre
    if (s_notice.pending && !AutoSave::modal_open()) {
        s_notice.pending = false;
        notify({{"type", "project_detached"}, {"conv", s_notice.conv}, {"same_printer", bundle().printers.get_selected_preset_name() == s_notice.printer}});
    }
    if (s_conv.empty())
        return;
    // Enregistré sous un nom par l'utilisateur (Enregistrer sous) : c'est désormais son fichier, Orca reprend la main.
    if (!attachable_now()) {
        BOOST_LOG_TRIVIAL(info) << "Plyo: le plateau est devenu un fichier de l'utilisateur, il n'est plus gardé avec la conversation";
        clear_attachment(false);
        s_owns_edits = false;
        return;
    }
    const Fingerprint now = current();
    if (now != s_seen) {
        s_seen        = now;
        s_last_change = Clock::now();
    }
    if (s_pending_detach && !changed()) {
        finish_detach(s_pending_forget);
        return;
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
    if (busy())
        return;
    if (write_now() && s_pending_detach)
        finish_detach(s_pending_forget);
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
    if (preset.empty() || bundle().filaments.find_preset(preset, false) == nullptr || !Spools::is_spool_preset(preset))
        return std::string();
    return preset;
}

} // namespace

fs::path path_of(const std::string& conv) { return Store::dir("projets") / (conv + ".3mf"); }

std::string attached() { return s_conv; }

bool owns_print_edits() { return s_owns_edits || !s_conv.empty(); }

bool attachable() { return attachable_now(); }

bool opening() { return s_opening; }

bool flush() { return write_if_changed(); }

void attach(const std::string& conv)
{
    if (!Conversations::valid_id(conv))
        return;
    if (conv == s_conv) {
        s_pending_detach = false; // la conversation revient avant son départ : elle garde son plateau
        return;
    }
    if (!attachable_now()) {
        BOOST_LOG_TRIVIAL(info) << "Plyo: plateau non attaché à la conversation : c'est un fichier de l'utilisateur";
        return;
    }
    // Plateau d'une autre conversation : écrit d'abord. S'il ne peut pas l'être (Orca occupé), la nouvelle conversation le
    // reprend tel quel (c'est sa pièce désormais).
    if (!s_conv.empty())
        clear_attachment(write_if_changed());
    s_conv        = conv;
    s_owns_edits  = true;
    s_last_change = Clock::now();
    ensure_timer();
}

void detach(bool forget_print_edits_now)
{
    if (s_conv.empty()) {
        if (forget_print_edits_now)
            forget_print_edits(); // plateau trop lourd, ou panneau rouvert : ses réglages ne suivent pas
        return;
    }
    if (write_if_changed()) {
        finish_detach(forget_print_edits_now);
        return;
    }
    // Orca occupé (ou écriture refusée) : on ne perd rien, le départ se fera à la première écriture réussie.
    s_pending_detach = true;
    s_pending_forget = s_pending_forget || forget_print_edits_now;
    BOOST_LOG_TRIVIAL(info) << "Plyo: départ de la conversation en attente : son 3MF n'a pas encore pu être écrit";
}

void release(const std::string& conv)
{
    if (!conv.empty() && conv == s_conv)
        clear_attachment(false);
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
    if (!reason.empty()) {
        detach(true);
        BOOST_LOG_TRIVIAL(info) << "Plyo: projet de la conversation non rouvert (" << reason << ")";
        return {{"ok", false}, {"reason", reason}};
    }
    const bool was_attached = !s_conv.empty();
    if (was_attached && !write_if_changed())
        return {{"ok", false}, {"reason", "occupe"}}; // le plateau en cours n'a pas pu être écrit : on n'y touche pas
    // Plateau d'une conversation, écrit dans son 3MF et pas modifié depuis : le remplacer ne perd rien.
    const bool plyo_plate = was_attached || (s_kept_plate && ProjectFilesLogic::plate_unchanged(s_kept_fp, current(), presets_dirty()));
    clear_attachment(plyo_plate);

    s_opening = true;
    struct Done { ~Done() { s_opening = false; } } done; // même si Orca lève une exception
    const ProjectNotificationsPause quiet;              // pour le panneau, la conversation continue
    if (plyo_plate) {
        bundle().printers.discard_current_changes();
        bundle().prints.discard_current_changes();
        bundle().filaments.discard_current_changes();
        plater()->new_project(true, true);
    } else {
        // Plateau qui n'est pas (ou plus) celui d'une conversation : Orca demande s'il y a quelque chose à enregistrer,
        // comme pour tout nouveau projet. Rien de modifié : aucune fenêtre.
        if (plater()->new_project(false, true) == wxID_CANCEL)
            return {{"ok", false}, {"reason", "annule"}};
        // Ce que l'utilisateur a choisi de garder serait de toute façon remplacé par les réglages du projet rouvert.
        bundle().printers.discard_current_changes();
        bundle().prints.discard_current_changes();
        bundle().filaments.discard_current_changes();
    }
    s_owns_edits = false;
    // "<silence>" : ni fenêtre de choix (ProjectDropDialog), ni nom de projet (Ctrl+S ne réécrit jamais ce fichier).
    plater()->load_project(wxString::FromUTF8(path.string()), "<silence>");

    // Le filament vient de la bobine (son préréglage a pu progresser depuis), le reste du 3MF : les valeurs du filament
    // du fichier, remises en « modifiées » par Orca, sont oubliées avant que l'enregistrement de la bobine les voie.
    const std::string spool = spool_preset_of(conv);
    if (!spool.empty()) {
        discard(false, true);
        if (bundle().filaments.get_selected_preset_name() != spool)
            FirstSteps::select_filament(spool);
    } else if (bundle().filaments.current_is_dirty() && Spools::is_spool_preset(bundle().filaments.get_selected_preset_name())) {
        // Fiche sans bobine utilisable, mais le 3MF a remis une bobine du registre : ses valeurs n'y entrent jamais.
        discard(false, true);
    }
    SettingsBridge::clear_undo();
    AutoSave::note_change();

    s_conv        = conv;
    s_owns_edits  = true;
    s_user_loaded = false;
    s_saved       = current();
    s_seen        = s_saved;
    s_has_saved   = true;
    s_last_change = Clock::now();
    ensure_timer();
    BOOST_LOG_TRIVIAL(info) << "Plyo: projet de la conversation rouvert (" << plater()->model().objects.size() << " pièce(s))";
    return {{"ok", true}, {"reason", ""}};
}

bool keeps_project()
{
    if (s_conv.empty() || s_opening || !attachable_now() || busy())
        return false; // Orca occupé, ou fichier de l'utilisateur : Orca pose ses questions comme avant
    return write_if_changed(); // le 3MF doit être écrit, sinon Orca demande
}

bool take_preset_changes()
{
    if (wxGetApp().preset_bundle == nullptr || !keeps_project())
        return false;
    if (bundle().printers.current_is_dirty())
        return false; // une machine modifiée n'est pas un réglage de pièce : Orca demande
    if (!AutoSave::save_spool_now())
        return false; // filament qui n'est pas une bobine (préréglage de l'utilisateur) : Orca demande
    // Plus rien n'est attaché : si Orca ne change pas de projet ensuite (assistant de configuration, mise à jour des
    // profils, déconnexion, installation d'une imprimante), le 3MF garde les réglages d'impression qui vont être oubliés
    // au lieu d'être réécrit sans eux, et le panneau est prévenu (tick) pour rouvrir la conversation.
    s_notice = {true, s_conv, s_project, bundle().printers.get_selected_preset_name()};
    clear_attachment(true);
    if (bundle().prints.current_is_dirty() || bundle().filaments.current_is_dirty())
        discard(true, true);
    s_owns_edits = false;
    return true;
}

void on_project_changed(bool paused)
{
    ++s_project;
    // Nouveau projet ou fichier ouvert par l'utilisateur : ce plateau n'est plus celui de la conversation (ses changements
    // ont été écrits juste avant par la question d'Orca, take_preset_changes). Un fichier chargé (pièces présentes) est à
    // lui jusqu'au prochain nouveau projet.
    if (!paused) {
        clear_attachment(false);
        s_kept_plate   = false;
        s_owns_edits   = false;
        s_notice       = {};
        Slic3r::GUI::Plater* p = plater();
        s_user_loaded  = p != nullptr && !p->model().objects.empty();
    }
}

void note_change() { ++s_settings; }

void set_listener(std::function<void(const nlohmann::json&)> listener) { s_listener = std::move(listener); }

void panel_closed()
{
    // Le plateau reste celui de la conversation (la minuterie continue) ; le panneau rouvert, qui commence une
    // conversation neuve, le détache. Ses derniers changements sont écrits tout de suite si Orca est libre.
    if (!wxGetApp().is_closing())
        write_if_changed();
}

void stop()
{
    if (!s_timer)
        return;
    s_timer->Stop();
    delete s_timer;
    s_timer = nullptr;
}

}} // namespace Plyo::ProjectFiles
