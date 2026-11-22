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

  // Filament choisi mais températures de la bobine pas encore vérifiées (étape Filament, avant le parcours guidé).
  function tempsPending(project) {
    var f = project && project.filament;
    return !!f && !f.proposed && !!f.preset && f.temps_ok !== true && !(project && project.step);
  }

  function currentStep(project) {
    var next = P.nextStep(project);
    if (next !== 'ready') return BY_FICHE[next];
    if (tempsPending(project)) return 'filament';
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

  function tempText(t) { return (t.nozzle != null ? t.nozzle + ' °C' : '?') + ' / ' + (t.bed != null ? t.bed + ' °C' : '?'); }

  // Découpe lancée depuis une réponse de l'assistant : la suite à proposer sur cette réponse une fois la plaque découpée.
  function afterSliceFollow(ctx) {
    var c = ctx || {};
    if (!c.sliced || c.blocked) return null; // plaque refusée par Orca pour l'impression : la carte d'Orca dit quoi faire
    return c.linked ? { label: 'Envoyer et imprimer', kind: 'send' } : { label: 'Exporter le fichier', kind: 'export' };
  }

  function primaryAction(step, ctx) {
    var c = ctx || {};
    // Canvas de la CC2 (étape Filament, ou emplacements repris depuis l'étape Imprimer) : on choisit un emplacement
    // (une couleur) ou un emplacement par couleur ; l'envoi attend que ce soit fait.
    if (c.canvas) {
      var cv = c.canvas;
      if (cv.mode === 'recall') return { label: 'Oui', kind: 'manualYes', enabled: true };
      if (cv.mode === 'manual') return { label: 'Garder ces emplacements', kind: 'manualSave', enabled: cv.complete !== false };
      if (cv.mode === 'single' && cv.proposal) return { label: cv.system === 'u1' ? 'Oui, la t' + cv.proposal.label.slice(1) : 'Oui, l’emplacement ' + cv.proposal.label, kind: 'confirmCanvas', enabled: true };
      if (cv.mode === 'multi') return { label: cv.system === 'u1' ? 'Utiliser ces têtes' : 'Utiliser ces emplacements', kind: 'confirmCanvas', enabled: !!cv.complete };
      // Carte « Couleurs » : chaque pièce change tout de suite ; la ligne d'action confirme les bobines, ou referme la carte rouverte.
      if (cv.mode === 'colours') return cv.reopened ? { label: 'C’est bon', kind: 'closeColours', enabled: !cv.busy } : { label: 'Utiliser ces bobines', kind: 'confirmCanvas', enabled: !!cv.complete && !cv.busy };
      return { label: '', kind: 'none', enabled: false };
    }
    // Une nouvelle bobine en un clic : la matière proposée (PLA) en bouton plein ; la marque, le nom et les températures de
    // l'étiquette attendent « Préciser ma bobine ». Aussi en « changer » le filament.
    if (c.quickSpool) return { label: 'Oui, du ' + c.quickSpool, kind: 'quickSpool', enabled: true };
    // « changer » le filament en cours : on répond avec les choix, ou « Garder cette bobine ».
    if (c.editing) return { label: '', kind: 'none', enabled: false };
    // Températures de la bobine : garder celles conseillées, ou entrer celles de l'étiquette (formulaire de l'étape).
    if (step === 'filament' && c.temps) return { label: 'Garder ' + tempText(c.temps), kind: 'keepTemps', enabled: true };
    // Fiche remplie mais plateau vide (relance d'Orca, pièce supprimée) : remettre la pièce passe avant tout.
    if (c.plateEmpty && (step === 'preparer' || step === 'imprimer')) return { label: 'Choisir un fichier', kind: 'importPart', enabled: true };
    var slice = c.slicing ? { label: 'Je découpe…', kind: 'slice', enabled: false } : { label: 'Découper', kind: 'slice', enabled: true };
    if (step === 'preparer') {
      // Questions d'intention : on répond avec les choix ; au résumé, un seul bouton applique et prépare.
      if (!c.sliced && c.intent === 'asking') return { label: '', kind: 'none', enabled: false };
      if (!c.sliced && c.intent === 'repeat') return { label: 'Préparer', kind: 'repeatIntent', enabled: true };
      if (!c.sliced && c.intent === 'ready') return { label: 'Appliquer et préparer', kind: 'applyIntent', enabled: true };
      // Débutant : sa réponse applique les réglages et lance la découpe d'elle-même ; on attend (signe d'attente, pas de bouton).
      if (!c.sliced && c.intent === 'auto') return { label: 'Je prépare ta pièce…', kind: 'applyIntent', enabled: false };
      if (!c.sliced) return slice;
      // Découpée mais refusée par Orca pour l'impression (`blocked`) : la carte d'Orca porte les corrections, pas de « Continuer ».
      if (c.blocked) return { label: '', kind: 'none', enabled: false };
      // Des risques : le seul bouton est « Tout corriger » dans la carte de vérification (il suit les cases cochées).
      return c.risks > 0 ? { label: '', kind: 'none', enabled: false } : { label: 'Continuer', kind: 'advance', enabled: true };
    }
    if (step === 'imprimer') {
      if (!c.sliced) return slice;
      if (c.blocked) return { label: '', kind: 'none', enabled: false }; // jamais « Imprimer » sur une plaque qu'Orca juge non imprimable
      // Fichier exporté (N3) : ce qui fait avancer, c'est de dire que l'impression a démarré ; l'export reste en secondaire.
      if (c.exported) return { label: 'L’impression a démarré', kind: 'started', enabled: true };
      return c.linked ? { label: 'Envoyer et imprimer', kind: 'send', enabled: !c.sending } : { label: 'Exporter le fichier', kind: 'export', enabled: !c.sending };
    }
    if (step === 'resultat') {
      // Jamais de bouton plein qui dépense tant que la fin n'est pas connue ou dite (resultState).
      var rs = resultState(c);
      if (rs === 'success') return { label: 'Nouveau projet', kind: 'newPart', enabled: true };
      if (rs === 'finished') return { label: 'Oui, c’est réussi', kind: 'success', enabled: true };
      if (rs === 'failed') return { label: PHOTO_PHONE, kind: 'photo', enabled: true };
      if (rs === 'stopped' && !c.endAsk) return { label: 'Nouveau projet', kind: 'newPart', enabled: true };
      return { label: '', kind: 'none', enabled: false };
    }
    // Débutant : la question de la plaque passe d'abord, seule ; pas d'autre bouton à côté.
    if (c.bedFirst && (step === 'machine' || step === 'piece' || step === 'filament')) return { label: '', kind: 'none', enabled: false };
    // Machine et bobine proposées (dernière machine, bobine du projet précédent) : confirmer d'un toucher.
    if (step === 'machine' && c.proposal) return { label: 'Oui, sur ' + c.proposal.name, kind: 'confirmMachine', enabled: true };
    // Liste des machines : une seule carte, « Oui, c'est elle » ; aucune, l'installation (la recherche sur le Wi-Fi d'abord).
    if (step === 'machine' && c.onlyMachine) return { label: 'Oui, c’est elle', kind: 'pickOnly', enabled: true };
    if (step === 'machine' && c.noMachine) return { label: 'Ajouter mon imprimante', kind: 'setupPrinter', enabled: true };
    if (step === 'filament' && c.proposal) return { label: 'Oui, ' + c.proposal.name, kind: 'confirmFilament', enabled: true };
    return { label: '', kind: 'none', enabled: false };
  }

  // Libellés uniques des deux façons d'envoyer une photo. La lecture de la photo par l'IA utilise la jauge : le bouton porte le
  // repère discret des actions de l'assistant (classe « ai »), pas de mention dans le texte (effet taximètre).
  var PHOTO_PHONE = 'Photo avec mon téléphone', PHOTO_COMPUTER = 'Photo depuis l’ordinateur';

  // État de l'étape Résultat (ctx : success, failed, ended, endAsk) :
  // 'success' (réussite dite), 'failed' (« raté » dit), 'finished' (la machine a fini, ta réponse est attendue),
  // 'stopped' (arrêt ou erreur lus sur la machine), 'printing' (aucune fin connue : l'impression est peut-être en cours).
  function resultState(ctx) {
    var c = ctx || {};
    if (c.success) return 'success';
    if (c.failed) return 'failed';
    if (c.ended === 'finished') return 'finished';
    if (c.ended) return 'stopped';
    return 'printing';
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
    if (c.canvas.mode === 'colours') return 'Couleurs de ta plaque';
    if (c.canvas.mode === 'tooMany') return t.tooMany || 'Ta pièce a plus de couleurs que d’emplacements';
    return t.one;
  }

  function prompt(step, ctx) {
    var c = ctx || {};
    if (c.canvas) return canvasPrompt(c);
    if (step === 'filament' && c.temps) return 'Quelles températures indique ta bobine ?';
    if (c.editing) return 'Quelle bobine ?';
    if (c.bedFirst && (step === 'machine' || step === 'piece' || step === 'filament')) return 'D’abord, une question sur ton imprimante';
    if (c.plateEmpty && (step === 'preparer' || step === 'imprimer')) return 'Ta pièce n’est plus sur le plateau';
    switch (step) {
      case 'machine': return c.proposal ? 'Imprimer sur ' + c.proposal.name + ' ?' : c.onlyMachine ? 'Imprimer sur ' + c.onlyMachine.name + ' ?' : c.noMachine ? 'Ajoute ton imprimante' : 'Choisis ton imprimante';
      case 'filament': return c.proposal ? c.proposal.name + ', comme la dernière fois ?' : c.quickSpool ? 'Ta bobine est en ' + c.quickSpool + ' ?' : 'Quelle bobine ?';
      case 'piece': return 'Ajoute la pièce à imprimer';
      case 'preparer': if (!c.sliced && c.intent === 'asking') return c.intentOne ? 'Une question sur ta pièce' : 'Quelques questions sur ta pièce';
        if (!c.sliced && c.intent === 'auto') return 'Je prépare ta pièce…';
        if (!c.sliced && c.intent === 'repeat') return 'Même usage que ta dernière pièce ?';
        if (!c.sliced && c.intent === 'ready') return 'Voilà ce que je propose';
        if (!c.sliced && c.slicing) return 'Je découpe ta plaque…';
        if (!c.sliced && c.sliceFailed) return 'La découpe a échoué : je t’explique ci-dessous';
        if (c.sliced && c.blocked) return 'Plyo Slicer bloque l’impression de cette plaque : je t’explique ci-dessous';
        return !c.sliced ? 'Découpe la plaque pour que je la vérifie' : (c.risks > 0 ? 'J’ai trouvé des points à régler : coche ce que tu veux corriger ci-dessous'
          : c.checked === 'clean' ? 'Tout est bon, on passe à l’impression' : c.checked === 'ignored' ? 'Tu as ignoré des points : à toi de voir' : 'Je vérifie ta plaque…');
      case 'imprimer': return !c.sliced ? 'Redécoupe la plaque avant d’imprimer' : c.blocked ? 'Plyo Slicer bloque l’impression de cette plaque : je t’explique ci-dessous' : 'Prêt à imprimer';
      default: if (c.success) return 'Bravo, c’est réussi !';
        if (c.failed) return 'Dommage. Montre-moi ta pièce en photo';
        // La question de fin d'impression est dans l'étape : la consigne dit seulement ce qui s'est passé.
        if (c.ended === 'finished') return 'Impression terminée';
        if (c.ended === 'cancelled') return 'Impression arrêtée';
        if (c.ended === 'error') return 'Ta machine signale une erreur';
        // Aucune fin connue : on ne demande pas « ça a marché ? » au début d'une impression.
        return 'Bonne impression ! Reviens me dire comment ça s’est passé.';
    }
  }

  // Choisir une matière peut changer le profil de filament d'Orca : on le dit, un profil modifié ou de marque n'est plus celui utilisé.
  // `show` (facultatif) : raccourci d'affichage des noms (Logic.shortName, sans « @machine ») ; la comparaison garde les noms entiers.
  function profileChangeNote(before, after, show) {
    if (!before || !after || baseName(before) === baseName(after)) return '';
    var b = show ? show(before) || before : before, a = show ? show(after) || after : after;
    if (b === a) { b = before; a = after; } // raccourcis identiques : les noms entiers, pour que la différence se voie
    return 'Profil de filament changé dans Plyo Slicer : « ' + b + ' » devient « ' + a + ' ».';
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
  // Lot UX 4 : la fiche tient toujours sur une ligne (les onglets ne bougent plus) ; elle se déplie seulement d'un clic.
  function compactFiche() { return true; }
  // Titre du panneau : le nom de la pièce du projet, sinon « Nouveau projet ».
  function projectTitle(project) { var p = project || {}; return p.part && p.part.name ? String(p.part.name) : 'Nouveau projet'; }

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

  // Nom de la machine suivi de la buse que lit le slicer (« Creality Ender-3 V3 · buse 0,4 mm ») ; sans buse connue, le nom
  // sans la mention anglaise du profil (« … 0.4 nozzle »). `nozzleMm` : context.nozzle_mm du slicer, seulement quand il lit
  // l'imprimante du projet (jamais une supposition).
  function nozzleMmText(mm) { return typeof mm === 'number' && isFinite(mm) && mm > 0 ? String(Math.round(mm * 1000) / 1000).replace('.', ',') + ' mm' : ''; }
  function machineText(printer, nozzleMm) {
    var name = String(printer && (printer.name || printer.preset) || '').replace(/\s+\d+(\.\d+)?\s*nozzle$/i, ''), n = nozzleMmText(nozzleMm);
    return n ? name + ' · buse ' + n : name;
  }

  // `extra` (facultatif) : { nozzleMm } (voir machineText).
  function ficheSummary(project, extra) {
    var p = project || {}, parts = [], x = extra || {};
    // Tenir sur une ligne : ni mot « emplacement » coupé, ni températures en chiffres (elles sont dans la fiche dépliée). La buse,
    // quand le slicer la lit sur la machine du projet.
    if (p.printer && (p.printer.name || p.printer.preset)) parts.push(machineText(p.printer, x.nozzleMm));
    if (p.part && p.part.name && !x.noPart) parts.push(shortName(p.part.name)); // `noPart` : déjà dit par le titre du panneau
    if (p.filament && p.filament.type && Array.isArray(p.canvas) && p.canvas.length) parts.push(filamentRow(p).text.replace(/ · emplacement /, ' · n° ').replace(/ · (\d+) emplacements$/, ' · $1 bobines'));
    else if (p.filament && p.filament.spool && p.filament.spool.name) parts.push(shortName(p.filament.spool.name));
    else if (p.filament && p.filament.type) parts.push(p.filament.type);
    return parts.join(' · ');
  }

  // Pendant les choix (machine, filament, pièce) une seule entrée, gratuite : montrer une impression ratée (souvent faite avant
  // Plyo). Ensuite deux au plus ; à elles quatre les étapes 4 à 6 gardent accessibles « Vérifier ma plaque », « Mes pièces »,
  // « réglages lus » et « limites ». Le défaut d'une pièce se montre en photo, gratuitement : seule la lecture utilise la jauge.
  function suggestionsFor(step) {
    switch (step) {
      case 'machine': case 'piece': case 'filament': return [{ label: 'Une impression ratée ? Montre-la-moi', kind: 'open', value: 'failed' }];
      case 'preparer': return [{ label: 'Vérifier ma plaque', kind: 'open', value: 'check' }, { label: 'Voir mes réglages actuels', kind: 'open', value: 'values' }];
      case 'imprimer': return [{ label: 'Que vérifier avant de lancer ?', kind: 'ask', value: 'Que dois-je vérifier sur mon imprimante juste avant de lancer l’impression ?' },
        { label: 'Températures de ma bobine', kind: 'open', value: 'limits' }];
      case 'resultat': return [{ label: 'Mes pièces', kind: 'open', value: 'parts' }, { label: 'Montrer le défaut en photo', kind: 'open', value: 'defect' }];
      default: return [];
    }
  }

  // Les lignes de la fiche déjà choisies (une valeur seulement proposée n'est pas choisie) : { line, text }.
  // `extra` (facultatif) : { nozzleMm } : la ligne de la machine dit la buse que lit le slicer.
  function filledRows(project, extra) {
    var p = project || {}, rows = [], n = extra && extra.nozzleMm;
    if (p.printer && !p.printer.proposed && (p.printer.name || p.printer.preset)) rows.push({ line: 'printer', text: nozzleMmText(n) ? machineText(p.printer, n) : p.printer.name || p.printer.preset });
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
    return { line: 'filament', text: p.filament.spool && p.filament.spool.name ? p.filament.spool.name : p.filament.type };
  }

  // Verdict de la vérification du démarrage (PlyoPrinterStatus.cpp) → une ligne du guide ; null si rien à dire.
  function watchText(verdict, name, file) {
    var f = file ? ' (' + file + ')' : '';
    switch (verdict) {
      case 'started': return { text: '✓ ' + name + ' a démarré l’impression' + f + '.', tone: 'ok', icon: 'check' };
      case 'busy': return { text: name + ' imprimait déjà ce fichier avant l’envoi.', tone: '', icon: 'info' };
      case 'error': return { text: name + ' signale une erreur : regarde son écran.', tone: 'warn', icon: 'alert' };
      case 'timeout': return { text: 'L’impression n’a pas démarré sur ' + name + '. Si le fichier est arrivé, lance-le depuis son écran ; sinon, vérifie qu’elle est allumée et renvoie-le.', tone: 'warn', icon: 'alert' };
      case 'unknown': return { text: 'Je ne sais pas encore vérifier le démarrage sur ' + name + ' : regarde son écran.', tone: '', icon: 'info' };
      default: return null;
    }
  }

  // Barre des étapes : une étape faite parmi les quatre premières se rouvre d'un clic (en mode « changer ») ; Imprimer et
  // Résultat, l'étape en cours et celles à venir, non.
  var REVISIT = ['machine', 'piece', 'filament', 'preparer'];
  function canRevisit(s) { return !!s && s.state === 'done' && REVISIT.indexOf(s.key) >= 0; }
  function revisitLabel(s) { return 'Revenir à l’étape ' + s.label; }

  // Fin d'une impression suivie sur la machine (PlyoPrinterStatus.cpp, message de phase « end ») : la question de
  // l'étape Résultat. null pour une fin dont on ne sait rien (« unknown_end », « lost ») : la question d'aujourd'hui reste.
  var END_REASONS = [
    { id: 'bed', label: 'Ça se décollait du plateau', said: 'ça se décollait du plateau' },
    { id: 'flow', label: 'Le fil ne sortait plus bien', said: 'le fil ne sortait plus bien' },
    { id: 'spaghetti', label: 'Ça faisait des fils ou des spaghettis', said: 'ça faisait des fils ou des spaghettis' },
    { id: 'mind', label: 'J’ai changé d’avis' },
    { id: 'other', label: 'Autre chose' }
  ];
  function endQuestion(verdict, machine, file) {
    var f = file ? '« ' + file + ' »' : '';
    switch (verdict) {
      case 'finished': return { verdict: verdict, text: machine + ' a fini d’imprimer ' + (f || 'ta pièce') + '. Ça s’est bien passé ?',
        choices: [{ id: 'yes', label: 'Oui, c’est réussi' }, { id: 'no', label: 'Non, c’est raté' }] };
      case 'cancelled': return { verdict: verdict, text: 'L’impression ' + (f ? 'de ' + f + ' ' : '') + 'a été arrêtée sur ' + machine + '. Qu’est-ce qui s’est passé ? Je suis là pour t’aider à trouver la cause et à la régler pour la prochaine fois.',
        choices: END_REASONS.map(function (r) { return { id: r.id, label: r.label }; }) };
      case 'error': return { verdict: verdict, text: machine + ' signale une erreur et l’impression s’est arrêtée. Regarde son écran et dis-moi ce qu’il affiche : je t’aide à comprendre.',
        choices: [{ id: 'screen', label: 'Écrire ce que dit l’écran' }] };
      default: return null;
    }
  }
  // La suite d'une réponse : `mark` « success » / « failure » (bobine de l'envoi, comme « Oui, c'est réussi » / « Non, c'est raté »)
  // ou rien ; `chat` ouvre la discussion, prête à écrire, avec `prefill` ; `photo` y invite à envoyer une photo.
  function endAction(verdict, id, file) {
    var none = { mark: '', chat: false, prefill: '', photo: false };
    if (verdict === 'finished') return id === 'yes' ? { mark: 'success', chat: false, prefill: '', photo: false } : { mark: 'failure', chat: true, prefill: '', photo: true };
    if (verdict === 'error') return { mark: '', chat: true, prefill: 'Mon imprimante signale une erreur. Son écran affiche : ', photo: false }; // ratée seulement si tu le dis ensuite
    if (verdict !== 'cancelled' || id === 'mind') return none;
    var r = END_REASONS.filter(function (x) { return x.id === id; })[0];
    if (!r) return none;
    return { mark: 'failure', chat: true, photo: true,
      prefill: r.said ? 'L’impression ' + (file ? 'de « ' + file + ' » ' : '') + 'a été arrêtée : ' + r.said + '. Comment l’éviter la prochaine fois ?' : '' };
  }
  // Une seule question par envoi : pas si le Résultat a déjà eu sa réponse (ou la question de fin la sienne).
  function endAsk(send, project) {
    return !!(send && send.end && !send.answered && !(project && project.success) && endQuestion(send.end.verdict, '', ''));
  }

  // Nom court d'une machine dans une phrase, comme la fiche repliée : sans la buse (« CR-10 SE », pas « … 0.4 nozzle »).
  function shortMachine(p) { return machineLabel(p).replace(/\s+\d+(\.\d+)?\s*nozzle$/i, ''); }

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

  // Cartes de l'étape Machine : les machines reliées, puis celles sans liaison (clé USB, carte SD) tant qu'il y en a peu
  // (sinon repliées derrière « Autres machines installées (n) », `folded`). `list` : profils visibles (groupPrinters).
  function machineCards(list, showOthers) {
    var g = groupPrinters(list), many = g.others.length > 3 && !showOthers;
    return { cards: g.main.concat(many ? [] : g.others), folded: many ? g.others.length : 0 };
  }
  // Ce que dit une carte sous le nom : « ● connectée », « reliée » (Wi-Fi), « clé USB » (pas de liaison).
  function machineStatus(card, reachable) { return !card.linked ? 'clé USB' : reachable === true ? '● connectée' : 'reliée'; }

  // Onglets Guide / Discussion : { tab: 'guide'|'chat', unread }. `send` ouvre la Discussion ; `answer` (une réponse arrive)
  // allume le point rouge si on est sur le Guide ; `show-chat` l'éteint ; `reset` (nouvelle conversation) revient au Guide.
  // `home: 'chat'` (UX-02) : le confirmé (« Je connais déjà ») commence sur « Poser une question » ('start-chat'), et un nouveau
  // projet l'y laisse ('reset'), jusqu'à ce qu'il ouvre lui-même « Étapes » ('show-guide' : on revient au comportement habituel).
  function tabAfter(state, event) {
    var home = !!(state && state.home === 'chat');
    var st = { tab: state && state.tab === 'chat' ? 'chat' : 'guide', unread: !!(state && state.unread) };
    var keep = function (o) { if (home) o.home = 'chat'; return o; };
    switch (event) {
      case 'send': return keep({ tab: 'chat', unread: false });
      case 'answer': return keep({ tab: st.tab, unread: st.tab === 'guide' ? true : st.unread });
      case 'show-chat': return keep({ tab: 'chat', unread: false });
      case 'show-guide': return { tab: 'guide', unread: st.unread };
      case 'reset': return keep({ tab: home ? 'chat' : 'guide', unread: false });
      case 'start-chat': return { tab: 'chat', unread: false, home: 'chat' };
      default: return keep(st);
    }
  }

  // Entrée du menu « ⋯ » qui change d'avis sur l'ouverture au lancement (UX-02) : elle dit ce que le clic va faire.
  function startMenuLabel(level) {
    return level === 'expert' ? 'Me guider pas à pas, panneau ouvert au lancement' : 'Je connais déjà : panneau fermé au lancement';
  }
  function startChangeNote(level) {
    return level === 'expert'
      ? 'C’est noté : au prochain lancement, le panneau reste fermé. Il est à un clic sur « Assistant », en haut, et s’ouvre sur « Poser une question ». L’onglet « Étapes » garde le parcours guidé.'
      : 'C’est noté : au prochain lancement, le panneau s’ouvre sur le parcours en étapes.';
  }

  // Texte d'accueil de l'onglet « Poser une question » (conversation vide). Sans projet complet, il renvoie vers « Étapes ».
  function chatHello(ready) {
    var base = 'Pose-moi ta question ici : un réglage, un problème d’impression, une photo de défaut à analyser.';
    return ready ? base : base + ' Pour avancer pas à pas, passe par l’onglet « Étapes ».';
  }

  // Ce qu'il manque à la fiche pour appliquer une correction (`missing` : printer, part, filament, dans cet ordre) : le
  // bouton qui y mène, et la phrase qui prévient avant une photo (rien si la machine et la bobine sont déjà choisies).
  function completeLabel(missing) {
    var m = Array.isArray(missing) ? missing : [], printer = m.indexOf('printer') >= 0, filament = m.indexOf('filament') >= 0;
    if (printer && filament) return 'Choisir ma machine et ma bobine';
    if (printer) return 'Choisir ma machine';
    if (filament) return 'Choisir ma bobine';
    return m.indexOf('part') >= 0 ? 'Choisir ma pièce' : '';
  }
  function fixNeeds(project) {
    var next = P.nextStep(project), p = project || {};
    var printer = next === 'printer', filament = !(p.filament && !p.filament.proposed && p.filament.preset);
    if (printer && filament) return 'Pour que j’applique une correction, il me faudra ta machine et ta bobine.';
    if (printer) return 'Pour que j’applique une correction, il me faudra ta machine.';
    if (filament) return 'Pour que j’applique une correction, il me faudra ta bobine.';
    return '';
  }

  // Ce qui manque encore parmi `missing` (printer, part, filament) une fois la fiche changée : un message qui demandait de les
  // choisir n'est plus vrai quand cette liste est vide (N2).
  function stillMissing(project, missing) {
    var p = project || {}, next = P.nextStep(p);
    return (Array.isArray(missing) ? missing : []).filter(function (k) {
      return k === 'printer' ? next === 'printer' : k === 'filament' ? !(p.filament && !p.filament.proposed && p.filament.preset) : k === 'part' ? !(p.part && p.part.name) : false;
    });
  }
  // Phrase dite quand la fiche est complète (N2) : une fiche de réglages encore à appliquer dans la discussion passe avant
  // l'invitation à montrer la pièce (le diagnostic est déjà fait).
  var FICHE_WAITS = 'C’est noté. Ta fiche de réglages t’attend dans la discussion : clique sur « Appliquer ».';
  function completionText(asked, fichePending) { return fichePending ? FICHE_WAITS : asked || FICHE_WAITS; }

  // Une machine qui ne répondait pas est revérifiée toute seule tant qu'on est à l'étape Imprimer.
  function shouldRecheck(step, reachable) { return step === 'imprimer' && reachable === false; }

  // Accueil du débutant (P1, parcours débutant 16/11) : la règle du jeu, avant la première question. Montré à tous sauf
  // « Je connais déjà », une seule fois (premiers-pas.json : greeted).
  var WELCOME = {
    title: 'Je t’aide à imprimer, étape par étape',
    lines: [
      { icon: 'chat', text: 'Je te pose quelques questions sur ton imprimante, ta bobine et ta pièce.' },
      { icon: 'check', text: 'Pour répondre, clique sur le bouton qui te correspond. Pas sûr ? Il y a toujours « Je ne sais pas ».' },
      { icon: 'wand', text: 'Je règle Plyo Slicer pour toi : tu n’as pas besoin de toucher à la partie de gauche.' }
    ],
    go: 'C’est parti'
  };
  function showsWelcome(fs) { return !!(fs && fs.seen && fs.level !== 'expert' && !fs.greeted); }

  var api = { machineCards: machineCards, machineStatus: machineStatus, WELCOME: WELCOME, showsWelcome: showsWelcome, machineText: machineText, stillMissing: stillMissing, completionText: completionText, FICHE_WAITS: FICHE_WAITS, resultState: resultState, PHOTO_PHONE: PHOTO_PHONE, PHOTO_COMPUTER: PHOTO_COMPUTER, completeLabel: completeLabel, fixNeeds: fixNeeds, shortMachine: shortMachine, canRevisit: canRevisit, revisitLabel: revisitLabel, endQuestion: endQuestion, endAction: endAction, endAsk: endAsk, afterSliceFollow: afterSliceFollow, watchText: watchText, tempsPending: tempsPending, profileChangeNote: profileChangeNote, baseName: baseName, shouldRecheck: shouldRecheck, machineLabel: machineLabel, divergenceNames: divergenceNames, chatHello: chatHello, tabAfter: tabAfter, startMenuLabel: startMenuLabel, startChangeNote: startChangeNote, filledRows: filledRows, groupPrinters: groupPrinters, contentFor: contentFor, STEPS: STEPS, currentStep: currentStep, steps: steps, tabLabel: tabLabel, primaryAction: primaryAction, prompt: prompt,
    afterPreflight: afterPreflight, advanceNote: advanceNote, resetStepOnChange: resetStepOnChange, barMode: barMode, compactFiche: compactFiche,
    ficheSummary: ficheSummary, suggestionsFor: suggestionsFor, projectTitle: projectTitle };
  root.PlyoJourney = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
