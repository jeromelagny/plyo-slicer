#pragma once

// Seul en-tête de Plyo inclus par le code d'OrcaSlicer (une ligne `#include "plyo/PlyoHooks.hpp" // PLYO:` par fichier).
// Il déclare exactement les fonctions de Plyo appelées depuis Orca, avec des types simples : rien de nlohmann, de boost ni
// de wx en dehors de déclarations anticipées. Retoucher un module de Plyo ne recompile donc pas Plater.cpp ni GUI_App.cpp.
// Les définitions restent dans leurs modules (le nom du module est celui de l'espace de noms) ; chaque module inclut cet
// en-tête au lieu de redéclarer ces fonctions. Points d'appel dans Orca : docs/plyo/FICHIERS-MODIFIES.md.

#include <string>

class wxMenu;
class wxSizer;
class wxString;

namespace Slic3r {
struct PrintHostUpload;
class SlicingProcessCompletedEvent;
namespace GUI {
class MainFrame;
} // namespace GUI
} // namespace Slic3r

namespace Plyo {

// --- MainFrame.cpp ---

// Bouton « Assistant » de la barre du haut et l'espace qui le sépare de « Découper » (MainFrame::create_side_tools,
// juste avant le bloc « Découper »). Le bouton ouvre ou ferme le panneau (PlyoAssistant.cpp).
void add_topbar_button(wxSizer* sizer, Slic3r::GUI::MainFrame* frame);

// Entrée cochable « Assistant Plyo » du menu Affichage (après « Reset Window Layout ») : ouvre ou ferme le panneau, active
// seulement dans Préparer et Aperçu, cochée tant que le panneau est ouvert (PlyoAssistant.cpp).
void append_view_menu_item(wxMenu* view_menu, Slic3r::GUI::MainFrame* frame);

// Fin de MainFrame::on_config_changed (changement fait dans un onglet de réglages, y compris par Plyo) : le changement est
// compté (enregistrement automatique de la bobine, projet de la conversation) et les valeurs du panneau sont rafraîchies.
void on_config_changed();

// --- Plater.cpp ---

// Début de Plater::on_config_change, par où passent aussi les changements faits hors des onglets (type de plateau, listes
// de préréglages de la barre latérale, couleur d'un filament) : rafraîchit seulement les valeurs affichées dans le panneau
// (un seul envoi pour une rafale d'appels). Rien n'est compté, donc rien n'est écrit (projet, bobine).
void refresh_values();

// Fin de Plater::new_project et de Plater::load_project : le panneau revient à son accueil.
void on_project_changed();

namespace FirstSteps {
// Fin du constructeur de MainFrame : accueil du premier lancement, ouverture du panneau.
void on_startup();
// Plater::priv::on_process_completed, juste avant `background_process.reset_export()` : si un export était en cours
// (`export_scheduled`), le panneau apprend sa fin réelle (fichier écrit, ou erreur).
void on_process_completed(const Slic3r::SlicingProcessCompletedEvent& evt, bool export_scheduled, const std::string& output_path);
} // namespace FirstSteps

namespace OrcaMessages {
// Plater::priv::on_process_completed, avant le crochet d'export : fin de chaque découpe (lecture seule).
void on_slicing_done(const Slic3r::SlicingProcessCompletedEvent& evt);
} // namespace OrcaMessages

namespace ProjectFiles {
// Plater::close_with_confirm : vrai si le plateau est celui d'une conversation et que son 3MF vient d'être écrit (ou n'a
// pas changé). Faux pendant une découpe, un envoi, une calibration, une fenêtre, pour un fichier de l'utilisateur, ou si
// l'écriture échoue : Orca pose alors sa question comme avant.
bool keeps_project();
// GUI_App::check_and_save/keep_current_preset_changes, `caption` : le titre de la question d'Orca. Seulement pour la
// fermeture, un nouveau projet ou l'ouverture d'un projet (ProjectFilesLogic::project_question), si keeps_project() et que
// l'imprimante n'est pas modifiée : écrit le filament en attente dans sa bobine, écrit le 3MF s'il a changé, oublie les
// modifications d'impression et de filament, et renvoie vrai : Orca n'a rien à demander. Sinon faux, et Orca demande comme
// avant (mise à jour des profils, assistants, déconnexion, export, instantanés : jamais rien de jeté).
bool take_preset_changes(const wxString& caption);
} // namespace ProjectFiles

namespace Canvas {
// Plater::send_gcode_legacy, devant le bloc qui ouvre la fenêtre d'envoi : si le panneau a armé un envoi (répartition des
// emplacements vérifiée, voir PlyoCanvas.hpp), remplit `upload` comme la fenêtre l'aurait fait (nom du fichier, démarrage,
// répartition, numéro de plaque pour un .gcode.3mf) et renvoie vrai : la fenêtre n'est pas ouverte. Sinon faux, rien
// n'est touché. `file_name` : default_output_file.filename() ; `plate_idx` : la plaque résolue (base 0).
bool fill_armed_upload(Slic3r::PrintHostUpload& upload, const std::string& file_name, bool use_3mf, int plate_idx);
} // namespace Canvas

// --- Utils/ElegooLink.cpp ---

namespace Send {
void on_upload_handed();
} // namespace Send

namespace CC2 {
// ElegooLink::loopUploadCC2, après l'envoi : démarre l'impression sur une Elegoo Centauri Carbon 2 (canal MQTT local).
// `host` : adresse de l'imprimante (IP ou nom) ; `serial` : son numéro de série ; `filename` : nom du fichier envoyé.
// Bloque jusqu'à la réponse de l'imprimante (90 s au plus). Vrai si elle a démarré ; sinon `error` dit pourquoi, en
// français. Le code d'accès n'est jamais écrit dans les journaux.
bool start_print(const std::string& host, const std::string& access_code, const std::string& serial, const std::string& filename,
                 std::string& error);
} // namespace CC2

// --- Utils/CrealityPrint.cpp ---

namespace PrinterStatus {
// CrealityPrint::start_print : dossier du fichier `filename` dans la réponse `retGcodeFileInfo` d'une Creality
// (« dossier:nom:taille:…;… »). Vide si le fichier n'y est pas ou si le dossier n'est pas un chemin absolu propre.
std::string creality_file_dir(const std::string& reply, const std::string& filename);
} // namespace PrinterStatus

} // namespace Plyo
