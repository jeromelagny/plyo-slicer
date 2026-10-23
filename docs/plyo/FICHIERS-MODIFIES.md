# Fichiers d'OrcaSlicer modifiés par Plyo

Chaque modification est marquée par un commentaire `PLYO:` dans le code (`# PLYO:` en CMake).
Retrouver toutes les modifications : `git grep -n "PLYO:" -- src resources`.

| Fichier | Modification | Pourquoi |
|---|---|---|
| `src/slic3r/CMakeLists.txt` | `include(.../plyo/plyo.cmake)` juste après `source_group(TREE ...)` | Compiler les sources de `src/plyo/` dans `libslic3r_gui`. La liste des fichiers Plyo reste dans `src/plyo/plyo.cmake`. Elle ne peut pas être ajoutée à `SLIC3R_GUI_SOURCES`, car `source_group(TREE)` refuse les fichiers hors de `src/slic3r/`. |
| `src/slic3r/GUI/MainFrame.cpp` | `#include "plyo/PlyoAssistant.hpp"` | Accès aux fonctions du panneau. |
| `src/slic3r/GUI/MainFrame.cpp` | Entrée cochable « Assistant Plyo » dans le menu Affichage (après « Reset Window Layout ») | Ouvrir et fermer le panneau. Active seulement dans Préparer et Aperçu. |
| `src/slic3r/GUI/MainFrame.cpp` | `#include "plyo/PlyoFirstSteps.hpp"` et `Plyo::FirstSteps::on_startup();` à la fin du constructeur | Accueil du premier lancement (par-dessus l'écran de configuration d'Orca) et ouverture du panneau à chaque lancement, sauf si l'utilisateur l'a fermé. Le reste se passe dans `src/plyo/PlyoFirstSteps.cpp`. |
| `src/slic3r/GUI/MainFrame.cpp` | `Plyo::on_config_changed();` à la fin de `MainFrame::on_config_changed()` | Tenir à jour les valeurs du panneau. Tout changement de configuration passe par cette fonction : saisie manuelle, changement de préréglage, modification par Plyo. |

## Fichiers ajoutés (hors code d'Orca)

- `src/plyo/` : code C++ du panneau (`PlyoAssistant.*`, `plyo.cmake`)
- `resources/web/plyo/` : page web du panneau
- `docs/plyo/` : documentation du projet
