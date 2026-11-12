# Fichiers d'OrcaSlicer modifiés par Plyo

Plyo Slicer est une version modifiée d'OrcaSlicer (licence AGPL-3.0). Cette page liste chaque modification apportée aux
fichiers d'OrcaSlicer, ce qu'elle fait, pourquoi, et comment la remettre en place après une mise à jour d'Orca. Tout le
code propre à Plyo vit à part (voir « Fichiers ajoutés ») ; dans les fichiers d'Orca il ne reste que des appels courts.

## Mettre à jour Orca (merge) : marche à suivre

1. **Fusionner** la branche d'Orca : `git fetch upstream && git merge upstream/main`.
2. **Résoudre les conflits** avec le tableau ci-dessous : pour chaque point de contact, la colonne « Après un merge » donne
   le geste exact. Accepter la version d'Orca, puis remettre la ligne Plyo. Retrouver tous les points de contact :
   `git grep -n "PLYO" -- . ':!src/plyo' ':!resources/web/plyo' ':!resources/plyo' ':!docs'`.
3. **Lancer les tests C++ de Plyo** : `bash src/plyo/tests/cpp/run.sh`. Les tests « sentinelles » (nom en « Lot 9 ·
   sentinelle » et « Règles d'Orca ») lisent les sources d'Orca dont Plyo dépend sans les modifier ; un échec dit ce
   qu'Orca a changé et quelle fonction de Plyo reprendre.
4. **Régénérer le catalogue des réglages** : `python3 -I src/plyo/catalog/generate_catalog.py` (réécrit
   `resources/plyo/catalog-keys.json` d'après `PrintConfig.cpp`, `Tab.cpp` et les traductions d'Orca). Relire le diff.
5. **Compiler** (`./build_release_macos.sh -s -a arm64` sur macOS, ou la chaîne d'Orca).
6. **Lancer tous les tests** : `node --test resources/web/plyo/tests/*.test.mjs`,
   `python3 -I -m unittest discover -s src/plyo/tests` (dont `test_orca_footprint.py`, qui compare cette liste au diff
   avec Orca et vérifie les marqueurs), puis les tests d'Orca (`ctest`).
7. Mettre ce fichier à jour si un point de contact a bougé.

## Conventions

- Une modification d'une ligne porte `// PLYO: raison` en fin de ligne (`# PLYO:` en CMake, shell et YAML,
  `<!-- PLYO: … -->` en XML), sans ligne ajoutée.
- Un bloc de plusieurs lignes est encadré par `// PLYO: begin raison` et `// PLYO: end` (même forme en CMake/XML).
- Le code d'Orca n'inclut qu'un seul en-tête de Plyo : `src/plyo/PlyoHooks.hpp`. Il déclare exactement les fonctions
  appelées depuis Orca, avec des types simples (déclarations anticipées seulement) : retoucher un module de Plyo ne
  recompile pas les gros fichiers d'Orca.
- Risque de conflit : **faible** (ligne isolée dans une zone stable), **moyen** (zone retouchée souvent par Orca),
  **élevé** (zone très active, ou sens qui peut changer sans conflit textuel).

## Points de contact dans le code et la compilation

| Fichier | Où | Ce que fait la modification | Pourquoi | Après un merge | Risque |
|---|---|---|---|---|---|
| `src/slic3r/GUI/Plater.cpp` | 2e ligne du fichier, après `#include "Plater.hpp"` | `#include "plyo/PlyoHooks.hpp"` | Accès aux fonctions de Plyo appelées ci-dessous. | Remettre la ligne juste après `#include "Plater.hpp"`. | moyen (bloc d'includes) |
| `src/slic3r/GUI/Plater.cpp` | `Plater::priv::on_process_completed`, juste après `notification_manager->set_slicing_progress_export_possible();` | `Plyo::OrcaMessages::on_slicing_done(evt);` | Le panneau apprend tout de suite qu'une découpe a échoué (type de l'erreur, pièce en cause) ou qu'elle est finie. Lecture seule : rien ne change dans le traitement d'Orca. Retient aussi le type d'une erreur d'export. | Remettre la ligne après `set_slicing_progress_export_possible()`, avant `background_process.reset_export()`. Si Orca déplace ou renomme cette fin de traitement, la remettre au premier endroit où `evt` est connu et l'export pas encore remis à zéro. | moyen |
| `src/slic3r/GUI/Plater.cpp` | même fonction, ligne suivante (après la ligne vide), juste avant `this->background_process.reset_export();` | `Plyo::FirstSteps::on_process_completed(evt, this->background_process.is_export_scheduled(), last_output_path);` | Le panneau ne dit « Enregistré » qu'une fois le fichier réellement écrit, avec son chemin, et signale une erreur d'écriture. Ne fait rien si aucun export n'était en cours. | Remettre la ligne juste avant `reset_export()` (elle doit lire `is_export_scheduled()` avant la remise à zéro). | moyen |
| `src/slic3r/GUI/Plater.cpp` | dernière ligne de `Plater::new_project`, avant `return wxID_YES;` | `Plyo::on_project_changed();` | Nouveau projet : le panneau revient à son accueil. Le crochet d'événements d'Orca (`set_lifecycle_hook_fn`) n'a qu'une place, déjà prise par les extensions, et `NewProject` n'est pas émis en mode silencieux. | Remettre la ligne avant le `return` final de réussite. | faible |
| `src/slic3r/GUI/Plater.cpp` | dernière ligne de `Plater::load_project`, après le journal `load project done` | `Plyo::on_project_changed();` | Projet ouvert : le panneau revient à son accueil (même raison). | Remettre la ligne à la fin de la fonction. | faible |
| `src/slic3r/GUI/Plater.cpp` | `Plater::close_with_confirm`, première condition | `if (up_to_date(false, false))` devient `if (up_to_date(false, false) \|\| Plyo::ProjectFiles::keeps_project())` | Le plateau d'une conversation est écrit par Plyo dans son propre 3MF (`datadir/plyo/projets/`) : la fenêtre « Le projet a des modifications non enregistrées » n'a pas lieu d'être. `second_check` est toujours appelé. Vrai seulement si le plateau est attaché à une conversation et que son 3MF vient d'être écrit ; faux pendant une découpe, un envoi, une calibration ou une fenêtre, pour un fichier de l'utilisateur, ou si l'écriture échoue : Orca pose alors sa question. | Reprendre la ligne d'Orca et lui ajouter `\|\| Plyo::ProjectFiles::keeps_project()` en fin de condition. | moyen (ligne modifiée) |
| `src/slic3r/GUI/Plater.cpp` | `Plater::send_gcode_legacy`, juste avant le bloc `{ auto preset_bundle = …` qui ouvre la fenêtre d'envoi | `if (!Plyo::Canvas::fill_armed_upload(upload_job.upload_data, default_output_file.filename().string(), use_3mf, resolved_plate_idx))` | Envoi lancé par le panneau avec une répartition d'emplacements vérifiée (Creality CFS, Flashforge IFS) : il part sans la fenêtre d'envoi. `fill_armed_upload` (`src/plyo/PlyoCanvas.cpp`) remplit le nom du fichier, le démarrage, la répartition et `plateindex` (`.gcode.3mf`) comme la fenêtre ; il ne fait rien si l'envoi n'a pas été armé par le panneau (le bouton d'Orca garde toujours sa fenêtre). | Remettre la ligne juste avant le bloc de la fenêtre. Si la sentinelle « envoi armé » échoue, Orca a changé ce que la fenêtre remplit : reporter le changement dans `fill_armed_upload`. Si Orca renomme `default_output_file`, `use_3mf` ou `resolved_plate_idx`, adapter les arguments. | **élevé** (zone Elegoo/Creality/Flashforge très active) |
| `src/slic3r/GUI/Plater.cpp` | première ligne de `Plater::on_config_change` | `Plyo::refresh_values();` | Les changements faits hors des onglets (type de plateau, listes de préréglages de la barre latérale, couleur d'un filament) passent par cette fonction et pas par `MainFrame::on_config_changed` : les valeurs affichées dans le panneau restent ainsi à jour. Ne fait que demander un rafraîchissement regroupé du panneau : rien n'est compté ni écrit. | Remettre la ligne en tête de la fonction. | faible |
| `src/slic3r/GUI/MainFrame.cpp` | fin du bloc d'includes, après `#include "FilamentMapDialog.hpp"` | `#include "plyo/PlyoHooks.hpp"` | Accès aux fonctions de Plyo appelées ci-dessous. | Remettre la ligne à la fin du bloc d'includes. | moyen (bloc d'includes) |
| `src/slic3r/GUI/MainFrame.cpp` | dernière ligne du constructeur `MainFrame::MainFrame()` | `Plyo::FirstSteps::on_startup();` | Accueil du premier lancement (par-dessus l'écran de configuration d'Orca) et ouverture du panneau à chaque lancement (`src/plyo/PlyoFirstSteps.cpp`). | Remettre la ligne à la fin du constructeur. | faible |
| `src/slic3r/GUI/MainFrame.cpp` | `MainFrame::create_side_tools`, juste avant `sizer->Add(slice_panel);` | `Plyo::add_topbar_button(sizer, this);` | Bouton « Assistant » dans la barre du haut, suivi de 15 px d'espace : ouvre ou ferme le panneau depuis n'importe quel onglet. Construit dans `src/plyo/PlyoAssistant.cpp`. | Remettre la ligne juste avant l'ajout du panneau « Découper » au sizer de la barre. | moyen (barre du haut retouchée souvent) |
| `src/slic3r/GUI/MainFrame.cpp` | `MainFrame::init_menubar_as_editor`, menu Affichage, juste avant le `viewMenu->AppendSeparator();` qui suit « Reset Window Layout » | `Plyo::append_view_menu_item(viewMenu, this);` | Entrée cochable « Assistant Plyo » : ouvre et ferme le panneau, active seulement dans Préparer et Aperçu, cochée tant que le panneau est ouvert. Construite dans `src/plyo/PlyoAssistant.cpp`. | Remettre la ligne après l'entrée « Reset Window Layout ». | moyen (menu Affichage) |
| `src/slic3r/GUI/MainFrame.cpp` | `MainFrame::init_menubar_as_gcodeviewer`, entrée « Quitter » | `SLIC3R_APP_NAME` remplacé par `SLIC3R_APP_FULL_NAME` dans `wxString::Format(_L("Quit %s"), …)` | Le menu dit « Quitter Plyo Slicer ». `SLIC3R_APP_NAME` reste « OrcaSlicer » (dossier de configuration, traductions, métadonnées). Les entrées « À propos » utilisent déjà `SLIC3R_APP_FULL_NAME` et ne sont pas modifiées. | Reprendre la ligne d'Orca et y remplacer `SLIC3R_APP_NAME` par `SLIC3R_APP_FULL_NAME`. | faible |
| `src/slic3r/GUI/MainFrame.cpp` | dernière ligne de `MainFrame::on_config_changed` | `Plyo::on_config_changed();` | Changement fait dans un onglet de réglages (saisie, préréglage, modification par Plyo) : compté pour l'enregistrement automatique de la bobine et du projet de la conversation, et valeurs du panneau rafraîchies. | Remettre la ligne à la fin de la fonction. | faible |
| `src/slic3r/GUI/GUI_App.cpp` | bloc d'includes, après `#include "GUI_App.hpp"` | `#include "plyo/PlyoHooks.hpp"` | Accès à `Plyo::ProjectFiles::take_preset_changes`. | Remettre la ligne après `#include "GUI_App.hpp"`. | moyen (bloc d'includes) |
| `src/slic3r/GUI/GUI_App.cpp` | `GUI_App::init_app_config` | `SetAppName(SLIC3R_APP_KEY)` devient `SetAppName("PlyoSlicer")` | Dossier de réglages propre à Plyo (`PlyoSlicer` dans Application Support, `%APPDATA%` ou `~/.config`) : un OrcaSlicer installé à côté garde ses préréglages. `SLIC3R_APP_KEY` reste « OrcaSlicer » (nom de `OrcaSlicer.conf`, catalogue des traductions, métadonnées 3MF/G-code). | Reprendre la ligne d'Orca et y mettre `"PlyoSlicer"`. | faible |
| `src/slic3r/GUI/GUI_App.cpp` | première ligne de `GUI_App::check_new_version_sf` | `return;` | La vérification de mise à jour interroge le serveur de versions d'OrcaSlicer et proposerait de télécharger OrcaSlicer à la place de Plyo Slicer. Même principe que `check_new_version()`, déjà désactivée par Orca. | Remettre `return;` en tête de la fonction. | faible |
| `src/slic3r/GUI/GUI_App.cpp` | première ligne de `GUI_App::check_and_save_current_preset_changes` et de `GUI_App::check_and_keep_current_preset_changes` | `if (Plyo::ProjectFiles::take_preset_changes(caption)) return true;` | Fermeture, nouveau projet ou ouverture d'un projet, reconnus au titre `caption` de la question d'Orca, quand le plateau est celui d'une conversation : Plyo écrit le 3MF et le filament dans sa bobine, puis oublie les modifications d'impression (elles sont dans le 3MF) ; aucune fenêtre « Enregistrer / Ignorer ». Faux (Orca demande comme avant) dans tous les autres cas : mise à jour des profils, assistants, déconnexion, export, sans conversation, pendant une calibration, imprimante modifiée, filament qui n'est pas une bobine, 3MF non écrit. | Remettre la ligne en tête des deux fonctions. La sentinelle « titres de la question » échoue si Orca change ou réutilise ces titres : reprendre alors la liste de `src/plyo/PlyoProjectFiles.cpp`. | faible (sens surveillé par la sentinelle) |
| `src/slic3r/GUI/GUI_App.cpp` | `GUI_App::config_wizard_startup`, première ligne du `if (!m_app_conf_exists \|\| …only_default_printers())` | `return false;` | L'assistant Plyo installe l'imprimante (recherche sur le réseau, catalogue des profils fournis, même fonction d'installation qu'Orca : `PresetBundle::apply_vendor_config`). L'assistant d'Orca reste accessible depuis les menus. | Remettre `return false;` en tête de cette branche. | faible |
| `src/slic3r/Utils/ElegooLink.cpp` | bloc d'includes, après `#include "PrintHost.hpp"` | `#include "plyo/PlyoHooks.hpp"` | Accès à `Plyo::CC2::start_print`. | Remettre la ligne. | faible |
| `src/slic3r/Utils/ElegooLink.cpp` | `ElegooLink::get_post_upload_actions`, bloc `PLYO: begin` / `PLYO: end` | Rend `StartPrint` aussi pour la Centauri Carbon 2 (Orca rendait `None`) | Orca envoie le fichier à une Elegoo Centauri Carbon 2 mais ne sait pas la démarrer ; Plyo ajoute le démarrage (ligne suivante). | Reprendre la fonction d'Orca et remettre le bloc. Si Orca sait démarrer la CC2 lui-même, retirer les deux blocs Plyo (sinon double démarrage). | moyen (sens) |
| `src/slic3r/Utils/ElegooLink.cpp` | `ElegooLink::loopUploadCC2`, après la boucle d'envoi, bloc `PLYO: begin` / `PLYO: end` à la place du message « start print is not supported » | Appelle `Plyo::CC2::start_print()` (canal MQTT local de l'imprimante, `src/plyo/PlyoCC2*.cpp`) et rend une erreur claire si l'impression ne démarre pas | « Envoyer et imprimer » fonctionne sur la CC2 comme sur les autres Elegoo. | Remettre le bloc après l'envoi. Voir « Déplacements prévus ». | moyen |
| `src/slic3r/Utils/CrealityPrint.cpp` | bloc d'includes, `#include <thread>` | ajouté | `std::this_thread::sleep_for` du bloc de `start_print`. | Remettre la ligne (ou la retirer avec le bloc). | faible |
| `src/slic3r/Utils/CrealityPrint.cpp` | bloc d'includes, après `#include "Http.hpp"` | `#include "plyo/PlyoHooks.hpp"` | Accès à `Plyo::PrinterStatus::creality_file_dir`. | Remettre la ligne. | faible |
| `src/slic3r/Utils/CrealityPrint.cpp` | `is_k1_family`, liste `k1_models` | code `"F003"` ajouté | La CR-10 SE (code F003 lu par `/info`) range ses fichiers dans `/usr/data/printer_data/gcodes`, comme les K1 ; sans lui, Orca demande de démarrer `/mnt/UDISK/…` et l'impression ne démarre jamais. | Remettre la ligne dans la liste (à proposer à Orca). | faible |
| `src/slic3r/Utils/CrealityPrint.cpp` | `CrealityPrint::start_print` : `const` retiré de `gcode_path`, puis bloc `PLYO: begin` / `PLYO: end` | Lit la liste de fichiers de l'imprimante (`get reqGcodeFile`, trois essais espacés de 2 s) et démarre le fichier dans son vrai dossier (`Plyo::PrinterStatus::creality_file_dir`) ; la liste de modèles d'Orca reste le repli | Une Creality inconnue d'Orca recevait le fichier sans démarrer. | Reprendre la fonction d'Orca, retirer `const` de `gcode_path` et remettre le bloc juste après. Voir « Déplacements prévus ». | moyen |
| `src/libslic3r/libslic3r.h` | `#define SLIC3R_APP_FULL_NAME` | « Plyo Slicer » | Nom affiché dans les titres des fenêtres, « À propos » et les messages d'Orca. Modifier cette ligne recompile presque tout Orca. | Remettre la valeur. | faible |
| `src/slic3r/CMakeLists.txt` | juste après `source_group(TREE …)` | `include(${CMAKE_CURRENT_SOURCE_DIR}/../plyo/plyo.cmake)` | Compiler les sources de `src/plyo/` dans `libslic3r_gui`. La liste reste dans `src/plyo/plyo.cmake` : elle ne peut pas aller dans `SLIC3R_GUI_SOURCES`, car `source_group(TREE)` refuse les fichiers hors de `src/slic3r/`. | Remettre la ligne après `add_library(libslic3r_gui …)` et `source_group`. | faible |
| `src/CMakeLists.txt` | `MACOSX_BUNDLE_BUNDLE_NAME` | « Plyo Slicer » | Nom affiché par macOS (barre des menus, Dock). Le dossier compilé s'appelle encore `OrcaSlicer.app`, renommé `Plyo Slicer.app` à la distribution. | Remettre la valeur. | faible |
| `CMakeLists.txt` | `CMAKE_XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER` (bloc `if (APPLE)`) | `fr.codika.PlyoSlicer` | Sinon macOS confond Plyo Slicer et OrcaSlicer (Dock, « Ouvrir avec », autorisations). Même valeur dans `MacOSXBundleInfo.plist.in`. | Remettre la valeur. | faible |
| `CMakeLists.txt` | CPack : `CPACK_PACKAGE_NAME`, `CPACK_PACKAGE_VENDOR`, `CPACK_PACKAGE_FILE_NAME`, `CPACK_PACKAGE_DESCRIPTION_SUMMARY`, `CPACK_PACKAGE_HOMEPAGE_URL`, `CPACK_PACKAGE_INSTALL_REGISTRY_KEY`, `CPACK_PACKAGE_EXECUTABLES` | Installateur « Plyo Slicer », éditeur « Codika », fichier `PlyoSlicer_Windows_Installer_V….exe` (suffixe d'architecture d'Orca conservé), description, page du projet, clé de registre `PlyoSlicer`, raccourci « Plyo Slicer » | Installé à côté d'OrcaSlicer (dossier, raccourcis et clé de registre à part) : avec la clé « OrcaSlicer », l'option « désinstaller avant d'installer » supprimerait un OrcaSlicer déjà installé. Le nouveau nom de fichier est attendu par `build_orca.yml` (ligne suivante). | Remettre les sept valeurs, chacune marquée `# PLYO:` en fin de ligne. | faible |
| `cmake/modules/MacOSXBundleInfo.plist.in` | `CFBundleIdentifier` | `fr.codika.PlyoSlicer` | Même raison que l'identifiant CMake. | Remettre la valeur. | faible |
| `cmake/modules/MacOSXBundleInfo.plist.in` | fin du `<dict>`, bloc `PLYO: begin` / `PLYO: end` | `NSLocalNetworkUsageDescription` et `NSBonjourServices` | Recherche d'imprimantes sur le réseau local (`src/plyo/PlyoDiscovery.cpp`) : macOS demande l'autorisation avec ce texte et n'autorise que les services mDNS listés. | Remettre le bloc avant `</dict>`. | faible |
| `src/dev-utils/platform/msw/OrcaSlicer.rc.in` | `VALUE "FileDescription"` et `VALUE "ProductName"` | « Plyo Slicer » au lieu de `@SLIC3R_APP_NAME@` | Nom affiché par Windows (Gestionnaire des tâches, propriétés du fichier). Le fichier reste `orca-slicer.exe`. | Remettre les deux valeurs. | faible |
| `build_release_macos.sh` | `build_slicer`, juste après `./scripts/run_gettext.sh` | `python3 src/plyo/rebrand_translations.py …` | `run_gettext.sh` recompile les traductions d'Orca après la compilation : sans cette ligne, il écraserait les traductions renommées « Plyo Slicer ». | Remettre la ligne après `run_gettext.sh`. | faible |
| `.github/workflows/build_orca.yml` | étape « Upload artifacts Win installer », `path:` | `*Slicer_Windows_Installer*.exe` au lieu de `OrcaSlicer*.exe` | L'installateur renommé par CPack doit être récupéré à la fin du run. La build Windows de Plyo se lance par `.github/workflows/plyo_windows.yml`. | Reprendre la ligne d'Orca et y mettre ce motif. | moyen (fichier de CI retouché souvent) |
| `.github/workflows/plyo_windows.yml` | fichier ajouté | Build Windows x64 lancée à la main, qui réutilise `build_check_cache.yml` d'Orca | Produire l'installateur de Plyo sans modifier les déclencheurs d'Orca. | Rien, sauf si Orca renomme ou change les entrées de `build_check_cache.yml`. | faible |

## Marque (icônes et logos)

Ces images d'Orca sont remplacées par celles de Plyo, **mêmes noms et mêmes dimensions**, pour ne toucher à aucune ligne de
code. Elles sont produites par `src/plyo/brand/make_assets.py` à partir de `src/plyo/brand/logo_geometry.py` (le logo en
vectoriel) et de la police HarmonyOS Sans livrée avec Orca. Après un merge qui change l'une d'elles (conflit binaire),
garder la version Plyo, puis relancer `make_assets.py` si Orca a changé les dimensions ou ajouté une image.

| Fichier | Usage |
|---|---|
| `resources/Icon.icns` | icône de l'app macOS |
| `resources/images/OrcaSlicer.icns` | documents associés (macOS) |
| `resources/images/OrcaSlicer.ico` | exe et installateur Windows |
| `resources/images/OrcaSlicer-mac_256px.ico` | Dock au lancement |
| `resources/images/OrcaSlicerTitle.ico` | petites fenêtres |
| `resources/images/OrcaSlicerTitle.png` | petites fenêtres |
| `resources/images/OrcaSlicer.png` | icône des fenêtres |
| `resources/images/OrcaSlicer_128px.png` | icône des fenêtres |
| `resources/images/OrcaSlicer_192px.png` | messages |
| `resources/images/OrcaSlicer_192px_grayscale.png` | messages |
| `resources/images/OrcaSlicer_192px_transparent.png` | assistant de configuration |
| `resources/images/OrcaSlicer.svg` | logo |
| `resources/images/OrcaSlicer_gradient_circle.svg` | logo rond |
| `resources/images/OrcaSlicer_about.svg` | « À propos » |
| `resources/images/OrcaSlicer_about_dark.svg` | « À propos », thème sombre |
| `resources/images/OrcaSlicer_horizontal_light.svg` | dépannage |
| `resources/images/OrcaSlicer_horizontal_dark.svg` | dépannage, thème sombre |
| `resources/images/splash_logo.svg` | écran de démarrage |
| `resources/images/splash_logo_dark.svg` | écran de démarrage, thème sombre |

Non remplacées (non utilisées par le code) : `OrcaSlicer_154*.png`, `OrcaSlicer_32px.png`, `OrcaSlicer_64.png`,
`OrcaSlicer-mac_128px.png`, `OrcaSlicer_gradient(_narrow).svg`, `OrcaSlicer_gray.svg`. Les pages web d'accueil d'Orca
(`resources/web/`) gardent leurs images.

## Traductions

Les fichiers `.po` d'Orca ne sont pas modifiés. À chaque compilation, la cible `plyo_translations` (`src/plyo/plyo.cmake`)
lance `src/plyo/rebrand_translations.py`. Le script remplace le nom de l'application par « Plyo Slicer » dans les
traductions et compile les `.mo` lus par l'application (`resources/i18n/<langue>/OrcaSlicer.mo`). Il garde intacts les
services d'Orca (Orca Cloud, Orca Cube…) ainsi que les crédits et la licence de la fenêtre « À propos ». Tests :
`python3 -I -m unittest discover -s src/plyo/tests`. Il faut `msgfmt` (`brew install gettext`) ; sans lui, les traductions
gardent le nom d'Orca.

## Ce que Plyo utilise d'Orca sans le modifier (surveillé par des tests)

Ces dépendances ne créent pas de conflit au merge, mais un changement d'Orca peut les casser sans erreur de compilation.
Chacune est gardée par une sentinelle de `src/plyo/tests/cpp/test_plyo.cpp` :

- titres des questions « Enregistrer ? » (`Closing application`, `Creating a new project`, `Load project`), reconnus
  par `Plyo::ProjectFiles::take_preset_changes` ;
- ce que remplit la fenêtre d'envoi de `send_gcode_legacy` (repris par `Plyo::Canvas::fill_armed_upload`) ;
- choix d'un filament (`Plater::priv::on_select_preset`, repris par `Plyo::FirstSteps::select_filament`), couleur d'un
  filament (`PresetComboBox::update_ams_color`, repris par `Plyo::Canvas::set_colour`), fin de l'installation d'une
  imprimante (`GuideFrame::run`, `GUI_App::run_wizard`, repris par `Plyo::PrinterSetup::install`), remise à plat
  (`GizmoObjectManipulation::reset_rotation_value`) et « Gizmo-Place on Face » (`GLCanvas3D::do_rotate`), repris par
  `src/plyo/PlyoCommands.cpp` ;
- boutons publics `MainFrame::m_slice_btn` et `m_print_btn`, encadrés par « Montre-moi » (`src/plyo/PlyoHighlight.cpp`) ;
- règles de `ConfigManipulation` et contrôles de températures de `Tab` (test « Règles d'Orca »).

## Déplacements prévus (à faire avec l'imprimante concernée)

Ces deux blocs contiennent encore de la logique Plyo dans un fichier d'Orca. Ils ne sont pas déplacés tant qu'ils ne
peuvent pas être vérifiés sur la machine :

- `src/slic3r/Utils/CrealityPrint.cpp`, `start_print` : déplacer la lecture de la liste de fichiers dans
  `src/plyo/PlyoPrinterStatus.cpp` (une fonction `creality_start_dir(host, filename)` qui fait la connexion, les trois
  essais et le journal), pour ne garder côté Orca que `if (const std::string dir = …; !dir.empty()) gcode_path = dir + "/" + filename;`
  et retirer `#include <thread>`. À vérifier sur une Creality (CR-10 SE) : démarrage du fichier envoyé, repli sur la
  liste de modèles si l'imprimante ne répond pas.
- `src/slic3r/Utils/ElegooLink.cpp`, `loopUploadCC2` : faire prendre à `Plyo::CC2::start_print` l'adresse brute
  (`m_host`) et rendre le message complet, pour ne garder côté Orca que l'appel et le `return false`. À vérifier sur une
  Centauri Carbon 2 : démarrage après l'envoi, message en cas de refus.

## Fichiers ajoutés (hors code d'Orca)

- `src/plyo/` : code C++ du panneau et de ses fonctions (`PlyoHooks.hpp` : seul en-tête inclus par Orca ;
  `plyo.cmake` : liste des sources), tests (`src/plyo/tests/`), catalogue (`src/plyo/catalog/`), marque
  (`src/plyo/brand/`), traductions (`rebrand_translations.py`). Adresse du service dans `PlyoConfig.*` (option CMake
  `PLYO_API_URL`, variable d'environnement `PLYO_API_URL` au lancement).
- `resources/web/plyo/` : page web du panneau et ses tests.
- `resources/plyo/catalog-keys.json` (généré par `generate_catalog.py`) et `resources/plyo/policy.json` : catalogue des
  réglages modifiables et politique (exclusions, niveaux de risque).
- `docs/plyo/` : cette liste.
- `.github/workflows/plyo_windows.yml` : installateur Windows, lancé à la main (voir le tableau).
