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
  // `folded` : l'utilisateur est dans la Discussion, qui a besoin de la place ; sinon seulement si la fenêtre est basse.
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

  // Pendant les choix (machine, filament, pièce) aucune suggestion : rien ne doit distraire. Ensuite deux au plus ; à elles
  // quatre les étapes 4 à 6 gardent accessibles « Vérifier ma plaque », « Mes pièces », « réglages lus » et « limites ».
  function suggestionsFor(step) {
    switch (step) {
      case 'preparer': return [{ label: 'Vérifier ma plaque', kind: 'open', value: 'check' }, { label: 'Voir les réglages que tu lis', kind: 'open', value: 'values' }];
      case 'imprimer': return [{ label: 'Mes pièces', kind: 'open', value: 'parts' }, { label: 'Limites du fabricant', kind: 'open', value: 'limits' }];
      case 'resultat': return [{ label: 'Mes pièces', kind: 'open', value: 'parts' }, { label: 'Ma pièce a un défaut', kind: 'ask', value: 'Ma pièce a un défaut, peux-tu m’aider ?' }];
      default: return [];
    }
  }

  // Les lignes de la fiche déjà choisies (une valeur seulement proposée n'est pas choisie) : { line, text }.
  function filledRows(project) {
    var p = project || {}, rows = [];
    if (p.printer && !p.printer.proposed && (p.printer.name || p.printer.preset)) rows.push({ line: 'printer', text: p.printer.name || p.printer.preset });
    if (p.filament && !p.filament.proposed && p.filament.type) rows.push({ line: 'filament', text: p.filament.type });
    if (p.part && p.part.name) rows.push({ line: 'part', text: p.part.name });
    return rows;
  }

  // Profils d'imprimante → une ligne par machine. « Ma K2 », « K2 - Copie » et « K2 » sont la même machine : on garde le profil
  // relié (« Ma … » de préférence). Les machines sans profil relié vont dans `others` (rangées sous « Autres profils »).
  function groupPrinters(list) {
    var out = { main: [], others: [] };
    if (!Array.isArray(list)) return out;
    var groups = [], byKey = {};
    list.forEach(function (p) {
      if (!p || !p.preset) return;
      var label = String(p.name || p.preset).replace(/^Ma\s+/i, '').replace(/\s*-\s*Copie.*$/i, '').trim();
      var key = label.toLowerCase();
      if (!byKey[key]) { byKey[key] = { label: label, items: [] }; groups.push(byKey[key]); }
      byKey[key].items.push(p);
    });
    groups.forEach(function (g) {
      var linked = g.items.filter(function (p) { return p.linked; });
      var pool = linked.length ? linked : g.items;
      var pick = pool.filter(function (p) { return /^Ma\s+/i.test(p.name || p.preset); })[0] || pool[0];
      (linked.length ? out.main : out.others).push({ preset: pick.preset, label: g.label, name: g.label, linked: !!linked.length });
    });
    return out;
  }

  // Onglets Guide / Discussion : { tab: 'guide'|'chat', unread }. `send` ouvre la Discussion ; `answer` (une réponse arrive)
  // allume le point rouge si on est sur le Guide ; `show-chat` l'éteint ; `reset` (nouvelle conversation) revient au Guide.
  function tabAfter(state, event) {
    var st = { tab: state && state.tab === 'chat' ? 'chat' : 'guide', unread: !!(state && state.unread) };
    switch (event) {
      case 'send': return { tab: 'chat', unread: false };
      case 'answer': return { tab: st.tab, unread: st.tab === 'guide' ? true : st.unread };
      case 'show-chat': return { tab: 'chat', unread: false };
      case 'show-guide': return { tab: 'guide', unread: st.unread };
      case 'reset': return { tab: 'guide', unread: false };
      default: return st;
    }
  }

  var api = { tabAfter: tabAfter, filledRows: filledRows, groupPrinters: groupPrinters, contentFor: contentFor, STEPS: STEPS, currentStep: currentStep, steps: steps, primaryAction: primaryAction, prompt: prompt,
    afterPreflight: afterPreflight, resetStepOnChange: resetStepOnChange, barMode: barMode, compactFiche: compactFiche,
    ficheSummary: ficheSummary, suggestionsFor: suggestionsFor };
  root.PlyoJourney = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
