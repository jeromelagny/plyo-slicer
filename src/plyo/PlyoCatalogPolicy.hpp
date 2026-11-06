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

// Plafond Plyo (°C) d'une clé de température, absent pour les autres clés. Dernière barrière, large : les bornes d'Orca vont
// jusqu'à 1500 °C (buse) et 300 °C (plateau), et les limites du fabricant peuvent manquer ou être passées par une confirmation.
std::optional<double> temperature_cap(const std::string& key);
// Refus si la valeur dépasse ce plafond, confirmation ou non. Une valeur non numérique est laissée à check_change.
CheckResult check_temperature_cap(const std::string& label, const std::string& key, const nlohmann::json& value);

// Valeur comme Orca la relit (point décimal, « 15% » pour un pourcentage, 1/0 pour un booléen). Vide si le type ne convient pas.
std::string to_serialized(const OptionInfo& info, const nlohmann::json& value);

// Identifiant des limites du fabricant pour une clé de température (nozzle_temp, bed_temp…), vide pour les autres.
std::string limit_id_of(const std::string& key);

}} // namespace Plyo::Catalog
