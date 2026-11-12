#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

// Règles de cohérence d'Orca reprises avant d'écrire un lot de réglages. Tab::load_config relance les contrôles de l'onglet
// modifié (ConfigManipulation::update_print_fff_config pour l'impression, check_filament_max_volumetric_speed et
// check_filament_ironing_spacing pour le filament) : chacun peut ouvrir une fenêtre au milieu de l'écriture, changer d'autres
// réglages ou remettre la valeur. Ici, le lot est complété pour que l'état final ne déclenche rien (mode vase, peau
// irrégulière, paroi supplémentaire alternée), ou refusé avec une phrase claire, avant toute écriture. Les conditions sont
// recopiées d'Orca : un test de source (test_plyo.cpp) échoue si elles changent.
// Sans dépendance à wxWidgets ni à Orca (testé par src/plyo/tests/cpp).
namespace Plyo { namespace ConfigRules {

// Valeurs telles qu'Orca les écrit (opt_serialize), pour chaque clé lue par les règles. Une option tableau peut garder
// toutes ses cases (« 0.5,0.5 ») : seule la première compte, comme dans Orca (get_at(0), opt_float(clé, 0)).
using Values = std::map<std::string, std::string>;
// Nom français d'un réglage (vide si inconnu : un nom de repli, puis la clé, sont utilisés).
using Title = std::function<std::string(const std::string&)>;

// Réglage ajouté au lot pour qu'Orca n'ait rien à changer.
struct Added
{
    std::string    key;
    std::string    scope;      // print | filament
    nlohmann::json value;      // valeur typée, comme un changement du catalogue (vérifiée comme les autres)
    std::string    serialized; // texte qu'Orca relirait
    std::string    trigger;    // clé du lot qui l'exige : sa confirmation vaut pour ce complément
    std::string    why;        // raison courte, pour l'utilisateur
};

struct Outcome
{
    bool               ok = true;
    std::string        text; // « Refusé : … Aucune modification appliquée. » quand !ok
    std::vector<Added> added;
};

// Clés lues par complete(), par onglet (à fournir dans `state` quand elles existent).
const std::vector<std::string>& print_keys();
const std::vector<std::string>& filament_keys();

// Règles des fenêtres de cohérence d'Orca sur l'état final prévu (`state` : valeurs actuelles + lot). `requested` : clés du
// lot. Orca ne relance les contrôles d'un onglet que s'il est modifié (`print_touched`, `filament_touched`).
// `belt_printer` : imprimante à tapis (préréglage imprimante, lu par Orca dans la même fonction).
// Complète le lot seulement quand le réglage qui déclenche la règle est dans le lot et que les réglages à ajouter n'y sont
// pas ; sinon refuse.
Outcome complete(const Values& state, const std::set<std::string>& requested, bool print_touched, bool filament_touched,
                 bool belt_printer, const Title& title);

// Couple « première couche / couches suivantes » vérifié par Orca à l'enregistrement d'un filament
// (Tab::validate_filament_temperature_pairs, fenêtre « Temperature Safety Check ») ; même règle que
// SpoolsLogic::temperature_pairs_ok.
struct PairKeys
{
    std::string first;
    std::string other;
    int         max_delta;
};
// Seuls les couples touchés par le lot sont vérifiés. Quand le lot change les couches suivantes sans la première couche, et
// que l'écart d'avant était permis, la première couche suit le changement (même écart qu'avant) ; sinon refus qui dit quoi
// ajouter. `before` et `after` : premières valeurs entières, avant et après le lot.
Outcome temperature_pairs(const std::vector<PairKeys>& pairs, const std::map<std::string, int>& before,
                          const std::map<std::string, int>& after, const std::set<std::string>& requested, const Title& title);

// Relecture après l'écriture. `planned` : pour chaque réglage du lot, le texte écrit et le texte relu ; `changed` : toutes
// les clés qui ont changé entre avant et après. `refused` : réglages qu'Orca a remis ou modifiés ; `also` : réglages changés
// par Orca en plus du lot.
struct Written
{
    std::string expected;
    std::string actual;
};
struct Verdict
{
    std::vector<std::string> refused;
    std::vector<std::string> also;
};
Verdict verify(const std::map<std::string, Written>& planned, const std::set<std::string>& changed);

// Annulation : réglages retouchés depuis le lot (valeur actuelle différente de celle que le lot a laissée). `after` : clé →
// texte laissé par le lot (vide : inconnu, jamais compté comme retouché) ; `current` : clé → texte actuel.
std::vector<std::string> retouched(const std::map<std::string, std::string>& after, const std::map<std::string, std::string>& current);

// Nom à montrer pour un réglage : `title`, sinon un nom de repli pour les clés qu'Orca change sans être au catalogue
// (timelapse, couches de supports forcées), sinon la clé.
std::string label_of(const std::string& key, const Title& title);

}} // namespace Plyo::ConfigRules
