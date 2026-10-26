#pragma once

#include <boost/filesystem/path.hpp>
#include <nlohmann/json.hpp>

#include <string>

// Fichiers de Plyo sur le disque, sans dépendance à Orca (testé par src/plyo/tests/cpp).
// Chemins en UTF-8 (boost::nowide) : un dossier « C:\Users\Jérôme » fonctionne aussi sous Windows.
namespace Plyo { namespace Files {

enum class Status { Ok, Missing, Damaged };

struct Loaded
{
    Status                  status = Status::Missing;
    nlohmann::json          value;   // null si absent ou abîmé
    boost::filesystem::path kept_as; // copie mise de côté d'un fichier abîmé
};

// Lit un fichier JSON. Un fichier illisible, invalide ou plus gros que `max_bytes` est renommé
// « <nom>.abime-<n> » : le prochain enregistrement ne l'écrase pas, et il reste récupérable à la main.
Loaded read_json(const boost::filesystem::path& path, unsigned long long max_bytes);

// Écrit `text` en entier ou pas du tout : fichier temporaire vérifié et synchronisé sur le disque, puis renommé.
// `private_file` : lisible par l'utilisateur seul (mode 600).
bool write_atomic(const boost::filesystem::path& path, const std::string& text, bool private_file);

}} // namespace Plyo::Files
