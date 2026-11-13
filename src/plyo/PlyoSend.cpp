#include "PlyoSend.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoOrcaMessages.hpp"
#include "PlyoOrcaMessagesLogic.hpp"
#include "PlyoOrcaWindows.hpp"
#include "PlyoPrinterStatus.hpp"
#include "PlyoSendLogic.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/PrintHostDialogs.hpp"

#include <boost/log/trivial.hpp>

#include <wx/dataview.h>
#include <wx/timer.h>
#include <wx/weakref.h>

#include <algorithm>
#include <chrono>
#include <exception>
#include <string>
#include <utility>

namespace Plyo { namespace Send {

namespace {

using Slic3r::GUI::wxGetApp;
namespace GUI = Slic3r::GUI;
using Clock   = std::chrono::steady_clock;

constexpr int VERDICT_WAIT_MS = 900; // Orca ouvre ses fenêtres d'erreur par CallAfter : on les laisse s'ouvrir
constexpr int ISSUE_MINUTES   = 15;
constexpr int PROGRESS_STEP   = 10;  // pour cent entre deux progressions dites au panneau

std::function<void(const nlohmann::json&)> s_listener;
wxWeakRef<GUI::PrintHostQueueDialog>       s_bound; // file d'envoi à laquelle Plyo est lié

int  s_scopes   = 0;     // appels à send_gcode_legacy faits par le panneau, en cours
bool s_handed   = false; // Orca a pris l'envoi pendant ce Scope
long s_expected = -1;    // rang de l'envoi attendu dans la file (nombre de lignes avant lui), -1 si inconnu

// Envoi du panneau suivi dans la file d'Orca.
struct Track
{
    bool        active   = false;
    long        job      = -1; // rang dans la file (PrintHostQueueDialog::Event::job_id), connu au premier événement
    long        expected = -1;
    int         progress = -1; // dernier pourcentage reçu
    int         told     = -1; // dernier pourcentage dit au panneau
    int         hundreds = 0;  // « 100 % » reçus
    std::string host_type;
};
Track s_track;

nlohmann::json    s_issue = nullptr; // dernier échec, pour l'IA
Clock::time_point s_issue_at;

bool                  s_verdict_pending = false;
std::function<void()> s_verdict_fn;
wxTimer*              s_verdict_timer = nullptr; // pointeurs nus : jamais détruits à la fin du programme (après wxWidgets)
wxTimer*              s_arrival_timer = nullptr;

void notify(const nlohmann::json& message)
{
    if (s_listener)
        s_listener(message);
}

std::string host_type_name(const Slic3r::DynamicPrintConfig& config)
{
    const auto* opt = config.option<Slic3r::ConfigOptionEnum<Slic3r::PrintHostType>>("host_type");
    if (opt == nullptr)
        return std::string();
    for (const auto& [name, value] : Slic3r::ConfigOptionEnum<Slic3r::PrintHostType>::get_enum_values())
        if (value == int(opt->value))
            return name;
    return std::string();
}

// Nombre de lignes de la file d'envoi d'Orca (son tableau wxDataViewListCtrl) : le rang du prochain envoi. -1 si illisible.
long queue_count()
{
    GUI::MainFrame*            frame = wxGetApp().mainframe;
    GUI::PrintHostQueueDialog* dlg   = frame != nullptr ? frame->printhost_queue_dlg() : nullptr;
    if (dlg == nullptr)
        return -1;
    for (wxWindow* child : dlg->GetChildren())
        if (auto* list = dynamic_cast<wxDataViewListCtrl*>(child))
            return static_cast<long>(list->GetItemCount());
    return -1;
}

// L'événement concerne-t-il l'envoi suivi ? Son rang est connu d'avance (lignes de la file) ; sinon, le premier événement
// arrivé après la prise par Orca le donne.
bool ours(size_t job_id)
{
    if (!s_track.active)
        return false;
    const long id = static_cast<long>(job_id);
    if (s_track.job >= 0)
        return id == s_track.job;
    if (s_track.expected >= 0 && id != s_track.expected)
        return false;
    s_track.job = id;
    return true;
}

void remember_issue(const std::string& code, const std::string& text)
{
    s_issue    = {{"source", "upload_error"}, {"code", code}, {"level", "error"}, {"text", text}};
    s_issue_at = Clock::now();
}

void stop_arrival()
{
    if (s_arrival_timer != nullptr)
        s_arrival_timer->Stop();
}

void arrive()
{
    if (!s_track.active)
        return;
    stop_arrival();
    s_track.active = false;
    s_issue        = nullptr;
    BOOST_LOG_TRIVIAL(info) << "Plyo: envoi du panneau arrivé (file d'Orca, rang " << s_track.job << ")";
    notify({{"type", "print_upload"}, {"phase", "arrived"}, {"job", s_track.job}});
}

void schedule_arrival()
{
    if (s_arrival_timer == nullptr) {
        s_arrival_timer = new wxTimer();
        s_arrival_timer->Bind(wxEVT_TIMER, [](wxTimerEvent&) { guarded("l'arrivée d'un envoi", [] { arrive(); }); });
    }
    s_arrival_timer->StartOnce(SendLogic::ARRIVED_QUIET_MS);
}

// Les gestionnaires ci-dessous sont appelés par la boucle d'événements de wxWidgets (fil de l'interface) : la file d'Orca
// poste ses événements depuis son fil d'envoi avec wxQueueEvent. Plyo est lié après Orca, donc appelé avant lui ; Skip()
// laisse toujours Orca faire son propre traitement (tableau, notification, fenêtre d'erreur).
void on_progress(GUI::PrintHostQueueDialog::Event& evt)
{
    evt.Skip();
    const size_t job      = evt.job_id;
    const int    progress = evt.progress;
    guarded("la progression d'un envoi", [job, progress] {
        if (!ours(job))
            return;
        if (progress >= 100) {
            ++s_track.hundreds;
            s_track.progress = 100;
            if (SendLogic::arrived_now(s_track.hundreds))
                arrive();
            else
                schedule_arrival(); // arrivé, sauf erreur dans les instants qui suivent
            return;
        }
        s_track.progress = std::max(s_track.progress, progress);
        if (progress > 0 && (s_track.told < 0 || progress - s_track.told >= PROGRESS_STEP)) {
            s_track.told = progress;
            notify({{"type", "print_upload"}, {"phase", "progress"}, {"percent", progress}, {"job", s_track.job}});
        }
    });
}

void on_error(GUI::PrintHostQueueDialog::Event& evt)
{
    evt.Skip();
    const size_t      job    = evt.job_id;
    const std::string status = evt.status.utf8_string();
    guarded("l'échec d'un envoi", [job, &status] {
        if (!ours(job))
            return;
        stop_arrival();
        s_track.active         = false;
        const int         http = SendLogic::http_status(status);
        const std::string step = SendLogic::step_of(s_track.progress, s_track.hundreds);
        const std::string code = SendLogic::failure_code(http, step);
        const std::string text = OrcaMessages::clean_for_panel(status);
        remember_issue(code, text);
        // Orca va aussi montrer sa fenêtre d'erreur (show_error) : la carte du panneau l'explique déjà.
        OrcaWindows::cover("upload_error", 10000);
        PrinterStatus::stop(); // le suivi du démarrage n'a plus d'objet (sinon « n'a pas démarré » dans 4 minutes)
        BOOST_LOG_TRIVIAL(info) << "Plyo: envoi du panneau en échec : " << code << " (étape " << step << ", HTTP " << http << ")";
        notify({{"type", "print_upload"},
                {"phase", "failed"},
                {"job", s_track.job},
                {"failure", {{"code", code}, {"step", step}, {"http", http}, {"host_type", s_track.host_type}, {"text", text}}}});
    });
}

void on_cancel(GUI::PrintHostQueueDialog::Event& evt)
{
    evt.Skip();
    const size_t job = evt.job_id;
    guarded("l'annulation d'un envoi", [job] {
        if (!ours(job))
            return;
        stop_arrival();
        s_track.active = false;
        PrinterStatus::stop();
        notify({{"type", "print_upload"}, {"phase", "cancelled"}, {"job", s_track.job}});
    });
}

} // namespace

void set_listener(std::function<void(const nlohmann::json&)> listener) { s_listener = std::move(listener); }

void attach()
{
    GUI::MainFrame*            frame = wxGetApp().mainframe;
    GUI::PrintHostQueueDialog* dlg   = frame != nullptr ? frame->printhost_queue_dlg() : nullptr;
    if (dlg == nullptr || s_bound.get() == dlg)
        return;
    // EVT_PRINTHOST_INFO n'est pas lu : Orca ne s'en sert plus (PrintHostQueueDialog::on_info est vide).
    dlg->Bind(GUI::EVT_PRINTHOST_PROGRESS, &on_progress);
    dlg->Bind(GUI::EVT_PRINTHOST_ERROR, &on_error);
    dlg->Bind(GUI::EVT_PRINTHOST_CANCEL, &on_cancel);
    s_bound = dlg;
}

Scope::Scope()
{
    attach();
    ++s_scopes;
    s_handed   = false;
    s_expected = queue_count();
}

Scope::~Scope() { --s_scopes; }

bool Scope::handed() const { return s_handed; }

void on_upload_handed()
{
    guarded("la prise d'un envoi par Orca", [] {
        if (s_scopes <= 0)
            return; // envoi lancé par le bouton d'Orca : le panneau ne le suit pas
        s_handed = true;
        stop_arrival();
        s_track          = Track();
        s_track.active   = true;
        s_track.expected = s_expected;
        if (const Slic3r::PresetBundle* bundle = wxGetApp().preset_bundle)
            s_track.host_type = host_type_name(bundle->printers.get_edited_preset().config);
        s_issue = nullptr;
        BOOST_LOG_TRIVIAL(info) << "Plyo: envoi du panneau pris par Orca (" << s_track.host_type << ", rang attendu " << s_expected << ")";
    });
}

void from_panel(std::function<void(nlohmann::json)> done)
{
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr) {
        done({{"ok", false}});
        return;
    }
    if (s_verdict_pending) {
        done({{"ok", false}, {"reason", "busy"}, {"text", "Un envoi est déjà en préparation : attends sa réponse."}});
        return;
    }
    // Orca refuserait après sa fenêtre (« Another export job is running ») : on le dit avant.
    if (plater->is_export_gcode_scheduled()) {
        done({{"ok", false}, {"reason", "busy"}, {"text", "Un export du fichier est en cours : attends qu'il se termine, puis renvoie."}});
        return;
    }
    notify({{"type", "print_send_waiting"}}); // la fenêtre d'envoi d'Orca s'ouvre dans l'appel qui suit
    const Clock::time_point t0        = Clock::now();
    bool                    handed    = false;
    bool                    send_seen = false;
    {
        Scope                    scope;
        OrcaWindows::Scope       windows("send");
        try {
            // Le même appel que le bouton « Imprimer la plaque » d'Orca hors Bambu Lab (Plater::priv::on_action_print_plate).
            plater->send_gcode_legacy(PLATE_CURRENT_IDX, nullptr);
        } catch (const std::exception& e) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: envoi en échec dans Orca : " << e.what();
        }
        handed    = scope.handed();
        send_seen = windows.send_dialog_seen();
    }
    if (handed) {
        done({{"ok", true}, {"route", "host"}});
        return;
    }
    // Orca n'a rien pris. S'il a refusé avec un message, sa fenêtre d'erreur s'ouvre juste après cet appel (show_error).
    OrcaWindows::expect("send", VERDICT_WAIT_MS + 1000);
    s_verdict_pending = true;
    s_verdict_fn      = [done, t0, send_seen] {
        s_verdict_pending                   = false;
        const std::optional<OrcaWindows::Seen> error = OrcaWindows::error_since(t0);
        const nlohmann::json                   report = OrcaMessages::report();
        const bool plate_error = OrcaMessagesLogic::has_error(report.contains("issues") ? report["issues"] : nlohmann::json::array());
        const std::string verdict = SendLogic::verdict(false, error.has_value(), send_seen, plate_error);
        if (verdict == "refused") {
            OrcaWindows::cover_seen(error->id, "upload_error"); // la carte du panneau cite déjà cette fenêtre
            remember_issue("before_send", error->text);
            done({{"ok", false}, {"reason", "refused"},
                  {"failure", {{"code", "before_send"}, {"step", "connect"}, {"http", 0}, {"text", error->text}}}});
        } else if (verdict == "closed")
            done({{"ok", false}, {"cancelled", true}});
        else if (verdict == "not_ready")
            done({{"ok", false}, {"reason", "not_ready"}, {"issues", report["issues"]}});
        else
            done({{"ok", false}, {"reason", "not_started"}});
    };
    if (s_verdict_timer == nullptr) {
        s_verdict_timer = new wxTimer();
        s_verdict_timer->Bind(wxEVT_TIMER, [](wxTimerEvent&) {
            auto fn = std::move(s_verdict_fn);
            s_verdict_fn = nullptr;
            if (fn)
                guarded("le verdict d'un envoi", fn);
            s_verdict_pending = false;
        });
    }
    s_verdict_timer->StartOnce(VERDICT_WAIT_MS);
}

bool busy() { return s_verdict_pending; }

nlohmann::json recent_issues()
{
    if (s_issue.is_null() || Clock::now() - s_issue_at > std::chrono::minutes(ISSUE_MINUTES))
        return nlohmann::json::array();
    return nlohmann::json::array({s_issue});
}

nlohmann::json state()
{
    return {{"active", s_track.active}, {"job", s_track.job},       {"expected", s_track.expected}, {"progress", s_track.progress},
            {"hundreds", s_track.hundreds}, {"handed", s_handed},   {"bound", s_bound.get() != nullptr},
            {"queue", queue_count()},       {"issue", s_issue}};
}

}} // namespace Plyo::Send
