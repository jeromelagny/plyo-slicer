#pragma once

#include <boost/filesystem/path.hpp>
#include <nlohmann/json.hpp>

#include <string>

// Fichiers JSON de Plyo dans datadir/plyo : lecture tolérante (fichier absent ou abîmé → null) et écriture
// atomique, lisible par l'utilisateur seul (mode 600).
namespace Plyo { namespace Store {

constexpr unsigned long long MAX_READ_BYTES = 8ULL * 1024 * 1024;

boost::filesystem::path dir(const std::string& sub = std::string());
nlohmann::json          read(const boost::filesystem::path& path);
bool                    write(const boost::filesystem::path& path, const nlohmann::json& value);

}} // namespace Plyo::Store
