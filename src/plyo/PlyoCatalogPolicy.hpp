#pragma once

#include "PlyoLimitsLogic.hpp"

#include <nlohmann/json.hpp>

#include <map>
#include <optional>
#include <string>
#include <vector>

// Ce que l'assistant peut lire et écrire : les réglages Filament + Impression du catalogue généré depuis Orca
// (resources/plyo/catalog-keys.json), moins tout ce que la politique interdit (G-code, identité des profils…,
// resources/plyo/policy.json). Sans dépendance à Orca (testé par src/plyo/tests/cpp).
namespace Plyo { namespace Catalog {

class Policy
{
public:
    // policy : contenu de policy.json ; keys : { "print": {clé: type}, "filament": {clé: type} } (types : int, float,
    // percent, float_or_percent, bool, enum).
    static Policy from_json(const nlohmann::json& policy, const nlohmann::json& keys);

    bool is_forbidden(const std::string& key) const;
    // scope : « print » ou « filament ». Vrai si la clé est au catalogue de cette portée et n'est pas interdite.
    bool allows(const std::string& scope, const std::string& key) const;
    bool needs_confirmation(const std::string& key) const;
    // Type de la clé (« float », « enum »…), vide si elle n'est pas autorisée.
    std::string kind(const std::string& scope, const std::string& key) const;
    // Nom français du réglage (vide si inconnu).
    std::string title(const std::string& key) const;
    // Clés autorisées de la portée, dans l'ordre alphabétique.
    std::vector<std::string> keys(const std::string& scope) const;

private:
    std::vector<std::string>                           m_forbidden_patterns, m_forbidden_keys, m_confirm_patterns, m_confirm_keys;
    std::map<std::string, std::map<std::string, std::string>> m_keys;
    std::map<std::string, std::string>                        m_titles;
};

// Valeur d'une option d'Orca sérialisée en texte → JSON (nombre, booléen, texte), ou null si illisible ou « nil ».
// Un pourcentage écrit « 15% » reste un texte ; sans « % » c'est un nombre.
nlohmann::json typed_value(const std::string& kind, const std::string& text);

// Ce que le slicer sait d'une option d'Orca (ConfigOptionDef) pour vérifier un changement.
struct OptionInfo
{
    std::string                 kind; // int, float, percent, float_or_percent, bool, enum
    std::optional<double>       min, max;
    std::vector<std::string>    enum_values;
};

struct CheckResult
{
    bool        ok = true;
    std::string text; // « Refusé : … » (français) quand !ok
};

// Les bornes d'Orca sont des float, lues en double : 0.1f vaut 0,1000000015. Cette marge accepte la valeur écrite dans la
// définition (0,1) sans laisser passer une vraie sortie de plage.
constexpr double BOUND_MARGIN = 1e-6;

// Le slicer fait autorité : type, bornes d'Orca, puis limites du fabricant pour les températures (`limit_id` non vide).
// `confirmed_outside` : l'utilisateur a coché lui-même une ligne hors plage du fabricant.
CheckResult check_change(const std::string& label, const OptionInfo& info, const nlohmann::json& value, const Limits::Range& limits,
                         const std::string& limit_id, bool confirmed_outside);

// Plafond Plyo (°C) d'une clé de température, absent pour les autres clés. Dernière barrière : les bornes d'Orca vont
// jusqu'à 1500 °C (buse) et 300 °C (plateau), et les limites du fabricant peuvent manquer ou être passées par une confirmation.
// Mêmes plafonds que le service (plyo-api, whitelist.ts et catalog-changes.ts) : 300 °C pour la buse, 110 °C pour le plateau
// et le caisson.
std::optional<double> temperature_cap(const std::string& key);
// Refus si la valeur dépasse ce plafond, confirmation ou non. Une valeur non numérique est laissée à check_change.
CheckResult check_temperature_cap(const std::string& label, const std::string& key, const nlohmann::json& value);

// Valeur comme Orca la relit (point décimal, « 15% » pour un pourcentage, 1/0 pour un booléen). Vide si le type ne convient pas.
std::string to_serialized(const OptionInfo& info, const nlohmann::json& value);

// Identifiant des limites du fabricant pour une clé de température (nozzle_temp, bed_temp…), vide pour les autres.
std::string limit_id_of(const std::string& key);

// --- Dernière barrière : ce que le service vérifie déjà (plyo-api/src/lib/catalog-changes.ts), revérifié ici ---

// Valeur demandée comparée à la valeur actuelle (`current` : valeur typée du relevé, null si inconnue). `nozzle_mm` : diamètre
// de la buse (0 si inconnu).
// Bornes strictes, jamais levées, même confirmées : diamètre du filament (1,5 à 3,1 mm), hauteurs de couche (75 % de la
// buse au plus), températures de buse (170 à 300 °C, sauf -1 « automatique » de la tour) et de plateau (0 à 110 °C),
// unité d'un réglage « mm ou % » (la même qu'aujourd'hui : 40 n'est pas 40 %).
CheckResult check_hard(const std::string& label, const std::string& key, const OptionInfo& info, const nlohmann::json& value,
                       const nlohmann::json& current, double nozzle_mm);

// Écart permis sans confirmation : 30 % de la valeur actuelle, ou un plancher proportionné à la plage d'Orca (`floorOf` du
// service) ; 0,1 mm pour le diamètre du filament. Les températures : 15 °C (buse et autres), 10 °C (plateau).
double max_delta(const std::string& key, const OptionInfo& info, double current);
// Refus si l'écart dépasse max_delta, ou si la valeur actuelle est inconnue sans bornes d'Orca pour la remplacer. Levé par
// une confirmation explicite de l'utilisateur.
CheckResult check_delta(const std::string& label, const std::string& key, const OptionInfo& info, const nlohmann::json& value,
                        const nlohmann::json& current);

// Réglage qui ne s'applique qu'avec une confirmation explicite : risque « confirmation » de la politique, et les réglages
// physiques du filament que le service traite pareil (diamètre, rapport de débit, température d'interface de la tour).
bool requires_confirmation(const Policy& policy, const std::string& key);

// Tout le contrôle d'un changement du catalogue avant l'écriture, dans l'ordre : plafond de température, type et bornes
// d'Orca, bornes strictes, limites du fabricant (`confirmed_outside`), puis, sans `confirmed`, le réglage sensible et
// l'écart. `code` du refus : « needs_confirmation » quand une confirmation suffirait, vide sinon.
struct Verdict
{
    CheckResult check;
    std::string code;
};
Verdict check_barrier(const Policy& policy, const std::string& label, const std::string& key, const OptionInfo& info,
                      const nlohmann::json& value, const nlohmann::json& current, double nozzle_mm, const Limits::Range& limits,
                      bool confirmed_outside, bool confirmed);

}} // namespace Plyo::Catalog
