// Logique pure du parcours en six étapes (sans DOM) : étape en cours, action principale, repli, suggestions.
// Chargée par index.html (window.PlyoJourney) et testée par node (tests/journey-logic.test.mjs).
// Les étapes 1 à 3 viennent de la fiche du projet (project-logic.js) ; les étapes 4 à 6 de project.step
// (slice, print, after ; absent ou « done » = Préparer).
(function (root) {
  var P = root.PlyoProject || (typeof require !== 'undefined' ? require('./project-logic.js') : null);

  var STEPS = [
    { key: 'machine', label: 'Machine' }, { key: 'filament', label: 'Filament' }, { key: 'piece', label: 'Pièce' },
    { key: 'preparer', label: 'Préparer' }, { key: 'imprimer', label: 'Imprimer' }, { key: 'resultat', label: 'Résultat' }
  ];
  var BY_FICHE = { printer: 'machine', filament: 'filament', part: 'piece' };
  var BY_STEP = { slice: 'preparer', print: 'imprimer', after: 'resultat' };

  function currentStep(project) {
    var next = P.nextStep(project);
    if (next !== 'ready') return BY_FICHE[next];
    return BY_STEP[project && project.step] || 'preparer';
  }

  function steps(project) {
    var current = currentStep(project), seen = false;
    return STEPS.map(function (s) {
      var state = s.key === current ? 'current' : (seen ? 'todo' : 'done');
      if (s.key === current) seen = true;
      return { key: s.key, label: s.label, state: state };
    });
  }

  function primaryAction(step, ctx) {
    var c = ctx || {};
    var slice = { label: 'Découper', kind: 'slice', enabled: true };
    if (step === 'preparer') {
      if (!c.sliced) return slice;
      return c.risks > 0 ? { label: 'Appliquer les correctifs', kind: 'fix', enabled: true } : { label: 'Continuer', kind: 'advance', enabled: true };
    }
    if (step === 'imprimer') {
      if (!c.sliced) return slice;
      return c.linked ? { label: 'Envoyer et imprimer', kind: 'send', enabled: true } : { label: 'Exporter le fichier', kind: 'export', enabled: true };
    }
    if (step === 'resultat') return { label: 'Envoyer une photo', kind: 'photo', enabled: true };
    return { label: '', kind: 'none', enabled: false };
  }

  function prompt(step, ctx) {
    var c = ctx || {};
    switch (step) {
      case 'machine': return 'Choisis ton imprimante';
      case 'filament': return 'Dis-moi quel filament est sur la bobine';
      case 'piece': return 'Ajoute la pièce à imprimer';
      case 'preparer': return !c.sliced ? 'Découpe la plaque pour que je la vérifie' : (c.risks > 0 ? 'J’ai trouvé des points à régler avant d’imprimer' : 'Tout est bon, on passe à l’impression');
      case 'imprimer': return !c.sliced ? 'Redécoupe la plaque avant d’imprimer' : 'Plateau vide et propre, filament chargé : c’est parti';
      default: return 'Alors, ça a marché ? Envoie-moi une photo';
    }
  }

  function afterPreflight(risks) { return risks === 0 ? 'advance' : 'stay'; }

  function presetOf(project, key) { return project && project[key] && project[key].preset ? project[key].preset : ''; }

  // Machine ou filament changé après la découpe : la découpe est périmée, on repasse à Préparer.
  function resetStepOnChange(before, after) {
    if (!after) return after;
    var changed = before && (presetOf(before, 'printer') !== presetOf(after, 'printer') || presetOf(before, 'filament') !== presetOf(after, 'filament'));
    if (!changed || (after.step !== 'print' && after.step !== 'after')) return after;
    var out = JSON.parse(JSON.stringify(after));
    out.step = 'slice';
    return out;
  }

  function barMode(widthPx) { return widthPx < 340 ? 'pills' : 'names'; }
  function compactFiche(o) { return !!(o && (o.folded || o.heightPx < 760)); }

  // Ce qui occupe le premier bloc du corps : les choix (étapes 1 à 3, ou « changer » le filament) ou le contenu des étapes 4 à 6.
  function contentFor(step, editing) {
    if (editing === 'filament') return 'choices';
    return step === 'machine' || step === 'filament' || step === 'piece' ? 'choices' : 'steps';
  }

  function ficheSummary(project) {
    var p = project || {}, parts = [];
    if (p.printer && (p.printer.name || p.printer.preset)) parts.push(p.printer.name || p.printer.preset);
    if (p.filament && p.filament.type) {
      var temps = p.filament.nozzle_temp != null && p.filament.bed_temp != null ? ' ' + p.filament.nozzle_temp + '/' + p.filament.bed_temp : '';
      parts.push(p.filament.type + temps);
    }
    if (p.part && p.part.name) parts.push(p.part.name);
    return parts.join(' · ');
  }

  var VALUES = { label: 'Voir les réglages que tu lis', kind: 'open', value: 'values' };
  var LIMITS = { label: 'Limites du fabricant', kind: 'open', value: 'limits' };
  function suggestionsFor(step) {
    switch (step) {
      case 'machine': return [{ label: 'Mon imprimante n’est pas trouvée', kind: 'ask', value: 'Mon imprimante n’est pas trouvée sur le réseau, que faire ?' }, VALUES];
      case 'filament': return [{ label: 'Quel filament choisir ?', kind: 'ask', value: 'Quel filament me conseilles-tu pour une première impression ?' }, VALUES, LIMITS];
      case 'piece': return [{ label: 'Quels formats acceptes-tu ?', kind: 'ask', value: 'Quels types de fichiers puis-je importer ?' }, VALUES, LIMITS];
      case 'preparer': return [{ label: 'Vérifier ma plaque', kind: 'open', value: 'check' }, { label: 'Quels réglages me conseilles-tu ?', kind: 'ask', value: 'Quels réglages me conseilles-tu pour cette pièce ?' }, VALUES, LIMITS];
      case 'imprimer': return [{ label: 'Mes pièces', kind: 'open', value: 'parts' }, { label: 'Que vérifier avant de lancer ?', kind: 'ask', value: 'Que dois-je vérifier avant de lancer l’impression ?' }, VALUES, LIMITS];
      default: return [{ label: 'Mes pièces', kind: 'open', value: 'parts' }, { label: 'Ma pièce a un défaut', kind: 'ask', value: 'Ma pièce a un défaut, peux-tu m’aider ?' }, VALUES];
    }
  }

  // État d'interface du repli : { folded, ficheOpen }. `send` (l'utilisateur écrit) replie, `toggle` bascule (la flèche),
  // `stepChange` déplie. Un autre événement ne change rien.
  function toggleFold(state, event) {
    var st = { folded: !!(state && state.folded), ficheOpen: !!(state && state.ficheOpen) };
    if (event === 'send') return { folded: true, ficheOpen: false };
    if (event === 'toggle') return { folded: !st.folded, ficheOpen: false };
    if (event === 'stepChange') return { folded: false, ficheOpen: st.ficheOpen };
    return st;
  }

  var api = { contentFor: contentFor, toggleFold: toggleFold, STEPS: STEPS, currentStep: currentStep, steps: steps, primaryAction: primaryAction, prompt: prompt,
    afterPreflight: afterPreflight, resetStepOnChange: resetStepOnChange, barMode: barMode, compactFiche: compactFiche,
    ficheSummary: ficheSummary, suggestionsFor: suggestionsFor };
  root.PlyoJourney = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
