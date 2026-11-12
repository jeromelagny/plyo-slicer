#pragma once

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

}} // namespace Plyo::AutoSave
