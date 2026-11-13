#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>
#include <utility>
#include <vector>

// Logique pure du « projet » d'une conversation (sans Orca ni wxWidgets, testée par src/plyo/tests/cpp) :
// { "printer": {"preset", "name"}, "filament": {"type", "preset", "nozzle_temp", "bed_temp"}, "part": {"name"} }.
// Chaque clé est absente ou null tant que l'utilisateur ne l'a pas choisie. Le projet ne porte jamais de secret
// (code d'accès d'imprimante…) : seules les clés ci-dessus sont lues.
namespace Plyo { namespace ProjectLogic {

// Étapes pas encore choisies, dans l'ordre « printer », « filament », « part ». Un projet null ou abîmé les a toutes.
std::vector<std::string> missing(const nlohmann::json& project);

bool complete(const nlohmann::json& project);

// Étapes de la fiche qu'une modification exige encore (même ordre que `missing`). `filament_only` : le lot ne touche que
// des réglages de l'onglet Filament ; la pièce n'est alors pas exigée, seulement l'imprimante et la bobine.
std::vector<std::string> missing_for(const nlohmann::json& project, bool filament_only);

// Texte français pour l'utilisateur si une modification doit être refusée (fiche incomplète, ou profils d'Orca qui ne
// sont plus ceux du projet) ; chaîne vide si elle est permise. `filament_only` : voir `missing_for`.
std::string refusal(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament, bool filament_only = false);

// Le projet réduit à ses clés connues (aucun secret, aucun chemin de fichier), prêt à être enregistré avec la
// conversation. null si ce n'est pas un objet. `step` (étape guidée) : slice, print, after, ou done (parcours terminé ou passé) ; `adapted` : nom de la pièce 3MF déjà adaptée ;
// `canvas` : [{t, canvas_id, tray_id, type, color, preset}] (emplacements du Canvas choisis, 16 au plus) ; `success` : réussite
// dite à l'étape Résultat ; `send` : {spool: {id, name}, watch, failed, answered, marked, end: {verdict, file}, outcome}, le
// dernier envoi ou export fait depuis le panneau.
nlohmann::json sanitize(const nlohmann::json& project);

// Filaments des couleurs 2 et suivantes choisis par les emplacements du Canvas : (numéro de filament t > 0, profil).
// La couleur 1 (t = 0) est le « filament » du projet.
std::vector<std::pair<int, std::string>> extra_filaments(const nlohmann::json& project);

// Réglages d'un projet 3MF (Metadata/project_settings.config) aplatis : { clé: texte }, première valeur des listes,
// valeurs non textuelles et listes vides ignorées.
nlohmann::json first_values(const nlohmann::json& settings);

// Le filament actuel d'Orca est-il celui du projet ? Oui s'il porte le même nom, ou ce nom suivi de « (Plyo) » (copie faite
// à l'enregistrement d'un profil d'Orca) ou de « — » (profil calibré par Plyo).
bool same_filament(const std::string& project_preset, const std::string& current);

// Comme `refusal` mais pour un réglage fait par l'utilisateur dans la fiche (température…) : la pièce n'est pas exigée,
// seuls l'imprimante et le filament déjà choisis sont comparés à Orca. Chaîne vide si c'est permis.
std::string edit_refusal(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament);

// Le projet a une imprimante et un filament choisis, et Orca n'est plus dessus : « Remettre le projet » a un sens.
bool can_restore(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament);

// Habitudes enregistrées localement : { machines: {profil: {filament: {type, nozzle_temp, bed_temp}}}, hidden: [profil], last }.
// Ne garde que ces clés (50 machines et 50 machines masquées au plus, températures entre 0 et 400 °C). `beds` : {profil: type de
// plateau d'Orca ou « unknown »} (BedLogic::is_answer), 50 au plus.
nlohmann::json sanitize_habits(const nlohmann::json& habits);

struct Adaptation
{
    nlohmann::json apply   = nlohmann::json::array(); // [{key, value}]
    nlohmann::json dropped = nlohmann::json::array(); // [{key, reason}]
};

// Réglages lus dans un 3MF ({clé du catalogue: valeur}) adaptés au projet : les températures viennent toujours de la
// fiche ; une autre valeur numérique hors de la plage de `range_of(clé)` ({min, max}, bornes facultatives) est écartée
// et signalée ; un booléen ou un texte d'une clé permise passe tel quel ; une clé que `range_of` rend null (hors de ce
// que l'assistant peut modifier) est ignorée.
Adaptation adapt_3mf(const nlohmann::json& file_values, const nlohmann::json& project,
                     const std::function<nlohmann::json(const std::string&)>& range_of);

// Le panneau s'ouvre-t-il au lancement ? Oui, sauf pour qui a répondu « Je connais déjà » à l'accueil (« expert », décision D5) :
// il reste à un clic sur « Assistant ». Débutant, accueil passé ou pas encore vu : comme avant.
bool opens_panel_at_startup(const std::string& level);

}} // namespace Plyo::ProjectLogic
