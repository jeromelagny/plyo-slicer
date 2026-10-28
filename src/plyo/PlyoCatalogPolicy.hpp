#pragma once

#include <nlohmann/json.hpp>

#include <map>
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
    // Clés autorisées de la portée, dans l'ordre alphabétique.
    std::vector<std::string> keys(const std::string& scope) const;

private:
    std::vector<std::string>                           m_forbidden_patterns, m_forbidden_keys, m_confirm_patterns, m_confirm_keys;
    std::map<std::string, std::map<std::string, std::string>> m_keys;
};

// Valeur d'une option d'Orca sérialisée en texte → JSON (nombre, booléen, texte), ou null si illisible ou « nil ».
// Un pourcentage écrit « 15% » reste un texte ; sans « % » c'est un nombre.
nlohmann::json typed_value(const std::string& kind, const std::string& text);

}} // namespace Plyo::Catalog
