#pragma once

#include <boost/filesystem/path.hpp>
#include <nlohmann/json.hpp>

#include <string>

// Fichiers JSON de Plyo dans datadir/plyo : lecture tolérante (fichier absent ou abîmé → null ; un fichier abîmé
// est mis de côté, jamais écrasé) et écriture atomique, lisible par l'utilisateur seul (mode 600).
namespace Plyo { namespace Store {

// Au-dessus des plus gros fichiers attendus (journal : 200 fiches avec vignette de 40 Ko au plus).
constexpr unsigned long long MAX_READ_BYTES = 16ULL * 1024 * 1024;

boost::filesystem::path dir(const std::string& sub = std::string());
nlohmann::json          read(const boost::filesystem::path& path);
bool                    write(const boost::filesystem::path& path, const nlohmann::json& value);

// Verrou d'instance (ROB-16), datadir/plyo/.lock : pris au démarrage (FirstSteps::on_startup) et tenu jusqu'à la fin du
// processus ; le système le rend tout seul si l'application s'arrête net. Sans effet après le premier appel.
void claim_instance();
// Vrai si une autre instance de Plyo tient le verrou de ce dossier de données : ses écritures et les nôtres peuvent
// s'écraser. Faux si le verrou est à nous, ou si le système de fichiers ne sait pas verrouiller (rien n'est affirmé).
bool other_instance();

}} // namespace Plyo::Store
