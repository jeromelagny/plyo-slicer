#pragma once

#include <algorithm>
#include <string>
#include <vector>

// Type de plateau choisi par l'utilisateur dans le panneau (logique pure, testée sans Orca) : liste montrée et vérification d'une
// demande. Le changement lui-même passe par la liste déroulante d'Orca (SettingsBridge::set_bed_type). Jamais sur décision de
// l'IA : ni les ordres (Commands), ni « apply », ni le catalogue n'atteignent ce choix.
namespace Plyo { namespace BedLogic {

// Valeurs d'Orca (curr_bed_type, s_keys_map_BedType dans PrintConfig.cpp) que le panneau peut retenir pour une imprimante.
inline const std::vector<std::string>& known_values()
{
    static const std::vector<std::string> values = {"Cool Plate",         "Engineering Plate",   "High Temp Plate",
                                                    "Textured PEI Plate", "Textured Cool Plate", "Supertack Plate"};
    return values;
}

// « Je ne sais pas » : la question est posée, le réglage d'Orca reste tel quel.
inline const char* unknown_answer() { return "unknown"; }

// Réponse retenue (habits.json, `beds`) : une valeur d'Orca connue, ou « unknown ».
inline bool is_answer(const std::string& value)
{
    const std::vector<std::string>& known = known_values();
    return value == unknown_answer() || std::find(known.begin(), known.end(), value) != known.end();
}

struct Offer
{
    std::string value; // valeur d'Orca (« Textured PEI Plate »)
    std::string label; // libellé d'Orca, en anglais (« Textured PEI Plate », « Smooth Cool Plate »…)
};

// Les types montrés au panneau : ceux de la liste déroulante d'Orca, seulement quand Orca la montre pour l'imprimante en cours
// (`shown` : Bambu Lab, ou profil qui déclare support_multi_bed_types) et qu'il y a vraiment un choix (deux types au moins).
inline std::vector<Offer> offered(bool shown, const std::vector<Offer>& combo)
{
    if (!shown || combo.size() < 2)
        return {};
    return combo;
}

// Refus d'une demande de changement, en mots simples ; vide si la valeur fait partie des types proposés.
inline std::string refusal(const std::vector<Offer>& offers, const std::string& wanted)
{
    if (offers.empty())
        return "Ton imprimante n'a qu'un type de plateau dans Plyo Slicer : il n'y a rien à choisir. Je n'ai rien changé.";
    for (const Offer& o : offers)
        if (o.value == wanted)
            return std::string();
    return "Ce type de plateau n'est pas proposé pour ton imprimante : je n'ai rien changé.";
}

}} // namespace Plyo::BedLogic
