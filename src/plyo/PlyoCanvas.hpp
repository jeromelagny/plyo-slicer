#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>
#include <utility>
#include <vector>

// Emplacements du Canvas d'une Elegoo Centauri Carbon 2, côté Orca : lecture (réseau, hors du fil principal), choix des
// profils et des couleurs de filament par numéro, plan d'envoi (carte des emplacements, voir PlyoCC2.hpp). Messages
// canvas_* du panneau (PlyoAssistant.cpp). Le code d'accès est lu dans le profil d'imprimante et ne sort jamais d'ici.
namespace Plyo { namespace Canvas {

// Lit les emplacements de l'imprimante de ce profil ; `done` (fil principal) reçoit
// {ok, reason?, canvases, colours:[{t, color, type}]} ; reason : not_cc2, unreachable, no_canvas.
void read(const std::string& printer_preset, std::function<void(nlohmann::json)> done);
// Couleurs (filaments utilisés par la plaque en cours) : [{t, color, type}], t à partir de 0.
nlohmann::json colours();
// Pour chaque {t, type, color} : profil compatible du type (exact, puis type de base), couleur de l'emplacement.
// {ok, presets:[{t, preset}], text?} ; tout ou rien sur la recherche des profils.
nlohmann::json apply(const nlohmann::json& entries);
// Plan d'envoi : carte [{t, canvas_id, tray_id}] pour l'imprimante de ce profil, avec les couleurs de la plaque.
void plan(const std::string& printer_preset, const nlohmann::json& map);
void clear_plan();
// Couleurs découpées de la plaque et profils de filament (voir CC2::OrcaState) ; depuis n'importe quel fil.
bool orca_state(std::vector<int>& sliced_t, std::vector<std::string>& presets);
// Relance sans carte un départ refusé ; `done` (fil principal) reçoit {ok, text}.
void start_plain(const std::string& printer_preset, std::function<void(nlohmann::json)> done);
// Remet ces profils sur les filaments 2 et suivants (restauration du projet). Ignore un numéro hors de la plaque.
void select_extra(const std::vector<std::pair<int, std::string>>& extra);
// Adresse sans schéma, chemin ni port (« http://192.168.1.29:80/ » → « 192.168.1.29 »), comme ElegooLink.
std::string bare_host(const std::string& print_host);

}} // namespace Plyo::Canvas
