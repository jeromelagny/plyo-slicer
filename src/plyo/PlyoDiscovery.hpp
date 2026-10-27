#pragma once

#include "PlyoDiscoveryLogic.hpp"

#include <functional>
#include <vector>

// Recherche des imprimantes sur le réseau de la maison (jamais au-delà) : réutilise les recherches d'Orca
// (Creality K2, Flashforge, OctoPrint) et ajoute Klipper/Moonraker (Creality K1, Ender-3 V3 KE…) et Elegoo (SDCP).
// Les résultats restent sur l'ordinateur : ils ne sont jamais envoyés au service Plyo ni à l'IA.
namespace Plyo { namespace Discovery {

// Lance la recherche en arrière-plan (une dizaine de secondes) ; `done` est appelé sur le fil de l'interface.
// Une recherche déjà en cours n'est pas relancée : renvoie false.
bool start(std::function<void(std::vector<Printer>)> done);

}} // namespace Plyo::Discovery
