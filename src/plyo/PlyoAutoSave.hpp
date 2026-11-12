#pragma once

#include "PlyoSpoolsLogic.hpp"

// Enregistrement automatique du préréglage de la bobine : un réglage du filament changé (par l'assistant ou à la main)
// est écrit dans le préréglage de la bobine sous son propre nom, environ 2 s après le dernier changement, quand Orca ne
// découpe pas et n'envoie pas. Jamais de fenêtre, jamais de nouveau préréglage, et seulement pour une bobine du registre
// (un préréglage de l'utilisateur n'est jamais écrasé). Décision : SpoolsLogic::should_save_spool.
namespace Plyo { namespace AutoSave {

// Démarre la minuterie (toutes les 500 ms) ; sans effet si elle tourne déjà. Appelé à l'ouverture du panneau.
void start();

// Arrête la minuterie (panneau détruit, y compris à la fermeture d'Orca).
void stop();

// Un réglage vient de changer : le délai de calme repart de zéro. Appelé par Plyo::on_config_changed().
void note_change();

// Signaux d'occupation, partagés avec le projet 3MF de la conversation (PlyoProjectFiles) :
// une fenêtre modale est ouverte ; Orca exporte ou envoie un G-code ; une calibration (de Plyo ou d'Orca) est en cours.
bool modal_open();
bool sending();
bool calibrating();

// Écrit tout de suite le filament modifié dans le préréglage de sa bobine (sans attendre le calme, sans fenêtre).
// Vrai s'il ne reste rien à perdre : filament non modifié, ou bobine bien enregistrée. Faux pour un préréglage qui
// n'est pas une bobine, pendant une calibration, si Orca refuserait les températures ou si l'écriture échoue.
bool save_spool_now();

// Avant que Plyo change de filament (bobine choisie, projet remis, calibration) : le filament modifié est écrit dans sa
// bobine. Clean (rien à perdre : non modifié, ou bobine écrite), NotSpool (préréglage qui n'est pas une bobine : Orca garde
// sa question), Refuse (bobine qu'on ne peut pas écrire maintenant : l'appelant ne change rien et dit
// SpoolsLogic::FLUSH_REFUSED_TEXT, plutôt que de laisser Orca transférer ou Plyo jeter ses réglages).
SpoolsLogic::Flush flush_spool();

}} // namespace Plyo::AutoSave
