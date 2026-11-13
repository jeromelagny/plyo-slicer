#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

// Ce qu'Orca dit de la plaque (erreur de découpe, refus de validation, avertissements, contrôles du G-code), mis sous une
// forme commune pour le panneau et pour l'IA. Les codes viennent des types et des identifiants d'Orca (type d'exception,
// StringExceptionType, message_id d'un avertissement, contrôle du G-code, clé du réglage) et de faits mesurés sur la plaque,
// jamais de son texte traduit : le texte ne sert qu'à l'affichage et à l'explication par l'IA.
// Sans dépendance à wxWidgets ni à Orca (testé par src/plyo/tests/cpp).
namespace Plyo { namespace OrcaMessagesLogic {

constexpr size_t MAX_ISSUES = 10;  // au plus, erreurs d'abord
constexpr size_t MAX_TEXT   = 300; // octets du texte d'Orca gardés

struct Issue
{
    std::string source; // slicing_error | validate_error | validate_warning | step_warning | gcode_check
    std::string code;   // identifiant stable et court (voir les fonctions *_code ci-dessous)
    std::string level;  // error | warning
    std::string text;   // texte d'Orca, déjà traduit ; nettoyé par clean_text
    std::string opt_key;     // réglage en cause, vide si aucun
    std::string scope;       // print | filament (modifiable par l'assistant), printer, ou vide
    std::string object_ref;  // identifiant de la pièce (ModelObject::id, comme PlateActions::context), vide si aucune
    std::string object_name;
    bool        critical = false; // avertissement qu'Orca remontre dans une fenêtre à l'export
    nlohmann::json fix;           // correction sûre proposée {key, value} (réglage du catalogue), ou null
};

// Texte d'Orca prêt à montrer : chaque chemin connu (`paths` : fichiers puis dossiers, ex. le fichier exporté, le dossier
// personnel, le dossier temporaire) réduit au nom du fichier, puis tout autre chemin absolu sans espace réduit à son dernier
// élément ; caractères de contrôle retirés, sauts de ligne et espaces resserrés ; MAX_TEXT octets au plus (UTF-8 entier).
std::string clean_text(const std::string& text, const std::vector<std::string>& paths = {});

// Ce qu'on sait de la plaque au moment d'une erreur de découpe (lu dans Orca, jamais dans le texte).
struct SliceFacts
{
    std::string step;        // étape commencée et pas finie (posSlice, psGCodeExport, psWipeTower…), vide si inconnue
    bool        has_object = false; // l'erreur désigne une pièce
    bool        wipe_tower = false; // la plaque a une tour de purge
};
// Code d'une erreur de découpe à partir du type C++ de l'exception (`type` : SlicingError, SlicingErrors,
// PlaceholderParserError, ExportError, bad_alloc…) et des faits :
// no_layers, empty_first_layer, nothing_to_print, print_empty, prime_tower, skirt_brim ; sinon le type lui-même.
std::string slicing_code(const std::string& type, const SliceFacts& facts);

// Ce qu'on sait de la plaque pour un refus de validation.
struct ValidateFacts
{
    bool over_nozzle      = false; // la hauteur de couche en cause dépasse le diamètre de la buse
    bool several_objects  = false; // plusieurs pièces (ou exemplaires) imprimées couche par couche
    bool too_tall         = false; // la pièce en cause atteint la hauteur maximale de l'imprimante
};
// Code d'un refus ou d'un avertissement de validation : StringExceptionType (1 à 5) d'abord, puis la clé du réglage
// complétée par les faits (layer_height_over_nozzle, vase_several_objects), object_too_tall, la clé elle-même, ou
// « validate ».
std::string validate_code(int type, const std::string& opt_key, bool has_object, const ValidateFacts& facts);

// Code d'un avertissement d'étape (PrintStateBase::SlicingNotificationType) : need_support, empty_layers… ; 0 ou inconnu :
// « step_warning ».
std::string step_warning_code(int message_id);

// Famille d'une erreur d'export d'après le type C++ de l'exception : write (le fichier n'a pas pu être écrit : disque plein,
// dossier protégé, fichier ouvert ailleurs), gcode_template (G-code de l'imprimante), slicing, memory, other.
std::string export_kind(const std::string& type);

// Hauteur de couche sûre pour cette buse (moitié du diamètre, au centième, entre 0,05 et 0,3 mm) ; 0 si buse inconnue.
double safe_layer_height(double nozzle_mm);

// Liste pour le panneau et l'IA : sans doublon (même source, code, pièce et texte), erreurs avant avertissements (ordre gardé
// sinon), MAX_ISSUES au plus. Champs vides omis.
nlohmann::json to_json(const std::vector<Issue>& issues);

// Y a-t-il une erreur (niveau « error ») dans cette liste (forme JSON de to_json) ? Une notification d'Orca de type inconnu
// (source « notification », code « unknown ») ne compte pas : on ne sait pas si elle bloque, Plyo ne refuse rien sur elle.
bool has_error(const nlohmann::json& issues);

// ---------- Notifications d'Orca (bulles du plateau et de la pièce, ERR-11) ----------
// Une notification affichée par Orca (NotificationManager::plyo_notices), lue par son type, jamais par son texte.
struct Notice
{
    std::string type;   // nom de l'énumérateur NotificationType (« PlaterError », « BBLMixUsePLAAndPETG »…)
    std::string level;  // error | warning | info (NotificationLevel ramené à trois)
    std::string text;   // déjà nettoyé pour le panneau (clean_for_panel), préfixe « Error: » retiré
    bool        gray = false; // grisée par Orca : périmée, en attente d'une nouvelle découpe
};
// Faits lus dans Orca pour un type partagé par plusieurs messages (jamais le texte).
struct NoticeFacts
{
    bool        prime_tower_outside = false; // PlaterWarning : la tour de purge sort du plateau (contrôle d'Orca)
    std::string mesh_object_ref;             // BBLObjectInfo : pièce de la plaque au maillage abîmé (arêtes ouvertes), vide sinon
    std::string mesh_object_name;
};
// Keep : expliquée dans le panneau ; Covered : déjà lue ailleurs par Plyo (validation, découpe, contrôles du G-code, envoi) ;
// Ignored : sans intérêt pour l'utilisateur (progression, astuce, mise à jour, compte en ligne, simple information).
enum class NoticeUse { Keep, Covered, Ignored };
struct NoticeClass
{
    NoticeUse   use = NoticeUse::Ignored;
    std::string code;  // code stable (object_outside, pla_petg_mix…), « unknown » pour une erreur ou un avertissement non reconnu
    std::string level; // error | warning
};
NoticeClass classify_notice(const Notice& notice, const NoticeFacts& facts);

// Types que Plyo nomme explicitement (gardés, déjà couverts ou écartés) : la sentinelle vérifie qu'ils existent chez Orca.
std::vector<std::string> listed_notice_types();

// Retire les balises « <Error> » d'Orca, puis un préfixe suivi d'un saut de ligne (« Error:\n », « Warning:\n », déjà
// traduits) en tête du texte.
std::string strip_notice_prefix(const std::string& text, const std::vector<std::string>& prefixes);

// Joint aux problèmes déjà lus (validation, découpe) les notifications gardées et non grisées, source « notification » :
// - même code qu'un problème déjà là : pas de doublon, le texte d'Orca complète seulement un problème qui n'en avait pas ;
// - « object_outside » quand la validation dit déjà « object_too_tall » : même pièce, même problème ;
// - une raison précise du refus d'Orca (filament_unprintable, extruder_unprintable, plugin_missing) remplace la supposition
//   « object_outside » sans texte (plaque refusée sans erreur de validation).
void merge_notices(std::vector<Issue>& issues, const std::vector<Notice>& notices, const NoticeFacts& facts);

// Codes des notifications gardées et non grisées, triés et sans doublon : signal léger lu toutes les 2 s par le panneau.
std::vector<std::string> notice_codes(const std::vector<Notice>& notices, const NoticeFacts& facts);

// Fin d'une découpe réussie ou annulée, lue juste après. `slicing` : une autre découpe suit vraiment (Orca découpe encore, ou
// « Tout découper » passe à la plaque suivante) → rien, sa propre fin parlera. `update_scheduled` : la minuterie de mise à
// jour d'Orca est en attente (c'est souvent le cas juste après une découpe, sans qu'une autre suive) → relire un peu plus
// tard, `max_tries` fois au plus. Sinon → envoyer.
enum class FinishRead { Skip, Retry, Send };
FinishRead finish_read(bool slicing, bool update_scheduled, int tries, int max_tries);

// Découpe demandée par le panneau juste après un réglage changé : Orca ne lit ce changement qu'au passage de sa minuterie
// (500 ms) ; une découpe lancée avant tomberait sur l'état d'erreur d'avant. Vrai tant qu'il faut encore attendre
// (minuterie en attente et moins de `max_wait_ms` écoulées).
bool slice_must_wait(bool update_scheduled, int waited_ms, int max_wait_ms);

}} // namespace Plyo::OrcaMessagesLogic
