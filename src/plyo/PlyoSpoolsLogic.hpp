#pragma once

#include "PlyoProfilesLogic.hpp"

#include <nlohmann/json.hpp>

#include <map>
#include <string>
#include <vector>

// Registre des bobines : la part sans Orca (testée par src/plyo/tests/cpp).
namespace Plyo { namespace SpoolsLogic {

// Nom de bobine saisi, nettoyé : espaces de bord supprimés, espaces multiples réduits, / \ : * ? " < > | remplacés par
// un espace, coupé à 60 octets sur un caractère entier. "" si le résultat fait moins de 3 caractères.
std::string clean_name(const std::string& typed);

// Clé de comparaison de deux noms : minuscules ASCII, espaces réduits.
std::string key_of(const std::string& name);

// Nom du préréglage filament d'une bobine pour une machine : « <bobine> — <machine> », coupé à Profiles::MAX_NAME_BYTES.
// S'il existe déjà chez l'utilisateur (`existing`) sans être à nous (`ours`) : « 2 », « 3 »… ; s'il est à nous, on l'écrase.
std::string preset_name(const std::string& spool, const std::string& machine_label, const std::vector<std::string>& existing,
                        const std::vector<std::string>& ours);

// Registre lu depuis le disque, remis en forme : {spools: [{id, name, material, brand?, range?, machines: {<imprimante>: {preset,
// last_outcome: "ok"|"bad"|"", last_ok_at: "AAAA-MM-JJ"|""}}}]}. Lignes invalides écartées, 200 bobines au plus.
// `brand` (marque dite à l'étape Filament) et `range` (sa gamme) n'existent que s'ils sont dits (BrandsLogic::clean_brand) ;
// une gamme sans marque est écartée.
// `colour` (couleur du filament de la dernière impression envoyée, « #RRGGBB ») n'existe que si elle est valable.
nlohmann::json sanitize(const nlohmann::json& raw);

// « #RRGGBB » en majuscules (un « #RRGGBBAA » d'Orca garde ses six premiers chiffres), ou "" si le texte n'est pas une couleur.
std::string clean_colour(const std::string& text);

// Note la couleur de la bobine `id` (celle de la plaque à l'envoi), pour la reconnaître dans la liste. Couleur invalide ou
// bobine inconnue : registre (nettoyé) inchangé.
nlohmann::json set_colour(const nlohmann::json& reg, const std::string& id, const std::string& colour);

// Ajoute une bobine : {reg, id, created}. Une bobine de même `key_of` est reprise (created faux), sans changer sa marque.
// Refus (nom ou matière invalide, registre plein) : registre inchangé, id "", created faux.
nlohmann::json add(const nlohmann::json& reg, const std::string& name, const std::string& material, const std::string& brand = "",
                   const std::string& range = "");

// Bobines pour une imprimante : [{id, name, material, brand?, range?, colour ("" si inconnue), has_preset, last_outcome, last_ok_at}], la dernière
// réussite d'abord.
nlohmann::json for_machine(const nlohmann::json& reg, const std::string& printer);

// Marque et gamme de la bobine `id` : {brand, range} (textes vides si elles n'ont pas été dites ou si la bobine est inconnue).
nlohmann::json brand_of(const nlohmann::json& reg, const std::string& id);

// Id de la bobine qui possède ce préréglage filament, ou "".
std::string spool_of_preset(const nlohmann::json& reg, const std::string& filament_preset);

// Préréglage de la bobine `id` pour ce préréglage d'imprimante ; vide si elle n'en a pas encore (ou bobine inconnue).
std::string preset_for(const nlohmann::json& reg, const std::string& id, const std::string& printer);

// Note le préréglage de la bobine `id` pour cette imprimante. Le résultat de la machine repart à zéro : il parlait
// d'autres valeurs. Bobine inconnue ou imprimante vide : registre (nettoyé) inchangé.
// `pending` : nom réservé AVANT l'enregistrement par Orca. Si l'enregistrement échoue en laissant le préréglage dans
// Orca, le nouvel essai retrouve ce nom (preset_for → `ours` de preset_name) et l'écrase, au lieu de créer « … 2 ».
// Tant qu'il est en attente, ce n'est pas un préréglage de bobine utilisable (has_preset faux, spool_of_preset l'ignore).
nlohmann::json set_preset(const nlohmann::json& reg, const std::string& id, const std::string& printer, const std::string& preset,
                          bool pending = false);

// Préréglage de l'utilisateur (choisi dans Orca, hors registre) inscrit comme bobine `name` pour cette imprimante, sans
// le renommer : {reg, id, created}. Déjà une bobine : registre inchangé, son id. Refus (id "") : préréglage ou imprimante
// vides, nom ou matière invalides (comme add), ou bobine du même nom ayant déjà un autre préréglage sur cette machine
// (jamais deux préréglages pour une bobine et une machine).
nlohmann::json adopt(const nlohmann::json& reg, const std::string& preset, const std::string& name, const std::string& material,
                     const std::string& printer);

// Le préréglage noté pour la bobine `id` sur cette imprimante attend-il encore son enregistrement ?
bool is_pending(const nlohmann::json& reg, const std::string& id, const std::string& printer);

// Nom de la bobine `id`, vide si elle est inconnue.
std::string spool_name(const nlohmann::json& reg, const std::string& id);

// Nom court de la machine, comme le panneau l'affiche (journey-logic.js machineLabel et ficheSummary) : sans « Ma » devant,
// sans « - Copie » / « - Copy », « (Plyo) » ni « 0.4 nozzle » derrière. « Ma Creality CR-10 SE 0.4 nozzle » → « Creality CR-10 SE ».
std::string machine_label(const std::string& printer_preset);

// État vu par l'enregistrement automatique (Plyo::AutoSave), relevé toutes les 500 ms.
struct AutoSaveState
{
    bool      filament_dirty = false; // le préréglage filament en cours a des modifications non enregistrées
    bool      is_spool       = false; // ce préréglage est celui d'une bobine du registre (spool_of_preset non vide)
    bool      slicing        = false; // Orca découpe
    bool      sending        = false; // Orca exporte ou envoie un fichier à l'imprimante
    long long quiet_ms       = 0;     // temps écoulé depuis le dernier changement de réglage
    bool      calibrating    = false; // une calibration (de Plyo ou d'Orca) a changé le filament pour son test
};

constexpr long long AUTOSAVE_QUIET_MS = 2000;

// Vrai seulement si le préréglage est modifié, est une bobine, que rien ne découpe ni n'envoie, qu'aucune calibration
// n'est en cours (ses valeurs de test ne doivent jamais entrer dans la bobine), et après AUTOSAVE_QUIET_MS sans
// changement (l'utilisateur a fini de taper).
bool should_save_spool(const AutoSaveState& state);

// Résultat d'une impression avec la bobine `id` sur cette imprimante : "ok" (last_outcome "ok", last_ok_at = `date`) ou
// "bad" (last_outcome "bad", la date de la dernière réussite reste). Bobine inconnue, machine sans préréglage (ou encore
// « en attente »), résultat ou date invalides : registre (nettoyé) inchangé.
nlohmann::json set_outcome(const nlohmann::json& reg, const std::string& id, const std::string& printer, const std::string& outcome,
                           const std::string& date);

// Nom du fichier de la version envoyée (plyo/essai) ou réussie (plyo/fiable) d'une bobine sur une imprimante :
// Profiles::file_stem(id + "|" + imprimante).
std::string version_stem(const std::string& id, const std::string& printer);

// Fichier de version relu : {spool, printer, date: "AAAA-MM-JJ", at: instant de l'envoi ("" s'il manque), values: {clé
// filament: texte d'Orca}[, print: {clé impression: texte d'Orca}]}, ou {} s'il manque la bobine, l'imprimante ou une date
// valable. Les valeurs qui ne sont pas du texte sont écartées ; dans `print`, aussi celles qui ne suivent pas la bobine.
nlohmann::json sanitize_version(const nlohmann::json& raw);

// Réglage de l'onglet Impression qui suit la bobine d'un projet à l'autre : la façon d'imprimer cette matière sur cette
// machine (débits, vitesses, accélérations, première couche, patte d'éléphant). Ce que la forme de la pièce décide
// (supports, bordure, radeau, jupe, lissage, remplissage, parois, couture, hauteur de couche…) reste avec son projet.
bool carries_with_spool(const std::string& key);

// Réglages d'impression réussis (`ok_print`) à remettre dans un projet : ceux qui suivent la bobine, diffèrent d'aujourd'hui
// (`edited`) et n'ont pas été changés dans ce projet (valeur éditée = valeur enregistrée du profil, `saved`).
nlohmann::json print_to_restore(const nlohmann::json& ok_print, const std::map<std::string, std::string>& saved,
                                const std::map<std::string, std::string>& edited);

// Dernier envoi (plyo/essai/dernier-envoi.json) relu : {spool, printer, date, at[, answered: "bad"]}, ou {} s'il manque
// l'un d'eux. Une réussite dite dans la discussion vise cet envoi, même si une autre bobine a été choisie depuis.
nlohmann::json last_sent(const nlohmann::json& raw);

// Au-delà, un envoi est trop ancien pour qu'une réussite dite dans la discussion le marque.
constexpr long long SENT_MAX_AGE_HOURS = 48;

// Dernier envoi déjà déclaré (`outcome` "bad" : « c'est raté ») : {…, answered: "bad"}. Une réussite dite ensuite ne le
// marque plus. Autre résultat : inchangé ; pointeur invalide : {}.
nlohmann::json answered(const nlohmann::json& pointer, const std::string& outcome);

// Une réussite dite peut-elle marquer ce dernier envoi ? "" (oui), "none" (pas d'envoi), "answered" (déjà déclaré raté),
// "old" (plus de SENT_MAX_AGE_HOURS avant `now_iso`, plus d'une heure dans le futur, ou instant illisible), "other" (pas
// la bobine `expected_spool` de la conversation, ou bobine non dite). Instants « AAAA-MM-JJTHH:MM:SS », heure locale.
std::string sent_refusal(const nlohmann::json& pointer, const std::string& expected_spool, const std::string& now_iso);

// Avant que Plyo change de filament (bobine choisie, projet remis, calibration), la bobine en cours modifiée est écrite :
// sinon Orca proposerait de transférer ses modifications sur l'autre filament, ou Plyo les jetterait.
// Clean (rien de modifié), Save (l'écrire d'abord), NotSpool (pas une bobine : Orca garde sa question), Refuse (bobine
// qu'on ne peut pas écrire maintenant, test en cours ou températures refusées par Orca : on ne change rien).
enum class Flush { Clean, Save, NotSpool, Refuse };
Flush flush_before_switch(bool filament_dirty, bool is_spool, bool calibrating, bool temperatures_ok);

constexpr const char* FLUSH_REFUSED_TEXT = "Je n’arrive pas à enregistrer les derniers réglages de ta bobine (un test est en cours, ou Plyo Slicer refuse ses "
                                           "températures) : je ne change rien pour ne pas les perdre. Termine le test ou vérifie ses températures, puis réessaie.";

// Matière d'un préréglage de l'utilisateur qui peut devenir une bobine (« filament_type », première valeur), ou "" :
// jamais un profil système, le préréglage par défaut ou une bobine, seulement une matière connue de Plyo, et seulement
// s'il hérite d'un profil système d'Orca (sinon Orca avertit à chaque réouverture d'un 3MF qui le nomme).
std::string adoptable_material(const std::string& filament_type, bool is_system, bool is_default, bool is_spool, bool has_system_parent);

// L'essai relu est-il bien celui de ce dernier envoi (même bobine, même imprimante, même instant) ? Sinon il a été
// réécrit depuis, ou n'a jamais été écrit : la réussite est refusée.
bool sent_trial_matches(const nlohmann::json& pointer, const nlohmann::json& trial);

// Nom court d'un réglage dans une phrase : un nom simple pour les plus courants (« débit »), sinon la dernière partie du
// titre du catalogue (après « · »), mots en minuscule sauf les sigles (« PEI »). Titre vide : la clé.
std::string short_title(const std::string& key, const std::string& catalog_title);

// Écart entre les valeurs d'aujourd'hui (`values_before`) et celles de la version réussie (`values_ok`), toutes deux
// {clé: texte d'Orca} : {differs, summary}. `summary` cite au plus 3 réglages réussis, « débit 0,88, température de buse
// 210 °C » : débit, températures de buse, pressure advance et rétraction d'abord, puis par clé ; première valeur d'un
// tableau, virgule décimale ; un titre déjà cité ne l'est pas deux fois. Clés absentes d'aujourd'hui : ignorées.
// Seuls les nombres sont cités : un texte, un booléen ou un choix (`kinds` du catalogue : "bool", "enum") compte comme un
// écart sans être cité.
nlohmann::json success_summary(const nlohmann::json& values_before, const nlohmann::json& values_ok,
                               const std::map<std::string, std::string>& catalog_titles,
                               const std::map<std::string, std::string>& kinds = {});

// Couple de températures « première couche / couches suivantes » et l'écart permis (buse 30 °C, plateau 15 °C).
struct TempPair
{
    int first_layer;
    int other_layers;
    int max_delta;
};

// Même règle que Tab::validate_filament_temperature_pairs d'Orca, qui ouvre une fenêtre « Temperature Safety Check »
// dans save_preset si un écart dépasse : vrai si aucun ne dépasse (une valeur <= 0 est un réglage coupé, ignoré).
// L'enregistrement automatique ne doit jamais ouvrir de fenêtre : il n'enregistre que si c'est vrai.
bool temperature_pairs_ok(const std::vector<TempPair>& pairs);

}} // namespace Plyo::SpoolsLogic
