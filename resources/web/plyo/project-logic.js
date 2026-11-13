// Logique pure de la fiche « Mon projet » (sans DOM) : étapes à compléter, projet proposé à partir du précédent.
// Chargée par index.html (window.PlyoProject) et testée par node (tests/project-logic.test.mjs).
// Un projet : { printer: {preset, name}, filament: {type, preset, nozzle_temp, bed_temp, spool: {id, name}}, part: {name} }.
// `filament.spool` : la bobine choisie à l'étape « Quelle bobine ? » (filament 1), retenue par le slicer (bobines.json).
// Jamais de secret dedans (code d'accès d'imprimante…). `proposed: true` : valeur reprise du projet précédent,
// pas encore confirmée par l'utilisateur.
(function (root) {
  var GUIDED_STEPS = ['slice', 'print', 'after'];

  function emptyProject() { return { printer: null, filament: null, part: null }; }

  function chosen(entry, field) {
    return !!entry && typeof entry === 'object' && !entry.proposed && typeof entry[field] === 'string' && entry[field] !== '';
  }

  // Première étape à faire : 'printer' | 'filament' | 'part' | 'ready' (même ordre que ProjectLogic::missing en C++).
  function nextStep(project) {
    var p = project && typeof project === 'object' ? project : {};
    if (!chosen(p.printer, 'preset')) return 'printer';
    if (!chosen(p.part, 'name')) return 'part';
    if (!chosen(p.filament, 'preset')) return 'filament';
    return 'ready';
  }

  function copy(entry) { return entry ? JSON.parse(JSON.stringify(entry)) : null; }

  // Nouveau projet qui reprend imprimante et filament du précédent, à confirmer ; la pièce est vide.
  function proposeFrom(previous) {
    var prev = previous && typeof previous === 'object' ? previous : {};
    var printer = copy(prev.printer), filament = copy(prev.filament);
    // Seule une bobine est reproposée (« Sunlu PLA+ noir, comme la dernière fois ? ») : un filament sans bobine (projet d'avant
    // « Quelle bobine ? », emplacements) laisse l'étape Filament montrer la liste et « Une nouvelle bobine ».
    if (filament && !(filament.spool && filament.spool.id)) filament = null;
    if (printer) printer.proposed = true;
    if (filament) filament.proposed = true;
    return { printer: printer, filament: filament, part: null };
  }

  function confirm(project) {
    var out = copy(project) || emptyProject();
    if (out.printer) delete out.printer.proposed;
    if (out.filament) delete out.filament.proposed;
    return out;
  }

  function nextGuidedStep(step) {
    var i = GUIDED_STEPS.indexOf(step);
    return i >= 0 && i + 1 < GUIDED_STEPS.length ? GUIDED_STEPS[i + 1] : null;
  }

  // Pièce déjà posée sur le plateau d'Orca (import par le menu d'Orca, glisser-déposer sur le plateau…) alors que la fiche
  // attend la pièce : son nom, sinon null. `signals` : {objects, part_name} (tour_signals du slicer).
  // `old` : {name, objects} : la pièce du projet précédent, encore sur le plateau, n'est pas celle de ce projet-ci.
  function partFromPlate(project, signals, old) {
    // Dès que la fiche n'a pas de pièce : une pièce déjà posée dans Orca est reconnue même avant le choix de la machine.
    var p = project && typeof project === 'object' ? project : {};
    if (chosen(p.part, 'name') || !signals || !(signals.objects > 0)) return null;
    if (old && signals.part_name === old.name && signals.objects <= old.objects) return null;
    if (old && signals.part_name === old.name) return 'Pièce posée sur le plateau'; // une pièce de plus : son nom n'est pas celui-là
    return typeof signals.part_name === 'string' && signals.part_name ? signals.part_name : 'Pièce posée sur le plateau';
  }

  // Un 3MF posé reprend ses réglages d'impression adaptés au projet, quand machine, pièce et filament sont choisis ; une fois par
  // pièce et par machine (`project.adapted` = nom de la pièce déjà adaptée, effacé quand la machine change).
  function needsAdaptation(project) {
    if (nextStep(project) !== 'ready') return false;
    var name = project.part && project.part.name;
    return /\.3mf$/i.test(String(name || '')) && project.adapted !== name;
  }

  // Remettre le projet dans Orca ne demande que la machine ; le filament est remis aussi s'il est déjà choisi.
  function restorable(project) { return !!project && typeof project === 'object' && chosen(project.printer, 'preset'); }

  // Réponse négative de filament_choose : fenêtre d'Orca annulée (`cancelled`, réglages non enregistrés gardés), ou pas de profil.
  function filamentChoiceError(msg, type) {
    if (msg && msg.cancelled) return 'Choix annulé : ton filament n’a pas changé, tes modifications restent en place. Choisis à nouveau quand tu veux : Plyo Slicer te redemandera quoi en faire.';
    return 'Je n’ai pas trouvé de profil ' + type + ' pour cette imprimante. Choisis un autre filament.';
  }

  // Choisir un fichier remplace ce qui reste du projet précédent : jamais une pièce déjà dans la fiche (reprise, pièce à reposer).
  function replacesPlate(project, oldPart, newProjectFile) {
    return !chosen(project && project.part, 'name') && !!(oldPart || newProjectFile);
  }
  function replacedText(name, count) {
    return count > 1 ? 'Les ' + count + ' pièces d’avant sont retirées du plateau.' : '« ' + (name || 'L’ancienne pièce') + ' » retirée du plateau.';
  }

  // Projet 3MF de la conversation (datadir/plyo/projets/<conv>.3mf) : on ne le rouvre que si la fiche a une pièce.
  function opensProjectFile(project) { return chosen(project && project.part, 'name'); }
  // Réponse du slicer à l'ouverture (`reason` : "" | "absent" | "abime" | "trop_gros" | "occupe" | "annule").
  function projectOpenedText(reason) {
    if (!reason) return '';
    if (reason === 'annule') return 'D’accord, ton plateau reste tel quel.';
    if (reason === 'occupe') return 'Plyo Slicer est occupé (découpe, envoi, test ou fenêtre ouverte) : je rouvre le plateau de ce projet dès qu’il a fini. D’ici là, je ne change rien.';
    return 'Je n’ai pas retrouvé le plateau de ce projet : je remets ta machine et ta bobine.';
  }
  // Plateau pas retrouvé : la machine et la bobine de la fiche reviennent, comme avant les projets 3MF. Pas si l'utilisateur
  // a gardé son propre projet.
  // Ouverture refusée par « occupe » : le slicer bloque réglages, bobine et pièce de cette conversation (le plateau est encore
  // celui d'avant) ; le panneau redemande toutes les OPEN_RETRY_MS, 20 fois au plus, puis le dit (openGiveUpText).
  var OPEN_RETRY_MS = 3000, OPEN_RETRY_MAX = 20;
  function openRetryStep(reason, tries) {
    if (reason !== 'occupe') return 'done';
    return tries < OPEN_RETRY_MAX ? 'retry' : 'give_up';
  }
  function openGiveUpText() {
    return 'Plyo Slicer est toujours occupé : je n’ai pas pu rouvrir le plateau de ce projet. Rouvre-le depuis « Mes projets » (menu « ⋯ ») quand il aura fini ; d’ici là, je ne change rien.';
  }
  function restoresAfterOpen(reason) { return !!reason && reason !== 'annule' && reason !== 'occupe'; }
  // `previous` : le plateau trop lourd est celui de la conversation qu'on vient de quitter.
  function tooHeavyText(previous) {
    return previous ? 'Le plateau de ton projet précédent était trop lourd pour que je le garde (50 Mo au plus) : je garde seulement sa fiche.'
      : 'Ton plateau est trop lourd pour que je le garde avec ce projet (50 Mo au plus) : je garde seulement sa fiche.';
  }
  // Plateau qui n'a pas pu être gardé (`reason` "echec" : écriture impossible ; sinon trop lourd).
  function projectFileText(reason, previous) {
    if (reason !== 'echec') return tooHeavyText(previous);
    return (previous ? 'Je n’ai pas pu enregistrer ton projet précédent' : 'Je n’arrive pas à enregistrer ce projet')
      + ' : vérifie qu’il reste de la place sur ton disque. Je garde seulement sa fiche.';
  }
  // Un fichier de l'utilisateur (ouvert dans Orca) n'est jamais attaché à une conversation (signal `user_file` du slicer).
  function mayAttach(signals) { return !(signals && signals.user_file); }
  // Orca a vidé les réglages de la pièce sans changer de projet (assistant de configuration, mise à jour des profils…) :
  // la conversation affichée rouvre son 3MF (les réglages reviennent) sur la même machine ; sur une autre, le plateau est
  // simplement rattaché (changer de machine refait la préparation). '' : ce n'est plus la conversation affichée.
  function afterDetached(msg, convId) {
    if (!msg || msg.conv !== convId) return '';
    return msg.same_printer ? 'open' : 'attach';
  }

  var api = { opensProjectFile: opensProjectFile, projectOpenedText: projectOpenedText, openRetryStep: openRetryStep, openGiveUpText: openGiveUpText, OPEN_RETRY_MS: OPEN_RETRY_MS, restoresAfterOpen: restoresAfterOpen, tooHeavyText: tooHeavyText, projectFileText: projectFileText, mayAttach: mayAttach, afterDetached: afterDetached, replacesPlate: replacesPlate, replacedText: replacedText, filamentChoiceError: filamentChoiceError, restorable: restorable, needsAdaptation: needsAdaptation, partFromPlate: partFromPlate, emptyProject: emptyProject, nextStep: nextStep, proposeFrom: proposeFrom, confirm: confirm,
    GUIDED_STEPS: GUIDED_STEPS, nextGuidedStep: nextGuidedStep };
  root.PlyoProject = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
