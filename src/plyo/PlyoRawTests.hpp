#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Deux actions proposées par l'IA (capacités show_preview et open_calibration du panneau) : ouvrir l'onglet « Aperçu »
// d'Orca, et ouvrir un test brut d'Orca (« Débit maximal », « VFA », « Test de tolérance Orca ») par ses fonctions publiques,
// comme ses menus. Rien n'est écrit dans les préréglages par Plyo.
namespace Plyo { namespace RawTests {

// Ouvre l'onglet « Aperçu » (MainFrame::select_tab). {ok, sliced} : la plaque en cours est-elle découpée ?
nlohmann::json show_preview();

// Un test brut peut-il partir maintenant ? null si oui, sinon {ok: false, text} : cible inconnue, découpe, envoi, calibration
// (guidée ou d'Orca) en cours, fenêtre d'Orca ouverte, projet de conversation pas encore rangé.
nlohmann::json refusal(const std::string& target);

// Lance le test, hors du traitement du message du panneau (CallAfter) : max_flow et vfa ouvrent la fenêtre modale d'Orca
// (MainFrame::run_calibration), qui remplace le projet par la pièce de test si l'utilisateur valide ; le projet de la
// conversation est d'abord écrit dans son 3MF (ProjectFiles::keeps_project), sinon rien n'est lancé. tolerance ajoute la
// pièce de test au plateau (MenuFactory::load_handy_model), sans fenêtre, puis organise la plaque s'il y avait déjà une pièce.
// `reply` reçoit {ok, target, replaced (nouveau projet ouvert par Orca), added (pièces ajoutées), arranged?, text?}.
void open(const std::string& target, std::function<void(nlohmann::json)> reply);

}} // namespace Plyo::RawTests
