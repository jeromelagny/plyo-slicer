// Logique pure de la fiche « Mon projet » (sans DOM) : étapes à compléter, projet proposé à partir du précédent.
// Chargée par index.html (window.PlyoProject) et testée par node (tests/project-logic.test.mjs).
// Un projet : { printer: {preset, name}, filament: {type, preset, nozzle_temp, bed_temp}, part: {name} }.
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
  function partFromPlate(project, signals) {
    // Dès que la fiche n'a pas de pièce : une pièce déjà posée dans Orca est reconnue même avant le choix de la machine.
    var p = project && typeof project === 'object' ? project : {};
    if (chosen(p.part, 'name') || !signals || !(signals.objects > 0)) return null;
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

  var api = { restorable: restorable, needsAdaptation: needsAdaptation, partFromPlate: partFromPlate, emptyProject: emptyProject, nextStep: nextStep, proposeFrom: proposeFrom, confirm: confirm,
    GUIDED_STEPS: GUIDED_STEPS, nextGuidedStep: nextGuidedStep };
  root.PlyoProject = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
