#pragma once

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

// Projet 3MF de chaque conversation (datadir/plyo/projets/<conv>.3mf) : la part sans Orca (testée par src/plyo/tests/cpp).
namespace Plyo { namespace ProjectFilesLogic {

// Au-delà, le plateau n'est pas gardé : seule la fiche de la conversation reste.
constexpr unsigned long long MAX_PROJECT_BYTES = 50ULL * 1024 * 1024;

// Délai sans changement avant d'écrire le 3MF (l'export tourne sur le fil de l'interface : on attend que l'utilisateur ait fini).
constexpr long long QUIET_MS = 3000;

struct SaveState
{
    bool      attached           = false; // le plateau est rattaché au projet d'une conversation
    bool      changed_since_save = false; // l'empreinte a changé depuis la dernière écriture
    bool      slicing            = false; // Orca découpe
    bool      sending            = false; // Orca exporte ou envoie un fichier à l'imprimante
    long long quiet_ms           = 0;     // temps écoulé depuis le dernier changement
};

// Vrai seulement si le plateau est attaché, a changé, que rien ne découpe ni n'envoie, et après QUIET_MS de calme.
inline bool should_save(const SaveState& s)
{
    return s.attached && s.changed_since_save && !s.slicing && !s.sending && s.quiet_ms >= QUIET_MS;
}

// Pourquoi le 3MF d'une conversation ne peut pas être rouvert : "" (il peut l'être), "absent", "trop_gros" (au-delà de
// MAX_PROJECT_BYTES : il n'est même pas lu) ou "abime" (vide, ou pas un 3MF lisible).
inline std::string open_reason(bool exists, unsigned long long size, bool parsed_ok)
{
    if (!exists)
        return "absent";
    if (size > MAX_PROJECT_BYTES)
        return "trop_gros";
    if (size == 0 || !parsed_ok)
        return "abime";
    return "";
}

// Empreinte des modifications : numéro de projet de Plyo (chaque nouveau projet ou chargement vide la pile d'annulation
// d'Orca, dont le compteur repart de 0), instant de la pile d'annulation (pièces, positions, réglages par objet) et
// compteur des changements de réglages (onglets, plateau sans objet choisi).
struct Fingerprint
{
    std::uint64_t project  = 0;
    std::uint64_t snapshot = 0;
    std::uint64_t settings = 0;
    bool operator==(const Fingerprint& o) const { return project == o.project && snapshot == o.snapshot && settings == o.settings; }
    bool operator!=(const Fingerprint& o) const { return !(*this == o); }
};

// Projets dont la conversation n'existe plus (effacée, ou au-delà des 30 gardées), dans l'ordre de `files`.
inline std::vector<std::string> orphans(const std::vector<std::string>& kept_conversations, const std::vector<std::string>& files)
{
    std::vector<std::string> out;
    for (const std::string& f : files)
        if (std::find(kept_conversations.begin(), kept_conversations.end(), f) == kept_conversations.end())
            out.push_back(f);
    return out;
}

}} // namespace Plyo::ProjectFilesLogic
