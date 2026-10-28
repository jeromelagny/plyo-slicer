#pragma once

#include "PlyoJson.hpp"

#include <algorithm>
#include <string>
#include <vector>

// Enregistrement des profils par l'assistant : la part sans Orca (testée par src/plyo/tests/cpp).
namespace Plyo { namespace Profiles {

constexpr size_t MAX_NAME_BYTES = 100;

// Nom de la copie utilisateur d'un profil système (non écrasable) : « <nom> (Plyo) », puis « (Plyo 2) »…, sans doublon
// parmi `existing`, et jamais plus de MAX_NAME_BYTES octets (coupe sur un caractère entier).
inline std::string copy_name(const std::string& base, const std::vector<std::string>& existing)
{
    for (int n = 1;; ++n) {
        const std::string suffix = n == 1 ? " (Plyo)" : " (Plyo " + std::to_string(n) + ")";
        const std::string name   = Json::utf8_prefix(base, MAX_NAME_BYTES - suffix.size()) + suffix;
        if (std::find(existing.begin(), existing.end(), name) == existing.end())
            return name;
    }
}

// Nom du fichier de la version fiable d'un couple « imprimante | filament » : empreinte FNV-1a de 16 chiffres
// hexadécimaux (stable d'une exécution à l'autre, sans caractère dangereux pour un nom de fichier).
inline std::string file_stem(const std::string& machine_key)
{
    unsigned long long hash = 1469598103934665603ULL;
    for (const unsigned char c : machine_key) {
        hash ^= c;
        hash *= 1099511628211ULL;
    }
    static const char digits[] = "0123456789abcdef";
    std::string       out(16, '0');
    for (int i = 15; i >= 0; --i, hash >>= 4)
        out[i] = digits[hash & 0xF];
    return out;
}

}} // namespace Plyo::Profiles
