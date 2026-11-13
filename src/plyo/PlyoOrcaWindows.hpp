#pragma once

#include <nlohmann/json.hpp>

#include <chrono>
#include <functional>
#include <optional>
#include <string>

// Fenêtres de message d'Orca (erreur, avertissement, question) vues par l'assistant, sans rien changer dans Orca : un
// observateur relève, tant que le panneau est ouvert, l'ouverture et la fermeture de la fenêtre modale du dessus quand c'est
// une fenêtre de message (ErrorDialog, WarningDialog, MessageDialog, RichMessageDialog, InfoDialog), et lit son titre et son
// texte. Toutes les autres fenêtres (réglages, fichiers, connexion, envoi, module Bambu) ne sont jamais lues, et aucune
// n'est touchée. Le texte, nettoyé (chemins, adresses du réseau), ne sert qu'à l'affichage et à l'explication par l'IA,
// jamais à décider d'un comportement. Fil de l'interface seulement.
namespace Plyo { namespace OrcaWindows {

using Clock = std::chrono::steady_clock;

// Qui prévient le panneau : {type: "orca_dialog", phase: "open" | "closed", id, kind: error | warning | question | info,
// title, text, during (send, model_add ou ""), covered (source qui l'explique déjà, ou "")}.
void set_listener(std::function<void(const nlohmann::json&)> listener);

// Observateur actif avec le panneau.
void start();
void stop();

// Relève tout de suite (sans attendre le prochain tic).
void poll_now();

// Fenêtre de message vue par l'observateur.
struct Seen
{
    int               id = 0;
    std::string       kind;   // error | warning | question | info
    std::string       title;  // nettoyé
    std::string       text;   // nettoyé
    std::string       during; // action du panneau en cours à son ouverture
    std::string       covered;
    bool              open = true;
    Clock::time_point at   = Clock::now();
};

// Action du panneau en cours (« send », « model_add ») : les fenêtres vues pendant ce temps portent son nom, et l'on sait si
// la fenêtre d'envoi d'Orca s'est montrée.
class Scope
{
public:
    explicit Scope(const char* during);
    ~Scope();
    Scope(const Scope&)            = delete;
    Scope& operator=(const Scope&) = delete;
    bool send_dialog_seen() const;

private:
    std::string m_previous;
    bool        m_previous_send_seen;
};

// Les fenêtres qui s'ouvrent dans les `ms` millisecondes portent `during` (Orca ouvre ses fenêtres d'erreur par CallAfter,
// après la fin de l'action).
void expect(const std::string& during, int ms);

// La prochaine fenêtre d'erreur qui s'ouvre dans les `ms` millisecondes est déjà expliquée par le panneau (`source` :
// upload_error, slice_result, export) : pas de carte en double.
void cover(const std::string& source, int ms);
// Même chose pour une fenêtre déjà vue.
void cover_seen(int id, const std::string& source);

// Dernière fenêtre d'erreur ouverte depuis `since` (relevé fait tout de suite).
std::optional<Seen> error_since(Clock::time_point since);

// Fenêtres d'erreur et d'avertissement récentes (15 min, trois au plus) qu'aucune autre source n'explique, au format des
// problèmes d'Orca pour l'IA : {source: "dialog", code: "error_dialog[:during]", level, text}.
nlohmann::json recent_issues();

// Banc d'essai (PlyoSelfTest) : fenêtres de premier niveau montrées {title, main, modal, kind, class}, et fenêtres de
// message vues.
nlohmann::json windows();
nlohmann::json history();

// Banc d'essai : genre de la fenêtre modale du dessus (« message », « send », « dialog ») ou "" ; et sa fermeture comme par
// un clic sur « valider » (`answer` = ok : Oui, sinon OK, ou « Envoyer » de la fenêtre d'envoi) ou « annuler » (Annuler,
// sinon Non). {ok, kind, title, button}.
std::string top_modal_kind();
nlohmann::json answer_top_modal(const std::string& answer);

}} // namespace Plyo::OrcaWindows
