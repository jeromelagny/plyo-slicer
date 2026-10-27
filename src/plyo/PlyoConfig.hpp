#pragma once

#include <string>

namespace Plyo { namespace Config {

// Adresse du service Plyo, sans « / » final : la variable d'environnement PLYO_API_URL si elle est valide
// (développement, ex. http://localhost:3000), sinon celle fixée à la compilation (option CMake PLYO_API_URL).
std::string api_url();

// Script à charger avant les pages Plyo : « window.PLYO_API_URL = "…"; ».
std::string api_url_script();

}} // namespace Plyo::Config
