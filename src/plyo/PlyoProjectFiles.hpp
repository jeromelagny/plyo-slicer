#pragma once

#include <boost/filesystem/path.hpp>
#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Un projet 3MF par conversation : datadir/plyo/projets/<conv>.3mf (logique pure dans PlyoProjectFilesLogic.hpp).
// Le plateau (pièces, positions) et les réglages d'impression de la conversation y sont écrits tout seuls, par l'export
// 3MF d'Orca, après 3 s sans changement et seulement quand Orca ne découpe pas et n'envoie pas. Rouvrir la conversation
// rouvre ce projet sans aucune fenêtre ; le filament vient alors du préréglage de la bobine de la fiche, qui fait foi.
// Ce fichier n'est jamais celui de l'utilisateur : le projet reste « Sans titre », Ctrl+S demande où enregistrer.
namespace Plyo { namespace ProjectFiles {

// Chemin du projet d'une conversation (identifiant déjà validé par Conversations::valid_id).
boost::filesystem::path path_of(const std::string& conv);

// Le plateau appartient désormais à cette conversation (nouvelle pièce posée, pièce précédente reprise) : la minuterie
// d'1 s compare l'empreinte et écrit le 3MF au repos. Un plateau attaché à une autre conversation est d'abord écrit.
// Refusé pour un fichier de l'utilisateur (attachable()).
void attach(const std::string& conv);

// Le plateau n'appartient plus à la conversation (changement de conversation dans le panneau) : ses changements en
// attente sont écrits, puis, si `forget_print_edits`, les réglages d'impression modifiés sont oubliés (ils sont dans le
// 3MF) pour ne pas suivre la pièce suivante. Si Orca est occupé, le plateau reste attaché avec ses réglages, et le départ
// se fait à la première écriture réussie.
void detach(bool forget_print_edits);

// Pièce refusée juste après attach(conv) (fichier illisible) : le plateau n'est pas celui de cette conversation, rien
// n'est écrit pour elle.
void release(const std::string& conv);

// Conversation effacée : plus d'écriture pour elle, et son 3MF disparaît.
void forget(const std::string& conv);

// Conversation attachée ("" : aucune).
std::string attached();

// Les réglages d'impression modifiés en cours sont ceux d'un plateau de conversation (attaché, ou trop lourd pour être
// gardé) : ils restent modifiés, jamais enregistrés dans le préréglage d'impression partagé.
bool owns_print_edits();

// Le plateau peut-il être celui d'une conversation ? Faux pour un fichier de l'utilisateur (projet nommé, ou fichier
// chargé par lui jusqu'au prochain nouveau projet).
bool attachable();

// Écrit le 3MF de la conversation attachée s'il a changé (jamais quand Orca est occupé). Vrai si un plateau est attaché
// et que son 3MF est à jour.
bool flush();

// Rouvre le projet de la conversation, sans fenêtre : {ok, reason} (reason : "" | "absent" | "abime" | "trop_gros" |
// "occupe" pendant une calibration | "annule" si l'utilisateur a gardé son propre projet non enregistré).
// Le projet attaché avant est d'abord écrit. En cas de succès, la conversation est attachée.
nlohmann::json open(const std::string& conv);

// Un projet de conversation est en cours d'ouverture (l'enregistrement automatique de la bobine attend).
bool opening();

// Retouche Orca (PLYO:, Plater::close_with_confirm) : vrai si le plateau est celui d'une conversation et que son 3MF
// vient d'être écrit (ou n'a pas changé). Faux pendant une découpe, un envoi, une calibration, une fenêtre, pour un
// fichier de l'utilisateur, ou si l'écriture échoue : Orca pose alors sa question comme avant.
bool keeps_project();

// Retouche Orca (PLYO:, GUI_App::check_and_save/keep_current_preset_changes) : si keeps_project() et que l'imprimante
// n'est pas modifiée, écrit le filament en attente dans sa bobine, écrit le 3MF s'il a changé, oublie les modifications
// d'impression et de filament, et renvoie vrai : Orca n'a rien à demander. Sinon faux, et Orca demande comme avant.
bool take_preset_changes();

// Appelé par Plyo::on_project_changed() (nouveau projet, projet chargé). `paused` : c'est Plyo qui recharge (calibration,
// réouverture d'une conversation) ; sinon c'est l'utilisateur, et le plateau n'est plus celui de la conversation.
void on_project_changed(bool paused);

// Un réglage a changé (Plyo::on_config_changed) : l'empreinte change.
void note_change();

// Messages au panneau : {type: "project_file", conv, kept: false} quand le plateau est trop lourd pour être gardé ;
// {type: "project_detached", conv, same_printer} quand Orca a vidé les réglages de la pièce sans changer de projet.
void set_listener(std::function<void(const nlohmann::json&)> listener);

// Panneau fermé : le plateau reste attaché (le panneau rouvert, qui commence une conversation neuve, le détache), ses
// derniers changements sont écrits si Orca est libre.
void panel_closed();

// Fermeture d'Orca : la minuterie est détruite.
void stop();

}} // namespace Plyo::ProjectFiles
