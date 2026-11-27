#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

// Marque d'une bobine : la part sans Orca (testée par src/plyo/tests/cpp). Les profils de filament fournis (système) d'une
// matière, compatibles avec l'imprimante en cours, sont lus par Plyo::Brands ; ici, on les range par marque et on rapproche
// ce qu'annonce un système multi-filament (CFS, Canvas…) d'un de ces profils. Rien n'est choisi ici : un profil de marque
// n'est retenu que sur un geste de l'utilisateur dans le panneau.
namespace Plyo { namespace BrandsLogic {

// Un profil fourni, tel que lu dans Orca.
struct Candidate
{
    std::string preset;                 // nom du profil (« Hyper PLA @K2-all », « eSUN PLA+ @System »)
    std::string vendor;                 // filament_vendor, première valeur (« Creality », « eSUN », « Generic »)
    bool        printer_bundle = false; // fourni avec les profils de la marque de l'imprimante (pas la bibliothèque commune)
};

constexpr size_t MAX_BRAND_BYTES = 60;
constexpr size_t MAX_LABEL_BYTES = 80;

// Clé de comparaison : minuscules ASCII, sans espaces, tirets ni soulignés (« Hyper-PLA » = « hyper pla »). Le « + » compte :
// « PLA+ » n'est pas « PLA ».
std::string norm(const std::string& text);

// Nom d'une gamme d'après le nom du profil : la partie avant « @ », espaces de bord retirés (« Hyper PLA @K2-all » → « Hyper PLA »).
std::string range_label(const std::string& preset);

// Un profil générique : marque vide ou « Generic », ou nom de gamme qui commence par « Generic ».
bool is_generic(const std::string& vendor, const std::string& label);

// Profils de marque rangés : [{brand, printer, ranges: [{preset, label, short}]}] (`printer` : la marque de l'imprimante, ou
// une marque dont des profils sont fournis avec l'imprimante). Génériques écartés. Une marque : celles dont la clé
// (norm) est la même ne font qu'une ; une gamme : un seul profil par nom court (norm), celui des profils de l'imprimante d'abord.
// `short` : le nom de la gamme sans la marque devant (« eSUN PLA+ » → « PLA+ »), sinon le nom entier.
// Ordre : la marque de l'imprimante (`printer_brand`), puis les marques qui ont des profils fournis avec l'imprimante, puis
// les autres ; à rang égal, ordre alphabétique (sans la casse). Gammes : ordre alphabétique.
nlohmann::json group(const std::vector<Candidate>& candidates, const std::string& printer_brand);

// Entrée {brand, label, short, preset} du profil `preset` dans `groups`, ou {} s'il n'y est pas.
nlohmann::json find(const nlohmann::json& groups, const std::string& preset);

// Ce qu'annonce un système multi-filament (marque `brand`, nom `name`) rapproché d'une gamme : {brand, label, short, preset}
// seulement si exactement une gamme de cette marque correspond, à la normalisation près (norm) : le nom annoncé est le nom de
// la gamme, ou son nom court, avec ou sans la marque devant. Marque ou nom vides, marque inconnue, aucune ou plusieurs gammes :
// {}. Jamais de ressemblance approchée : c'est une proposition que l'utilisateur confirme.
nlohmann::json match(const nlohmann::json& groups, const std::string& brand, const std::string& name);

// La gamme `range` de la marque `brand` (même rapprochement exact que match) : pour une bobine déjà nommée par l'utilisateur,
// sur une nouvelle imprimante. {} si rien ne correspond exactement.
nlohmann::json same_range(const nlohmann::json& groups, const std::string& brand, const std::string& range);

// Marque saisie par l'utilisateur (« Autre marque ») : espaces réduits, caractères de contrôle et / \ : * ? " < > | retirés,
// coupée à MAX_BRAND_BYTES. "" si elle fait moins de 2 caractères.
std::string clean_brand(const std::string& typed);

}} // namespace Plyo::BrandsLogic
