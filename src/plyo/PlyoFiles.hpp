#pragma once

#include <boost/filesystem/path.hpp>
#include <nlohmann/json.hpp>

#include <memory>
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
// `private_file` : lisible par l'utilisateur seul (mode 600). Le fichier temporaire porte le numéro du processus et un
// compteur (« <nom>.tmp-<pid>-<n> ») : deux instances, ou deux fils, qui écrivent le même fichier ne se gênent pas (la
// dernière écriture complète gagne, jamais un mélange).
bool write_atomic(const boost::filesystem::path& path, const std::string& text, bool private_file);

// Nom du fichier temporaire de write_atomic : unique dans le processus (compteur) et entre processus (numéro du processus).
boost::filesystem::path temp_path_for(const boost::filesystem::path& path);

// Verrou d'instance sur un fichier (créé au besoin) : un seul processus le tient à la fois, et le système le rend tout seul
// quand ce processus s'arrête, même brutalement. Un seul objet par fichier et par processus (sur macOS et Linux, fermer un
// second objet sur le même fichier rendrait aussi le verrou du premier).
class InstanceLock
{
public:
    // Owned : ce processus tient le verrou ; Taken : un autre processus le tient ; Unknown : impossible de verrouiller
    // (fichier impossible à créer, système de fichiers sans verrou).
    enum class State { Owned, Taken, Unknown };

    explicit InstanceLock(const boost::filesystem::path& file);
    ~InstanceLock();
    InstanceLock(const InstanceLock&)            = delete;
    InstanceLock& operator=(const InstanceLock&) = delete;

    State state() const { return m_state; }

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
    State                 m_state = State::Unknown;
};

}} // namespace Plyo::Files
