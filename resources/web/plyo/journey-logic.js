// Logique pure du parcours en six étapes (sans DOM) : étape en cours, action principale, repli, suggestions.
// Chargée par index.html (window.PlyoJourney) et testée par node (tests/journey-logic.test.mjs).
// Les étapes 1 à 3 viennent de la fiche du projet (project-logic.js) ; les étapes 4 à 6 de project.step
// (slice, print, after ; absent ou « done » = Préparer).
(function (root) {
  var P = root.PlyoProject || (typeof require !== 'undefined' ? require('./project-logic.js') : null);

  var STEPS = [
    { key: 'machine', label: 'Machine' }, { key: 'piece', label: 'Pièce' }, { key: 'filament', label: 'Filament' },
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

  // Nom de l'onglet Étapes avec la progression (« Étapes · 4/6 ») : la barre n'est visible que dans cet onglet.
  function tabLabel(project) {
    if (!project) return 'Étapes';
    var current = currentStep(project);
    var i = STEPS.findIndex(function (s) { return s.key === current; });
    return 'Étapes · ' + (i + 1) + '/' + STEPS.length;
  }

  function primaryAction(step, ctx) {
    var c = ctx || {};
    // Canvas de la CC2 (étape Filament, ou emplacements repris depuis l'étape Imprimer) : on choisit un emplacement
    // (une couleur) ou un emplacement par couleur ; l'envoi attend que ce soit fait.
    if (c.canvas) {
      var cv = c.canvas;
      if (cv.mode === 'recall') return { label: 'Oui', kind: 'manualYes', enabled: true };
      if (cv.mode === 'manual') return { label: 'Garder ces emplacements', kind: 'manualSave', enabled: true };
      if (cv.mode === 'single' && cv.proposal) return { label: cv.system === 'u1' ? 'Oui, la t' + cv.proposal.label.slice(1) : 'Oui, l’emplacement ' + cv.proposal.label, kind: 'confirmCanvas', enabled: true };
      if (cv.mode === 'multi') return { label: cv.system === 'u1' ? 'Utiliser ces têtes' : 'Utiliser ces emplacements', kind: 'confirmCanvas', enabled: !!cv.complete };
      return { label: '', kind: 'none', enabled: false };
    }
    // « changer » le filament en cours : on répond avec les choix, ou « Garder ce filament ».
    if (c.editing) return { label: '', kind: 'none', enabled: false };
    // Fiche remplie mais plateau vide (relance d'Orca, pièce supprimée) : remettre la pièce passe avant tout.
    if (c.plateEmpty && (step === 'preparer' || step === 'imprimer')) return { label: 'Choisir un fichier', kind: 'importPart', enabled: true };
    var slice = c.slicing ? { label: 'Je découpe…', kind: 'slice', enabled: false } : { label: 'Découper', kind: 'slice', enabled: true };
    if (step === 'preparer') {
      // Questions d'intention : on répond avec les choix ; au résumé, un seul bouton applique et prépare.
      if (!c.sliced && c.intent === 'asking') return { label: '', kind: 'none', enabled: false };
      if (!c.sliced && c.intent === 'ready') return { label: 'Appliquer et préparer', kind: 'applyIntent', enabled: true };
      if (!c.sliced) return slice;
      // Des risques : le seul bouton est « Tout corriger » dans la carte de vérification (il suit les cases cochées).
      return c.risks > 0 ? { label: '', kind: 'none', enabled: false } : { label: 'Continuer', kind: 'advance', enabled: true };
    }
    if (step === 'imprimer') {
      if (!c.sliced) return slice;
      return c.linked ? { label: 'Envoyer et imprimer', kind: 'send', enabled: !c.sending } : { label: 'Exporter le fichier', kind: 'export', enabled: !c.sending };
    }
    if (step === 'resultat') return c.success ? { label: 'Nouvelle pièce', kind: 'newPart', enabled: true } : { label: 'Envoyer une photo', kind: 'photo', enabled: true };
    // Machine et filament proposés (dernière machine, dernier filament) : confirmer d'un toucher.
    if (step === 'machine' && c.proposal) return { label: 'Oui, sur ' + c.proposal.name, kind: 'confirmMachine', enabled: true };
    if (step === 'filament' && c.proposal) return { label: 'Oui, du ' + c.proposal.name, kind: 'confirmFilament', enabled: true };
    return { label: '', kind: 'none', enabled: false };
  }

  // Sans système connu : les textes de la CC2.
  var SLOT_PROMPTS = {
    canvas: { loading: 'Je lis les emplacements de ta CC2…', one: 'Quel emplacement du Canvas pour ta pièce ?' },
    cfs: { loading: 'Je lis les emplacements de ton CFS…', one: 'Quel emplacement du CFS pour ta pièce ?' },
    ifs: { loading: 'Je lis les emplacements de ton IFS…', one: 'Quel emplacement de l’IFS pour ta pièce ?' },
    manual: { loading: 'Je relis ce que tu m’as dit…', one: 'Quel emplacement pour ta pièce ?' },
    u1: { loading: 'Je lis les têtes de ta U1…', one: 'Quelle tête pour ta pièce ?', multi: 'Quelle tête pour chaque couleur ?', tooMany: 'Ta pièce a plus de couleurs que de têtes' }
  };
  function canvasPrompt(c) {
    var t = SLOT_PROMPTS[c.canvas.system] || SLOT_PROMPTS.canvas;
    if (c.canvas.mode === 'recall') return c.canvas.recall;
    if (c.canvas.mode === 'manual') return 'Décris tes emplacements';
    if (c.canvas.mode === 'loading') return t.loading;
    if (c.canvas.mode === 'multi') return t.multi || 'Quel emplacement pour chaque couleur ?';
    if (c.canvas.mode === 'tooMany') return t.tooMany || 'Ta pièce a plus de couleurs que d’emplacements';
    return t.one;
  }

  function prompt(step, ctx) {
    var c = ctx || {};
    if (c.canvas) return canvasPrompt(c);
    if (c.editing) return 'Dis-moi quel filament est sur la bobine';
    if (c.plateEmpty && (step === 'preparer' || step === 'imprimer')) return 'Ta pièce n’est plus sur le plateau';
    switch (step) {
      case 'machine': return c.proposal ? 'Imprimer sur ' + c.proposal.name + ' ?' : 'Choisis ton imprimante';
      case 'filament': return c.proposal ? c.proposal.name + ', comme la dernière fois ?' : 'Dis-moi quel filament est sur la bobine';
      case 'piece': return 'Ajoute la pièce à imprimer';
      case 'preparer': if (!c.sliced && c.intent === 'asking') return 'Quelques questions sur ta pièce';
        if (!c.sliced && c.intent === 'ready') return 'Voilà ce que je propose';
        if (!c.sliced && c.slicing) return 'Je découpe ta plaque…';
        return !c.sliced ? 'Découpe la plaque pour que je la vérifie' : (c.risks > 0 ? 'J’ai trouvé des points à régler : coche ce que tu veux corriger ci-dessous'
          : c.checked === 'clean' ? 'Tout est bon, on passe à l’impression' : c.checked === 'ignored' ? 'Tu as ignoré des points : à toi de voir' : 'Je vérifie ta plaque…');
      case 'imprimer': return !c.sliced ? 'Redécoupe la plaque avant d’imprimer' : 'Prêt à imprimer';
      default: return c.success ? 'Bravo, c’est réussi !' : 'Alors, ça a marché ? Envoie-moi une photo';
    }
  }

  // Choisir une matière peut changer le profil de filament d'Orca : on le dit, un profil modifié ou de marque n'est plus celui utilisé.
  function profileChangeNote(before, after) {
    if (!before || !after || baseName(before) === baseName(after)) return '';
    return 'Profil de filament changé dans Orca : « ' + before + ' » devient « ' + after + ' ».';
  }
  function afterPreflight(risks) { return risks === 0 ? 'advance' : 'stay'; }
  // Message au passage à l'impression : « Pas de risque » seulement si la vérification n'a rien trouvé, même ignoré.
  function advanceNote(allRisks) {
    return allRisks > 0 ? { text: 'Tu as ignoré des points signalés : on passe à l’impression, à toi de voir.', tone: 'warn', icon: 'alert' }
      : { text: 'Pas de risque détecté : on passe à l’impression.', tone: 'ok', icon: 'check' };
  }

  function presetOf(project, key) { return project && project[key] && project[key].preset ? project[key].preset : ''; }

  // Machine ou filament changé après la découpe : la découpe est périmée, on repasse à Préparer.
  // Nom d'un profil sans la copie « (Plyo) » ni la calibration « — … » (comme ProjectLogic::same_filament).
  function baseName(name) { return String(name || '').replace(/ \(Plyo\)$/, '').replace(/ — .*$/, ''); }
  function resetStepOnChange(before, after) {
    if (!after) return after;
    var printerChanged = !!before && presetOf(before, 'printer') !== presetOf(after, 'printer');
    var changed = printerChanged || (!!before && presetOf(before, 'filament') !== presetOf(after, 'filament'));
    var resetStep = changed && (after.step === 'print' || after.step === 'after');
    // Emplacements du Canvas : oubliés avec la machine, ou si le filament (couleur 1) n'est plus celui de l'emplacement.
    var first = Array.isArray(after.canvas) ? after.canvas.filter(function (e) { return e.t === 0; })[0] : null;
    var dropCanvas = !!after.canvas && (printerChanged || !after.filament || (!!first && baseName(first.preset) !== baseName(after.filament.preset)));
    if (!resetStep && !(printerChanged && after.adapted) && !dropCanvas) return after;
    var out = JSON.parse(JSON.stringify(after));
    if (resetStep) out.step = 'slice';
    if (printerChanged) delete out.adapted; // un autre profil de machine : les réglages du 3MF sont à adapter de nouveau
    if (dropCanvas) delete out.canvas;
    return out;
  }

  function barMode(widthPx) { return widthPx < 340 ? 'pills' : 'names'; }
  // `folded` : l'utilisateur est dans la Discussion, qui a besoin de la place ; sinon seulement si la fenêtre est basse.
  // Repliée en une ligne : onglet Discussion, petite fenêtre, ou dès l'étape Préparer (les choix sont faits, l'étape en cours a la place).
  function compactFiche(o) { return !!(o && (o.folded || o.heightPx < 760 || ['preparer', 'imprimer', 'resultat'].indexOf(o.step) >= 0)); }

  // Ce qui occupe le premier bloc du corps : les choix (étapes 1 à 3, ou « changer » le filament) ou le contenu des étapes 4 à 6.
  function contentFor(step, editing) {
    if (editing === 'filament') return 'choices';
    return step === 'machine' || step === 'filament' || step === 'piece' ? 'choices' : 'steps';
  }

  // La fiche repliée tient sur une ligne : un nom très long est coupé au milieu, pour que le filament reste visible.
  function shortName(name) {
    var n = String(name || '');
    return n.length <= 28 ? n : n.slice(0, 18) + '…' + n.slice(-8);
  }

  function ficheSummary(project) {
    var p = project || {}, parts = [];
    // Tenir sur une ligne : ni buse, ni mot « emplacement » coupé, ni températures en chiffres (elles sont dans la fiche dépliée).
    if (p.printer && (p.printer.name || p.printer.preset)) parts.push(String(p.printer.name || p.printer.preset).replace(/\s+\d+(\.\d+)?\s*nozzle$/i, ''));
    if (p.part && p.part.name) parts.push(shortName(p.part.name));
    if (p.filament && p.filament.type && Array.isArray(p.canvas) && p.canvas.length) parts.push(filamentRow(p).text.replace(/ · emplacement /, ' · n° ').replace(/ · (\d+) emplacements$/, ' · $1 bobines'));
    else if (p.filament && p.filament.type) parts.push(p.filament.type);
    return parts.join(' · ');
  }

  // Pendant les choix (machine, filament, pièce) aucune suggestion : rien ne doit distraire. Ensuite deux au plus ; à elles
  // quatre les étapes 4 à 6 gardent accessibles « Vérifier ma plaque », « Mes pièces », « réglages lus » et « limites ».
  function suggestionsFor(step) {
    switch (step) {
      case 'preparer': return [{ label: 'Vérifier ma plaque', kind: 'open', value: 'check' }, { label: 'Voir mes réglages actuels', kind: 'open', value: 'values' }];
      case 'imprimer': return [{ label: 'Que vérifier avant de lancer ? (utilise ta jauge)', kind: 'ask', value: 'Que dois-je vérifier sur mon imprimante juste avant de lancer l’impression ?' },
        { label: 'Températures de ma bobine', kind: 'open', value: 'limits' }];
      case 'resultat': return [{ label: 'Mes pièces', kind: 'open', value: 'parts' }, { label: 'Ma pièce a un défaut (utilise ta jauge)', kind: 'ask', value: 'Ma pièce a un défaut, peux-tu m’aider ?' }];
      default: return [];
    }
  }

  // Les lignes de la fiche déjà choisies (une valeur seulement proposée n'est pas choisie) : { line, text }.
  function filledRows(project) {
    var p = project || {}, rows = [];
    if (p.printer && !p.printer.proposed && (p.printer.name || p.printer.preset)) rows.push({ line: 'printer', text: p.printer.name || p.printer.preset });
    if (p.part && p.part.name) rows.push({ line: 'part', text: p.part.name });
    if (p.filament && !p.filament.proposed && p.filament.type) rows.push(filamentRow(p));
    return rows;
  }

  // Ligne filament : avec les emplacements, la couleur et le numéro (« PLA blanc · emplacement 2 »).
  function filamentRow(p) {
    var cv = Array.isArray(p.canvas) ? p.canvas : [];
    if (cv.length > 1) return { line: 'filament', text: p.filament.type + ' · ' + cv.length + (cv[0].system === 'u1' ? ' têtes' : ' emplacements') };
    if (cv.length === 1) {
      var C = (typeof window !== 'undefined' && window.PlyoCanvas) || null, name = C ? C.colourName(cv[0].color) : '';
      var slot = cv[0].label !== undefined && cv[0].label !== '' ? cv[0].label : cv[0].tray_id + 1; // numéro du traducteur (« 1A ») ; projet ancien : tray_id + 1
      return { line: 'filament', text: p.filament.type + (name ? ' ' + name : '') + (cv[0].system === 'u1' ? ' · tête ' : ' · emplacement ') + slot, swatch: cv[0].color };
    }
    return { line: 'filament', text: p.filament.type };
  }

  // Nom d'une machine : le nom du profil sans « Ma » devant ni « - Copie » derrière.
  function machineLabel(p) { return String(p && (p.name || p.preset) || '').replace(/^Ma\s+/i, '').replace(/\s*-\s*Copie.*$/i, '').trim(); }

  // Carte « Orca est passé sur… » : noms courts, sauf si les deux profils donnent le même nom (« Ma K2 » et « K2 »).
  function divergenceNames(printer, orcaPreset) {
    var from = (printer && (printer.name || printer.preset)) || '', to = machineLabel({ name: orcaPreset });
    if (machineLabel({ name: from }).toLowerCase() !== to.toLowerCase()) return { from: from, to: to };
    return { from: (printer && printer.preset) || from, to: orcaPreset }; // noms complets des profils
  }

  // Profils d'imprimante → une ligne par machine. « Ma K2 », « K2 - Copie » et « K2 » sont la même machine : on garde le profil
  // relié (« Ma … » de préférence). Les machines sans profil relié vont dans `others` (rangées sous « Autres profils »).
  function groupPrinters(list) {
    var out = { main: [], others: [] };
    if (!Array.isArray(list)) return out;
    var groups = [], byKey = {};
    list.forEach(function (p) {
      if (!p || !p.preset) return;
      var label = machineLabel(p);
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

  // Texte d'accueil de l'onglet « Poser une question » (conversation vide). Sans projet complet, il renvoie vers « Étapes ».
  function chatHello(ready) {
    var base = 'Pose-moi ta question ici : un réglage, un problème d’impression, une photo de défaut à analyser.';
    return ready ? base : base + ' Pour avancer pas à pas, passe par l’onglet « Étapes ».';
  }

  // Une machine qui ne répondait pas est revérifiée toute seule tant qu'on est à l'étape Imprimer.
  function shouldRecheck(step, reachable) { return step === 'imprimer' && reachable === false; }

  var api = { profileChangeNote: profileChangeNote, baseName: baseName, shouldRecheck: shouldRecheck, machineLabel: machineLabel, divergenceNames: divergenceNames, chatHello: chatHello, tabAfter: tabAfter, filledRows: filledRows, groupPrinters: groupPrinters, contentFor: contentFor, STEPS: STEPS, currentStep: currentStep, steps: steps, tabLabel: tabLabel, primaryAction: primaryAction, prompt: prompt,
    afterPreflight: afterPreflight, advanceNote: advanceNote, resetStepOnChange: resetStepOnChange, barMode: barMode, compactFiche: compactFiche,
    ficheSummary: ficheSummary, suggestionsFor: suggestionsFor };
  root.PlyoJourney = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
