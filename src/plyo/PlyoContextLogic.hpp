#pragma once

#include <nlohmann/json.hpp>

#include <map>
#include <optional>
#include <string>
#include <vector>

// Contexte envoyé au service Plyo avec une question (corps de /api/diagnose) : ce que le slicer sait déjà et que l'IA ne
// devinerait pas (plateau en cours, matière, matériel de l'imprimante, mesures de la plaque, essais passés). Chaque champ
// est filtré et tronqué ici, au format exact du service (plyo-api, src/lib/schema.ts) : une valeur absente ou douteuse
// n'est pas envoyée (jamais de chaîne vide). Lectures seules : rien ici n'écrit dans Orca.
// Sans dépendance à wxWidgets ni à Orca (testé par src/plyo/tests/cpp).
namespace Plyo { namespace ContextLogic {

constexpr size_t MAX_BED_KEYS = 12; // clés de température de plateau, au plus

// Texte d'une ligne : caractères de contrôle retirés, espaces resserrés, `max_chars` caractères (UTF-8 entiers) au plus.
std::string clip(const std::string& text, size_t max_chars);

// Clé de réglage d'Orca au format du service : ^[a-z][a-z0-9_]{0,79}$.
bool valid_opt_key(const std::string& key);

// Valeurs brutes lues dans les préréglages en cours (première case des options « tableau »), texte d'Orca non traduit.
struct Raw
{
    std::string              bed_type;          // type de plateau de la plaque en cours (« Textured PEI Plate »), vide si inconnu
    std::vector<std::string> bed_temp_keys;     // clés de température que ce plateau lit (première couche comprise)
    std::string              filament_type;     // « PLA », « PETG »…
    std::string              filament_vendor;   // « Generic », « Sunlu »…
    std::string              nozzle_type;       // « brass », « hardened_steel »… (« undefine » : inconnu)
    std::string              extruder_type;     // « Direct Drive » ou « Bowden »
    std::string              printer_structure; // « corexy », « i3 »… (« undefine » : inconnu)
};

// Champs ajoutés à `context` : bed_type (60), bed_temp_keys (12 au plus, toutes valides, sans doublon, jamais vide),
// filament_type (40), filament_vendor (60), printer_facts {nozzle_type, extruder_type, printer_structure} (40 chacun ;
// « undefine », « nil » et vide ignorés ; bloc absent s'il est vide).
nlohmann::json context_extras(const Raw& raw);

// Messages d'Orca au format du service (IssueSchema) : source connue, code sans espace (^[A-Za-z0-9_.:-]{1,60}, caractères
// interdits remplacés par « _ »), niveau error|warning, opt_key gardé seulement s'il est valide, object_ref en chiffres
// seulement, texte sur une ligne de 300 caractères au plus et non vide ; 10 au plus. Les champs propres au panneau (scope,
// object_name, fix, critical) ne partent pas.
nlohmann::json issues_for_ai(const nlohmann::json& issues);

// Plateau envoyé à l'IA : `plate` (PlateActions::context) complété par `facts` ({objects: {ref: {needs_support, contact_mm2}},
// conflict: bool}, mesures de Preflight) : needs_support (booléen) et contact_mm2 (nombre arrondi, 0 à 1 000 000) sur
// chaque pièce mesurée, conflict (booléen) si la plaque est découpée, issues au format du service.
nlohmann::json plate_for_ai(const nlohmann::json& plate, const nlohmann::json& facts);

// Essais passés sur ce couple imprimante + filament (Memory::for_current) au format du service (MemorySchema) : date
// (40), 10 changements au plus {id (60), before, after} (valeurs nombre, booléen, texte ou null), why et note (200, non
// vides), outcome connu, defect (clé courte, 40, non vide) ; 10 entrées au plus. Une entrée sans date est ignorée. Les
// champs propres au slicer (at, conv, asked, printed…) ne partent pas.
nlohmann::json memory_for_ai(const nlohmann::json& memory);

// Coût du filament d'une plaque découpée (écran « Tout est prêt » du panneau) : volume extrudé par filament (mm³, indice du
// filament), densité (g/cm³) et prix au kilo du préréglage filament (`filament_cost`). Seulement si chaque filament utilisé a
// un prix et une densité : sinon rien (le panneau masque alors la case, jamais un coût partiel ou inventé). Le coût horaire de
// la machine (`time_cost`) n'en fait pas partie.
std::optional<double> filament_cost(const std::map<size_t, double>& volumes_mm3, const std::vector<double>& density, const std::vector<double>& cost_per_kg);

}} // namespace Plyo::ContextLogic
