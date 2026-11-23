// Étape « Imprimer » (préparer, imprimer, résultat) : logique sans DOM partagée par le panneau classique (index.html) et la v2
// (v2/imprimer.js). Chargée par les deux pages (window.PlyoImprimer) et testée par node (tests/imprimer-logic.test.mjs).
// Rien ici ne parle au slicer : les fonctions lisent le projet, les signaux de la plaque (tour_signals) et la vérification
// avant impression (preflight), et rendent ce qu'il faut dire ou faire.
(function (root) {
  var req = function (name, file) { return root[name] || (typeof require !== 'undefined' ? require(file) : null); };
  var I = req('PlyoIntent', './intent-logic.js'), M = req('PlyoMachines', './machines-logic.js'), J = req('PlyoJourney', './journey-logic.js');
  var PF = req('PlyoPreflight', './preflight.js');

  // ---------- Durée, poids, coût ----------
  // « environ 1 h 05 » (phrase du classique) ; « 1 h 05 » ou « 45 min » (chiffre de l'écran « Tout est prêt »).
  function durationText(seconds) {
    var m = Math.max(1, Math.round(seconds / 60));
    return m < 60 ? 'environ ' + m + ' min' : 'environ ' + Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }
  function shortDuration(seconds) { return durationText(seconds).replace(/^environ /, ''); }
  function printSummary(signals) {
    var s = signals;
    if (!s || !s.sliced || !s.time_s) return '';
    var grams = s.weight_g ? ' et ' + Math.round(s.weight_g) + ' g de filament' : '';
    return 'Ton impression prendra ' + durationText(s.time_s) + grams + '.';
  }
  function money(v) { return (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }
  // Les trois chiffres de « Tout est prêt ». Le coût vient du slicer (`cost`, calculé avec le prix du préréglage filament,
  // `filament_cost`) : sans prix, il n'est pas donné et la case est masquée. Jamais de chiffre inventé.
  function stats(signals, material) {
    var s = signals || {};
    if (!s.sliced || !(s.time_s > 0)) return null;
    return { time: shortDuration(s.time_s), grams: s.weight_g > 0 ? Math.round(s.weight_g) + ' g' : '', material: material || '',
      cost: typeof s.cost === 'number' && s.cost > 0 ? '≈ ' + money(s.cost) + ' €' : '' };
  }

  // ---------- L'envoi gardé dans le projet (project.send) ----------
  // Le dernier envoi (ou export) fait depuis le panneau pour ce projet : { spool: {id, name}, watch (id du suivi), failed (« raté »
  // dit), answered (fin répondue), marked (réussite envoyée au slicer), end: {verdict, file} (fin lue), outcome, route }.
  function sendOf(project) { return project && project.send && typeof project.send === 'object' ? project.send : null; }
  // L'envoi du projet ; sans envoi noté (projet d'avant, impression lancée depuis Orca), il part de la bobine du projet : le
  // slicer ne la marque que si son dernier envoi est récent et fait avec elle. Jamais pour les emplacements (Canvas…).
  function sendRecord(p) {
    var f = p.filament;
    if (!sendOf(p)) p.send = f && f.spool && f.spool.id && !(Array.isArray(p.canvas) && p.canvas.length) ? { spool: { id: f.spool.id, name: f.spool.name } } : {};
    return p.send;
  }
  // Un nouvel envoi remplace le précédent.
  function newSend(p) { delete p.send; return sendRecord(p); }
  // Le slicer suit cet envoi sur la machine (print_watch) jusqu'à la fin de l'impression.
  function noteWatched(p, watchId) {
    var s = sendRecord(p);
    s.watch = watchId;
    s.answered = false;
    delete s.end;
    s.outcome = '';
    return s;
  }
  // La fin déjà répondue sans jugement ('' sinon) ; la question de fin qui attend sa réponse (null sinon).
  function endOutcome(p) { var s = sendOf(p); return s && !p.success ? s.outcome || '' : ''; }
  function endQuestionNow(p) {
    var s = sendOf(p);
    if (!s || !J.endAsk(s, p)) return null;
    return J.endQuestion(s.end.verdict, p.printer ? J.shortMachine(p.printer) : 'ton imprimante', s.end.file);
  }
  // Nom de la bobine de l'envoi, tant que la réussite n'est pas dite.
  function spoolAsk(p) { var s = sendOf(p); return s && s.spool && !p.success ? s.spool.name : ''; }
  // Suivi en cours : l'envoi a son suivi, sans fin lue ni réponse.
  function watching(p) { var s = sendOf(p); return !!(s && s.watch && !s.end && !s.answered && !p.success); }

  // ---------- Questions d'intention (« À quoi va servir ta pièce ? ») ----------
  function intentAnswers(p) { var i = (p && p.intent) || {}, a = {}; ['use', 'pref', 'speed'].forEach(function (k) { if (i[k]) a[k] = i[k]; }); return a; }
  // État des questions pour l'étape Préparer. `o` : { step, sliced, habits, level ('expert' = confirmé), changing (« Changer »
  // demandé), idk, manual (clés changées à la main, null tant qu'elles ne sont pas lues), applying, nozzleMm }.
  // null : pas de question (déjà appliquée, passée, ou plus demandée). `needsManual` : relire les modifications manuelles.
  function intentState(p, o) {
    if (!p || o.step !== 'preparer' || o.sliced) return null;
    var i = p.intent || {}, habits = o.habits || M.emptyHabits();
    if (i.applied || i.skipped || !M.askIntent(habits) && !i.use) return null;
    var answers = intentAnswers(p), q = I.nextQuestion(answers);
    // Confirmé, deuxième pièce et suivantes (UX-33) : une ligne « Comme la dernière fois » au lieu des trois questions.
    if (q && !i.reask && !o.changing && I.offersRepeat(o.level, habits.last_intent, answers))
      return { mode: 'repeat', text: I.repeatText(habits.last_intent) };
    // Débutant : une seule question (l'usage), sauf après « Ajuster » qui repose les deux autres.
    var novice = o.level !== 'expert', one = novice && !i.adjust;
    if (q) return { mode: 'asking', question: q, answers: answers, total: answers.use === 'test' || one ? 1 : 3, idk: !!o.idk, guess: I.guessUse(p.part && p.part.name) };
    var type = p.filament && p.filament.type;
    var r = I.keepManual(I.settingsFor(answers, type, o.nozzleMm || 0), o.manual);
    // Débutant : pas d'écran « Voilà ce que je propose » ; pendant que sa réponse s'applique, le résumé se lit et la découpe suit.
    return { mode: novice && o.applying ? 'auto' : 'ready', summary: I.summary(answers, type), changes: r.apply, kept: r.kept, level: M.levelOf(habits), needsManual: o.manual === null || o.manual === undefined };
  }
  // Questions encore sans réponse, au format attendu par le service (les choix de « pref » dépendent de l'usage déjà choisi).
  function intentPending(st) {
    if (!st || st.mode !== 'asking') return null;
    var a = st.answers, out = [], Q = I.QUESTIONS;
    var add = function (q) { out.push({ id: q.id, text: q.text, choices: q.choices.map(function (c) { return { id: c.id, label: c.label }; }) }); };
    if (!a.use) add(Q.use);
    else if (!a.pref && Q.pref[a.use]) add(Q.pref[a.use]);
    if (!a.speed && a.use !== 'test') add(Q.speed);
    return out.length ? out : null;
  }
  // Les cinq usages en grandes cartes (v2) : les exemples concrets de « Je ne sais pas », la réponse suggérée d'après le nom de
  // la pièce (sinon la plus sûre, « objet du quotidien »), marquée « Suggéré ».
  var USE_ICONS = { flex: 'flex', deco: 'heart', daily: 'home', strong: 'bolt', test: 'test' };
  function useCards(partName) {
    var guess = I.guessUse(partName), help = I.idkOptions('use', {}), sug = guess || help.safe;
    return { suggested: sug, cards: help.options.map(function (o) { return { id: o.answer, label: o.label, sub: o.sub || '', icon: USE_ICONS[o.answer] || 'cube', suggested: o.answer === sug }; }) };
  }
  // Libellés courts d'une intention : « Objet du quotidien », « Équilibrée · Normal ».
  function intentLabels(answers) {
    var a = answers || {}, Q = I.QUESTIONS, find = function (q, id) { var c = q && q.choices.filter(function (x) { return x.id === id; })[0]; return c ? c.label : ''; };
    var use = find(Q.use, a.use), pref = a.use && Q.pref[a.use] ? find(Q.pref[a.use], a.pref) : '', speed = a.use === 'test' ? '' : find(Q.speed, a.speed);
    return { use: use, detail: [pref, speed].filter(Boolean).join(' · ') };
  }

  // ---------- « Tout est prêt » : les vérifications ----------
  function hasBrim(s) { return s.brim_type !== 'no_brim' && (s.brim_type === 'auto_brim' || Number(s.brim_width) > 0); }
  function kinds(data, settings) {
    var out = {};
    PF.preflightRisks({ settings: settings, objects: data.objects, conflict: data.conflict }).forEach(function (r) { out[r.kind] = r; });
    return out;
  }
  // Lignes de vérification à partir de la vérification avant impression (preflight) : { key, ok, title, sub, act }. `act` : le
  // geste de la ligne ({ label, kind: 'apply' | 'plate' | 'show_setting', changes, action, key }). `o` : { printer (nom court),
  // filament ({ nozzle_temp, bed_temp }), added ({ support, brim } : ajoutés par la préparation) }.
  function readyChecks(data, o) {
    var opts = o || {}, out = [];
    if (!data || !data.settings || !Array.isArray(data.objects) || !data.objects.length) return out;
    var s = data.settings, now = kinds(data, s), added = opts.added || {};
    if (now.conflict) out.push({ key: 'conflict', ok: false, title: 'Des pièces se chevauchent', sub: 'La buse les heurterait à l’impression.', act: { label: 'Ranger', kind: 'plate', action: 'arrange' } });
    if (now.fit) out.push({ key: 'fit', ok: false, title: 'Elle dépasse du plateau', sub: now.fit.text, act: { label: 'Réduire', kind: 'plate', action: 'scale_to_fit' } });
    else out.push({ key: 'fit', ok: true, title: 'Elle tient sur le plateau' + (opts.printer ? ' de ' + opts.printer : '') });
    if (now.open_top) {
      var fix = now.open_top.fixes[0];
      out.push({ key: 'open_top', ok: false, title: 'Elle n’aurait pas de dessus', sub: 'Aucune couche pleine n’est prévue au-dessus.', act: fix ? { label: 'Corriger', kind: 'apply', changes: fix.keyChanges.map(function (c) { return { key: c.key, value: c.value, label: c.label, confirmed: true }; }), catalog: true } : null });
    }
    // Supports : seulement si une pièce a des parties dans le vide.
    var overhang = data.objects.some(function (x) { return x && x.needs_support === true; });
    if (overhang) {
      if (s.support) out.push({ key: 'support', ok: true, title: added.support ? 'J’ai ajouté des supports' : 'Avec des supports', sub: 'Des parties sont dans le vide : les supports les soutiennent, ils se détachent à la main.', act: { label: 'Retirer', kind: 'apply', changes: [{ id: 'support', value: false }] } });
      else out.push({ key: 'support', ok: false, title: 'Pas de supports', sub: 'Attention : des parties dans le vide risquent de s’affaisser.', act: { label: added.support ? 'Remettre' : 'Ajouter', kind: 'apply', changes: [{ id: 'support', value: true }] } });
    }
    // Bordure : quand une pièce en a besoin (haute et fine, ou touche peu le plateau), ou quand la préparation l'a ajoutée.
    var bare = kinds(data, Object.assign({}, s, { brim_type: 'no_brim', brim_width: 0 }));
    var needs = bare.tall || bare.contact;
    if (hasBrim(s) && (needs || added.brim)) out.push({ key: 'brim', ok: true, title: added.brim ? 'J’ai ajouté une bordure' : 'Avec une bordure', sub: 'Un fin rebord autour de la pièce, pour qu’elle ne se décolle pas.', act: { label: 'Retirer', kind: 'apply', changes: [{ id: 'brim_type', value: 'no_brim' }] } });
    else if (!hasBrim(s) && needs) out.push({ key: 'brim', ok: false, title: 'Pas de bordure', sub: (bare.tall ? 'Haute et fine : elle risque de basculer.' : 'Elle touche peu le plateau : elle risque de se décoller.'), act: { label: added.brim ? 'Remettre' : 'Ajouter', kind: 'apply', changes: [{ id: 'brim_type', value: 'outer_only' }, { id: 'brim_width', value: 5 }] } });
    var f = opts.filament;
    if (f && (f.nozzle_temp != null || f.bed_temp != null))
      out.push({ key: 'temp', ok: true, title: 'Températures de ta bobine', sub: (f.nozzle_temp != null ? f.nozzle_temp + ' °C' : '?') + ' / ' + (f.bed_temp != null ? f.bed_temp + ' °C' : '?'), act: { label: 'Montre-moi', kind: 'show_setting', key: 'nozzle_temperature' } });
    return out;
  }
  // Corrections que la préparation fait d'elle-même (celles conseillées, sur des réglages : supports et bordure). Le reste
  // (réduire, ranger, remettre les réglages du mode vase) attend ton geste dans « Tout est prêt ».
  function autoFixes(data) {
    return PF.preflightPlan(data).fixes.filter(function (f) { return f.checked && (f.key === 'support' || f.key === 'brim'); });
  }

  // ---------- Résultat ----------
  // « Qu'est-ce qui ne va pas ? » : ce qui ressemble le plus, et la phrase envoyée à l'assistant.
  var SYMPTOMS = [
    { id: 'warp', label: 'Elle se décolle du plateau', sub: 'Les coins se soulèvent', said: 'elle se décolle du plateau, les coins se soulèvent' },
    { id: 'strings', label: 'Des fils comme des cheveux', sub: 'Entre les parties', said: 'il y a des fils comme des cheveux entre les parties' },
    { id: 'spaghetti', label: 'Un tas de spaghetti', sub: 'La pièce s’est détachée', said: 'la pièce s’est détachée et a fait un tas de spaghetti' },
    { id: 'layers', label: 'Des couches décalées ou fragiles', sub: '', said: 'les couches sont décalées ou fragiles' },
    { id: 'first', label: 'La première couche ne colle pas', sub: '', said: 'la première couche ne colle pas' }
  ];
  function symptomPrompt(id, part) {
    var s = SYMPTOMS.filter(function (x) { return x.id === id; })[0];
    if (!s) return '';
    return 'Mon impression' + (part ? ' de « ' + part + ' »' : '') + ' est ratée : ' + s.said + '. Qu’est-ce qui cloche, et que changer pour la prochaine fois ?';
  }

  // Calibration guidée par photo : ce que montre chaque test (classique et v2).
  var CALIB = {
    temperature: { name: 'Tour de température', shows: 'la température où ton filament fait le moins de fils et soude bien ses couches', duration: '≈ 45 min', parts: 'Ta tour, étage par étage', pick: 'Choisis l’étage le plus propre', tower: true },
    flow: { name: 'Test de débit', shows: 'la quantité de plastique juste : ni trous, ni bourrelets sur le dessus', duration: '≈ 20 min par passe', parts: 'Les carrés du test', pick: 'Choisis le carré le plus lisse' },
    retraction: { name: 'Tour de rétraction', shows: 'la rétraction la plus courte qui supprime les fils', duration: '≈ 40 min', parts: 'Ta tour, bande par bande', pick: 'Choisis la bande la plus propre', tower: true },
    pressure_advance: { name: 'Test des angles (pressure advance)', shows: 'le réglage qui rend les angles nets, sans bourrelet', duration: '≈ 10 min', parts: 'Les lignes du motif', pick: 'Choisis la ligne aux angles les plus nets' },
    ironing: { name: 'Plaque de lissage', shows: 'le débit et l’espacement qui donnent le dessus le plus lisse', duration: '≈ 15 min', parts: 'Les carrés de la plaque', pick: 'Choisis le carré le plus lisse' }
  };

  // Écran de l'étape 3 de la v2 d'après le projet. `ui` : { sending, exported, failed (« Raté » dit ou « Ça a l'air de mal se
  // passer »), result (« Elle a fini »), later, intent (intentState) }.
  function screen(p, ui) {
    var u = ui || {}, step = J.currentStep(p);
    if (step === 'preparer') return u.intent ? 'usage' : 'preparing';
    if (step === 'imprimer') return u.sending ? 'sending' : u.exported ? 'saved' : 'ready';
    if (p.success) return 'success';
    var s = sendOf(p);
    if (u.failed || (s && s.failed)) return 'failed';
    if (u.later) return 'later';
    if (endQuestionNow(p)) return 'end';
    if (watching(p) && !u.result) return 'printing';
    return 'result';
  }

  var api = { durationText: durationText, shortDuration: shortDuration, printSummary: printSummary, stats: stats, sendOf: sendOf, sendRecord: sendRecord, newSend: newSend,
    noteWatched: noteWatched, endOutcome: endOutcome, endQuestionNow: endQuestionNow, spoolAsk: spoolAsk, watching: watching, intentAnswers: intentAnswers,
    intentState: intentState, intentPending: intentPending, useCards: useCards, intentLabels: intentLabels, readyChecks: readyChecks, autoFixes: autoFixes,
    SYMPTOMS: SYMPTOMS, symptomPrompt: symptomPrompt, CALIB: CALIB, screen: screen };
  root.PlyoImprimer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
