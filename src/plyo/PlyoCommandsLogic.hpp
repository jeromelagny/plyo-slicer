#pragma once

#include <algorithm>
#include <set>
#include <string>
#include <utility>

// Ordres de l'IA sur le plateau : la part sans Orca (testée par src/plyo/tests/cpp).
namespace Plyo { namespace CommandsLogic {

// Deux exemplaires dont les rectangles se recouvrent, vus de dessus : leurs identifiants, le plus petit d'abord.
using OverlapPairs = std::set<std::pair<size_t, size_t>>;

// Les ordres qui créent une pièce ou en agrandissent une : les seuls après lesquels il peut falloir réorganiser la plaque.
inline bool grows_plate(const std::string& op)
{
    static const std::set<std::string> ops = {"set_copies", "scale", "scale_to_size", "cut_height", "split", "fill_bed", "inch_to_mm"};
    return ops.count(op) > 0;
}

// Vrai si `after` contient un chevauchement absent de `before`. Un rectangle englobant n'est pas la forme réelle : deux
// pièces imbriquées se recouvrent sans se toucher, et ce placement voulu ne doit pas être défait.
inline bool has_new_overlap(const OverlapPairs& before, const OverlapPairs& after)
{
    return !std::includes(before.begin(), before.end(), after.begin(), after.end());
}

}} // namespace Plyo::CommandsLogic
