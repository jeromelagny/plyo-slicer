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

// Un plateau ne s'attache à une conversation que s'il n'est pas un fichier de l'utilisateur : ni projet nommé (ouvert ou
// enregistré sous un nom), ni fichier chargé par lui sans nom (jusqu'au prochain nouveau projet). Sinon Plyo ferait taire
// la question « enregistrer ? » d'Orca et garderait ses modifications dans datadir au lieu de son fichier.
inline bool attachable(bool has_project_file, bool user_loaded) { return !has_project_file && !user_loaded; }

// Le plateau quitté (écrit dans le 3MF de sa conversation, empreinte `kept`) peut être remplacé sans rien demander :
// même projet, même état du plateau, et aucun préréglage modifié depuis. Le compteur de réglages n'entre pas en compte :
// vider les modifications en partant le fait bouger.
inline bool plate_unchanged(const Fingerprint& kept, const Fingerprint& now, bool presets_dirty)
{
    return kept.project == now.project && kept.snapshot == now.snapshot && !presets_dirty;
}

// L'export 3MF tourne sur le fil de l'interface : jamais pendant une découpe, un envoi, une calibration (son plateau de
// test n'est pas celui du projet) ou une fenêtre modale.
inline bool write_allowed(bool slicing, bool sending, bool calibrating, bool modal) { return !slicing && !sending && !calibrating && !modal; }

// Une conversation peut prendre le plateau : pas de départ en attente d'écriture, et pas d'autre plateau modifié qu'Orca,
// occupé, ne laisserait pas écrire (ses réglages, et ses derniers changements, iraient dans la nouvelle conversation).
inline bool attach_allowed(bool pending_detach, bool other_plate_unsaved, bool busy)
{
    return !pending_detach && !(other_plate_unsaved && busy);
}

// Texte du refus quand Orca n'a pas fini (découpe, envoi) et que le projet d'avant n'est pas encore rangé.
// À l'attache de `attaching` : les réglages d'impression en cours appartiennent au plateau de `owner` (owns_edits). Ils
// sont oubliés s'ils sont ceux d'une autre conversation (jamais repris par elle), gardés si la conversation revient sur
// son propre plateau (perdu : disque plein, trop lourd ; ils n'ont été écrits nulle part).
inline bool forget_edits_on_attach(bool owns_edits, const std::string& owner, const std::string& attaching)
{
    return owns_edits && owner != attaching;
}

constexpr const char* BUSY_TEXT = "J’attends qu’Orca ait fini ce qu’il fait (découpe, envoi, test ou fenêtre ouverte) pour ranger le projet d’avant ; réessaie dans un instant.";

// Résultat d'une écriture du 3MF : écrit, Orca occupé (rien n'est tenté), ou perdu (trop lourd, disque plein, droits :
// le plateau n'est plus gardé avec la conversation, seule sa fiche reste, et le panneau le dit).
enum class WriteResult { Ok, Busy, Lost };

// Départ d'une conversation selon l'écriture de son 3MF : fait (`detached`), réglages d'impression oubliés (`forget`,
// si demandé), ou en attente (`pending`, seulement quand Orca est occupé). Une écriture perdue ne laisse jamais rien
// en attente : sinon tout serait refusé avec « occupe » alors que rien n'occupe Orca.
struct Leave
{
    bool detached = false;
    bool forget   = false;
    bool pending  = false;
};
inline Leave leave_after(WriteResult r, bool forget_print_edits)
{
    if (r == WriteResult::Busy)
        return {false, false, true};
    return {true, forget_print_edits, false};
}

// Ouverture d'une conversation refusée parce qu'Orca est occupé (`reason` "occupe") : le panneau la montre déjà, mais le
// plateau est encore celui d'avant. Renvoie la conversation qui attend son plateau ("" : aucune).
inline std::string pending_open_after(const std::string& conv, const std::string& reason)
{
    return reason == "occupe" ? conv : std::string();
}

// Réglages, bobine et pièce de la conversation affichée : refusés tant que le plateau est encore celui d'une autre (départ
// en attente d'écriture, ou ouverture refusée par « occupe » que le panneau redemande).
inline bool edits_blocked(bool pending_detach, const std::string& pending_open) { return pending_detach || !pending_open.empty(); }

// Fichier de l'utilisateur chargé dans Orca (Fichier › Ouvrir, projet récent, sauvegarde de secours) : Orca remet le
// filament du fichier en « modifié » sur le préréglage qu'il nomme. Si c'est une bobine, la bobine fait foi : ces valeurs
// sont oubliées, sinon l'enregistrement automatique les écrirait dans la bobine 2 s plus tard.
inline bool drops_loaded_filament_edits(bool user_loaded, bool filament_dirty, bool is_spool)
{
    return user_loaded && filament_dirty && is_spool;
}

// Question « enregistrer les modifications ? » d'Orca (`caption`) que Plyo peut prendre à sa place : seulement celles de la
// fermeture, d'un nouveau projet ou de l'ouverture d'un projet (`project_captions`, traduits comme Orca les affiche).
// Mise à jour des profils, assistants, déconnexion, export de configuration, instantanés : Orca demande comme avant (les
// réglages de la pièce ne sont pas oubliés en silence).
inline bool project_question(const std::string& caption, const std::vector<std::string>& project_captions)
{
    return !caption.empty() && std::find(project_captions.begin(), project_captions.end(), caption) != project_captions.end();
}

// Conversations à effacer pour faire de la place, d'après leurs fichiers du plus récent au plus ancien (`has_plate` : un
// projet 3MF existe pour elle). La limite compte à part celles qui ont un plateau et les simples questions : une série de
// questions ne fait jamais partir un projet. Rend les rangs à effacer, dans l'ordre de `has_plate`.
inline std::vector<size_t> to_prune(const std::vector<bool>& has_plate, size_t max_plates, size_t max_others)
{
    std::vector<size_t> out;
    size_t              plates = 0, others = 0;
    for (size_t i = 0; i < has_plate.size(); ++i)
        if (has_plate[i] ? ++plates > max_plates : ++others > max_others)
            out.push_back(i);
    return out;
}

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
