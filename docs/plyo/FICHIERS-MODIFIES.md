# Fichiers d'OrcaSlicer modifiés par Plyo

Chaque modification est marquée par un commentaire `PLYO:` dans le code (`# PLYO:` en CMake).
Retrouver toutes les modifications : `git grep -n "PLYO:" -- src resources`.

| Fichier | Modification | Pourquoi |
|---|---|---|
| `src/slic3r/CMakeLists.txt` | `include(.../plyo/plyo.cmake)` juste après `source_group(TREE ...)` | Compiler les sources de `src/plyo/` dans `libslic3r_gui`. La liste des fichiers Plyo reste dans `src/plyo/plyo.cmake`. Elle ne peut pas être ajoutée à `SLIC3R_GUI_SOURCES`, car `source_group(TREE)` refuse les fichiers hors de `src/slic3r/`. |
| `src/slic3r/GUI/MainFrame.cpp` | `#include "plyo/PlyoAssistant.hpp"` | Accès aux fonctions du panneau. |
| `src/slic3r/GUI/MainFrame.cpp` | Entrée cochable « Assistant Plyo » dans le menu Affichage (après « Reset Window Layout ») | Ouvrir et fermer le panneau. Active seulement dans Préparer et Aperçu. |
| `src/slic3r/GUI/MainFrame.cpp` | `#include "plyo/PlyoFirstSteps.hpp"` et `Plyo::FirstSteps::on_startup();` à la fin du constructeur | Accueil du premier lancement (par-dessus l'écran de configuration d'Orca) et ouverture du panneau à chaque lancement. Le reste se passe dans `src/plyo/PlyoFirstSteps.cpp`. |
| `src/slic3r/GUI/MainFrame.cpp` | Dans `create_side_tools()`, `Plyo::create_topbar_button(this)` et un espace, avant le bouton « Découper » | Bouton « Assistant » dans la barre du haut : ouvre ou ferme le panneau depuis n'importe quel onglet. Le bouton est construit dans `src/plyo/PlyoAssistant.cpp`. |
| `src/slic3r/GUI/MainFrame.cpp` | « À propos de » et « Quitter » affichent « Plyo Slicer » (3 lignes) | Nom de l'application dans les menus. `SLIC3R_APP_NAME` et `SLIC3R_APP_KEY` ne changent pas : ils servent au dossier de configuration, aux traductions et aux métadonnées des fichiers 3MF/G-code (compatibilité). |
| `src/libslic3r/libslic3r.h` | `SLIC3R_APP_FULL_NAME` vaut « Plyo Slicer » | Nom affiché dans les titres des fenêtres et les messages d'Orca (« Plyo Slicer - Info »…). Modifier cette ligne recompile presque tout Orca. |
| `build_release_macos.sh` | Après `run_gettext.sh`, lance `src/plyo/rebrand_translations.py` | `run_gettext.sh` recompile les traductions d'Orca après la compilation : sans cette ligne, il écraserait les traductions renommées « Plyo Slicer ». |
| `src/CMakeLists.txt` | `MACOSX_BUNDLE_BUNDLE_NAME "Plyo Slicer"` | Nom affiché par macOS (barre des menus, Dock). Le dossier compilé s'appelle encore `OrcaSlicer.app` : on le renomme `Plyo Slicer.app` au moment de le distribuer (renommer le dossier d'une app macOS est sans risque). |
| `src/slic3r/GUI/GUI_App.cpp` | `init_app_config()` : `SetAppName("PlyoSlicer")` au lieu de `SLIC3R_APP_KEY` | Dossier de réglages propre à Plyo (`~/Library/Application Support/PlyoSlicer`, `%APPDATA%\PlyoSlicer`, `~/.config/PlyoSlicer`) : un OrcaSlicer installé à côté garde ses préréglages. `SLIC3R_APP_KEY` reste « OrcaSlicer » (nom de `OrcaSlicer.conf`, catalogue des traductions, métadonnées 3MF/G-code). |
| `CMakeLists.txt` + `cmake/modules/MacOSXBundleInfo.plist.in` | Identifiant macOS `fr.codika.PlyoSlicer` | Sinon macOS confond Plyo Slicer et OrcaSlicer (même app pour le Dock, « Ouvrir avec », autorisations). |
| `CMakeLists.txt` (CPack) | Nom « Plyo Slicer », éditeur « Codika », clé de registre `PlyoSlicer`, raccourci « Plyo Slicer » | Installateur Windows. Avec la clé « OrcaSlicer », l'option « désinstaller avant d'installer » supprimerait un OrcaSlicer déjà installé. Le nom du fichier `OrcaSlicer_Windows_Installer_…` ne change pas : la CI d'Orca l'attend. |
| `src/dev-utils/platform/msw/OrcaSlicer.rc.in` | `FileDescription` et `ProductName` = « Plyo Slicer » | Nom affiché par Windows (Gestionnaire des tâches, propriétés du fichier). Le fichier reste `orca-slicer.exe`. |
| `src/slic3r/GUI/MainFrame.cpp` | `Plyo::on_config_changed();` à la fin de `MainFrame::on_config_changed()` | Tenir à jour les valeurs du panneau. Tout changement de configuration passe par cette fonction : saisie manuelle, changement de préréglage, modification par Plyo. |

## Marque (icônes et logos)

Les images d'Orca ci-dessous sont remplacées par celles de Plyo, **mêmes noms et mêmes dimensions**, pour ne toucher à aucune ligne de code. Elles sont produites par `src/plyo/brand/make_assets.py` (à relancer après une mise à jour d'Orca qui changerait ces fichiers) à partir de `src/plyo/brand/logo_geometry.py` (le logo en vectoriel) et de la police HarmonyOS Sans livrée avec Orca.

- `resources/Icon.icns` (icône de l'app macOS), `resources/images/OrcaSlicer.icns` (documents associés)
- `resources/images/OrcaSlicer.ico` (exe et installateur Windows), `OrcaSlicer-mac_256px.ico` (Dock au lancement), `OrcaSlicerTitle.ico/.png` (petites fenêtres)
- `resources/images/OrcaSlicer.png`, `OrcaSlicer_128px.png` (icône des fenêtres), `OrcaSlicer_192px.png`, `OrcaSlicer_192px_grayscale.png` (messages), `OrcaSlicer_192px_transparent.png` (assistant de configuration)
- `resources/images/OrcaSlicer.svg`, `OrcaSlicer_gradient_circle.svg`, `OrcaSlicer_about(_dark).svg` (« À propos »), `OrcaSlicer_horizontal_light/_dark.svg` (dépannage), `splash_logo(_dark).svg` (écran de démarrage)

Non remplacées (non utilisées par le code) : `OrcaSlicer_154*.png`, `OrcaSlicer_32px.png`, `OrcaSlicer_64.png`, `OrcaSlicer-mac_128px.png`, `OrcaSlicer_gradient(_narrow).svg`, `OrcaSlicer_gray.svg`. Les pages web d'accueil d'Orca (`resources/web/`) gardent leurs images.

## Traductions

Les fichiers `.po` d'Orca ne sont pas modifiés. À chaque compilation, la cible `plyo_translations` (`src/plyo/plyo.cmake`) lance `src/plyo/rebrand_translations.py`. Le script remplace le nom de l'application par « Plyo Slicer » dans les traductions et compile les `.mo` lus par l'application (`resources/i18n/<langue>/OrcaSlicer.mo`). Il garde intacts les services d'Orca (Orca Cloud, Orca Cube…) et les crédits et la licence de la fenêtre « À propos ». Tests : `python3 -m unittest discover -s src/plyo/tests`. Il faut `msgfmt` (`brew install gettext`) ; sans lui, les traductions gardent le nom d'Orca.

## Fichiers ajoutés (hors code d'Orca)

- `src/plyo/` : code C++ du panneau (`PlyoAssistant.*`, `plyo.cmake`)
- `resources/web/plyo/` : page web du panneau
- `docs/plyo/` : documentation du projet
