#pragma once

// Dictée vocale dans le champ de saisie du panneau : Plyo ne fait que demander au système de lancer SA dictée (macOS :
// Dictée ; Windows : saisie vocale, raccourci Windows + H). C'est le système qui écoute et qui écrit le texte dans le champ
// qui a le curseur : Plyo n'ouvre pas le micro, n'enregistre rien et n'envoie aucun son nulle part.
namespace Plyo { namespace Dictation {

// Le système sait-il lancer sa dictée d'ici ? Faux sous Linux : le panneau ne montre alors pas le bouton.
bool available();

// Demande au système de lancer sa dictée. Faux si la demande n'a pas pu partir. Vrai ne garantit pas que la dictée
// écoute : si elle est désactivée, le système propose lui-même de l'activer.
bool start();

// « mac », « windows » ou « other » : le panneau choisit son texte d'aide.
const char* platform();

}} // namespace Plyo::Dictation
