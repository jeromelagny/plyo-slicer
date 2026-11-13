#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

// Retouches faites à la main dans les onglets d'Orca (lot 11). Rien n'est jeté ni écrit en silence :
// - UX-31 : retouches de l'onglet Impression laissées avec un projet ; le panneau demande au projet suivant s'il faut les
//   garder dans le profil d'impression (sans fenêtre d'Orca) ;
// - UX-32 : retouches du filament écrites dans la bobine par l'enregistrement automatique : le panneau le dit, avec
//   « Annuler » ; et dit aussi quand l'écriture n'a pas pu se faire ;
// - UX-36 : fichier 3MF de l'utilisateur dont les valeurs du filament ne sont pas reprises : le panneau le dit, avec
//   « Prendre ceux du fichier ».
// Seules les clés du catalogue (onglets Impression et Filament) sont comptées, écrites ou remises, et toujours par le pont
// (SettingsBridge::restore_values : valeurs vérifiées, règles d'Orca, relecture).
namespace Plyo { namespace Retouches {

// Retouches à la main du préréglage édité de cette portée : {preset, changes: [{key, label, before, after}], values: {clé:
// texte d'Orca d'aujourd'hui}, before: {clé: texte du préréglage enregistré}}. `changes` vide : rien de retouché à la main.
nlohmann::json diff(bool print);

// Messages pour le panneau (spool_kept, spool_keep_failed). Appelé à l'ouverture du panneau.
void set_listener(std::function<void(const nlohmann::json&)> listener);

// UX-31. À appeler juste avant qu'Orca ou Plyo oublie les réglages d'impression d'un projet (`conv` : sa conversation).
void capture_print(const std::string& conv);
// Retouches en attente de ta réponse ({} si aucune), gardées sur le disque jusqu'à ta réponse (fermeture d'Orca comprise).
nlohmann::json print_pending();
// « Les garder dans mon profil » : écrites dans le profil (sa copie « (Plyo) » si c'est un profil d'Orca). {ok, text, name}.
nlohmann::json keep_print();
// « Seulement pour ce projet » : la question n'est plus posée.
void dismiss_print();
// « Annuler » après « Les garder » : le profil reprend ses valeurs d'avant. {ok, text}.
nlohmann::json undo_keep_print();

// UX-32. Appelé par l'enregistrement automatique : `before` est le diff(false) relevé juste avant d'écrire la bobine.
void spool_saved(const nlohmann::json& before);
// L'écriture n'a pas pu se faire : « temperatures » (écart refusé par Orca, `key` : le réglage en cause) ou « write ».
void spool_not_saved(const std::string& reason, const std::string& key);
// « Annuler » de la note « Gardé dans ta bobine » (`token` : celui de la note). {ok, text}.
nlohmann::json undo_spool(int token);

// UX-36. À appeler juste avant que les valeurs du filament d'un fichier ouvert soient oubliées au profit de la bobine.
void capture_file_filament();
// Ce qui n'a pas été repris ({} si rien) : {spool, changes}. Donné une fois au panneau, gardé pour « Prendre ceux du fichier ».
nlohmann::json file_filament();
// « Prendre ceux du fichier » : un lot annulable. {ok, text, undo_id?}.
nlohmann::json take_file_filament();

}} // namespace Plyo::Retouches
