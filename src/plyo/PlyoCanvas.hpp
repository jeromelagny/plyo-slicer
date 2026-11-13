#pragma once

#include "PlyoHooks.hpp" // fill_armed_upload : appelée par Orca (Plater::send_gcode_legacy)

#include <nlohmann/json.hpp>

#include <functional>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace Slic3r { class DynamicPrintConfig; }

// Emplacements d'une imprimante, côté Orca : lecture (réseau, hors du fil principal), choix des profils et des couleurs de
// filament par numéro, plan d'envoi (carte des emplacements, voir PlyoCC2.hpp). Messages canvas_* du panneau
// (PlyoAssistant.cpp). Le code d'accès est lu dans le profil d'imprimante et ne sort jamais d'ici.
// « canvas » désigne ici toute unité d'emplacements : Canvas de la Centauri Carbon 2, boîte CFS (Creality), IFS (Flashforge),
// têtes de la Snapmaker U1. Le nom reste celui du premier traducteur, c'est un protocole interne (projets enregistrés).
//
// ÉTAT : seule la CC2 est validée sur une vraie machine. CFS, IFS et U1 ne le sont PAS : les essais T9, T13, T14, T15 et T17 ne
// sont pas faits et cette branche n'est pas livrable tant qu'ils ne le sont pas (`validated` faux dans l'état lu).
namespace Plyo { namespace Canvas {

// Lit les emplacements de l'imprimante de ce profil ; `done` (fil principal) reçoit
// {ok, reason?, canvases, colours:[{t, color, type}], system, source, imposable, empty_blocks, start_plain, validated, blocker?} ;
// reason : no_translator, link_incomplete, unreachable, no_canvas. Sans traducteur, seulement {ok, reason}.
void read(const std::string& printer_preset, std::function<void(nlohmann::json)> done);
// Couleurs (filaments utilisés par la plaque en cours) : [{t, color, type}], t à partir de 0.
nlohmann::json colours();
// Pour chaque {t, type, color, preset?} : profil compatible du type (exact, puis type de base), couleur de l'emplacement.
// `preset` : profil de marque choisi par l'utilisateur pour cet emplacement, vérifié par Brands::check (refus sinon).
// {ok, presets:[{t, preset}], text?} ; tout ou rien sur la recherche des profils.
nlohmann::json apply(const nlohmann::json& entries);
// Plan d'envoi : carte [{t, canvas_id, tray_id}] pour l'imprimante de ce profil, avec les couleurs de la plaque.
void plan(const std::string& printer_preset, const nlohmann::json& map);
void clear_plan();
// CFS et IFS : relit l'imprimante hors du fil principal, revérifie tout (lecture, découpe, profil édité, filaments réellement
// utilisés, carte) puis lance Plater::send_gcode_legacy sans fenêtre, avec la répartition. Au moindre doute, rien n'est envoyé.
// `done` (fil principal) reçoit {ok, text}. `ok` veut dire « Orca a pris l'envoi », jamais « l'impression a démarré » :
// CrealityPrint::start_print n'attend aucune réponse. NON VALIDÉ sur machine (T13, T14, T15).
void send_planned(const std::string& printer_preset, std::function<void(nlohmann::json)> done);
// Pour fill_armed_upload (PlyoHooks.hpp, appelée par Plater::send_gcode_legacy, fil principal) : la répartition armée par
// send_planned, une seule fois. Vide en dehors de cet appel : le bouton d'Orca garde toujours sa fenêtre.
std::optional<std::map<std::string, std::string>> take_armed_send();
// Couleurs découpées de la plaque et profils de filament (voir CC2::OrcaState) ; depuis n'importe quel fil.
bool orca_state(std::vector<int>& sliced_t, std::vector<std::string>& presets);
// Relance sans carte un départ refusé ; `done` (fil principal) reçoit {ok, text}.
void start_plain(const std::string& printer_preset, std::function<void(nlohmann::json)> done);
// Remet ces profils sur les filaments 2 et suivants (restauration du projet). Ignore un numéro hors de la plaque.
void select_extra(const std::vector<std::pair<int, std::string>>& extra);
// Traducteur de ce profil (canvas, cfs, ifs, u1), vide s'il n'y en a pas ; `reason` : link_incomplete.
std::string translator_of(const Slic3r::DynamicPrintConfig& config, std::string* reason = nullptr);
// Adresse sans schéma, chemin ni port (« http://192.168.1.29:80/ » → « 192.168.1.29 »), comme ElegooLink.
std::string bare_host(const std::string& print_host);

}} // namespace Plyo::Canvas
