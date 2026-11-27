#pragma once

#include "PlyoCatalogPolicy.hpp"

// Charge la politique et la liste des réglages du catalogue depuis resources/plyo (livrés avec l'application).
// Si un des deux fichiers manque ou est abîmé, la politique est vide : l'assistant ne peut alors rien lire ni écrire
// en mode catalogue (échec fermé).
namespace Plyo { namespace Catalog {

const Policy& policy();

}} // namespace Plyo::Catalog
