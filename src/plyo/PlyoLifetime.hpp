#pragma once

#include <functional>

// Drapeau commun « on ferme » (ROB-15) : les fils détachés de Plyo (recherche d'imprimantes, tests de liaison, lectures
// d'emplacements, suivi d'impression…) ne rappellent l'application que par post(), qui ne transmet plus rien une fois Orca en
// train de se fermer. Logique pure : PlyoLifetimeLogic.hpp.
namespace Plyo { namespace Lifetime {

// Vrai dès que la fenêtre principale est détruite pendant la fermeture d'Orca (lisible depuis n'importe quel fil).
bool closing();

// Fil principal, à chaque fenêtre principale créée (FirstSteps::on_startup, PrinterStatus) : lève le drapeau quand elle est
// détruite pour de bon. Une fenêtre recréée par Orca (changement de langue) ne le lève pas.
void watch_main_frame();

// N'importe quel fil : `fn` s'exécute sur le fil principal (CallAfter), gardé par guarded(`what`), sauf si Orca se ferme.
void post(const char* what, std::function<void()> fn);

}} // namespace Plyo::Lifetime
