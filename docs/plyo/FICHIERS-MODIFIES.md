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
| `src/CMakeLists.txt` | `MACOSX_BUNDLE_BUNDLE_NAME "Plyo Slicer"` | Nom affiché par macOS (barre des menus, Dock). Le paquet s'appelle encore `OrcaSlicer.app` (renommage complet avec icône à prévoir). |
| `src/slic3r/GUI/MainFrame.cpp` | `Plyo::on_config_changed();` à la fin de `MainFrame::on_config_changed()` | Tenir à jour les valeurs du panneau. Tout changement de configuration passe par cette fonction : saisie manuelle, changement de préréglage, modification par Plyo. |

## Traductions

Les fichiers `.po` d'Orca ne sont pas modifiés. À chaque compilation, la cible `plyo_translations` (`src/plyo/plyo.cmake`) lance `src/plyo/rebrand_translations.py`. Le script remplace le nom de l'application par « Plyo Slicer » dans les traductions et compile les `.mo` lus par l'application (`resources/i18n/<langue>/OrcaSlicer.mo`). Il garde intacts les services d'Orca (Orca Cloud, Orca Cube…) et les crédits et la licence de la fenêtre « À propos ». Tests : `python3 -m unittest discover -s src/plyo/tests`. Il faut `msgfmt` (`brew install gettext`) ; sans lui, les traductions gardent le nom d'Orca.

## Fichiers ajoutés (hors code d'Orca)

- `src/plyo/` : code C++ du panneau (`PlyoAssistant.*`, `plyo.cmake`)
- `resources/web/plyo/` : page web du panneau
- `docs/plyo/` : documentation du projet
