#include "PlyoAssistant.hpp"
#include "PlyoAutoSave.hpp"
#include "PlyoBrands.hpp"
#include "PlyoBrandsLogic.hpp"
#include "PlyoGuard.hpp"
#include "PlyoJson.hpp"
#include "PlyoCalibration.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoCanvas.hpp"
#include "PlyoColours.hpp"
#include "PlyoSlots.hpp"
#include "PlyoCC2.hpp"
#include "PlyoCommands.hpp"
#include "PlyoConversations.hpp"
#include "PlyoDictation.hpp"
#include "PlyoDiscovery.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoHighlight.hpp"
#include "PlyoJournal.hpp"
#include "PlyoLifetime.hpp"
#include "PlyoLifetimeLogic.hpp"
#include "PlyoLimits.hpp"
#include "PlyoLoginDialog.hpp"
#include "PlyoMemory.hpp"
#include "PlyoModelImport.hpp"
#include "PlyoConfig.hpp"
#include "PlyoContextLogic.hpp"
#include "PlyoOrcaMessages.hpp"
#include "PlyoPageLogic.hpp"
#include "PlyoOrcaWindows.hpp"
#include "PlyoPhoneDialog.hpp"
#include "PlyoPlateActions.hpp"
#include "PlyoRetouches.hpp"
#include "PlyoPreflight.hpp"
#include "PlyoProfiles.hpp"
#include "PlyoPrinterLink.hpp"
#include "PlyoPrinterStatus.hpp"
#include "PlyoDiscoveryLogic.hpp"
#include "PlyoStore.hpp"
#include "PlyoHabits.hpp"
#include "PlyoProject.hpp"
#include "PlyoProjectLogic.hpp"
#include "PlyoProjectFiles.hpp"
#include "PlyoRawTests.hpp"
#include "PlyoPrinterSetup.hpp"
#include "PlyoSelfTest.hpp"
#include "PlyoSend.hpp"
#include "PlyoSession.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoSpools.hpp"
#include "PlyoSpoolsLogic.hpp"

#include "libslic3r/Utils.hpp"
#include "slic3r/GUI/DockPanel.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/Widgets/SideButton.hpp"
#include "slic3r/GUI/Widgets/StateColor.hpp"
#include "slic3r/GUI/Widgets/WebHosting.hpp"
#include "slic3r/GUI/wxExtensions.hpp"

#include <boost/beast/core/detail/base64.hpp>
#include <boost/filesystem/path.hpp>
#include <boost/log/trivial.hpp>
#include <boost/nowide/fstream.hpp>
#include <nlohmann/json.hpp>

#include <wx/aui/framemanager.h>
#include <wx/gdicmn.h>
#include <wx/menu.h>
#include <wx/panel.h>
#include <wx/sizer.h>
#include <wx/uri.h>
#include <wx/weakref.h>
#include <wx/webview.h>

#include <exception>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace Plyo {

using Slic3r::GUI::DockPanel;
using Slic3r::GUI::MainFrame;
using Slic3r::GUI::Plater;

namespace {

constexpr const char* PANE_NAME = "plyo:assistant";

// Le panneau est détruit par Orca quand on le ferme ; wxWeakRef repasse alors à nullptr tout seul.
wxWeakRef<DockPanel> s_panel;
// Bascule de version du panneau : le panneau fermé se rouvre aussitôt (sa page est choisie à l'ouverture). Le plateau reste
// attaché à la conversation pendant la fermeture : la page rouverte la reprend (project_resume_get), comme une réouverture.
bool s_reopen = false;
bool                 s_refresh_pending = false;
int                  s_project_pauses  = 0; // gardes ProjectNotificationsPause en vie (fil principal seulement)
int                  s_project_changes = 0; // appels à on_project_changed() (fil principal seulement)
wxWeakRef<SideButton> s_topbar_button;
wxMenuItem*          s_view_menu_item = nullptr; // entrée du menu Affichage, lue seulement par le banc d'essai

// Mode Simple (parcours débutant, lot 8) : la barre de réglages d'Orca repliée et le panneau plus large, par des fonctions
// publiques d'Orca (Plater::collapse_sidebar, celle du bouton de repli et de Maj + Tab, et le volet AUI du panneau) : aucun
// point de contact dans le code d'Orca. Orca ne retient pas ce repli : il est remis à chaque ouverture du panneau.
// `changed` : l'utilisateur vient de choisir ; sinon (ouverture) la disposition d'Orca n'est touchée qu'en mode Simple.
bool layout_simple() { return Json::str(FirstSteps::state(), "layout") == "simple"; }
void apply_layout(bool changed)
{
    Plater* plater = Slic3r::GUI::wxGetApp().plater();
    if (plater == nullptr || !s_panel)
        return;
    const bool simple = layout_simple();
    if (simple || changed)
        plater->collapse_sidebar(simple);
    if (!simple && !changed)
        return;
    wxAuiManager* aui = wxAuiManager::GetManager(s_panel);
    if (aui == nullptr)
        return;
    wxAuiPaneInfo& pane = aui->GetPane(s_panel);
    if (!pane.IsOk())
        return;
    // Un volet ancré garde sa largeur : on l'impose le temps d'une mise en page (taille minimale et maximale), puis on rend
    // la main (l'utilisateur peut toujours le redimensionner).
    const int width = s_panel->FromDIP(simple ? 480 : 380);
    pane.BestSize(wxSize(width, pane.best_size.y)).MinSize(wxSize(width, -1)).MaxSize(wxSize(width, -1));
    aui->Update();
    pane.MinSize(wxSize(s_panel->FromDIP(320), -1)).MaxSize(wxSize(-1, -1));
    aui->Update();
}

// Bouton de la barre du haut : plein quand le panneau est ouvert, cerné quand il est fermé.
void refresh_topbar_button()
{
    if (!s_topbar_button)
        return;
    const wxColour bar     = StateColor::darkModeColorFor(wxColour("#3B4446"));
    const wxColour teal    = wxColour(0, 150, 136);
    const wxColour hovered = wxColour(38, 166, 154);
    StateColor     bg;
    bg.append(wxColour(0, 137, 123), StateColor::Pressed);
    bg.append(hovered, StateColor::Hovered);
    bg.append(s_panel ? teal : bar, StateColor::Normal);
    StateColor border;
    border.append(hovered, StateColor::Hovered);
    border.append(teal, StateColor::Normal);
    s_topbar_button->SetBackgroundColor(bg);
    s_topbar_button->SetBorderColor(border);
    s_topbar_button->Refresh();
}

std::string read_resource(const std::string& name)
{
    const boost::filesystem::path path = boost::filesystem::path(Slic3r::resources_dir()) / "web" / "plyo" / name;
    boost::nowide::ifstream       file(path.string(), std::ios::binary);
    if (!file) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: impossible de lire " << path.string();
        return std::string();
    }
    std::ostringstream content;
    content << file.rdbuf();
    return content.str();
}

// La page est chargée comme texte (sans adresse de base dans resources/web/plyo ; WebView2 ignore celle de SetPage) : les
// scripts annexes sont insérés à la place de leurs marqueurs « <!--plyo-include:nom.js--> », dans l'ordre de la page, qui
// est la seule liste (ARCH-11). La politique de sécurité du contenu est construite d'après l'adresse réelle du service, et
// chaque balise <script> porte le jeton de cette page (PageLogic).
// Version du panneau : clé « ui » des premiers pas (« classique » ou « v2 »). Page v2 absente ou illisible : la classique.
std::string load_page()
{
    const std::string name = PageLogic::page_for_ui(Json::str(FirstSteps::state(), "ui", 20));
    std::string       page = read_resource(name);
    if (page.empty() && name != "index.html")
        page = read_resource("index.html");
    if (page.empty())
        return "<h3>Assistant Plyo</h3><p>Page introuvable : resources/web/plyo/index.html</p>";
    const std::string nonce = PageLogic::new_nonce();
    // Banc d'essai (PLYO_SELFTEST) : le pilote passe après tous les scripts du panneau. Hors banc, chaîne vide : page inchangée.
    return PageLogic::assemble(page, read_resource, Config::api_url_script(), SelfTest::page_script(),
                               PageLogic::content_security_policy(Config::api_url(), nonce, SelfTest::page_connect_sources()), nonce);
}

// Garde de navigation (ARCH-17) : la vue du panneau n'affiche que sa page (page d'amorçage, puis la page Plyo chargée par
// SetPage). Toute autre adresse (lien, redirection, formulaire, script) est refusée : une page distante recevrait sinon le pont
// window.orca (session, réglages, plateau). Le panneau n'ouvre aucun lien vers l'extérieur ; une nouvelle fenêtre est déjà
// refusée par DockPanel.
bool allowed_navigation(const wxString& url)
{
    if (Slic3r::GUI::web_hosting::is_content_url(url))
        return true;
    if (wxURI::Unescape(url.BeforeFirst('#')) == wxURI::Unescape(Slic3r::GUI::web_hosting::bootstrap_url()))
        return true;
#ifdef _WIN32
    // WebView2 charge SetPage par NavigateToString, qui se présente comme about:blank ou une adresse data:text/html (Chromium
    // refuse de lui-même qu'une page ouvre une adresse data: en haut de la vue).
    if (url == "about:blank" || url.StartsWith("data:text/html"))
        return true;
#endif
    return false;
}

// Profondeur de recherche de la vue web sous le panneau : elle en est un enfant direct aujourd'hui, mais wx (ou une version
// d'Orca) peut l'envelopper ; au-delà, ce n'est plus notre panneau.
constexpr int WEBVIEW_SEARCH_DEPTH = 4;

void guard_navigation(DockPanel* panel)
{
    const std::vector<wxWindow*> views = PageLogic::find_bounded<wxWindow*>(
        panel, [](wxWindow* w) -> const wxWindowList& { return w->GetChildren(); },
        [](wxWindow* w) { return wxDynamicCast(w, wxWebView) != nullptr; }, WEBVIEW_SEARCH_DEPTH);
    // Sans vue trouvée, le panneau resterait sans garde : on le dit dans le journal plutôt que de le taire.
    if (views.empty())
        BOOST_LOG_TRIVIAL(error) << "Plyo: aucune vue web trouvée sous le panneau, la navigation n'y est pas gardée.";
    for (wxWindow* child : views) {
        auto* view = wxDynamicCast(child, wxWebView);
        view->Bind(wxEVT_WEBVIEW_NAVIGATING, [](wxWebViewEvent& event) {
            if (allowed_navigation(event.GetURL())) {
                event.Skip();
                return;
            }
            BOOST_LOG_TRIVIAL(warning) << "Plyo: navigation refusée dans le panneau : " << event.GetURL().utf8_string().substr(0, 200);
            event.Veto();
        });
    }
}

void send(const nlohmann::json& message)
{
    if (s_panel)
        s_panel->push_message(message);
}

void send_values()
{
    nlohmann::json message = SettingsBridge::read_values();
    message["type"]        = "values";
    // Langue de l'interface d'Orca (ex. « fr_FR ») : l'assistant répond dans cette langue.
    message["locale"]      = Slic3r::GUI::wxGetApp().current_language_code().utf8_string();
    // Hors de `context` (que le panneau transmet au service) : ce qui sert à la fiche et aux questions de l'étape Machine. Types de
    // plateau proposés pour l'imprimante en cours et type du projet ; modèle de l'imprimante et ses tailles de buse.
    message["bed"]         = SettingsBridge::bed_info();
    message["machine"]     = PrinterSetup::current_model();
    send(message);
}

// Fins d'impression lues par le suivi (phase « end »), par id d'envoi, le temps de la session : arrivées panneau fermé ou
// pendant une autre conversation, le panneau les redemande (print_watch_replay) en rouvrant la conversation de cet envoi.
std::map<std::string, nlohmann::json> s_watch_ends;

void send_watch(nlohmann::json w, const std::string& id)
{
    w["type"] = "print_watch";
    w["id"]   = id; // l'envoi suivi : le panneau ignore un message d'un envoi remplacé
    if (Json::str(w, "phase") == "end" && !id.empty()) {
        if (s_watch_ends.size() >= 20 && s_watch_ends.count(id) == 0)
            s_watch_ends.erase(s_watch_ends.begin());
        s_watch_ends[id] = w;
    }
    send(w);
}

// Réponse à une demande du panneau (apply, undo, calib_*…) : `request`, l'identifiant de la demande, est renvoyé tel quel
// (le panneau retrouve ainsi la fiche ou le bouton qui attend ; 0 si la demande n'en portait pas).
void send_result(const nlohmann::json& result, const nlohmann::json& data)
{
    nlohmann::json message = result;
    message["type"]        = "result";
    message["request"]     = Json::integer(data, "request", 0);
    send(message);
}

// Refus (à envoyer tel quel) si une modification ne doit pas être faite : fiche du projet incomplète, ou Orca qui n'est
// plus sur l'imprimante ou le filament du projet. null si elle est permise. Ne sont jamais refusés : un retour arrière
// (`revert`) et un réglage fait par l'utilisateur dans la fiche elle-même (`project_edit`, ex. les températures).
// `missing` : les étapes de la fiche à compléter d'abord (le panneau propose d'y aller).
nlohmann::json project_refusal(const nlohmann::json& data)
{
    if (Json::boolean(data, "revert", false))
        return nullptr;
    const nlohmann::json project = data.contains("project") ? data["project"] : nlohmann::json();
    const nlohmann::json state   = Project::state();
    const std::string    printer = Json::str(state, "printer_preset"), filament = Json::str(state, "filament_preset");
    // Un lot qui ne touche que l'onglet Filament n'exige pas la pièce (seulement les réglages, pas les ordres sur le plateau).
    const bool filament_only = Json::str(data, "type") == "apply" && SettingsBridge::filament_only(data.contains("changes") ? data["changes"] : nlohmann::json());
    // Un réglage fait dans la fiche n'exige pas la pièce, mais Orca doit être sur le profil du projet : sinon il écrirait
    // dans le filament d'un autre projet.
    const bool        edit = Json::boolean(data, "project_edit", false);
    const std::string text = edit ? ProjectLogic::edit_refusal(project, printer, filament) : ProjectLogic::refusal(project, printer, filament, filament_only);
    if (text.empty())
        return nullptr;
    return {{"ok", false}, {"text", text}, {"can_restore", ProjectLogic::can_restore(project, printer, filament)},
            {"missing", edit ? std::vector<std::string>() : ProjectLogic::missing_for(project, filament_only)}};
}

// Ferme le panneau pour le rouvrir sur l'autre version (voir s_reopen).
void reopen_panel()
{
    if (!s_panel)
        return;
    s_reopen = true;
    s_panel->request_close();
}

void handle_page_message(const nlohmann::json& data)
{
    const std::string type = data.is_object() ? Json::str(data, "type") : std::string();
    try {
        if (type == "ready") {
            send({{"type", "status"}, {"text", "Connecté au slicer."}});
            // Une autre instance de Plyo tient déjà ce dossier de données (ROB-16) : le panneau le dit, avec quoi faire.
            if (Store::other_instance())
                send({{"type", "other_instance"}});
            // Dictée vocale du système : le panneau ne montre son bouton micro que si elle peut être lancée d'ici.
            send({{"type", "dictation"}, {"available", Dictation::available()}, {"platform", Dictation::platform()}});
            send_values();
        } else if (type == "dictation_start") {
            // Bouton micro du champ de saisie : le système écoute et écrit dans le champ, Plyo n'enregistre ni n'envoie rien.
            send({{"type", "dictation"}, {"available", Dictation::available()}, {"platform", Dictation::platform()},
                  {"started", Dictation::start()}});
        } else if (type == "dictation_stop") {
            // Second appui sur le micro : le système arrête d'écouter.
            send({{"type", "dictation"}, {"available", Dictation::available()}, {"platform", Dictation::platform()},
                  {"stopped", Dictation::stop()}});
        } else if (type == "get_values")
            send_values();
        else if (type == "apply") {
            // Le plateau est encore celui d'une autre conversation (départ ou ouverture en attente qu'Orca ait fini) : rien
            // ne s'y applique.
            if (ProjectFiles::edits_blocked()) {
                send_result({{"ok", false}, {"text", ProjectFiles::busy_text()}}, data);
                return;
            }
            if (const nlohmann::json refused = project_refusal(data); !refused.is_null()) {
                send_result(refused, data);
                return;
            }
            // Chaque application réussie est notée dans la mémoire de la machine (imprimante + filament).
            nlohmann::json       before = SettingsBridge::read_values();
            const nlohmann::json manual = Profiles::manual_edits(); // enregistrées avec le lot
            // Le lot a été proposé pour des profils précis : s'ils ont changé depuis, rien n'est écrit.
            if (const nlohmann::json stale = SettingsBridge::check_profiles(Json::str(data, "printer_name"), Json::str(data, "print_name"), Json::str(data, "filament_name"));
                !stale.is_null()) {
                send_result(stale, data);
                return;
            }
            const nlohmann::json changes = data.contains("changes") ? data["changes"] : nlohmann::json();
            // Mode catalogue : les changements portent une « key » (clé d'Orca) au lieu d'un « id » de la liste d'origine.
            const bool           catalog = changes.is_array() && !changes.empty() && changes[0].is_object() && changes[0].contains("key");
            nlohmann::json result = catalog ? SettingsBridge::apply_catalog_changes(changes, Json::str(data, "print_name"), Json::str(data, "filament_name"))
                                            : SettingsBridge::apply_changes(changes);
            if (Json::boolean(result, "ok", false)) {
                // L'écriture fait foi : le lot est en place et annulable. Les enregistrements annexes (profil, mémoire,
                // journal) ne peuvent plus le faire passer pour un échec : une erreur y est notée, la réponse reste « appliqué ».
                try {
                    // Les profils sont enregistrés avant la mémoire : si Orca en crée une copie, le couple imprimante + filament change de nom.
                    const nlohmann::json saved = Profiles::save_applied();
                    result["saved"]            = saved["saved"];
                    result["save_error"]       = saved["save_error"];
                    result["in_project"]       = saved["in_project"];
                    result["print_edited"]     = saved["print_edited"];
                    result["manual_saved"]     = manual;
                } catch (const std::exception& e) {
                    BOOST_LOG_TRIVIAL(error) << "Plyo: lot appliqué, profil non enregistré : " << e.what();
                    result["save_error"] = "erreur inattendue";
                }
                try {
                    const nlohmann::json ask = data.contains("ask") ? data["ask"] : nlohmann::json();
                    nlohmann::json       after = SettingsBridge::read_values();
                    if (catalog) {
                        // Ce qui est réellement en place : le lot relu, et ce qu'Orca a changé en plus (clés du catalogue).
                        // La valeur d'après est celle du relevé du catalogue (même forme que ce que le panneau relira pour un
                        // retour arrière : « 20% », true…) ; le libellé et l'unité sont ceux de la fiche (titre du catalogue sinon).
                        after["params"]  = nlohmann::json::array();
                        before["params"] = nlohmann::json::array();
                        const nlohmann::json snap = SettingsBridge::read_snapshot();
                        const auto           unit_of = [&changes](const std::string& key) {
                            for (const nlohmann::json& c : changes)
                                if (c.is_object() && Json::str(c, "key") == key)
                                    return Json::str(c, "unit", 20);
                            return std::string();
                        };
                        const auto note = [&](const std::string& key, const std::string& label, const nlohmann::json& was, const nlohmann::json& now) {
                            const nlohmann::json in_place = snap.contains(key) && !snap[key].is_null() ? snap[key] : now;
                            const std::string    title    = label.empty() || label == key ? Catalog::policy().title(key) : label;
                            after["params"].push_back({{"id", key}, {"value", in_place}, {"label", title}, {"unit", unit_of(key)}, {"catalog", true}});
                            before["params"].push_back({{"id", key}, {"value", was}});
                        };
                        for (const nlohmann::json& a : Json::arr(result, "applied"))
                            note(Json::str(a, "id"), Json::str(a, "label"), a["before"], a["after"]);
                        for (const nlohmann::json& a : Json::arr(result, "also_changed"))
                            if (Catalog::policy().allows(Json::str(a, "scope"), Json::str(a, "key")))
                                note(Json::str(a, "key"), Json::str(a, "label"), a["before"], a["after"]);
                    }
                    const std::string    key = Memory::note_applied(before, after, Json::str(data, "why"), ask);
                    SettingsBridge::set_memory_key(Json::integer(result, "undo_id", 0), key);
                    // Réglages venus d'une réponse de l'IA : notés aussi dans le journal de la pièce.
                    const nlohmann::json noted = Memory::for_current();
                    if (ask.is_object() && !key.empty() && !noted.empty()) {
                        Journal::set_changes(Json::str(ask, "conv"), Json::arr(noted[0], "changes"));
                        Profiles::note_trial(Json::str(noted[0], "at")); // devient la version fiable si l'impression réussit
                    }
                } catch (const std::exception& e) {
                    BOOST_LOG_TRIVIAL(error) << "Plyo: lot appliqué, mémoire ou journal non mis à jour : " << e.what();
                }
            }
            send_result(result, data);
        } else if (type == "undo") {
            // `undo_id` : l'annulation d'une fiche précise ; sans, le dernier lot (menu « ⋯ »).
            nlohmann::json result = SettingsBridge::undo_last(Json::integer(data, "undo_id", 0));
            if (Json::boolean(result, "ok", false)) {
                try {
                    Journal::clear_changes(Memory::forget(Json::str(result, "memory_key")));
                    // Les valeurs d'avant sont remises : le profil est réenregistré, comme après l'application.
                    const nlohmann::json saved = Profiles::save_applied();
                    result["saved"]            = saved["saved"];
                    result["save_error"]       = saved["save_error"];
                    result["in_project"]       = saved["in_project"];
                    result["print_edited"]     = saved["print_edited"];
                } catch (const std::exception& e) {
                    BOOST_LOG_TRIVIAL(error) << "Plyo: lot annulé, enregistrements annexes incomplets : " << e.what();
                    result["save_error"] = "erreur inattendue";
                }
            }
            send_result(result, data);
        } else if (type == "ai_context") {
            // Juste avant une demande à l'IA : le plateau (avec les mesures de la vérification avant impression), ce qui a déjà
            // été appliqué sur cette machine, les limites et leur provenance, et ce que le slicer sait de la machine (lectures
            // seules, filtrées au format du service : ContextLogic).
            const Limits::Range range  = Limits::current();
            nlohmann::json      limits = Limits::to_json(range);
            if (!limits.empty() && !range.source.empty())
                limits["source"] = range.source;
            send({{"type", "ai_context"}, {"plate", ContextLogic::plate_for_ai(PlateActions::context(), Preflight::ai_facts())},
                  {"memory", ContextLogic::memory_for_ai(Memory::for_current())}, {"limits", limits},
                  {"snapshot", SettingsBridge::read_snapshot()}, {"context", SettingsBridge::ai_context()}});
        }
        else if (type == "reliable_get") {
            nlohmann::json info = Profiles::reliable_info();
            info["type"]        = "reliable";
            send(info);
        } else if (type == "restore_reliable") {
            nlohmann::json result = Profiles::restore_reliable();
            result["type"]        = "restore_reliable_result";
            send(result);
        } else if (type == "manual_edits_get")
            send({{"type", "manual_edits"}, {"items", Profiles::manual_edits()}});
        else if (type == "limits_get")
            send({{"type", "limits"}, {"limits", Limits::to_json(Limits::current())}});
        else if (type == "limits_set") {
            const bool ok = Limits::set(data.contains("limits") ? data["limits"] : nlohmann::json::object());
            send({{"type", "limits"}, {"ok", ok}, {"limits", Limits::to_json(Limits::current())}});
        }
        else if (type == "outcome_pending")
            send({{"type", "outcome_pending"}, {"items", Memory::pending()}});
        else if (type == "outcome_set") {
            const std::string note = Json::str(data, "note");
            Journal::set_outcome(Json::str(data, "conv"), Json::str(data, "outcome"), note);
            const bool saved_outcome = Memory::set_outcome(Json::str(data, "machine"), Json::str(data, "at"), Json::str(data, "outcome"), note);
            // « Ça a marché » : ces réglages deviennent la version fiable de cette imprimante + filament (si c'est bien le couple en cours).
            const bool current_pair = Json::str(data, "machine") == Limits::machine_key();
            if (saved_outcome && Json::str(data, "outcome") == "ok" && current_pair)
                Profiles::mark_reliable(Json::str(data, "at"));
            // Bobine en cours : la version envoyée à l'imprimante devient sa version réussie ; un échec est noté au registre.
            if (current_pair && Json::str(data, "outcome") == "ok")
                Profiles::mark_spool_success();
            else if (current_pair && Json::str(data, "outcome") == "bad")
                Profiles::mark_spool_failure();
            send({{"type", "outcome_saved"}, {"ok", saved_outcome}});
        } else if (type == "outcome_printed") {
            // Le projet passe à l'étape Résultat : ses corrections en attente sont celles de cette impression (une seule question).
            Memory::note_printed(Json::str(data, "conv", 40));
        } else if (type == "outcome_result") {
            // Réponse de l'étape Résultat (ou de la fin suivie) : elle marque aussi la mémoire des corrections de cette impression,
            // le journal de la pièce, et leurs réglages réussis (la bobine est marquée par spool_success / spool_failure).
            const std::string        conv    = Json::str(data, "conv", 40);
            const std::string        outcome = Json::str(data, "outcome");
            std::vector<std::string> ats;
            for (const nlohmann::json& a : Json::arr(data, "ats"))
                if (a.is_string() && ats.size() < 20)
                    ats.push_back(a.get<std::string>());
            const nlohmann::json items    = Memory::set_result(conv, outcome, ats);
            bool                 reliable = false;
            if (!items.empty()) {
                Journal::set_outcome(conv, outcome);
                if (outcome == "ok")
                    for (const nlohmann::json& e : items)
                        reliable = Profiles::mark_reliable(Json::str(e, "at")) || reliable;
            }
            send({{"type", "outcome_result_done"}, {"conv", conv}, {"outcome", outcome}, {"items", items}, {"reliable", reliable}});
        } else if (type == "spool_success") {
            // Réussite déclarée hors de la carte « Ça a marché ? » (phrase dans la discussion).
            // Elle vise le dernier envoi, même si une autre bobine a été choisie depuis.
            // Seulement pour la bobine de la conversation (`spool`, son id) : jamais un autre envoi, ancien ou déclaré raté.
            nlohmann::json done = Profiles::mark_sent_success(Json::str(data, "spool"), Json::boolean(data, "change_of_mind", false));
            done["type"]        = "spool_success_done";
            send(done);
        } else if (type == "spool_failure") {
            // « Non, c'est raté » à l'étape Résultat : vise le dernier envoi, comme spool_success.
            nlohmann::json done = Profiles::mark_sent_failure(Json::str(data, "spool"));
            done["type"]        = "spool_failure_done";
            send(done);
        } else if (type == "journal_add")
            Journal::record(data);
        else if (type == "journal_list") {
            // Projets encore gardés : une pièce dont le projet a été supprimé n'offre pas de bouton qui mène à une erreur.
            nlohmann::json projects = nlohmann::json::array();
            for (const nlohmann::json& it : Conversations::list())
                projects.push_back(it["id"]);
            send({{"type", "journal"}, {"events", Journal::list()}, {"projects", projects}});
        } else if (type == "orca_issues") {
            // Ce qu'Orca dit de la plaque (après un lot appliqué, une découpe qui ne démarre pas, une plaque non imprimable).
            nlohmann::json r = OrcaMessages::report();
            r["type"]        = "orca_issues";
            r["purpose"]     = Json::str(data, "purpose", 40);
            send(r);
        } else if (type == "preflight")
            // Après un découpage (ou sur demande) : mesures du plateau pour la vérification avant impression.
            send({{"type", "preflight"}, {"data", Preflight::measure()}});
        else if (type == "plate_action") {
            const std::string kind    = Json::str(data, "kind");
            const long long   request = Json::integer(data, "request", 0LL); // pour retrouver le bouton qui a demandé l'action
            const auto        reply   = [kind, request](nlohmann::json done) {
                done["type"]    = "plate_action";
                done["kind"]    = kind;
                done["request"] = request;
                send(done);
            };
            // Une découpe attend qu'Orca ait lu un réglage changé à l'instant (PlateActions::run_when_ready).
            if (kind == "undo")
                reply(PlateActions::undo(Json::integer(data, "undo_token", -1LL)));
            else
                PlateActions::run_when_ready(kind, reply);
        } else if (type == "commands") {
            // Ordres de l'IA (« penche la pièce de 20° ») : exécutés aussitôt, annulables d'un clic (plate_action « undo »).
            // Les gestes simples sur la pièce (tourner, taille, copies, poser à plat), faits à la main ou demandés à l'IA,
            // n'attendent pas l'imprimante ni la bobine : ils ne dépendent pas de la machine. Jamais sur le plateau d'une autre
            // conversation. Les autres ordres (orienter, ranger, réduire pour tenir…) restent soumis à la fiche du projet.
            const nlohmann::json list    = data.contains("commands") ? data["commands"] : nlohmann::json();
            const bool           simple  = ProjectLogic::user_plate_edit(list);
            const nlohmann::json project = data.contains("project") ? data["project"] : nlohmann::json();
            const nlohmann::json refused = !simple                       ? project_refusal(data)
                                           : ProjectFiles::edits_blocked() ? nlohmann::json{{"ok", false}, {"text", ProjectFiles::busy_text()}}
                                           : !ProjectLogic::has_part(project)
                                               ? nlohmann::json{{"ok", false}, {"text", "Pour faire ça, pose d'abord ta pièce sur le plateau."},
                                                                {"can_restore", false}, {"missing", {"part"}}}
                                               : nlohmann::json();
            if (!refused.is_null()) {
                nlohmann::json done = refused;
                done["type"]        = "commands";
                done["request"]     = Json::integer(data, "request", 0);
                send(done);
                return;
            }
            nlohmann::json done = Commands::run(data.contains("commands") ? data["commands"] : nlohmann::json());
            done["type"]        = "commands";
            done["request"]     = Json::integer(data, "request", 0);
            send(done);
        } else if (type == "open_tool") {
            nlohmann::json done = Commands::open_tool(Json::str(data, "tool"), Json::str(data, "object", 20));
            done["type"]        = "open_tool";
            send(done);
        } else if (type == "show_setting") {
            const std::string key = Json::str(data, "key");
            // Mode Simple : la barre de réglages est repliée ; on la rouvre pour montrer le réglage (la disposition choisie reste,
            // elle revient à la prochaine ouverture du panneau).
            if (Plater* plater = Slic3r::GUI::wxGetApp().plater(); plater != nullptr && plater->is_sidebar_collapsed())
                plater->collapse_sidebar(false);
            Highlight::show_setting(key, [key](const nlohmann::json& shown) {
                nlohmann::json message = shown;
                message["type"]        = "show_setting";
                message["key"]         = key;
                send(message);
            });
        } else if (type == "conv_list")
            send({{"type", "conv_list"}, {"items", Conversations::list()}});
        else if (type == "conv_load") {
            const std::string id = Json::str(data, "id");
            send({{"type", "conv_loaded"}, {"id", id}, {"conversation", Conversations::load(id)}});
        } else if (type == "conv_save") {
            // Enregistrement silencieux : le panneau n'attend pas de réponse, un échec est seulement journalisé. Un ancien
            // projet effacé pour faire de la place est dit au panneau (jamais en silence).
            // `reason` : too_big (conversation trop longue), write_failed (disque plein, dossier protégé), invalid.
            std::vector<std::string>   removed;
            const Conversations::Saved saved = Conversations::save(Json::str(data, "id"), Json::any(data, "conversation"), &removed);
            if (saved != Conversations::Saved::Ok) {
                BOOST_LOG_TRIVIAL(warning) << "Plyo: conversation non enregistrée (" << Conversations::reason(saved) << ")";
                send({{"type", "conv_save_failed"}, {"id", Json::str(data, "id")}, {"reason", Conversations::reason(saved)}});
            } else if (!removed.empty())
                send({{"type", "conv_pruned"}, {"names", removed}});
        } else if (type == "project_resume_get") {
            // Ouverture du panneau : la conversation dont le plateau est encore attaché (panneau fermé puis rouvert), avec son
            // contenu, pour qu'elle soit rouverte avant tout signal du plateau ; et la liste, pour proposer une reprise.
            // Un départ en attente (nouveau projet demandé, Orca occupé) : ce plateau n'est plus celui à rouvrir.
            const std::string    attached = ProjectFiles::detach_pending() ? std::string() : ProjectFiles::attached();
            const nlohmann::json c        = attached.empty() ? nlohmann::json() : Conversations::load(attached);
            send({{"type", "project_resume"}, {"attached", c.is_null() ? std::string() : attached}, {"conversation", c},
                  {"items", Conversations::list()}});
        } else if (type == "conv_delete") {
            ProjectFiles::forget(Json::str(data, "id")); // plus d'écriture pour elle ; son 3MF part avec elle
            Conversations::remove(Json::str(data, "id"));
            send({{"type", "conv_list"}, {"items", Conversations::list()}});
        }
        else if (type == "session_load")
            send({{"type", "session"}, {"session", Session::load()}});
        else if (type == "session_save")
            send({{"type", "session_saved"}, {"ok", Session::save(data.contains("session") ? data["session"] : nlohmann::json())}});
        else if (type == "login") {
            // Fenêtre de connexion modale centrée sur Orca ; le panneau reçoit ensuite la session (ou null).
            // Une seule fenêtre à la fois : un double-clic ne doit pas en ouvrir une seconde imbriquée.
            // Le drapeau retombe en sortant, exception comprise (ROB-18) : « Se connecter » marche encore après un échec.
            static bool s_login_open = false;
            if (!s_login_open) {
                const LifetimeLogic::FlagReset open(s_login_open);
                LoginDialog dialog(Slic3r::GUI::wxGetApp().mainframe);
                dialog.ShowModal();
            }
            if (!s_login_open)
                send({{"type", "session"}, {"session", Session::load()}});
        } else if (type == "phone") {
            // Fenêtre du QR code du lien téléphone (créé par le panneau) ; une seule à la fois.
            // Au premier envoi du téléphone elle se ferme, et le panneau va chercher l'envoi aussitôt.
            static bool s_phone_open = false;
            const nlohmann::json session = Session::load();
            const nlohmann::json link    = Json::any(data, "link");
            if (!s_phone_open && session.is_object() && link.is_object() && link.contains("id") && link["id"].is_string()) {
                int result = wxID_CANCEL;
                {
                    const LifetimeLogic::FlagReset open(s_phone_open); // retombe même si la fenêtre échoue (ROB-18)
                    PhoneDialog dialog(Slic3r::GUI::wxGetApp().mainframe, session["access_token"].get<std::string>(), link);
                    result = dialog.ShowModal();
                }
                if (result == wxID_OK)
                    send({{"type", "phone_batch_ready"}});
                else if (result == wxID_NO) // « Choisir des photos sur l'ordinateur »
                    send({{"type", "phone_pick_files"}});
            }
        } else if (type == "calib_start") {
            // Calibration guidée : lancée seulement par un bouton du panneau (« Lancer le test » d'une proposition, ou « Calibrer cette bobine »).
            nlohmann::json started = Calibration::start_test(Json::str(data, "test"), Json::integer(data, "pass", 1), Json::num(data, "base_value", 0.0));
            if (Json::boolean(started, "ok", false)) {
                started["type"]    = "calib_started";
                started["request"] = Json::integer(data, "request", 0);
                send(started);
            } else
                send_result(started, data);
        } else if (type == "calib_save") {
            send_result(Calibration::save_result(Json::str(data, "test"), Json::num(data, "value", 0.0)), data);
            send({{"type", "calib_history"}, {"items", Calibration::history_for_current()}});
        } else if (type == "calib_restore")
            send_result(Calibration::restore(), data);
        else if (type == "calib_history")
            send({{"type", "calib_history"}, {"items", Calibration::history_for_current()}});
        else if (type == "firststeps_state") {
            nlohmann::json state   = FirstSteps::state();
            state["needs_printer"] = PrinterSetup::needs_printer(); // premier lancement : l'assistant installe l'imprimante
            send({{"type", "firststeps"}, {"state", state}});
        }
        else if (type == "firststeps_set") {
            const nlohmann::json patch = Json::obj(data, "patch");
            FirstSteps::set_state(patch);
            if (patch.contains("layout")) // « Disposition simple » du menu ⋯ : appliquée tout de suite
                apply_layout(true);
            if (patch.contains("ui")) { // « Essayer le nouvel assistant » / « Revenir à l'ancien » : le panneau se rouvre sur l'autre page
                reopen_panel();
                return;
            }
            send({{"type", "firststeps"}, {"state", FirstSteps::state()}});
        } else if (type == "tour_signals") {
            nlohmann::json signals = FirstSteps::tour_signals();
            signals["type"]        = "tour_signals";
            signals["user_file"]   = !ProjectFiles::attachable(); // un fichier de l'utilisateur n'est jamais attaché à la conversation
            send(signals);
        } else if (type == "model_add") {
            // Modèle 3D joint dans le panneau (trombone ou glisser-déposer). Une nouvelle pièce posée : le plateau devient celui
            // de la conversation, avant l'adaptation des réglages d'un 3MF (qui restent ainsi dans le projet, pas dans le
            // préréglage d'impression partagé). Pièce refusée : le plateau n'est pas attaché.
            const std::string conv   = Json::str(data, "conv");
            const std::string before = ProjectFiles::attached();
            if (ProjectFiles::edits_blocked() || (!conv.empty() && ProjectFiles::attach(conv) == "occupe")) {
                // Le plateau d'avant n'est pas encore rangé (Orca découpe ou envoie) : la pièce n'est pas posée.
                send({{"type", "model_added"}, {"ok", false}, {"busy", true}, {"text", ProjectFiles::busy_text()}});
                return;
            }
            // `sample` : la pièce d'essai fournie avec l'application (« Pas encore de fichier ? »), posée de la même façon.
            const std::string    sample  = Json::str(data, "sample");
            const nlohmann::json project = data.contains("project") ? data["project"] : nlohmann::json();
            nlohmann::json added = sample.empty() ? ModelImport::add(Json::str(data, "name"), Json::str(data, "data"), project, Json::boolean(data, "replace", false))
                                                  : ModelImport::add_sample(sample, project, Json::boolean(data, "replace", false));
            if (!Json::boolean(added, "ok", false) && before.empty())
                ProjectFiles::release(conv); // rien d'écrit pour elle : le plateau n'a pas changé
            if (!sample.empty())
                added["sample"] = sample;
            added["type"]        = "model_added";
            send(added);
        } else if (type == "gallery_get") {
            // Galerie de l'étape « Ta pièce » : les modèles ajoutés dans resources/plyo/galerie (vérifiés), avec leur vignette.
            send({{"type", "gallery"}, {"items", ModelImport::gallery()}});
        } else if (type == "design_lib_get") {
            // Pièces sur mesure : manifold-3d (Apache-2.0), livrée dans resources/web/plyo/vendor/manifold et chargée par le
            // panneau à la première pièce créée (la page est chargée comme texte : elle ne peut pas lire ce fichier elle-même).
            const std::string js = read_resource("vendor/manifold/manifold.js"), wasm = read_resource("vendor/manifold/manifold.wasm");
            std::string encoded(boost::beast::detail::base64::encoded_size(wasm.size()), '\0');
            encoded.resize(boost::beast::detail::base64::encode(encoded.data(), wasm.data(), wasm.size()));
            send({{"type", "design_lib"}, {"ok", !js.empty() && !wasm.empty()}, {"js", js}, {"wasm", encoded}});
        } else if (type == "project_attach") {
            // Pièce précédente reprise, ou pièce posée autrement que par le panneau : le plateau est celui de la conversation.
            const std::string conv = Json::str(data, "conv");
            const std::string refused = ProjectFiles::attach(conv);
            if (refused == "occupe")
                send({{"type", "project_attach_refused"}, {"conv", conv}, {"text", ProjectFiles::busy_text()}});
            else if (refused.empty())
                send({{"type", "project_attached"}, {"conv", conv}});
        } else if (type == "project_detach") {
            // Autre conversation : le plateau quitté est écrit, ses réglages d'impression ne suivent pas.
            ProjectFiles::detach(true);
        } else if (type == "project_open") {
            nlohmann::json opened = ProjectFiles::open(Json::str(data, "conv"));
            opened["type"]        = "project_opened";
            opened["conv"]        = Json::str(data, "conv");
            send(opened);
            send_values();
        } else if (type == "model_adapt") {
            send({{"type", "model_adapted"}, {"adaptation", ModelImport::adapt_last(data.contains("project") ? data["project"] : nlohmann::json())}});
        } else if (type == "show_preview") {
            // Action de l'IA « show » / « preview » : l'onglet « Aperçu » d'Orca.
            nlohmann::json shown = RawTests::show_preview();
            shown["type"]        = "show_preview";
            shown["request"]     = Json::integer(data, "request", 0);
            send(shown);
        } else if (type == "open_calibration") {
            // Action de l'IA « open_calibration » (max_flow, vfa, tolerance), confirmée dans le panneau. Refus immédiat si Orca
            // est occupé ; sinon le test part après ce message (CallAfter), et la réponse vient quand sa fenêtre est fermée.
            const std::string target  = Json::str(data, "target", 20);
            const long long   request = Json::integer(data, "request", 0);
            const auto        reply   = [request](nlohmann::json done) {
                done["type"]    = "open_calibration";
                done["request"] = request;
                send(done);
            };
            if (const nlohmann::json refused = RawTests::refusal(target); !refused.is_null()) {
                nlohmann::json done = refused;
                done["target"]      = target;
                reply(done);
            } else
                RawTests::open(target, reply);
        } else if (type == "show_me") {
            const std::string target = Json::str(data, "target");
            send({{"type", "show_me"}, {"target", target}, {"ok", Json::boolean(Highlight::show(target), "ok", false)}});
        } else if (type == "explain") {
            nlohmann::json fiche = FirstSteps::explain(Json::str(data, "key"));
            fiche["type"]        = "explain";
            send(fiche);
        } else if (type == "printer_scan") {
            // Les adresses trouvées restent dans le panneau (sur l'ordinateur) : jamais envoyées au service ni à l'IA.
            const bool started = Discovery::start([](std::vector<Discovery::Printer> printers) {
                nlohmann::json list = Discovery::to_json(printers);
                for (nlohmann::json& p : list)
                    p["match"] = PrinterSetup::identify(p); // modèle du catalogue reconnu, pour « C'est la tienne ? »
                send({{"type", "printer_scan_result"}, {"printers", list}});
            });
            if (!started)
                BOOST_LOG_TRIVIAL(info) << "Plyo: recherche d'imprimantes déjà en cours";
        } else if (type == "habits_get") {
            send({{"type", "habits"}, {"habits", Habits::load()}});
        } else if (type == "habits_set") {
            Habits::save(data.contains("habits") ? data["habits"] : nlohmann::json());
        } else if (type == "project_state") {
            nlohmann::json state = Project::state();
            state["type"]        = "project_state";
            send(state);
        } else if (type == "project_printers") {
            send({{"type", "project_printers"}, {"printers", Project::printers()}});
        } else if (type == "project_reachable") {
            const std::string preset = Json::str(data, "preset");
            Project::reachable(preset, [preset](bool ok) { send({{"type", "project_reachable"}, {"preset", preset}, {"ok", ok}}); });
        } else if (type == "project_restore") {
            nlohmann::json r = Project::restore(data.contains("project") ? data["project"] : nlohmann::json(), Json::boolean(data, "discard_unsaved", false));
            r["type"]        = "project_restored";
            send(r);
            send_values();
        } else if (type == "canvas_read") {
            const std::string preset = Json::str(data, "preset");
            const bool        for_send = Json::boolean(data, "send", false);
            const long long   id       = Json::integer(data, "id", 0);
            Canvas::read(preset, [preset, for_send, id](nlohmann::json r) {
                r["type"]   = "canvas_state";
                r["preset"] = preset;
                r["send"]   = for_send;
                r["id"]     = id;
                send(r);
            });
        } else if (type == "canvas_apply") {
            nlohmann::json r = Canvas::apply(data.contains("entries") ? data["entries"] : nlohmann::json());
            r["type"]        = "canvas_applied";
            send(r);
            send_values();
        } else if (type == "colours_get") {
            // Carte « Couleurs » : les pièces de la plaque et leur couleur (lecture seule). `select` : la ligne touchée, sélectionnée
            // dans la vue 3D comme un clic (sans point d'annulation, contrairement à l'ordre « select » de l'IA).
            if (const std::string ref = Json::str(data, "select", 20); !ref.empty())
                Colours::select(ref);
            nlohmann::json r = Colours::state();
            r["type"]        = "colours";
            r["id"]          = Json::integer(data, "id", 0);
            send(r);
        } else if (type == "colour_set") {
            // Couleur d'une pièce choisie d'un clic dans la carte « Couleurs ». Jamais un ordre de l'IA : ce message n'est envoyé
            // que par ce bouton du panneau. Annulable par plate_action « undo » avec l'undo_token rendu.
            const long long token = Json::integer(data, "token", 0);
            Colours::set_colour(data, [token](nlohmann::json r) {
                r["type"]  = "colour_set";
                r["token"] = token;
                send(r);
                if (Json::boolean(r, "ok", false))
                    send_values();
            });
        } else if (type == "canvas_plan") {
            static bool hooked = false;
            if (!hooked) { // un départ avec carte refusé (envoi de Plyo ou d'Orca) est signalé au panneau
                hooked = true;
                CC2::on_orca_state(&Canvas::orca_state);
                CC2::on_refused([](const std::string& text) { // appelé par le fil d'envoi d'Orca
                    Lifetime::post("un départ refusé", [text] { send({{"type", "canvas_refused"}, {"text", text}}); });
                });
            }
            if (Json::boolean(data, "clear", false))
                Canvas::clear_plan();
            else
                Canvas::plan(Json::str(data, "preset"), data.contains("map") ? data["map"] : nlohmann::json());
        } else if (type == "slots_manual_get") {
            const std::string preset = Json::str(data, "preset");
            nlohmann::json    r      = Slots::manual_get(preset);
            r["type"]    = "slots_manual_state";
            r["preset"]  = preset;
            r["colours"] = Canvas::colours();
            send(r);
        } else if (type == "slots_manual_save") {
            const std::string preset = Json::str(data, "preset");
            nlohmann::json    r      = Slots::manual_save(preset, Json::any(data, "slots"));
            r["type"]   = "slots_manual_saved";
            r["preset"] = preset;
            send(r);
        } else if (type == "canvas_send") {
            Canvas::send_planned(Json::str(data, "preset"), [](nlohmann::json r) {
                r["type"] = "canvas_sent";
                send(r);
            });
        } else if (type == "model_learned" || type == "models_shared") {
            // Modèles appris : le choix fait ici (« local ») et la table partagée du serveur (« shared »), relus à la recherche.
            const boost::filesystem::path file  = Store::dir() / "modeles-appris.json";
            nlohmann::json                store = Store::read(file);
            if (!store.is_object())
                store = nlohmann::json::object();
            if (type == "models_shared")
                store["shared"] = Discovery::shared_from_server(data.contains("reply") ? data["reply"] : nlohmann::json());
            else if (const std::string brand = Json::str(data, "brand"), code = Json::str(data, "code"), model = Json::str(data, "model");
                     Discovery::valid_learned(brand, code, model))
                store["local"][brand][code] = model;
            Store::write(file, store);
        } else if (type == "print_watch_start") {
            PrinterStatus::watch(Json::str(data, "preset"), [id = Json::str(data, "id")](nlohmann::json w) { send_watch(w, id); });
        } else if (type == "print_watch_replay") {
            // Conversation rouverte : la fin de son envoi, si le suivi l'a lue pendant qu'elle n'était pas affichée.
            if (const auto it = s_watch_ends.find(Json::str(data, "id")); it != s_watch_ends.end())
                send(it->second);
        } else if (type == "canvas_start_plain") {
            Canvas::start_plain(Json::str(data, "preset"), [](nlohmann::json r) {
                r["type"] = "canvas_started";
                send(r);
            });
        } else if (type == "printer_link_check") {
            nlohmann::json state = PrinterLink::check(data.contains("printer") ? data["printer"] : nlohmann::json());
            state["type"]        = "printer_link_state";
            send(state);
        } else if (type == "printer_select_profile") {
            nlohmann::json r = PrinterLink::select_profile(Json::str(data, "name"));
            r["type"]        = "printer_profile_selected";
            send(r);
        } else if (type == "printer_link_test") {
            PrinterLink::test(data.contains("printer") ? data["printer"] : nlohmann::json(), Json::str(data, "access_code"), [](nlohmann::json r) {
                r["type"] = "printer_link_tested";
                send(r);
            });
        } else if (type == "printer_link_save") {
            nlohmann::json r = PrinterLink::save(data.contains("printer") ? data["printer"] : nlohmann::json(), Json::str(data, "webui"), Json::str(data, "access_code"));
            r["type"]        = "printer_link_saved";
            send(r);
        } else if (type == "printer_link_dialog") {
            nlohmann::json r = PrinterLink::open_dialog(data.contains("printer") ? data["printer"] : nlohmann::json());
            r["type"]        = "printer_link_dialog_closed";
            send(r);
        } else if (type == "spools_get") {
            send({{"type", "spools"}, {"items", Spools::list(Json::str(data, "printer"))}});
        } else if (type == "brands_get") {
            // « De quelle marque est ta bobine ? » : profils fournis de marque pour cette matière, sur l'imprimante en cours
            // seulement (le profil de départ d'une bobine est toujours pris pour elle). Lecture seule.
            const std::string material = Json::str(data, "material", 30), printer = Json::str(data, "printer", 200);
            const bool        current  = Brands::is_current_printer(printer);
            send({{"type", "brands"}, {"material", material}, {"printer", printer}, {"ok", current},
                  {"brands", current ? Brands::groups(material) : nlohmann::json::array()}});
        } else if (type == "slot_brands_get") {
            // Emplacements lus (CFS, Canvas…) : pour chacun, les marques de sa matière et ce que son annonce (marque, nom)
            // rapproche exactement d'un profil fourni. Reste dans le slicer et le panneau : rien n'en part au service.
            nlohmann::json items = nlohmann::json::array();
            std::map<std::string, nlohmann::json> by_type;
            const nlohmann::json slots = Brands::is_current_printer(Json::str(data, "printer", 200)) ? Json::arr(data, "slots") : nlohmann::json::array();
            for (const nlohmann::json& s : slots) {
                if (items.size() >= 32)
                    break;
                const std::string slot_type = Json::str(s, "type", 30);
                if (by_type.find(slot_type) == by_type.end())
                    by_type[slot_type] = Brands::for_type(slot_type);
                const nlohmann::json& found = by_type[slot_type];
                items.push_back({{"key", Json::str(s, "key", 20)},
                                 {"material", found["material"]},
                                 {"brands", found["brands"]},
                                 {"match", BrandsLogic::match(found["brands"], Json::str(s, "brand", 60), Json::str(s, "name", 60))}});
            }
            send({{"type", "slot_brands"}, {"printer", Json::str(data, "printer", 200)}, {"id", Json::integer(data, "id", 0)}, {"items", items}});
        } else if (type == "spool_choose") {
            if (ProjectFiles::edits_blocked()) { // le plateau est encore celui d'une autre conversation
                send({{"type", "spool_chosen"}, {"ok", false}, {"text", ProjectFiles::busy_text()}});
                return;
            }
            // Bobine nommée : son préréglage pour cette machine est choisi, ou créé depuis le profil de la matière de cette machine.
            // Marque choisie dans le panneau (geste de l'utilisateur) : profil de départ vérifié par Spools, marque et gamme gardées.
            nlohmann::json r = Spools::create_or_choose(Json::str(data, "name"), Json::str(data, "material"), Json::str(data, "printer"),
                                                        Json::str(data, "brand_preset", 200), Json::str(data, "brand", 200),
                                                        Json::str(data, "range", 200));
            r["type"]        = "spool_chosen";
            if (Json::boolean(r, "ok", false)) {
                // Ce qui a marché avec cette bobine dans l'onglet Impression (débit de première couche, vitesses…) est remis
                // dans ce projet sans question : le panneau le dit, avec « Annuler ».
                r["print_restored"] = Profiles::restore_spool_print();
                // Couleur choisie dans le panneau pour une nouvelle bobine : donnée au filament 1 de la plaque, notée sur la bobine.
                if (const std::string colour = SpoolsLogic::clean_colour(Json::str(data, "colour", 16)); !colour.empty()) {
                    Canvas::set_project_colour(0, colour);
                    Spools::note_colour(Json::str(r, "id"));
                }
                // Bobine déjà connue sans couleur notée (d'avant cette version) : celle de la plaque, corrigée à chaque envoi.
                if (!Json::boolean(r, "created", false))
                    Spools::note_colour(Json::str(r, "id"), true);
                // Dernière version réussie de cette bobine sur cette machine, et ce qui en diffère aujourd'hui (phrase de reprise).
                r["success"] = Spools::success_for(Json::str(r, "id"), Json::str(r, "printer"));
            }
            send(r);
            send_values();
        } else if (type == "spool_adopt_check") {
            // Préréglage de l'utilisateur choisi dans Orca : le panneau propose une fois d'en faire une bobine.
            nlohmann::json r = Spools::adopt_offer(Json::str(data, "preset"));
            r["type"]        = "spool_adopt_offer";
            send(r);
        } else if (type == "spool_about_current") {
            // Carte « Orca est passé sur … » du filament (UX-35) : ce filament est-il une bobine, ou peut-il le devenir ?
            nlohmann::json r = Spools::about_current();
            r["type"]        = "spool_current";
            send(r);
        } else if (type == "retouches_get") {
            // UX-31 : retouches de l'onglet Impression laissées avec le projet d'avant, en attente de ta réponse.
            send({{"type", "print_retouches"}, {"pending", Retouches::print_pending()}});
        } else if (type == "retouches_keep" || type == "retouches_undo") {
            nlohmann::json r;
            if (ProjectFiles::edits_blocked())
                r = {{"ok", false}, {"text", ProjectFiles::busy_text()}};
            else
                r = type == "retouches_keep" ? Retouches::keep_print() : Retouches::undo_keep_print();
            r["type"] = type == "retouches_keep" ? "print_retouches_kept" : "print_retouches_undone";
            send(r);
            send_values();
        } else if (type == "retouches_dismiss") {
            Retouches::dismiss_print();
        } else if (type == "spool_kept_undo") {
            // UX-32 : « Annuler » de la note « Gardé dans ta bobine ».
            nlohmann::json r = ProjectFiles::edits_blocked() ? nlohmann::json{{"ok", false}, {"text", ProjectFiles::busy_text()}}
                                                             : Retouches::undo_spool(static_cast<int>(Json::integer(data, "token", 0)));
            r["type"]  = "spool_kept_undone";
            r["token"] = Json::integer(data, "token", 0);
            send(r);
            send_values();
        } else if (type == "file_filament_get") {
            // UX-36 : valeurs du filament d'un fichier ouvert, non reprises (une fois).
            send({{"type", "file_filament"}, {"info", Retouches::file_filament()}});
        } else if (type == "file_filament_take") {
            nlohmann::json r = ProjectFiles::edits_blocked() ? nlohmann::json{{"ok", false}, {"text", ProjectFiles::busy_text()}}
                                                             : Retouches::take_file_filament();
            r["type"] = "file_filament_taken";
            send(r);
            send_values();
        } else if (type == "spool_adopt") {
            nlohmann::json r = Spools::adopt(Json::str(data, "preset"), Json::str(data, "name"));
            r["type"]        = "spool_adopted";
            send(r);
        } else if (type == "print_start") {
            if (Json::boolean(data, "export", false))
                // La réponse ne part qu'à la fin réelle de l'export ; la fenêtre d'enregistrement s'ouvre dans cet appel, comme celle de connexion.
                FirstSteps::export_file([](nlohmann::json r) {
                    // Le fichier est écrit : ses réglages de bobine sont ceux à retenir si l'impression réussit.
                    if (Json::boolean(r, "ok", false))
                        Profiles::note_sent();
                    r["type"]   = "print_started";
                    r["export"] = true;
                    send(r);
                });
            else
                // La réponse ne part qu'une fois Orca décidé : sa fenêtre d'envoi fermée (et ses messages ouverts), comme l'export.
                FirstSteps::start_print([preset = Json::str(data, "preset"), watch_id = Json::str(data, "watch_id")](nlohmann::json r) {
                    // Pris par Orca (sa file d'envoi) : ces réglages de bobine sont ceux à retenir si l'impression réussit. Fenêtre
                    // du module Bambu Lab : on ne sait pas si l'envoi part, la bobine est notée quand tu dis qu'elle imprime.
                    const bool taken = Json::boolean(r, "ok", false) && Json::str(r, "route") == "host";
                    if (taken)
                        Profiles::note_sent();
                    r["type"] = "print_started";
                    send(r);
                    // Le démarrage est vérifié sur l'imprimante elle-même (état avant l'envoi, puis relu jusqu'au verdict).
                    if (Json::boolean(r, "ok", false) && !preset.empty())
                        PrinterStatus::watch(preset, [id = watch_id](nlohmann::json w) { send_watch(w, id); });
                });
        } else if (type == "print_declared") {
            // « L'impression a démarré » après la fenêtre du module Bambu Lab : c'est toi qui le dis, la bobine est notée ici.
            Profiles::note_sent();
        } else if (type == "printer_link_recheck") {
            // « Vérifier la liaison de mon imprimante » après un envoi en échec : la connexion enregistrée, testée telle quelle.
            PrinterLink::recheck([](nlohmann::json r) {
                r["type"] = "printer_link_rechecked";
                send(r);
            });
        } else if (type == "printer_link_dialog_current") {
            // Fenêtre « Connexion » d'Orca pour l'imprimante en cours (code d'accès ou clé d'API à corriger).
            nlohmann::json r = PrinterLink::open_dialog_current();
            r["type"]        = "printer_link_current_closed";
            send(r);
        } else if (type == "setup_catalog") {
            send({{"type", "setup_catalog"}, {"catalog", PrinterSetup::catalog()}});
        } else if (type == "setup_install") {
            nlohmann::json r = PrinterSetup::install(Json::str(data, "vendor"), Json::str(data, "model"), Json::str(data, "nozzle"));
            r["type"]        = "setup_installed";
            send(r);
            send_values();
        } else if (type == "bed_type_set") {
            // Type de plateau choisi d'un clic dans le panneau (question de l'étape Machine, « Changer » de la fiche). Jamais un
            // ordre de l'IA : ce message n'est envoyé que par ces boutons, et ni Commands, ni apply, ni le catalogue n'y mènent.
            nlohmann::json r = ProjectFiles::edits_blocked() ? nlohmann::json{{"ok", false}, {"text", ProjectFiles::busy_text()}}
                                                             : SettingsBridge::set_bed_type(Json::str(data, "value", 40), Json::str(data, "printer", 200));
            r["type"]        = "bed_type_set";
            r["token"]       = Json::integer(data, "token", 0);
            send(r);
            send_values();
        } else if (type == "printer_wizard") {
            PrinterLink::open_printer_wizard();
        } else if (type == "session_clear") {
            Session::clear();
            send({{"type", "session"}, {"session", nullptr}});
        }
        else if (SelfTest::handle(type, data, send)) {
            // message du banc d'essai : accepté seulement quand PLYO_SELFTEST est actif (sinon handle rend false)
        } else
            BOOST_LOG_TRIVIAL(warning) << "Plyo: message inconnu reçu du panneau : " << data.dump();
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: erreur en traitant « " << type << " » : " << e.what();
        // Type distinct de « result » : seule la demande qui porte ce `request` peut s'en servir, jamais une fiche sans rapport.
        send({{"type", "error"}, {"request", Json::integer(data, "request", 0)}, {"for", type}, {"ok", false},
              {"text", "Quelque chose s'est mal passé de mon côté. Réessaie ; si ça recommence, redémarre Plyo."}});
    }
    // Les valeurs affichées sont rafraîchies par on_config_changed() après une modification.
}

// Appelé pendant le callback de message de la vue web : on ne touche pas à l'interface ici
// (règle Orca/wxWidgets), on reporte le traitement. CallAfter sur le panneau : si le panneau
// est détruit d'ici là, l'appel en attente est abandonné avec lui.
void on_page_message(const nlohmann::json& data)
{
    if (s_panel)
        s_panel->CallAfter([data]() { guarded("un message du panneau", [&] { handle_page_message(data); }); });
}

} // namespace

void toggle_assistant(Plater* plater)
{
    if (s_panel) {
        s_panel->request_close();
        return;
    }
    if (plater == nullptr)
        return;

    ProjectFiles::set_listener([](const nlohmann::json& message) { send(message); });
    Retouches::set_listener([](const nlohmann::json& message) { send(message); }); // retouches gardées dans la bobine (lot 11)
    OrcaMessages::set_listener([](const nlohmann::json& message) { send(message); }); // fin de chaque découpe (slice_result)
    Send::set_listener([](const nlohmann::json& message) { send(message); });        // envoi suivi dans la file d'Orca (lot 10)
    OrcaWindows::set_listener([](const nlohmann::json& message) { send(message); }); // fenêtres de message d'Orca (lot 10)
    Send::attach();
    FirstSteps::set_focus_listener([](const nlohmann::json& focus) {
        nlohmann::json message = focus;
        message["type"]        = "focus_setting";
        send(message);
    });
    auto* panel = new DockPanel(plater, load_page(), on_page_message, [] {}, [] {
        // Panneau détruit (fermé par sa croix ou par le bouton) : le plan d'envoi n'a plus personne pour le montrer ou le
        // retirer (le panneau le renvoie à sa réouverture) ; le bouton du haut repasse à « fermé ».
        Canvas::clear_plan();
        AutoSave::stop();
        OrcaWindows::stop();
        // Fermeture d'Orca : la minuterie part avec lui. Sinon le plateau reste attaché (derniers changements écrits) ;
        // le panneau rouvert, qui commence une conversation neuve, le détache.
        if (Slic3r::GUI::wxGetApp().is_closing())
            ProjectFiles::stop();
        else {
            ProjectFiles::panel_closed();
            // Mode Simple : sans le panneau, la barre de réglages d'Orca revient (rien ne reste caché sans assistant).
            if (Plater* plater = Slic3r::GUI::wxGetApp().plater(); plater != nullptr && layout_simple() && plater->is_sidebar_collapsed())
                plater->collapse_sidebar(false);
        }
        if (s_topbar_button)
            s_topbar_button->CallAfter([] { refresh_topbar_button(); });
        if (s_reopen) {
            s_reopen = false;
            if (!Slic3r::GUI::wxGetApp().is_closing())
                Slic3r::GUI::wxGetApp().CallAfter([] {
                    if (!s_panel)
                        toggle_assistant(Slic3r::GUI::wxGetApp().plater());
                });
        }
    });
    guard_navigation(panel);
    s_panel           = panel;
    s_refresh_pending = false; // un rafraîchissement en attente meurt avec l'ancien panneau
    AutoSave::start();         // le préréglage de la bobine s'enregistre tout seul tant que le panneau est là
    OrcaWindows::start();      // les fenêtres de message d'Orca sont vues tant que le panneau est là
    plater->add_dock_pane(panel, PANE_NAME, "Assistant Plyo", "right", wxSize(380, 600), [panel]() { panel->fire_close(); });
    // La disposition enregistrée par Orca peut garder une largeur minuscule (18 px vu) : le panneau serait
    // à peine visible. On lui impose une largeur minimale, et sa largeur normale si la sienne est trop petite.
    if (wxAuiManager* aui = wxAuiManager::GetManager(panel)) {
        wxAuiPaneInfo& pane  = aui->GetPane(panel);
        const int      min_w = panel->FromDIP(320);
        if (pane.IsOk()) {
            pane.MinSize(wxSize(min_w, -1));
            if (pane.best_size.x < panel->FromDIP(360))
                pane.BestSize(wxSize(panel->FromDIP(380), pane.best_size.y));
            aui->Update();
        }
    }
    apply_layout(false); // mode Simple : barre d'Orca repliée, panneau élargi
    refresh_topbar_button();
}

bool is_assistant_shown() { return s_panel; }

wxWindow* create_topbar_button(wxWindow* parent)
{
    auto* holder = new wxPanel(parent, wxID_ANY);
    holder->SetBackgroundColour(StateColor::darkModeColorFor(wxColour("#3B4446")));
    auto* button = new SideButton(holder, "Assistant", "");
    button->SetLayoutStyle(1); // pilule arrondie des deux côtés (le style par défaut est collé à une flèche « ˅ »)
    button->SetTextLayout(SideButton::EHorizontalOrientation::HO_Center, holder->FromDIP(15));
    button->SetCornerRadius(holder->FromDIP(12));
    button->SetExtraSize(wxSize(holder->FromDIP(38), holder->FromDIP(10)));
    button->SetMinSize(wxSize(-1, holder->FromDIP(24)));
    button->SetToolTip("Ouvrir ou fermer l'assistant Plyo");
    button->Bind(wxEVT_BUTTON, [](wxCommandEvent&) {
        // Le panneau vit dans le plateau : depuis un autre onglet, on revient d'abord sur « Préparer ».
        auto* frame = Slic3r::GUI::wxGetApp().mainframe;
        if (!s_panel && frame != nullptr && !frame->is_prepare_or_preview_tab())
            frame->select_tab(TAB_ID_PREPARE);
        toggle_assistant(Slic3r::GUI::wxGetApp().plater());
    });
    auto* sizer = new wxBoxSizer(wxHORIZONTAL);
    sizer->Add(button, 0, wxALIGN_CENTER_VERTICAL);
    holder->SetSizer(sizer);
    s_topbar_button = button;
    refresh_topbar_button();
    return holder;
}

void add_topbar_button(wxSizer* sizer, MainFrame* frame)
{
    // Les deux lignes d'avant dans MainFrame::create_side_tools : le bouton, puis 15 px avant « Découper ».
    sizer->Add(create_topbar_button(frame), 0, wxALIGN_CENTER_VERTICAL);
    sizer->Add(frame->FromDIP(15), 0, 0, 0, 0);
}

void append_view_menu_item(wxMenu* view_menu, MainFrame* frame)
{
    // Même entrée qu'avant dans MainFrame : texte, aide, coche et activation inchangés.
    s_view_menu_item = append_menu_check_item(
        view_menu, wxID_ANY, "Assistant Plyo", "Afficher ou masquer le panneau Assistant Plyo",
        [frame](wxCommandEvent&) { toggle_assistant(frame->plater()); }, frame,
        [frame]() { return frame->is_prepare_or_preview_tab(); }, []() { return is_assistant_shown(); }, frame);
}

wxMenuItem* view_menu_item() { return s_view_menu_item; }

int project_change_count() { return s_project_changes; }

void on_project_changed()
{
    ++s_project_changes;
    CC2::clear_refused(); // « Démarrer sans carte » lancerait le fichier de la pièce d'avant
    ProjectFiles::on_project_changed(s_project_pauses > 0); // projet de l'utilisateur : plus celui de la conversation
    if (s_project_pauses > 0)
        return; // calibration : la pièce reviendra, le panneau garde sa conversation et son plan d'envoi
    Canvas::clear_plan(); // la carte des emplacements visait la pièce d'avant
    send({{"type", "project_changed"}});
    // Nouveau projet ou projet ouvert : l'assistant revient à l'écran s'il avait été fermé (une fois Orca libre).
    if (!s_panel && !Slic3r::GUI::wxGetApp().is_closing())
        Slic3r::GUI::wxGetApp().CallAfter([] { FirstSteps::open_panel(); });
}

ProjectNotificationsPause::ProjectNotificationsPause() { ++s_project_pauses; }
ProjectNotificationsPause::~ProjectNotificationsPause() { --s_project_pauses; }

void on_config_changed()
{
    AutoSave::note_change(); // le délai de calme de l'enregistrement automatique repart de zéro
    ProjectFiles::note_change(); // le projet de la conversation a changé
    refresh_values();
}

void refresh_values()
{
    // Orca peut appeler ceci plusieurs fois de suite (MainFrame::on_config_changed passe aussi par
    // Plater::on_config_change) : on regroupe en un seul envoi.
    if (!s_panel || s_refresh_pending)
        return;
    s_refresh_pending = true;
    s_panel->CallAfter([]() {
        s_refresh_pending = false;
        guarded("la lecture des réglages", [] { send_values(); });
    });
}

} // namespace Plyo
