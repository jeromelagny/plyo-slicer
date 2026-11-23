// Assistant v2, étape 3 « Imprimer » (lot 4) : une question d'usage (réponse suggérée), la préparation automatique (« Je prépare
// ton impression… » : réglages de l'usage, découpe, vérification avant impression), l'écran « Tout est prêt » (durée, poids, coût
// si le préréglage filament a un prix ; vérifications avec Retirer / Remettre et « Montre-moi » ; « Ajuster »), l'envoi ou
// l'enregistrement pour la clé USB, le suivi du démarrage et de la fin (Creality, Klipper), « Ça a l'air de mal se passer », la
// boucle Résultat (Réussi / Raté / Je montre), le diagnostic et « Appliquer et réimprimer », la calibration proposée.
// Aussi, pour toute la discussion : la fiche de réglages proposée par l'IA (à appliquer, avec « Annuler »), les actions de l'IA
// (show, show_setting, slice, remember_success, open_calibration), le journal des pièces, « Ça a marché ? » des corrections,
// la proposition de retenir un préréglage choisi dans Orca et la carte « Plyo Slicer est passé sur … ».
// Mêmes messages au slicer que le panneau classique (plate_action, preflight, orca_issues, apply, undo, manual_edits_get,
// canvas_read, canvas_send, print_start, print_watch_start, print_watch_replay, print_declared, outcome_*, spool_success,
// spool_failure, journal_add, calib_*, show_preview, show_setting, show_me, open_calibration, spool_adopt*, project_restore) ;
// logique partagée : imprimer-logic.js, intent-logic.js, preflight.js, journey-logic.js, assistant-logic.js, canvas-logic.js.
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var ui = V2.ui, D = V2.discussion;
  var J = root.PlyoJourney, P = root.PlyoProject, M = root.PlyoMachines, I = root.PlyoIntent, X = root.PlyoImprimer, PF = root.PlyoPreflight,
    C = root.PlyoCanvas, Sp = root.PlyoSpools, R = root.PlyoRetouches, Logic = root.PlyoLogic;

  var SLICE_WAIT_MS = 120000, SEND_WAIT_MS = 8000, ARMED_WAIT_MS = 30000, UPLOAD_WAIT_MS = 600000, SIGNALS_MS = 2000;
  var BATCH_TAG = 'v2' + Date.now().toString(36); // lots posés par l'assistant pour ce projet (jamais présentés comme tes modifications)
  var panel = null;
  var habits = M.emptyHabits(), level = '', signals = null, reachable = {};
  var request = 3000000, waiters = {}, undone = {};
  var watchSeq = 0;
  var adoptAsked = {};

  // ---------- État de l'étape, pour la conversation affichée ----------
  function fresh(id) {
    return { conv: id, idk: false, changing: false, manual: null, applying: false, expert: null, adjust: false, intentLine: null,
      slicing: false, sliceTimer: null, sliceSince: 0, sliceAsked: false, sliceTried: '', issues: [], blockSig: '', sliceSig: null, checkAsked: null,
      preflight: null, added: {}, autoFixed: false, fixing: '', sending: null, lock: null, exported: null, failure: null,
      screen: '', symptom: '', asked: false, watchLine: null, readId: 0, refused: '', successNote: '', calibOpen: false, diverge: null, recheckTimer: null };
  }
  var S = fresh(null);
  function conv() { return panel ? panel.conv() : null; }
  function state() {
    var c = conv();
    if (c && S.conv !== c.id) {
      clearTimeout(S.sliceTimer);
      S = fresh(c.id);
      if (!c.seenProject) c.seenProject = JSON.parse(JSON.stringify(c.project));
      // Conversation rouverte : la fin d'un envoi suivi, arrivée pendant l'absence, est redemandée au slicer (comme le classique).
      var s = X.sendOf(c.project);
      if (s && s.watch && !s.end && !s.answered) panel.post({ type: 'print_watch_replay', id: s.watch });
    }
    return S;
  }
  function project() { var c = conv(); return c ? c.project : P.emptyProject(); }
  function step() { return J.currentStep(project()); }
  function inStep3() { return J.barKey(step()) === 'imprimer' && P.nextStep(project()) === 'ready'; }
  function values() { return panel ? panel.values() : null; }
  function render() { if (panel) panel.render(); }
  function save() { if (panel) panel.scheduleSave(); }
  function shortName() { var p = project(); return p.printer ? J.shortMachine(p.printer) || p.printer.name || p.printer.preset : 'ton imprimante'; }
  function partName() { var p = project(); return p.part && p.part.name ? p.part.name : ''; }
  function expert() { return level === 'expert'; }
  function sliced() { var p = project(); return !!(signals && signals.sliced) && !(p.intent && p.intent.reask); }
  function thread(text) { var c = conv(); if (c && root.PlyoThread && root.PlyoThread.add(c.project, 'etapes', text)) save(); }
  // Une phrase dans la discussion, gardée avec la conversation.
  // Un lot refusé par le slicer : son texte, avec le bouton qui débloque (choisir la machine ou la bobine, remettre le projet).
  function refused(text, result, retry) { return note(text || 'Je n’ai pas pu appliquer ces réglages.', 'error', panel.refusalActions(result, retry)); }
  function note(text, tone, acts) {
    if (!text || !panel) return null;
    panel.record({ kind: 'note', text: text, tone: tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'ok' });
    return panel.say(text, tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'info', acts);
  }
  function saveHabits() { panel.post({ type: 'habits_set', habits: habits }); }

  // Machine ou bobine changée, étape changée (comme projectChanged du classique) : une découpe faite est périmée.
  function changed() {
    var c = conv();
    if (!c) return;
    c.project = J.resetStepOnChange(c.seenProject || null, c.project);
    c.seenProject = JSON.parse(JSON.stringify(c.project));
    save();
    render();
  }
  function setStep(s) { var p = project(); p.step = s || 'done'; changed(); }

  // ---------- Demandes au slicer qui répondent par « result », « plate_action », « show_preview », « open_calibration » ----------
  function ask(message, after) {
    var id = ++request;
    waiters[id] = after || null;
    message.request = id;
    panel.post(message);
    return id;
  }
  function onResult(msg) {
    var c = conv();
    // Réglages posés par l'assistant pour ce projet : retenus, et oubliés à l'annulation (jamais comptés comme les tiens).
    if (c && msg.ok && c.project.assistant && typeof c.project.assistant === 'object') {
      if (msg.undo_id && Array.isArray(msg.written)) { c.project.assistant = Logic.noteWritten(c.project.assistant, msg.written, BATCH_TAG + ':' + msg.undo_id); save(); }
      if (msg.undone_id) { c.project.assistant = Logic.forgetBatch(c.project.assistant, BATCH_TAG + ':' + msg.undone_id); save(); }
    }
    if (msg.undone_id && undone[msg.undone_id]) { var u = undone[msg.undone_id]; delete undone[msg.undone_id]; u(msg); }
    watchAfterApply(msg);
    var w = waiters[msg.request];
    if (!(msg.request in waiters)) return;
    delete waiters[msg.request];
    if (w) w(!!msg.ok, msg.text, msg);
  }
  function apply(changes, why, after, extra) {
    var names = Logic.namesForApply(extra && extra.data || null, values() && values().context);
    var m = Object.assign({ type: 'apply', changes: changes, print_name: names.process, filament_name: names.filament, printer_name: names.printer, why: why }, extra && extra.msg || {});
    ask(m, after);
  }
  function plateAction(kind, after, extra) {
    if (kind === 'slice') startSlicing();
    ask(Object.assign({ type: 'plate_action', kind: kind }, extra || {}), after);
  }
  function onPlateAction(msg) {
    if (!(msg.request in waiters)) return;
    var w = waiters[msg.request];
    delete waiters[msg.request];
    var st = state();
    if (msg.kind === 'slice') {
      // Orca occupé sur le plateau (orienter, ranger) : la découpe est redemandée d'elle-même, comme les gestes de l'étape 1.
      if (!msg.ok && msg.reason === 'busy' && (st.sliceBusy || 0) < 20) {
        st.sliceBusy = (st.sliceBusy || 0) + 1;
        setTimeout(function () { if (state() === st && st.slicing) ask({ type: 'plate_action', kind: 'slice' }, w); }, 500);
        return;
      }
      st.sliceBusy = 0;
      if (!msg.ok) stopSlicing();
      // Refus sans explication d'Orca (plateau vide, occupé trop longtemps) : dit dans la carte, avec « Découper à nouveau ».
      if (!msg.ok && msg.reason !== 'orca_refused' && msg.reason !== 'too_big') { st.sliceTried = 'failed'; st.sliceError = msg.text || ''; render(); if (w) w(false, msg); return; }
      if (msg.ok) st.sliceError = '';
      if (msg.reason === 'orca_refused') { sliceFailed(msg.issues, 'refused'); if (w) w(false, msg); return; }
      if (msg.reason === 'too_big') { st.issues = [{ tone: 'error', title: 'Ta pièce ne tient pas sur le plateau', text: msg.text || '', actions: [{ kind: 'plate', action: 'scale_to_fit', label: 'Réduire pour que ça tienne' }] }]; render(); if (w) w(false, msg); return; }
    }
    if (!msg.ok && msg.text && msg.kind !== 'slice') note(msg.text, 'error');
    if (w) w(!!msg.ok, msg);
    if (inStep3()) render();
  }

  // ---------- Découpe et vérification ----------
  function stopSlicing() { var st = state(); clearTimeout(st.sliceTimer); st.slicing = false; st.sliceTimer = null; }
  function startSlicing() {
    var st = state();
    stopSlicing();
    st.issues = [];
    st.slicing = true;
    st.sliceSince = Date.now();
    // La vérification d'avant ne vaut plus : elle est redemandée une fois la plaque découpée (même si Orca n'a rien à refaire).
    st.preflight = null;
    st.sliceSig = null;
    st.checkAsked = null;
    if (signals) signals.sliced = false;
    st.sliceAsked = false;
    st.sliceTimer = setTimeout(function () { if (!st.slicing) return; stopSlicing(); st.issues = [viewOf(PF.SLICE_SLOW, 'warn', 'La découpe ne répond pas')]; render(); }, SLICE_WAIT_MS);
  }
  function slice() { plateAction('slice'); render(); }
  function viewOf(v, tone, title) { return { tone: tone, title: title || '', text: v.text, actions: v.actions || [] }; }
  // La découpe n'a pas eu lieu (erreur ou refus d'Orca) : sa raison expliquée (preflight.js), avec la correction quand elle est sûre.
  function sliceFailed(issues, origin) {
    var st = state();
    stopSlicing();
    var list = PF.orcaCards(issues, {});
    if (!list.length) list = [{ source: origin === 'refused' ? 'validate_error' : 'slicing_error', code: 'unknown', level: 'error', text: '' }];
    st.issues = list.map(function (i) { return PF.orcaIssueView(i, { canUndo: !!(values() && values().can_undo), novice: !expert() }); });
    st.sliceTried = 'failed';
    var v = st.issues[0];
    panel.record({ kind: 'note', text: v.title + ' : ' + v.text, tone: 'error' });
    render();
  }
  function onSliceResult(msg) {
    var st = state();
    if (!conv()) return;
    if (msg.status === 'error') { sliceFailed(msg.issues, 'slice'); return; }
    if (msg.status === 'cancelled') { if (!st.slicing) return; stopSlicing(); st.issues = [viewOf(PF.SLICE_STOPPED, 'warn', 'Découpe arrêtée')]; render(); return; }
    stopSlicing();
    st.sliceTried = '';
    panel.post({ type: 'tour_signals' });
    // Plaque découpée mais refusée pour l'impression : ses erreurs ; sinon ses avertissements, expliqués.
    remember(msg.issues);
    var list = PF.orcaCards(Array.isArray(msg.issues) ? msg.issues : [], { warnings: msg.ready_for_print !== false });
    st.issues = list.map(function (i) { return PF.orcaIssueView(i, { canUndo: !!(values() && values().can_undo), novice: !expert() }); });
    if (msg.ready_for_print === false) st.blockSig = 'shown';
    render();
  }
  function onOrcaIssues(msg) {
    var st = state(), issues = Array.isArray(msg.issues) ? msg.issues : [];
    if (msg.purpose === 'stalled') {
      if (!st.slicing || msg.busy) return;
      if (PF.orcaCards(issues, {}).length) { sliceFailed(issues, 'refused'); return; }
      if (msg.pending) { st.sliceAsked = false; st.sliceSince = Date.now(); return; }
      stopSlicing();
      st.issues = [viewOf(PF.SLICE_NOT_STARTED, 'warn', 'La découpe n’a pas démarré')];
      st.sliceTried = 'failed';
      render();
    } else if (msg.purpose === 'blocked') {
      remember(issues);
      st.issues = PF.orcaCards(issues, {}).map(function (i) { return PF.orcaIssueView(i, { canUndo: !!(values() && values().can_undo), novice: !expert() }); });
      render();
    } else onOrcaNoticeIssues(msg, issues);
  }
  function onSignals(msg) {
    var before = signals;
    signals = msg;
    var c = conv();
    if (!c) return;
    var st = state();
    watchNotices(msg.notices);
    if (msg.sliced && st.slicing) stopSlicing();
    if (msg.sliced && st.sliceTried === 'auto') st.sliceTried = ''; // découpée : un prochain changement redécoupera de lui-même
    // Découpe demandée qui n'a pas démarré (Orca la refuse sans un mot) : on demande pourquoi, une fois.
    if (st.slicing && !msg.sliced && msg.slicing === false && !st.sliceAsked && Date.now() - st.sliceSince > 2500) { st.sliceAsked = true; panel.post({ type: 'orca_issues', purpose: 'stalled' }); }
    if (!msg.sliced) st.blockSig = '';
    else if (msg.ready_for_print === false && !st.blockSig) { st.blockSig = 'asked'; panel.post({ type: 'orca_issues', purpose: 'blocked' }); }
    // Nouvelle découpe : la vérification avant impression (preflight) est demandée, comme dans le classique.
    var r = Logic.newSlice(st.sliceSig, msg);
    st.sliceSig = r.sig;
    if (!msg.sliced) st.preflight = null;
    var unchecked = msg.sliced && !st.preflight && st.checkAsked !== r.sig && P.nextStep(c.project) === 'ready';
    if (r.fire || unchecked) { st.checkAsked = r.sig; panel.post({ type: 'preflight' }); }
    var sig = function (s) { return s ? JSON.stringify([s.sliced, s.linked, s.time_s, s.weight_g, s.cost, s.objects, s.ready_for_print]) : ''; };
    if (inStep3() && sig(before) !== sig(msg)) { drive(); render(); }
  }
  function onPreflight(data) {
    var st = state(), c = conv();
    if (!c) return;
    st.preflight = data && data.sliced ? data : null;
    if (st.preflight) thread('Découpe vérifiée : ' + (PF.preflightRisks(data).length ? 'des points signalés' : 'aucun risque') + '. ' + X.printSummary(signals));
    // La préparation corrige d'elle-même ce qui est conseillé (supports, bordure), une fois : « Retirer » reste dans la liste.
    var fixes = st.preflight && step() === 'preparer' && !st.autoFixed ? X.autoFixes(data) : [];
    if (fixes.length) {
      st.autoFixed = true;
      st.fixing = 'auto';
      var batch = PF.fixBatch(fixes);
      var after = function (ok, text) {
        st.fixing = '';
        if (!ok) { note(text || 'Je n’ai pas pu corriger ta plaque.', 'error'); advance(); return; }
        fixes.forEach(function (f) { st.added[f.key] = true; });
        slice();
      };
      // Même lot que « Tout corriger » du classique (une étape à annuler) ; les profils seulement pour les réglages du catalogue.
      if (batch.catalog) apply(batch.changes, 'Vérification avant impression', after);
      else ask({ type: 'apply', changes: batch.changes, why: 'Vérification avant impression' }, after);
      render();
      return;
    }
    advance();
  }
  // Préparée et vérifiée : on passe à « Tout est prêt » (jamais quand Orca juge la plaque non imprimable).
  function advance() {
    var st = state();
    if (step() === 'preparer' && st.preflight && sliced() && !(signals && signals.ready_for_print === false) && !st.fixing) { setStep('print'); return; }
    render();
  }
  // La préparation se fait d'elle-même : réglages de l'usage, puis découpe (une fois par état de la plaque).
  function drive() {
    var c = conv();
    if (!c || !inStep3() || !panel) return;
    var st = state(), p = c.project, s = step();
    // Plyo Slicer sur une autre machine ou un autre filament : le slicer refuserait les réglages, et une découpe serait faite
    // pour une autre machine. La carte « … est passé sur » attend ton choix.
    if (diverged()) return;
    if (s === 'preparer') {
      var it = intentNow();
      if (it && it.mode === 'ready' && (!expert() || (p.intent && p.intent.reapply)) && !st.applying && !st.intentError) { applyIntent(); return; }
      if (it) return;
      if (sliced()) { if (st.preflight) advance(); return; }
    }
    // Une seule découpe d'elle-même par état de la plaque : après un échec, « Découper à nouveau » attend ton geste.
    if ((s === 'preparer' || s === 'imprimer') && !sliced() && !st.slicing && !st.fixing && !st.applying && st.sliceTried === '' && signals && signals.objects > 0) {
      st.sliceTried = 'auto';
      slice();
    }
  }

  // ---------- Questions d'intention ----------
  function intentNow() {
    var p = project(), st = state();
    var it = X.intentState(p, { step: step(), sliced: sliced(), habits: habits, level: level, changing: st.changing, idk: st.idk, manual: st.manual,
      applying: st.applying, nozzleMm: values() && values().context ? values().context.nozzle_mm : 0 });
    if (it && it.needsManual && st.manual === null) readManual(render);
    return it;
  }
  function readManual(then) {
    var st = state();
    st.manual = st.manual || [];
    var c = conv();
    manualWaiters.push(function (items) { st.manual = Logic.splitManualEdits(items, c && c.project.assistant).mine.map(function (m) { return m.key; }); then(); });
    panel.post({ type: 'manual_edits_get' });
  }
  var manualWaiters = [];
  function answerIntent(qid, id) {
    var p = project(), st = state();
    p.intent = p.intent || {};
    p.intent[qid] = id;
    st.idk = false;
    // Débutant : la réponse suffit ; préférence et vitesse prennent leur valeur sûre (« Ajuster » les repose ensuite).
    if (!expert() && !p.intent.adjust) Object.assign(p.intent, I.noviceAnswers(X.intentAnswers(p)));
    changed();
    if (!I.nextQuestion(X.intentAnswers(p)) && !expert()) applyIntent();
  }
  function applyIntent() {
    var st = state();
    if (st.applying) return;
    st.intentError = null;
    st.applying = true;
    render();
    readManual(function () {
      var p = project(), it = intentNow();
      if (!it || (it.mode !== 'ready' && it.mode !== 'auto')) { st.applying = false; render(); return; }
      var done = function (result) {
        st.applying = false;
        st.manual = null;
        p.intent.applied = true;
        ['reapply', 'reask', 'adjust'].forEach(function (k) { delete p.intent[k]; });
        p.intent.for = presetKey(p);
        habits = M.noteIntent(habits, false);
        var last = I.validLast(X.intentAnswers(p));
        if (last) habits.last_intent = last;
        saveHabits();
        thread('Choix pour la pièce appliqués : ' + it.summary.sentence.replace(/ :$/, '') + ' ' + it.summary.bullets.join(', ') + '.');
        if (st.intentLine) st.intentLine.remove();
        st.intentLine = null;
        if (result && result.undo_id) {
          var mine = conv();
          st.intentLine = panel.say(I.doneText(X.intentAnswers(p)), 'info', [{ label: 'Annuler', run: function () { undoIntent(result.undo_id, mine); } }]);
        }
        changed();
        slice();
      };
      if (!it.changes.length) { done(null); return; }
      apply(Logic.confirmedChanges(it.changes.map(function (c) { return { key: c.key, value: c.value, label: c.label }; })), 'Intention : ' + it.summary.sentence.replace(/ :$/, ''),
        function (ok, text, result) {
          if (!ok) {
            // Refusé (Orca occupé, fiche incomplète…) : on s'arrête là, sans redemander en boucle ; la carte le dit avec « Réessayer ».
            st.applying = false;
            st.intentError = { text: text || 'Je n’ai pas pu régler Plyo Slicer pour ta pièce.', result: result || {} };
            panel.record({ kind: 'note', text: st.intentError.text, tone: 'error' });
            render();
            return;
          }
          done(result);
        });
    });
  }
  // Le plateau a été vidé dans Plyo Slicer : rien à découper ; la pièce revient par « Annuler » du slicer, ou à l'étape 1.
  function goneBox() {
    return noteBox('warn', 'alert', 'Ta pièce n’est plus sur le plateau. « Annuler » de Plyo Slicer (Cmd/Ctrl + Z) la remet ; sinon, reviens à l’étape 1 pour la reposer.',
      [ui.button('Revenir à l’étape 1', function () { if (panel.openStep) panel.openStep('piece'); }, 'btn sm main')]);
  }
  function intentErrorBox() {
    var st = state(), e = st.intentError;
    var acts = [ui.button('Réessayer', function () { st.intentError = null; applyIntent(); }, 'btn sm main')];
    panel.refusalActions(e.result, function () { st.intentError = null; applyIntent(); }).forEach(function (a) {
      acts.unshift(ui.button(a.label, a.run, 'btn sm main'));
    });
    if (acts.length > 1) acts[1].className = 'btn sm';
    return noteBox('error', 'alert', e.text, acts);
  }
  function presetKey(p) { return [p.printer && p.printer.preset, p.filament && p.filament.preset].join('|'); }
  // « Annuler » du lot de l'usage : réglages d'avant remis, retour à la question.
  function undoIntent(undoId, mine) {
    undone[undoId] = function () {
      var st = state();
      if (st.intentLine) { st.intentLine.remove(); st.intentLine = null; }
      if (conv() !== mine || !mine.project.intent) return;
      mine.project.intent.applied = false;
      delete mine.project.success;
      if (signals) signals.sliced = false;
      setStep('slice');
      note('Réglages d’avant remis.', 'info');
    };
    ask({ type: 'undo', undo_id: undoId }, function (ok, text) { if (!ok) note(text, 'error'); });
  }
  // Machine ou bobine changée après l'usage appliqué : les mêmes réponses sont réappliquées (comme le classique).
  function followIntent() {
    var p = project(), i = p.intent;
    if (i && i.applied && i.for && i.for !== presetKey(p)) { i.applied = false; i.reapply = true; save(); }
  }
  // « Ajuster » de « Tout est prêt » : un autre usage, une autre priorité ou vitesse ; les réglages sont réappliqués et la plaque
  // redécoupée.
  function adjustIntent(patch) {
    var p = project(), st = state(), a = Object.assign(X.intentAnswers(p), patch);
    if (patch.use) { a = { use: patch.use }; Object.assign(a, I.noviceAnswers(a)); }
    // La plaque déjà découpée ne vaut plus pour ces réponses (comme « Ajuster » du classique : `reask`).
    p.intent = Object.assign({}, a, { reapply: true, reask: true });
    st.preflight = null;
    if (signals) signals.sliced = false;
    st.added = {};
    st.autoFixed = false;
    st.sliceTried = '';
    setStep('slice');
  }

  // ---------- Envoi ----------
  function lockSend(kind) {
    var st = state();
    if (st.lock) return false;
    st.lock = { kind: kind, timer: setTimeout(unlockSend, SEND_WAIT_MS) };
    st.failure = null;
    st.refused = '';
    return true;
  }
  function waitLonger(ms) { var st = state(); if (st.lock) { clearTimeout(st.lock.timer); st.lock.timer = setTimeout(unlockSend, ms); } }
  function unlockSend() { var st = state(); if (st.lock) clearTimeout(st.lock.timer); st.lock = null; st.sending = null; if (inStep3()) render(); }
  function newWatchId() { watchSeq += 1; return 'v' + watchSeq + '-' + Date.now(); }
  function rememberHabit() {
    var p = project();
    if (!p.printer || !p.printer.preset || !p.filament || p.filament.proposed) return;
    habits = M.rememberFilament(habits, p.printer.preset, p.filament);
    saveHabits();
  }
  function sendPrint() {
    var p = project(), st = state();
    if (!lockSend('print')) return;
    st.sending = { text: PF.SEND_TEXTS.sending(shortName()), percent: null };
    render();
    if (C.needsReread(p.canvas)) {
      // Relecture des emplacements avant l'envoi : rien ne part si l'un a changé de matière ou a disparu.
      waitLonger(ARMED_WAIT_MS);
      st.readId += 1;
      st.sending.text = 'Je relis les ' + C.words(knownSlots()).slots + ' ' + C.words(knownSlots()).of + ' avant d’envoyer…';
      panel.post({ type: 'canvas_read', preset: p.printer.preset, send: true, id: st.readId });
      return;
    }
    startPrint();
  }
  function knownSlots() { var list = V2.materiel && V2.materiel.printers ? V2.materiel.printers() : null, p = project(); var k = root.PlyoMateriel.knownPrinter(list, p.printer && p.printer.preset); return k && k.slots || ''; }
  function startPrint() {
    var p = project(), st = state();
    rememberHabit();
    waitLonger(UPLOAD_WAIT_MS);
    st.watchId = newWatchId();
    panel.post({ type: 'print_start', export: false, preset: p.printer ? p.printer.preset : '', watch_id: st.watchId });
  }
  function onCanvasState(msg) {
    var st = state(), p = project();
    if (!msg.send || msg.id !== st.readId || !st.lock) return;
    if (!p.printer || msg.preset !== p.printer.preset) { unlockSend(); return; }
    var chosen = p.canvas || [];
    if (!msg.ok && C.isImposed(chosen)) { unlockSend(); st.refused = 'Je n’arrive pas à relire ' + C.words(msg.system || knownSlots()).your + ' : rien n’est envoyé. Vérifie que ton imprimante est allumée, puis réessaie.'; render(); return; }
    var route = msg.ok ? C.sendRoute(chosen, msg) : 'orca';
    if (msg.ok) {
      var check = C.checkBeforeSend(chosen, C.trays(msg), { system: msg.system, empty_blocks: !!msg.empty_blocks });
      var cols = Array.isArray(msg.colours) ? msg.colours : [];
      if (cols.length && (cols.length !== chosen.length || cols.some(function (c) { return !chosen.some(function (e) { return e.t === c.t; }); }))) check.block.push('La pièce n’a plus les mêmes couleurs qu’au choix des emplacements.');
      if (route === 'refuse') check.block.push('Je ne peux plus imposer ces emplacements sur cette machine' + (msg.blocker ? ' (' + msg.blocker + ')' : '') + '.');
      if (check.block.length) { unlockSend(); st.refused = check.block.join(' ') + ' Choisis à nouveau les emplacements : rien n’est envoyé.'; render(); return; }
      check.notes.forEach(function (t) { note(t, 'info'); });
    }
    if (route === 'armed') { waitLonger(ARMED_WAIT_MS); panel.post({ type: 'canvas_send', preset: p.printer.preset }); }
    else startPrint();
  }
  function onCanvasSent(msg) {
    var st = state(), p = project();
    if (!msg.ok) { unlockSend(); st.refused = msg.text || 'Je n’ai pas pu envoyer avec ces emplacements : rien n’est parti.'; render(); return; }
    X.newSend(p);
    st.watchId = newWatchId();
    X.noteWatched(p, st.watchId);
    save();
    panel.post({ type: 'print_watch_start', preset: p.printer.preset, id: st.watchId });
    st.sending = { text: msg.text || 'J’envoie le fichier : la répartition part avec. Regarde l’écran de ton imprimante.', percent: null, armed: true };
    render();
  }
  function exportFile() {
    if (!lockSend('export')) return;
    waitLonger(UPLOAD_WAIT_MS);
    panel.post({ type: 'print_start', export: true });
  }
  // Réponse à l'envoi, une fois Orca décidé : fenêtre fermée, refus, fenêtre du module Bambu Lab (« device »), ou envoi pris.
  function onPrintStarted(msg) {
    var st = state(), p = project(), T = PF.SEND_TEXTS;
    if (msg.export) { onExportDone(msg); return; }
    if (!msg.ok) {
      unlockSend();
      if (msg.cancelled) { note(T.closed, 'info'); return; }
      if (msg.reason === 'refused') { st.failure = PF.uploadFailureView(msg.failure, shortName()); render(); return; }
      if (msg.reason === 'not_sliced') { st.sliceTried = ''; drive(); return; }
      if (msg.reason === 'not_ready') {
        var list = PF.orcaCards(msg.issues, {});
        st.issues = list.length ? list.map(function (i) { return PF.orcaIssueView(i, { novice: !expert() }); }) : [viewOf({ text: T.notReady, actions: [{ kind: 'slice', label: 'Découper à nouveau' }] }, 'error', 'Pas encore imprimable')];
        render();
        return;
      }
      if (msg.reason === 'not_started') { st.issues = [viewOf({ text: T.notStarted, actions: [{ kind: 'slice', label: 'Découper à nouveau' }] }, 'error', 'L’envoi n’est pas parti')]; render(); return; }
      note(msg.text || 'Plyo Slicer ne peut pas encore imprimer cette plaque : vérifie qu’elle est découpée et que l’imprimante est reliée.', 'error');
      return;
    }
    thread('Envoyée à l’imprimante.');
    X.newSend(p);
    X.noteWatched(p, st.watchId || '');
    save();
    if (msg.route === 'device') {
      var s = X.sendOf(p);
      s.route = 'device';
      save();
      st.sending = { text: T.device, percent: null, device: true };
      render();
      return;
    }
    st.sending = { text: T.sending(shortName()), percent: 0 };
    render();
  }
  function onSendWaiting() { var st = state(); if (st.sending) { st.sending.text = C.orcaConfirm(project().canvas) || PF.SEND_TEXTS.waiting; render(); } }
  function onPrintUpload(msg) {
    var st = state(), T = PF.SEND_TEXTS, name = shortName();
    if (!st.sending) return;
    if (msg.phase === 'progress') { st.sending.text = T.progress(name, msg.percent); st.sending.percent = msg.percent; render(); return; }
    unlockSend();
    if (msg.phase === 'arrived') { note(T.arrived(name), 'ok'); started(); }
    else if (msg.phase === 'cancelled') { stopWatch(); note(T.cancelled(name), 'warn'); }
    else if (msg.phase === 'failed') { stopWatch(); st.failure = PF.uploadFailureView(msg.failure, name); render(); }
  }
  function stopWatch() { var s = X.sendOf(project()); if (s && s.watch) { s.watch = ''; save(); } }
  function onExportDone(msg) {
    var st = state();
    unlockSend();
    if (msg.cancelled) return;
    if (!msg.ok && msg.reason === 'error') { var ev = PF.exportErrorView(msg); st.issues = [viewOf(ev, 'error', 'L’enregistrement n’a pas abouti')]; render(); return; }
    if (!msg.ok) { note(msg.reason === 'not_sliced' ? 'La plaque n’est plus découpée : je la redécoupe, puis réessaie.' : msg.text || 'L’export n’a pas abouti : aucun fichier n’a été écrit.', 'error'); st.sliceTried = ''; drive(); return; }
    thread('Fichier exporté pour l’imprimante.');
    rememberHabit();
    journalPart('');
    X.newSend(project());
    save();
    st.exported = { text: Logic.exportedText(msg, C.exportNote(project().canvas)), file: msg.file || msg.name || '' };
    render();
  }
  // L'impression a démarré (fichier arrivé, ou dit par toi) : l'étape Résultat commence.
  function started() {
    var p = project(), st = state();
    st.exported = null;
    st.screen = '';
    rememberHabit();
    journalPart('');
    thread('Impression lancée.');
    delete p.success;
    var s = X.sendOf(p);
    if (s && s.route === 'device' && !s.declared) { s.declared = true; panel.post({ type: 'print_declared' }); }
    setStep('after');
    panel.post({ type: 'outcome_printed', conv: conv().id });
  }

  // ---------- Suivi et fin ----------
  function onPrintWatch(msg) {
    var p = project(), s = X.sendOf(p), st = state();
    if (!s || !s.watch || msg.id !== s.watch) return;
    if (msg.phase === 'end') {
      if (s.end) return;
      s.end = { verdict: msg.verdict, file: msg.file || '' };
      save();
      render();
      return;
    }
    st.watchLine = J.watchText(msg.verdict, shortName(), msg.file);
    if (st.watchLine && msg.verdict !== 'started') panel.record({ kind: 'note', text: st.watchLine.text, tone: st.watchLine.tone === 'warn' ? 'warn' : 'ok' });
    render();
  }
  function markAnswered() { var s = X.sendOf(project()); if (s) { s.answered = true; save(); } }
  function journalPart(outcome) {
    var c = conv(), name = partName(), ctx = (values() && values().context) || {};
    if (!c || !name) return;
    panel.post({ type: 'journal_add', conv: c.id, parts: [name], printer: ctx.printer || '', filament: ctx.filament || '', problem: '', defect: '', thumb: '', outcome: outcome });
  }
  // La réponse du Résultat marque aussi la mémoire des corrections de cette impression (une seule question par impression).
  function markCorrections(outcome) {
    var c = conv(), s = X.sendRecord(c.project);
    if (s.corrections_outcome === outcome) return;
    var ats = s.corrections_outcome && Array.isArray(s.corrections) ? s.corrections : [];
    s.corrections_outcome = outcome;
    save();
    panel.post({ type: 'outcome_result', conv: c.id, outcome: outcome, ats: ats });
  }
  function success() {
    var p = project(), st = state(), s = X.sendRecord(p);
    p.success = true;
    st.screen = '';
    journalPart('ok');
    if (!s.marked && s.spool) { s.marked = true; panel.post({ type: 'spool_success', spool: s.spool.id, change_of_mind: !!s.failed }); st.successNote = 'Je retiens ces réglages pour ' + s.spool.name + ' sur ' + shortName() + '…'; }
    else if (!s.spool) st.successNote = '';
    markCorrections('ok');
    markAnswered();
    thread('Résultat : impression réussie.');
    changed();
  }
  function failed() {
    var p = project(), st = state(), s = X.sendRecord(p);
    thread('Résultat : impression ratée.');
    if (!s.failed) { s.failed = true; delete s.marked; save(); if (s.spool) panel.post({ type: 'spool_failure', spool: s.spool.id }); }
    markCorrections('bad');
    markAnswered();
    st.screen = 'failed';
    render();
  }
  function answerEnd(id) {
    var p = project(), s = X.sendOf(p);
    if (!s || !s.end || s.answered) return;
    var a = J.endAction(s.end.verdict, id, s.end.file);
    s.outcome = s.end.verdict;
    markAnswered();
    if (a.mark === 'success') success();
    else if (a.mark === 'failure') failed();
    else render();
    if (a.chat) panel.prefill(a.prefill);
  }
  function reprint() {
    var p = project(), st = state();
    delete p.success;
    st.screen = '';
    st.asked = false;
    st.symptom = '';
    setStep(sliced() ? 'print' : 'slice');
  }
  // « Appliquer et réimprimer » : les réglages changent, la plaque est à redécouper (la préparation repart d'elle-même).
  function reprintAfterFix() {
    var p = project(), st = state();
    delete p.success;
    st.screen = '';
    st.asked = false;
    st.symptom = '';
    st.preflight = null;
    st.sliceTried = '';
    if (signals) signals.sliced = false;
    setStep('slice');
    drive();
  }

  // ---------- Vues ----------
  function section(text) { return ui.el('div', 'sec', text); }
  function noteBox(tone, iconName, text, acts) {
    var box = ui.el('div', 'note' + (tone ? ' ' + tone : ''));
    box.appendChild(ui.icon(iconName || 'info', 18));
    var body = ui.el('div', 'note-body');
    body.appendChild(ui.rich(text));
    if (acts && acts.length) { var row = ui.el('div', 'acts'); acts.forEach(function (a) { if (a) row.appendChild(a); }); body.appendChild(row); }
    box.appendChild(body);
    return box;
  }
  function card(o) {
    var b = ui.el('button', 'card' + (o.sel ? ' sel' : ''));
    b.type = 'button';
    if (o.icon) { var ic = ui.el('span', 'ic'); ic.appendChild(ui.icon(o.icon, 22)); b.appendChild(ic); }
    var mid = ui.el('span', 'mid');
    mid.appendChild(ui.el('strong', '', o.title));
    if (o.sub) mid.appendChild(ui.el('small', '', o.sub));
    b.appendChild(mid);
    var end = ui.el('span', 'end');
    if (o.badge) end.appendChild(o.badge);
    if (o.radio) { var ck = ui.el('span', 'check'); if (o.sel) ck.appendChild(ui.icon('check', 14)); end.appendChild(ck); }
    else if (o.chev) end.appendChild(ui.icon('right', 18));
    b.appendChild(end);
    if (o.on) b.addEventListener('click', o.on);
    return b;
  }
  function badge(text, cls) { return ui.el('span', 'badge' + (cls ? ' ' + cls : ''), text); }
  function spinLine(text) { var row = ui.el('div', 'scan'); row.appendChild(ui.el('span', 'spin')); row.appendChild(ui.el('span', 'grow', text)); return row; }
  function link(label, run, cls) { return ui.button(label, run, 'link' + (cls ? ' ' + cls : '')); }

  // Cartes d'Orca (erreur de découpe, plaque refusée, avertissement) : l'explication de preflight.js et ses gestes.
  function issueBox(v, i) {
    var st = state();
    var acts = [];
    (v.actions || []).forEach(function (a) {
      if (a.kind === 'dismiss') { acts.push(ui.button(a.label, function () { st.issues.splice(i, 1); render(); }, 'btn sm')); return; }
      if (a.kind === 'undo_last' || a.kind === 'preview' || a.kind === 'import') return;
      var label = a.kind === 'ask' && !panel.session() ? PF.ASK_LOGIN_LABEL : a.label;
      var b = ui.button(label, function () {
        if (a.kind === 'slice') { st.issues = []; st.sliceTried = ''; slice(); }
        else if (a.kind === 'show_setting') panel.post({ type: 'show_setting', key: a.key });
        else if (a.kind === 'show_me') panel.post({ type: 'show_me', target: a.target });
        else if (a.kind === 'ask') panel.send(a.prompt);
        else if (a.kind === 'export') { st.issues = []; exportFile(); }
        else if (a.kind === 'plate') plateAction(a.action, function (ok) { if (ok) { st.issues = []; st.sliceTried = ''; slice(); } });
        else if (a.kind === 'fix') { b.disabled = true; apply(Logic.confirmedChanges(a.changes), 'Correction demandée par Plyo Slicer', function (ok, text) { if (!ok) { note(text, 'error'); render(); return; } note('Corrigé : ' + a.label.charAt(0).toLowerCase() + a.label.slice(1) + '.', 'ok'); st.issues = []; st.sliceTried = ''; slice(); }); }
      }, 'btn sm');
      acts.push(b);
    });
    acts.push(link('Fermer', function () { st.issues.splice(i, 1); render(); }));
    return noteBox(v.tone === 'error' ? 'error' : 'warn', 'alert', '**' + (v.title || 'Plyo Slicer signale un point') + '**\n' + v.text + (v.quote && !v.explained ? '\n« ' + v.quote + ' »' : ''), acts);
  }
  function issuesInto(body) { state().issues.forEach(function (v, i) { body.appendChild(issueBox(v, i)); }); }

  // ---------- Ce que Plyo Slicer signale hors de la découpe (lot 5) ----------
  // Avertissements après un lot appliqué (after_apply), bulles d'Orca sur le plateau (tour_signals.notices), fenêtres d'erreur
  // d'Orca (orca_dialog) : dans « Je prépare… » ou « Tout est prêt », avec les autres cartes ; ailleurs, dans la discussion.
  // Mêmes explications et mêmes gestes (preflight.js) que le panneau classique.
  var orcaSeen = { known: {}, notices: [], noticeConv: null, noticeAsk: [], afterApply: null, dialogLine: null, dialogId: null };
  function remember(issues) { (issues || []).forEach(function (i) { orcaSeen.known[PF.issueKey(i)] = true; }); }
  function viewsOf(issues) { return PF.orcaCards(issues, { warnings: true }).map(function (i) { return PF.orcaIssueView(i, { canUndo: !!(values() && values().can_undo), novice: !expert() }); }); }
  var shownCard = ''; // écran de l'étape 3 affiché (X.screen) : seuls « preparing » et « ready » montrent les cartes d'Orca
  function inCardIssues() { return inStep3() && (shownCard === 'preparing' || shownCard === 'ready'); }
  function showIssueViews(views) {
    if (!views.length) return 0;
    if (inCardIssues()) {
      var st = state();
      views.forEach(function (v) { if (!st.issues.some(function (x) { return x.title === v.title && x.text === v.text; })) st.issues.push(v); });
      render();
    } else views.forEach(issueNotice);
    return views.length;
  }
  function runIssueAction(a, b, drop) {
    if (a.kind === 'slice') { drop(); state().sliceTried = ''; slice(); }
    else if (a.kind === 'show_setting') panel.post({ type: 'show_setting', key: a.key });
    else if (a.kind === 'show_me') panel.post({ type: 'show_me', target: a.target });
    else if (a.kind === 'ask') panel.send(a.prompt);
    else if (a.kind === 'export') { drop(); exportFile(); }
    else if (a.kind === 'preview') showPreview(b);
    else if (a.kind === 'import') { var f = document.getElementById('file-input'); if (f) f.click(); }
    else if (a.kind === 'undo_last') { b.disabled = true; ask({ type: 'undo' }, function (ok, t) { b.disabled = false; note(t || (ok ? 'Réglages d’avant remis.' : 'Je n’ai pas pu annuler.'), ok ? 'ok' : 'error'); if (ok) drop(); }); }
    else if (a.kind === 'plate') { b.disabled = true; plateAction(a.action, function (ok) { b.disabled = false; if (ok) { drop(); slice(); } }); }
    else if (a.kind === 'fix') { b.disabled = true; apply(Logic.confirmedChanges(a.changes), 'Correction demandée par Plyo Slicer', function (ok, text) { b.disabled = false; if (!ok) { note(text, 'error'); return; } note('Corrigé : ' + a.label.charAt(0).toLowerCase() + a.label.slice(1) + '.', 'ok'); drop(); slice(); }); }
  }
  // Une carte de Plyo Slicer dans la discussion, avec ses gestes.
  function issueNotice(v) {
    var box = null, drop = function () { if (box) box.remove(); };
    var acts = [];
    (v.actions || []).forEach(function (a) {
      if (a.kind === 'dismiss') { acts.push({ label: a.label, run: drop }); return; }
      var label = a.kind === 'ask' && !panel.session() ? PF.ASK_LOGIN_LABEL : a.label;
      acts.push({ label: label, run: function (e) { runIssueAction(a, e && e.target && e.target.tagName === 'BUTTON' ? e.target : { disabled: false }, drop); } });
    });
    if (!(v.actions || []).some(function (a) { return a.kind === 'dismiss'; })) acts.push({ label: 'Fermer', run: drop });
    box = panel.say('**' + (v.title || 'Plyo Slicer signale un point') + '**\n' + v.text + (v.quote && !v.explained ? '\n« ' + v.quote + ' »' : ''), v.tone === 'error' ? 'error' : 'warn', acts);
    box.classList.add('orca-issue');
    return box;
  }
  function askOrca(purpose) { if (conv()) panel.post({ type: 'orca_issues', purpose: purpose }); }
  // Bulles d'Orca : une nouvelle est demandée en détail ; une bulle fermée par Orca pourra être redite si elle revient.
  function watchNotices(codes) {
    var c = conv();
    if (!c || !Array.isArray(codes)) return;
    if (orcaSeen.noticeConv !== c.id) { orcaSeen.noticeConv = c.id; orcaSeen.notices = []; }
    var change = PF.noticeChange(orcaSeen.notices, codes);
    orcaSeen.notices = codes.slice();
    if (change.gone.length) Object.keys(orcaSeen.known).forEach(function (k) { if (change.gone.indexOf(k.split('|')[1]) >= 0) delete orcaSeen.known[k]; });
    if (change.added.length) { orcaSeen.noticeAsk = change.added; askOrca('notices'); }
  }
  // Un lot appliqué : Orca peut le refuser ou prévenir (validation). On relit ce qu'il en dit, une fois le lot pris en compte.
  function watchAfterApply(msg) {
    if (!msg.ok || !msg.undo_id || !conv()) return;
    orcaSeen.afterApply = { tries: 0, keys: (Array.isArray(msg.applied) ? msg.applied : []).map(function (a) { return a && a.id; }) };
    setTimeout(function () { askOrca('after_apply'); }, 600);
  }
  function onOrcaNoticeIssues(msg, issues) {
    if (msg.purpose === 'notices') {
      if (msg.busy) { orcaSeen.notices = []; return; }
      var shown = PF.noticeIssues(issues, orcaSeen.noticeAsk, orcaSeen.known);
      remember(shown);
      showIssueViews(viewsOf(shown));
      return;
    }
    if (msg.purpose === 'after_apply') {
      var wait = orcaSeen.afterApply;
      if (!wait) return;
      // Le lot n'est pas encore pris en compte par Orca : on relit un peu plus tard (cinq fois au plus).
      if ((msg.pending || msg.busy) && wait.tries < 5) { wait.tries += 1; setTimeout(function () { askOrca('after_apply'); }, 700); return; }
      orcaSeen.afterApply = null;
      // Erreurs : toujours (la prochaine découpe serait refusée) ; avertissements : ceux des réglages du lot, ou nouveaux.
      var said = issues.filter(function (i) { return i.source === 'validate_error' || (i.source === 'validate_warning' && (wait.keys.indexOf(i.opt_key) >= 0 || !orcaSeen.known[PF.issueKey(i)])); });
      remember(issues);
      showIssueViews(viewsOf(said));
    }
  }
  // Fenêtre d'Orca (orca_dialog) : une ligne discrète tant qu'elle est ouverte ; une erreur fermée, qu'aucune autre carte
  // n'explique, devient une carte qui cite son texte.
  function onOrcaDialog(msg) {
    if (msg.phase === 'open') {
      if (orcaSeen.dialogLine) orcaSeen.dialogLine.remove();
      orcaSeen.dialogId = msg.id;
      orcaSeen.dialogLine = panel.say(PF.dialogWaitText(msg));
      orcaSeen.dialogLine.classList.add('orca-wait');
      return;
    }
    if (orcaSeen.dialogLine && orcaSeen.dialogId === msg.id) { orcaSeen.dialogLine.remove(); orcaSeen.dialogLine = null; }
    if (PF.dialogCardWanted(msg)) showIssueViews([PF.dialogView(msg)]);
  }

  // « Plyo Slicer est passé sur … » (machine ou filament changé hors du panneau) : sans rien décider à ta place.
  // Plyo Slicer est-il sur une autre machine, ou sur un autre filament, que le projet ? (hors envoi en cours)
  function diverged() {
    var p = project(), ctx = values() && values().context, st = state();
    if (!p.printer || p.printer.proposed || !ctx || st.lock) return false;
    if (ctx.printer && ctx.printer !== p.printer.preset) return true;
    var f = p.filament;
    return !!(ctx.filament && f && !f.proposed && f.preset && !(Array.isArray(p.canvas) && p.canvas.length) && !R.sameFilament(f.preset, ctx.filament));
  }
  function divergenceInto(body) {
    var p = project(), ctx = values() && values().context, st = state();
    if (!diverged()) return false;
    if (ctx.printer && ctx.printer !== p.printer.preset) {
      var names = J.divergenceNames(p.printer, ctx.printer);
      body.appendChild(noteBox('warn', 'alert', 'Plyo Slicer est passé sur **' + names.to + '**, mais ton projet imprime sur **' + names.from + '**.', [
        ui.button('Utiliser ' + names.to + ' pour ce projet', function () { if (V2.materiel && V2.materiel.pickPrinter) V2.materiel.pickPrinter(ctx.printer, J.machineLabel({ name: ctx.printer })); }, 'btn sm'),
        ui.button('Remettre ' + names.from, restoreProject, 'btn sm')]));
      return true;
    }
    var f = p.filament, of = ctx.filament;
    var t = R.filamentDivergence(of, f);
    var acts = [];
    if (st.diverge && st.diverge.preset === of && st.diverge.path === 'name') {
      body.appendChild(adoptForm(of, true));
      return true;
    }
    if (st.diverge && st.diverge.preset === of && st.diverge.path === 'none') { body.appendChild(noteBox('warn', 'alert', R.ADOPT_NONE, [ui.button(t.restore, restoreProject, 'btn sm')])); return true; }
    acts.push(ui.button(t.use, function () { st.diverge = { preset: of, path: 'asking' }; panel.post({ type: 'spool_about_current' }); }, 'btn sm'));
    acts.push(ui.button(t.restore, restoreProject, 'btn sm'));
    var box = noteBox('warn', 'alert', t.text, acts);
    box.querySelector('.note-body').appendChild(ui.el('p', 'hint', t.note));
    body.appendChild(box);
    return true;
  }
  function restoreProject() { var p = project(); if (P.restorable(p)) panel.post({ type: 'project_restore', project: p, discard_unsaved: false }); }
  function onSpoolCurrent(msg) {
    var st = state(), d = st.diverge;
    if (!d || d.path !== 'asking' || msg.preset !== d.preset) return;
    var path = R.adoptionPath(msg);
    if (path === 'attach') { st.diverge = null; if (V2.materiel && V2.materiel.attachSpool) V2.materiel.attachSpool(msg.spool, msg.material); note('Ton projet utilise maintenant ta bobine « ' + msg.spool.name + ' ».', 'ok'); return; }
    st.diverge = { preset: d.preset, path: path, material: msg.material };
    render();
  }
  // Nom d'une bobine retenue : prérempli, modifiable, avec l'aide de l'étiquette (comme une nouvelle bobine).
  function adoptForm(preset, attach) {
    var st = state(), box = ui.el('div', 'note tip adopt');
    box.appendChild(ui.icon('spool', 18));
    var body = ui.el('div', 'note-body');
    body.appendChild(ui.el('p', '', 'Faire de « ' + preset + ' » une bobine que je retiens' + (attach ? ', pour ce projet et les suivants' : '') + '. Quel est son nom ?'));
    var lab = ui.el('label', 'fld');
    lab.appendChild(ui.txt('Nom de ta bobine'));
    var input = ui.el('input');
    input.type = 'text';
    input.value = Sp.cleanName(preset);
    lab.appendChild(input);
    body.appendChild(lab);
    body.appendChild(ui.el('p', 'hint', Sp.NAME_HELP));
    var err = ui.el('p', 'err hidden');
    body.appendChild(err);
    var row = ui.el('div', 'acts');
    var ok = ui.button('C’est ma bobine', function () {
      var code = Sp.nameError(input.value);
      if (code) { err.textContent = ui.fr(Sp.nameErrorText(code)); err.classList.remove('hidden'); return; }
      ok.disabled = true;
      st.adoptAttach = attach ? { preset: preset, material: st.diverge && st.diverge.material } : null;
      panel.post({ type: 'spool_adopt', preset: preset, name: Sp.cleanName(input.value) });
    }, 'btn sm main');
    row.appendChild(ok);
    row.appendChild(link('Annuler', function () { st.diverge = null; st.adopt = null; render(); }));
    body.appendChild(row);
    box.appendChild(body);
    return box;
  }
  // Préréglage de l'utilisateur choisi dans Orca, hors de ses bobines : proposé une fois par session ; « Non » ne le repropose jamais.
  function checkAdoptOffer() {
    var p = project(), ctx = values() && values().context, f = ctx && ctx.filament;
    if (!conv() || !p.printer || p.printer.proposed || !ctx || ctx.printer !== p.printer.preset || !f) return;
    if (adoptAsked[f] || !Sp.offersAdopt(habits, f)) return;
    if (p.filament && p.filament.preset && !R.sameFilament(p.filament.preset, f)) return; // la carte « … est passé sur » le propose déjà
    adoptAsked[f] = true;
    panel.post({ type: 'spool_adopt_check', preset: f });
  }
  function onAdoptOffer(msg) {
    var ctx = values() && values().context;
    if (!msg.offer || !ctx || ctx.filament !== msg.preset) return;
    var box = panel.say(Sp.adoptQuestion(msg.preset) + ' Je garderai ses réglages qui marchent et je te la proposerai à l’étape 2.', 'info', [
      { label: 'Oui, retiens-la', primary: true, run: function () { box.body.querySelector('.acts').remove(); box.body.appendChild(adoptForm(msg.preset, false)); } },
      { label: 'Non merci', run: function () { box.remove(); habits = Sp.declineAdopt(habits, msg.preset); saveHabits(); } }]);
  }
  function onSpoolAdopted(msg) {
    var st = state();
    if (!msg.ok) { note(msg.text || 'Je n’ai pas pu retenir cette bobine.', 'error'); render(); return; }
    var attach = st.adoptAttach && st.adoptAttach.preset === msg.preset ? st.adoptAttach : null;
    st.adoptAttach = null;
    st.diverge = null;
    note('C’est noté : « ' + msg.name + ' » fait partie de tes bobines.', 'ok');
    if (attach && V2.materiel && V2.materiel.attachSpool) { V2.materiel.attachSpool({ id: msg.id, name: msg.name }, attach.material); return; }
    var f = project().filament;
    if (f && f.preset === msg.preset) { f.spool = { id: msg.id, name: msg.name }; changed(); }
    else render();
  }

  // ---------- Écran « À quoi va servir ta pièce ? » ----------
  function usageCard(it) {
    var p = project(), st = state(), body = ui.el('div', 'card-content');
    if (st.intentError) body.appendChild(intentErrorBox());
    divergenceInto(body);
    if (it.mode === 'repeat') {
      body.appendChild(noteBox('', 'sliders', it.text));
      return { title: 'Même usage que ta dernière pièce ?', sub: 'Je règle Plyo Slicer comme pour ta dernière pièce.', body: body,
        primary: { label: 'Préparer l’impression', icon: 'send', run: function () { var last = I.validLast(habits.last_intent); if (!last) { st.changing = true; render(); return; } p.intent = Object.assign({}, last); changed(); applyIntent(); } },
        extra: [link('Changer', function () { st.changing = true; render(); }, 'muted')] };
    }
    var answers = X.intentAnswers(p), uc = X.useCards(partName()), primary = null, extra = [];
    var list = ui.el('div', 'cards uses');
    uc.cards.forEach(function (c) {
      list.appendChild(card({ icon: c.icon, title: c.label, sub: c.sub, sel: answers.use === c.id, badge: c.suggested ? badge('Suggéré') : null,
        on: function () { if (expert()) { p.intent = Object.assign({}, p.intent || {}, { use: c.id }); delete p.intent.pref; if (c.id === 'test') delete p.intent.speed; changed(); } else answerIntent('use', c.id); } }));
    });
    body.appendChild(list);
    var pending = it.mode === 'auto' || st.applying;
    if (pending) body.appendChild(spinLine('Je règle Plyo Slicer pour toi…'));
    if (expert() && answers.use && answers.use !== 'test') {
      // Confirmé : préférence et vitesse visibles d'office (« Pour aller plus loin »).
      body.appendChild(section('Pour aller plus loin'));
      [I.QUESTIONS.pref[answers.use], I.QUESTIONS.speed].forEach(function (q) {
        if (!q) return;
        body.appendChild(ui.el('p', 'hint', q.text));
        var chips = ui.el('div', 'chips');
        q.choices.forEach(function (c) { var b = ui.button(c.label, function () { p.intent[q.id] = c.id; changed(); }, 'chip' + (answers[q.id] === c.id ? ' sel' : '')); chips.appendChild(b); });
        body.appendChild(chips);
      });
    }
    if (expert() && it.mode === 'ready') primary = { label: 'Préparer l’impression', icon: 'send', disabled: pending, run: applyIntent };
    else if (expert() && answers.use) primary = { label: 'Préparer l’impression', disabled: true, run: function () {} };
    if (!pending && !expert()) extra.push(link('Je ne sais pas : choisis pour moi', function () { answerIntent('use', uc.suggested); }, 'muted center'));
    if (!pending) extra.push(link('Je règle moi-même', function () {
      p.intent = { skipped: true };
      habits = M.noteIntent(habits, true);
      saveHabits();
      note('D’accord, je garde les réglages d’impression actuels.', 'info');
      changed();
      drive();
    }, 'muted center'));
    return { title: 'À quoi va servir ta pièce ?', sub: 'Je choisis les bons réglages d’après ta réponse.', body: body, primary: primary, extra: extra };
  }

  // ---------- « Je prépare ton impression… » ----------
  function preparingCard() {
    var p = project(), st = state(), body = ui.el('div', 'card-content'), it = p.intent || {};
    var labels = X.intentLabels(X.intentAnswers(p));
    var lines = [
      { text: it.skipped || !labels.use ? 'Je garde tes réglages d’impression' : 'Je règle Plyo Slicer pour « ' + labels.use + ' »', done: !st.applying },
      { text: 'Je découpe la pièce en couches', done: sliced(), busy: st.slicing },
      { text: 'Je vérifie que tout va bien se passer', done: !!st.preflight && !st.fixing, busy: sliced() && (!st.preflight || !!st.fixing) }
    ];
    var ul = ui.el('ul', 'checks prep');
    var current = lines.findIndex(function (l) { return !l.done; });
    lines.forEach(function (l, i) {
      var li = ui.el('li', i <= current || current < 0 ? 'on' : '');
      var mark = ui.el('span', l.done ? 'ok' : '');
      if (l.done) mark.appendChild(ui.icon('check', 18));
      else if (i === current && !st.issues.length) mark = ui.el('span', 'spin');
      else mark.appendChild(ui.icon('clock', 18));
      li.appendChild(mark);
      li.appendChild(ui.el('span', 'txt', l.text));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    divergenceInto(body);
    issuesInto(body);
    if (!st.issues.length && !st.slicing && !sliced() && st.sliceTried === 'failed') body.appendChild(noteBox('warn', 'alert', st.sliceError || 'La découpe ne s’est pas faite.', [ui.button('Découper à nouveau', function () { st.sliceTried = ''; st.sliceError = ''; slice(); }, 'btn sm')]));
    if (st.intentError) body.appendChild(intentErrorBox());
    if (signals && signals.objects === 0) body.appendChild(goneBox());
    var extra = [];
    if (sliced() && st.preflight && signals && signals.ready_for_print === false) extra.push(ui.el('p', 'hint center', 'Plyo Slicer ne laisse pas imprimer cette plaque : regarde ce qu’il signale.'));
    return { title: 'Je prépare ton impression…', sub: null, body: body, primary: null, extra: extra };
  }

  // ---------- « Tout est prêt » ----------
  function statBox(stats) {
    var box = ui.el('div', 'stat');
    function cell(b, small) { var d = ui.el('div'); d.appendChild(ui.el('b', '', b)); d.appendChild(ui.el('small', '', small)); box.appendChild(d); }
    cell(stats.time, 'd’impression');
    if (stats.grams) cell(stats.grams, stats.material ? 'de ' + stats.material : 'de filament');
    if (stats.cost) cell(stats.cost, 'de filament');
    box.classList.toggle('two', box.children.length === 2);
    return box;
  }
  function checkAct(c) {
    var st = state(), a = c.act;
    if (!a) return null;
    var b = ui.button(a.label, function () {
      if (a.kind === 'show_setting') { panel.post({ type: 'show_setting', key: a.key }); return; }
      b.disabled = true;
      if (a.kind === 'plate') { plateAction(a.action, function (ok) { if (ok) { st.preflight = null; slice(); } else render(); }); return; }
      var done = function (ok, text, result) {
        if (!ok) { refused(text, result, function () { b.disabled = false; b.click(); }); render(); return; }
        if (c.key === 'support' || c.key === 'brim') st.added[c.key] = st.added[c.key] || a.label !== 'Retirer';
        st.preflight = null;
        slice();
      };
      if (a.catalog) apply(a.changes, 'Vérification avant impression', done);
      else ask({ type: 'apply', changes: a.changes, why: 'Vérification avant impression' }, done);
    }, 'mini');
    return b;
  }
  function readyCard() {
    var p = project(), st = state(), body = ui.el('div', 'card-content'), linked = !!(signals && signals.linked);
    var stats = X.stats(signals, p.filament && p.filament.type);
    var moved = divergenceInto(body);
    if (stats) body.appendChild(statBox(stats));
    var checks = X.readyChecks(st.preflight, { printer: shortName(), filament: p.filament, added: st.added });
    if (checks.length) {
      var ul = ui.el('ul', 'checks');
      checks.forEach(function (c) {
        var li = ui.el('li');
        var mark = ui.el('span', c.ok ? 'ok' : 'w');
        mark.appendChild(ui.icon(c.ok ? 'check' : 'alert', 18));
        li.appendChild(mark);
        var t = ui.el('span', 'txt', c.title);
        if (c.sub) t.appendChild(ui.el('small', '', c.sub));
        li.appendChild(t);
        var b = checkAct(c);
        if (b) li.appendChild(b);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    } else if (st.slicing || st.fixing || (!sliced() && st.sliceTried === 'auto')) body.appendChild(spinLine('Je redécoupe la pièce et je revérifie…'));
    else if (signals && signals.objects === 0) body.appendChild(goneBox());
    else if (!sliced() && !st.issues.length && st.sliceTried === 'failed' && st.sliceError) body.appendChild(noteBox('warn', 'alert', st.sliceError, [ui.button('Découper à nouveau', function () { st.sliceTried = ''; st.sliceError = ''; slice(); }, 'btn sm main')]));
    else if (!sliced() && !st.issues.length && !moved) body.appendChild(noteBox('warn', 'alert', 'La plaque n’est plus découpée.', [ui.button('Découper', function () { st.sliceTried = ''; slice(); }, 'btn sm main')]));
    issuesInto(body);
    // Réglages : l'usage choisi, et « Ajuster » (usage, priorité, vitesse).
    var it = p.intent || {}, labels = X.intentLabels(X.intentAnswers(p));
    var line = ui.el('div', 'summary-line');
    var ic = ui.el('span', 'ic'); ic.appendChild(ui.icon('sliders', 20)); line.appendChild(ic);
    var mid = ui.el('div', 'grow');
    mid.appendChild(ui.el('strong', '', it.skipped || !labels.use ? 'Réglages : les tiens' : 'Réglages : ' + labels.use));
    if (labels.detail) mid.appendChild(ui.el('small', '', labels.detail));
    else if (it.skipped) mid.appendChild(ui.el('small', '', 'Je n’ai rien changé'));
    line.appendChild(mid);
    line.appendChild(ui.button(st.adjust ? 'Fermer' : 'Ajuster', function () { st.adjust = !st.adjust; render(); }, 'btn sm'));
    body.appendChild(line);
    if (st.adjust) body.appendChild(adjustBox());
    // Machine qui ne répond pas : revérifiée toute seule.
    if (linked && p.printer && reachable[p.printer.preset] === false)
      body.appendChild(noteBox('warn', 'alert', shortName() + ' ne répond pas. Allume-la et vérifie qu’elle est sur le même réseau : je revérifie toute seule.', [ui.button('Vérifier à nouveau', function () { delete reachable[p.printer.preset]; panel.post({ type: 'project_reachable', preset: p.printer.preset }); render(); }, 'btn sm')]));
    // Emplacements choisis à l'étape 2 : rappel, et « Changer les emplacements ».
    if (Array.isArray(p.canvas) && p.canvas.length) {
      var cv = noteBox('', 'spool', C.mapLabel(p.canvas, C.isImposed(p.canvas)), [link('Changer les emplacements', function () { if (st.lock) return; st.refused = ''; reopenMateriel(); })]);
      var pn = C.printNote(p.canvas);
      if (pn) cv.querySelector('.note-body').appendChild(ui.el('p', 'hint', pn));
      body.appendChild(cv);
    }
    if (st.refused) body.appendChild(noteBox('warn', 'alert', st.refused, [link('Changer les emplacements', reopenMateriel)]));
    if (st.failure) body.appendChild(failureBox(st.failure));
    body.appendChild(noteBox('tip', 'info', '**Avant de lancer :** plateau propre (sans traces de doigts) et filament bien engagé.', [link('Que vérifier d’autre ?', function () { panel.send(J.suggestionsFor('imprimer')[0].value); })]));
    var blocked = !!(signals && signals.ready_for_print === false);
    var ready = sliced() && !st.slicing && !blocked && !st.fixing && !moved;
    var primary = linked ? { label: 'Lancer l’impression sur ' + shortName(), icon: 'send', disabled: !ready || !!st.lock, run: sendPrint }
      : { label: 'Enregistrer pour la clé USB', icon: 'save', disabled: !ready || !!st.lock, run: exportFile };
    // Plyo Slicer n'est plus sur la machine ou la bobine du projet : le fichier serait fait pour une autre. Choisir d'abord.
    if (moved) primary.label = 'Choisis d’abord ci-dessus';
    else if (!ready && !blocked) primary.label = 'Je prépare…';
    var links = ui.el('div', 'links');
    var prev = link('Voir l’aperçu dans Orca', function () { showPreview(prev); });
    links.appendChild(prev);
    if (linked && !moved) links.appendChild(link('Enregistrer le fichier', exportFile));
    return { title: 'Tout est prêt', sub: null, body: body, primary: primary, extra: [links] };
  }
  function adjustBox() {
    var p = project(), a = X.intentAnswers(p), box = ui.el('div', 'adjust');
    function group(title, q, cur, onPick) {
      if (!q) return;
      box.appendChild(ui.el('p', 'hint', title));
      var chips = ui.el('div', 'chips');
      q.choices.forEach(function (c) { chips.appendChild(ui.button(c.label, function () { onPick(c.id); }, 'chip' + (cur === c.id ? ' sel' : ''))); });
      box.appendChild(chips);
    }
    group('Usage', I.QUESTIONS.use, a.use, function (id) { adjustIntent({ use: id }); });
    if (a.use && a.use !== 'test') {
      group('Priorité', I.QUESTIONS.pref[a.use], a.pref, function (id) { adjustIntent({ pref: id }); });
      group('Vitesse', I.QUESTIONS.speed, a.speed, function (id) { adjustIntent({ speed: id }); });
    }
    return box;
  }
  function reopenMateriel() { var b = document.querySelector('#stepper .st[data-step="materiel"]'); if (b && !b.disabled) b.click(); }
  function failureBox(v) {
    var st = state(), acts = [];
    v.actions.forEach(function (a) {
      if (a.kind === 'retry') acts.push(ui.button(a.label, function () { st.failure = null; sendPrint(); }, 'btn sm main'));
      else if (a.kind === 'export') acts.push(ui.button(a.label, function () { st.failure = null; exportFile(); }, 'btn sm'));
      else if (a.kind === 'printing') acts.push(ui.button(a.label, function () { st.failure = null; started(); }, 'btn sm'));
      else if (a.kind === 'ask') acts.push(ui.button(panel.session() ? a.label : PF.ASK_LOGIN_LABEL, function () { panel.send(a.prompt); }, 'btn sm'));
      else if (a.kind === 'link') acts.push(ui.button(a.label, function () { panel.post({ type: 'printer_link_recheck' }); }, 'btn sm'));
    });
    acts.push(link('Fermer', function () { st.failure = null; render(); }));
    return noteBox(v.tone === 'warn' ? 'warn' : 'error', 'alert', '**' + v.title + '**\n' + v.text, acts);
  }
  function showPreview(b) {
    if (b) b.disabled = true;
    ask({ type: 'show_preview' }, null);
    previewBtn = b || null;
  }
  var previewBtn = null;
  function onShowPreview(msg) {
    if (!(msg.request in waiters)) return;
    delete waiters[msg.request];
    var b = previewBtn;
    if (b) { b.disabled = false; previewBtn = null; }
    // Ouvert : le lien le dit un instant (l'explication va dans la conversation) ; sinon, la raison là où l'on est.
    if (msg.ok && msg.sliced !== false && b && panel.flash(b, 'Aperçu ouvert dans Plyo Slicer')) panel.say(Logic.previewText(msg), 'info');
    else panel.tell(Logic.previewText(msg), msg.ok ? 'info' : 'error');
  }

  // ---------- Envoi en cours, fichier enregistré ----------
  function sendingCard() {
    var st = state(), body = ui.el('div', 'card-content'), s = st.sending;
    body.appendChild(spinLine(s.text));
    if (typeof s.percent === 'number' && s.percent > 0) { var bar = ui.el('div', 'progress'); var fill = ui.el('i'); fill.style.width = Math.min(100, s.percent) + '%'; bar.appendChild(fill); body.appendChild(bar); }
    if (!s.device && !s.armed) body.appendChild(ui.el('p', 'hint', 'Transfert puis démarrage. Je vérifie qu’elle commence bien.'));
    var primary = s.device || s.armed ? { label: s.armed ? 'Oui, elle imprime' : 'L’impression a démarré', icon: 'check', run: function () { unlockSend(); started(); } } : null;
    return { kicker: 'Impression', title: 'J’envoie le fichier à ' + shortName() + '…', sub: null, body: body, primary: primary };
  }
  function savedCard() {
    var st = state(), body = ui.el('div', 'card-content');
    body.appendChild(noteBox('ok', 'check', st.exported.text));
    var steps = ui.el('div', 'steps3');
    ['Retire la clé et branche-la sur l’imprimante.', 'Sur son écran : Imprimer, puis choisis le fichier.', 'Reviens ici quand c’est fini pour me dire si c’est réussi.'].forEach(function (t, i) {
      var row = ui.el('div'); row.appendChild(ui.el('b', '', String(i + 1))); row.appendChild(ui.el('span', '', t)); steps.appendChild(row);
    });
    body.appendChild(steps);
    return { title: 'Fichier enregistré', sub: null, body: body, primary: { label: 'Compris, j’ai lancé l’impression', icon: 'check', run: started },
      extra: [link('Enregistrer à nouveau', exportFile, 'muted center')] };
  }

  // ---------- Impression en cours ----------
  function printingCard() {
    var st = state(), body = ui.el('div', 'card-content'), w = st.watchLine;
    if (w) body.appendChild(noteBox(w.tone === 'ok' ? 'ok' : w.tone === 'warn' ? 'warn' : '', w.icon === 'check' ? 'check' : w.icon === 'alert' ? 'alert' : 'info', w.text.replace(/^✓ /, '')));
    else body.appendChild(spinLine('Je vérifie qu’elle a bien démarré…'));
    var stats = X.stats(signals, project().filament && project().filament.type);
    if (stats) body.appendChild(ui.el('p', 'hint', 'Durée prévue : ' + stats.time + (stats.grams ? ' · ' + stats.grams + ' de filament' : '') + '. Je te le dis ici quand elle a fini.'));
    body.appendChild(noteBox('tip', 'eye', '**Regarde la première couche :** elle doit être bien écrasée et collée. Si elle se décolle, arrête et dis-le-moi.'));
    var extra = [ui.button('Ça a l’air de mal se passer', function () { st.screen = 'failed'; st.during = true; render(); }, 'btn wide'),
      link('Elle a fini', function () { st.screen = 'result'; render(); }, 'muted center')];
    return { kicker: 'Impression en cours', title: shortName() + ' imprime ' + (partName() || 'ta pièce'), sub: null, body: body, primary: null, extra: extra };
  }

  // ---------- Résultat ----------
  function bigChoice() {
    var row = ui.el('div', 'big-choice');
    [['😀', 'Réussi', success], ['😕', 'Raté', failed], ['📷', 'Je montre', function () { failed(); state().photoAsk = true; render(); }]].forEach(function (x) {
      var b = ui.el('button');
      b.type = 'button';
      b.appendChild(ui.el('span', 'emo', x[0]));
      b.appendChild(ui.txt(x[1]));
      b.addEventListener('click', x[2]);
      row.appendChild(b);
    });
    return row;
  }
  function resultCard() {
    var st = state(), p = project(), body = ui.el('div', 'card-content'), ask = X.spoolAsk(p);
    body.appendChild(bigChoice());
    // Fin inconnue (clé USB, machine sans suivi) : on ne demande pas « c'est fini ? » au début de l'impression.
    var asked = st.screen === 'result';
    return { kicker: asked ? 'Résultat' : 'Impression lancée', title: asked ? 'C’est fini ? Alors, c’est réussi ?' : 'Bonne impression !',
      sub: asked ? (ask ? 'Ta réponse m’aide à améliorer les prochaines impressions sur « ' + ask + ' ».' : 'Ta réponse m’aide à améliorer les prochaines impressions.')
        : (ask ? 'Quand elle est finie, dis-moi si c’est réussi : je retiendrai les réglages de ta bobine « ' + ask + ' ».' : 'Quand elle est finie, dis-moi si c’est réussi. Si quelque chose cloche, je t’aide à trouver pourquoi.'),
      body: body, primary: null,
      extra: [link('Je répondrai plus tard', function () { st.screen = 'later'; render(); }, 'muted center')] };
  }
  // La machine a dit comment l'impression a fini (fin suivie) : la question formulée selon l'état, comme le classique.
  function endCard() {
    var st = state(), p = project(), q = X.endQuestionNow(p), body = ui.el('div', 'card-content');
    if (q.verdict === 'finished') {
      body.appendChild(bigChoice());
      return { kicker: 'Résultat', title: 'C’est fini ! Alors, c’est réussi ?', sub: q.text.replace(/ Ça s’est bien passé \?$/, '') + ' Ta réponse m’aide à améliorer les prochaines impressions sur cette bobine.', body: body, primary: null,
        extra: [link('Je répondrai plus tard', function () { st.screen = 'later'; render(); }, 'muted center')] };
    }
    body.appendChild(ui.el('p', '', q.text));
    var chips = ui.el('div', 'chips');
    q.choices.forEach(function (c) { chips.appendChild(ui.button(c.label, function () { answerEnd(c.id); }, 'chip')); });
    body.appendChild(chips);
    var extra = [];
    if (q.verdict === 'error' && X.spoolAsk(p)) extra.push(ui.button('Non, c’est raté', failed, 'btn wide'));
    extra.push(link('Nouveau projet', function () { panel.newConversation(); }, 'muted center'));
    return { kicker: 'Résultat', title: q.verdict === 'cancelled' ? 'Impression arrêtée' : 'Ta machine signale une erreur', sub: null, body: body, primary: null, extra: extra };
  }
  function laterCard() {
    var body = ui.el('div', 'card-content');
    body.appendChild(ui.el('p', 'hint', 'Ton projet est enregistré. Rouvre-le depuis « Mes pièces récentes » pour me dire comment ça s’est passé.'));
    body.appendChild(nextCards(false));
    return { kicker: 'Projet enregistré', title: 'Je te reposerai la question', sub: null, body: body, primary: null,
      extra: [link('Finalement, je réponds', function () { state().screen = 'result'; render(); }, 'muted center')] };
  }
  function nextCards(withCalib) {
    var p = project(), list = ui.el('div', 'cards');
    var spool = p.filament && p.filament.spool && p.filament.spool.name;
    list.appendChild(card({ icon: 'plus', title: 'Imprimer une autre pièce', sub: 'Même imprimante' + (spool ? ', même bobine' : ''), chev: true, on: function () { panel.newConversation(); } }));
    var stats = X.stats(signals);
    list.appendChild(card({ icon: 'rotate', title: 'Réimprimer la même', sub: stats ? stats.time : null, chev: true, on: reprint }));
    if (withCalib) list.appendChild(card({ icon: 'target', title: 'Améliorer ma bobine', sub: 'Un test guidé pour des réglages parfaits', chev: true, on: function () { state().calibOpen = !state().calibOpen; render(); } }));
    return list;
  }
  function successCard() {
    var st = state(), body = ui.el('div', 'card-content');
    if (st.successNote) body.appendChild(noteBox('ok', 'check', st.successNote));
    body.appendChild(nextCards(true));
    if (st.calibOpen) body.appendChild(calibChooser());
    return { kicker: 'Bravo !', title: 'Belle impression !', sub: null, body: body, primary: null };
  }
  function failedCard() {
    var st = state(), p = project(), body = ui.el('div', 'card-content');
    if (st.asked) {
      body.appendChild(noteBox('tip', 'info', 'Je t’ai répondu dans la discussion, juste en dessous. **Appliquer et réimprimer** change les réglages et prépare la prochaine impression.'));
      body.appendChild(nextCards(true));
      if (st.calibOpen) body.appendChild(calibChooser());
      return { kicker: 'Résultat', title: 'On corrige pour la prochaine fois', sub: null, body: body, primary: null,
        extra: [link('Montrer une autre photo', photoChoice, 'muted center')] };
    }
    var list = ui.el('div', 'cards');
    X.SYMPTOMS.forEach(function (s) { list.appendChild(card({ title: s.label, sub: s.sub || null, sel: st.symptom === s.id, radio: true, on: function () { st.symptom = s.id; render(); } })); });
    body.appendChild(list);
    body.appendChild(card({ icon: 'camera', title: 'Montrer une photo', sub: 'Avec ton téléphone ou depuis l’ordinateur', badge: badge('IA', 'ai'), chev: true, on: function () { st.photoAsk = !st.photoAsk; render(); } }));
    if (st.photoAsk) body.appendChild(photoBox());
    var go = function () {
      if (st.during || !(X.sendOf(p) && X.sendOf(p).failed)) { st.during = false; failed(); }
      st.asked = true;
      render();
      panel.send(X.symptomPrompt(st.symptom, partName()));
    };
    return { kicker: 'Résultat', title: 'Qu’est-ce qui ne va pas ?', sub: 'Choisis ce qui ressemble le plus. Une photo me permet d’être plus précis.', body: body,
      primary: { label: 'Trouver la solution', disabled: !st.symptom || panel.busy(), run: go },
      extra: [link('Retour', function () { st.screen = st.during ? '' : 'result'; st.during = false; render(); }, 'muted center')] };
  }
  function photoChoice() { var st = state(); st.photoAsk = true; st.asked = false; render(); }
  function photoBox() {
    var st = state(), p = project(), box = ui.el('div', 'cards photo-ask');
    var prompt = function () { return st.symptom ? X.symptomPrompt(st.symptom, partName()) : 'Voici ma pièce ratée' + (partName() ? ' (« ' + partName() + ' »)' : '') + ' : qu’est-ce qui cloche, et que changer pour la prochaine fois ?'; };
    var mark = function () { if (st.during || !(X.sendOf(p) && X.sendOf(p).failed)) { st.during = false; failed(); } st.asked = true; st.photoAsk = false; };
    box.appendChild(card({ icon: 'phone', title: 'Avec mon téléphone', sub: 'Scanne un QR code : les photos arrivent ici', chev: true, on: function () { mark(); panel.prefill(prompt()); panel.openPhone(); render(); } }));
    box.appendChild(card({ icon: 'folder', title: 'Depuis l’ordinateur', sub: 'Choisis des photos déjà prises, puis envoie', chev: true, on: function () { mark(); panel.pickPhotos(prompt()); render(); } }));
    return box;
  }

  // ---------- Calibration ----------
  function calibChooser() {
    var p = project(), box = ui.el('div', 'calib-choose');
    box.appendChild(ui.el('p', 'hint', R.calibIntro(p.filament && p.filament.spool ? p.filament.spool.name : '')));
    var list = ui.el('div', 'cards');
    R.CALIB_CHOICES.forEach(function (c, i) {
      var info = X.CALIB[c.test];
      list.appendChild(card({ icon: 'target', title: info.name, sub: info.shows.charAt(0).toUpperCase() + info.shows.slice(1) + ' · ' + info.duration, badge: i === 0 ? badge('Conseillé') : null, chev: true, on: function () { startCalib(c.test); } }));
    });
    box.appendChild(list);
    return box;
  }
  var calib = null; // test en cours : { box, test, pass, awaiting, analyzing, receive(photos) }
  function startCalib(test, b, extra) {
    if (b) b.disabled = true;
    state().calibOpen = false;
    render();
    ask(Object.assign({ type: 'calib_start', test: test, pass: 1 }, extra || {}), function (ok, text) { if (b) b.disabled = false; if (!ok) note(text || 'Je n’ai pas pu poser le test.', 'error'); });
  }
  function onCalibStarted(msg) {
    if (msg.request in waiters) delete waiters[msg.request];
    var info = X.CALIB[msg.test];
    if (!info) return;
    if (calib) calib.box.remove();
    panel.record({ kind: 'note', text: info.name + ' posé sur le plateau.', tone: '' });
    var box = ui.el('div', 'msg ai calib');
    box.appendChild(D.who(info.name + (msg.test === 'flow' ? ' — passe ' + msg.pass + ' sur 2' : '')));
    box.appendChild(ui.el('p', '', 'Le test est sur le plateau. Ce qu’il va montrer : ' + info.shows + '. ' + (msg.instructions || '')));
    box.appendChild(ui.el('p', 'hint', 'Ta pièce et tes réglages sont gardés : « Remettre ma pièce » les ramène à tout moment.'));
    var sheet = ui.el('div', 'sheet');
    sheet.appendChild(ui.el('p', 'sheet-title', info.parts + ' · ' + info.pick));
    var choice = null, group = 'calib-' + Date.now();
    var rows = Logic.calibOrder(msg.sections || [], info.tower).map(function (s) {
      var row = ui.el('label', 'pick-row');
      var radio = ui.el('input');
      radio.type = 'radio';
      radio.name = group;
      row.appendChild(radio);
      row.appendChild(ui.el('span', 'grow', s.label));
      if (s.where) row.appendChild(badge(s.where));
      radio.addEventListener('change', function () { choice = s; update(); });
      sheet.appendChild(row);
      return { radio: radio, row: row, s: s };
    });
    var status = ui.el('p', 'hint', 'Pas sûr ? Une fois le test imprimé, envoie-moi une photo : je t’aide à choisir.');
    sheet.appendChild(status);
    var acts = ui.el('div', 'acts');
    var photo = ui.button('Photo', null, 'btn sm', 'camera');
    var phone = ui.button('Téléphone', null, 'btn sm', 'phone');
    var save = ui.button('', null, 'btn sm main hidden');
    var back = link('Remettre ma pièce', function () { restoreCalib(back); });
    [photo, phone, save, back].forEach(function (b) { acts.appendChild(b); });
    sheet.appendChild(acts);
    box.appendChild(sheet);
    var card2 = { box: box, test: msg.test, pass: msg.pass, awaiting: true, analyzing: false };
    calib = card2;
    panel.syncPhone();
    function update() {
      if (!choice) return;
      save.classList.remove('hidden');
      save.textContent = ui.fr(msg.test === 'flow' && msg.pass === 1 ? 'Lancer la passe fine' : 'Enregistrer ' + choice.label + ' pour ce filament');
    }
    function analyze(photos) {
      if (card2.analyzing) return;
      if (!panel.session()) { panel.requireLogin('Pour lire la photo de ton test, je l’envoie à l’IA : connecte-toi, sans mot de passe (tu reçois un code par e-mail).', function () { analyze(photos); }); return; }
      card2.analyzing = true;
      card2.awaiting = false;
      status.textContent = ui.fr('L’assistant regarde ta photo…');
      var v = values() || {};
      panel.apiFetch('/api/calibration/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: v.locale || 'fr', test: msg.test,
        pass: msg.test === 'flow' ? msg.pass : undefined, images: photos.map(function (ph) { return { media_type: ph.media_type, data: ph.data }; }), sections: msg.sections,
        filament: v.context ? v.context.filament : undefined, printer: v.context ? v.context.printer : undefined }) })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (r) {
          card2.analyzing = false;
          if (calib !== card2) return;
          if (!r.ok) { if (r.data.error === 'insufficient_credits') panel.setGauge(r.data.gauge); status.textContent = ui.fr(Logic.errorView(r.data.error, r.data).text + ' Tu peux aussi choisir toi-même le meilleur.'); card2.awaiting = true; return; }
          if (r.data.credits) panel.setGauge(r.data.credits.gauge);
          if (r.data.status !== 'ok') { status.textContent = ui.fr(r.data.retake_advice || 'Reprends la photo, en pleine lumière.'); card2.awaiting = true; return; }
          panel.syncPhone();
          var win = rows.filter(function (x) { return x.s.index === r.data.winner_index; })[0];
          if (!win) return;
          win.radio.checked = true;
          win.row.classList.add('best');
          choice = win.s;
          status.textContent = ui.fr('Le meilleur : ' + win.s.label + '. ' + (r.data.explanation || '') + ' Tu as la pièce en main : choisis-en un autre si tu n’es pas d’accord.');
          update();
        })
        .catch(function () { card2.analyzing = false; if (calib === card2) { status.textContent = ui.fr(Logic.errorView('network').text + ' Tu peux aussi choisir toi-même le meilleur.'); card2.awaiting = true; } });
    }
    card2.receive = analyze;
    var fileIn = ui.el('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/*';
    fileIn.multiple = true;
    fileIn.className = 'hidden';
    fileIn.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileIn.files || []).slice(0, 6);
      fileIn.value = '';
      Promise.all(files.map(function (f) { return root.PlyoPhotos.downscale(f).catch(function () { return null; }); })).then(function (list) {
        var ok = list.filter(Boolean);
        if (ok.length) analyze(ok); else status.textContent = ui.fr('Cette image ne peut pas être lue : prends plutôt du JPEG ou du PNG.');
      });
    });
    box.appendChild(fileIn);
    photo.addEventListener('click', function () { fileIn.click(); });
    phone.addEventListener('click', function () { card2.awaiting = true; panel.syncPhone(); panel.openPhone(); });
    save.addEventListener('click', function () {
      save.disabled = true;
      if (msg.test === 'flow' && msg.pass === 1) { ask({ type: 'calib_start', test: 'flow', pass: 2, base_value: choice.value }, function (ok, t) { if (!ok) { save.disabled = false; status.textContent = ui.fr(t); } }); return; }
      ask({ type: 'calib_save', test: msg.test, value: choice.value }, function (ok, t) {
        if (!ok) { save.disabled = false; status.textContent = ui.fr(t); return; }
        panel.record({ kind: 'note', text: info.name + ' : ' + t, tone: 'ok' });
        acts.textContent = '';
        acts.appendChild(ui.el('span', 'done-line ok', t));
        var restore = ui.button('Remettre ma pièce', function () { restoreCalib(restore); }, 'btn sm main');
        acts.appendChild(restore);
      });
    });
    panel.addToThread(box);
  }
  function restoreCalib(b) {
    if (b) b.disabled = true;
    ask({ type: 'calib_restore' }, function (ok, t) {
      if (!ok) { if (b) b.disabled = false; note(t, 'error'); return; }
      if (calib) { calib.awaiting = false; calib.box.querySelectorAll('button').forEach(function (x) { x.disabled = true; }); }
      calib = null;
      panel.syncPhone();
      note(t, 'ok');
    });
  }

  // ---------- Réponses de l'assistant : fiche de réglages, actions, test proposé ----------
  function paramOf(id) { var v = values(); return (v && Array.isArray(v.params) && v.params.filter(function (x) { return x.id === id; })[0]) || { label: id, unit: '', value: null }; }
  function formatValue(value, unit) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (typeof value === 'string') return Logic.choiceLabel(value);
    return (Math.round(value * 1000) / 1000).toLocaleString('fr-FR') + (unit ? ' ' + unit : '');
  }
  function changeOf(s) {
    if (s.catalog) return { label: s.label, key: s.id, before: s.beforeText || formatValue(s.before, s.unit), after: s.valueText || formatValue(s.value, s.unit) };
    var p = paramOf(s.id), after = s.delta !== null && s.delta !== undefined && typeof p.value === 'number' ? p.value + s.delta : s.value;
    return { label: p.label, key: p.key, before: formatValue(p.value, p.unit), after: formatValue(after, p.unit) };
  }
  // Fiche de réglages proposée par l'IA : cases à cocher (« coché = je le change pour toi »), « Appliquer », « Ignorer », puis
  // « Annuler ». À l'étape Résultat : « Appliquer et réimprimer ». Une conversation rouverte la montre en lecture.
  function sheetInto(box, entry, archived) {
    var a = entry.data, old = box.querySelector('.sheet');
    if (!a.suggestions || !a.suggestions.length) return;
    var ro = Logic.sheetArchived(archived, false, !!entry.applied);
    var sheet = ui.el('div', 'sheet live');
    sheet.appendChild(ui.el('p', 'sheet-title', ro ? (entry.applied ? 'Réglages appliqués' : 'Réglages proposés') : 'Réglages proposés'));
    if (!ro && !expert()) sheet.appendChild(ui.el('p', 'hint', 'Coché = je le change pour toi. Décoche ce que tu préfères garder.'));
    var rows = [];
    Logic.groupByTab(a.suggestions).forEach(function (g) {
      if (g.tab) sheet.appendChild(ui.el('p', 'group-title', g.tab));
      g.items.forEach(function (s) {
        var c = ro && entry.changes && entry.changes[s.id] ? entry.changes[s.id] : changeOf(s);
        var row = ui.el(ro ? 'div' : 'label', 'set-row');
        var check = null;
        if (!ro) { check = ui.el('input'); check.type = 'checkbox'; check.checked = Logic.defaultChecked(s); row.appendChild(check); }
        else row.appendChild(ui.icon(entry.applied ? 'check' : 'info', 14));
        var info = ui.el('div', 'grow');
        var name = (root.PLYO_FICHES || {})[c.key] ? ui.button(c.label, function (e) { if (e) { e.preventDefault(); e.stopPropagation(); } panel.explain(c.key); }, 'setting-name') : ui.el('span', 'setting-name', c.label);
        if (name.tagName === 'BUTTON') name.title = ui.fr('C’est quoi ce réglage ?');
        info.appendChild(name);
        info.appendChild(ui.el('span', 'delta', c.before + ' → ' + c.after));
        if (s.reason) info.appendChild(ui.el('small', '', s.reason));
        if (!ro && s.beyond) info.appendChild(ui.el('small', 'caution', '⚠ Hors de la plage conseillée par le fabricant de ton filament : à toi de décider.'));
        else if (!ro && s.confirm) info.appendChild(ui.el('small', 'caution', '⚠ Réglage sensible : coche-le si tu veux l’appliquer.'));
        row.appendChild(info);
        sheet.appendChild(row);
        rows.push({ check: check, s: s, row: row, c: c });
      });
    });
    if (old) old.replaceWith(sheet); else box.appendChild(sheet);
    if (ro) { if (!entry.applied) sheet.appendChild(ui.el('p', 'hint', 'Pour les appliquer aujourd’hui, redemande-moi : tes réglages ont pu changer depuis.')); return; }
    entry.changes = {};
    rows.forEach(function (r) { entry.changes[r.s.id] = r.c; });
    save();
    var fail = ui.el('p', 'err hidden');
    var foot = ui.el('div', 'acts');
    var resultStep = step() === 'resultat' && inStep3();
    var applyBtn = ui.button('', null, 'btn sm main', resultStep ? 'send' : null);
    var applyOnly = resultStep ? link('Appliquer sans réimprimer') : null;
    var ignore = link('Ignorer', function () { sheet.remove(); });
    foot.appendChild(applyBtn);
    if (applyOnly) foot.appendChild(applyOnly);
    foot.appendChild(ignore);
    sheet.appendChild(foot);
    sheet.appendChild(fail);
    function picked() { return rows.filter(function (r) { return r.check.checked; }); }
    function count() {
      var n = picked().length;
      applyBtn.lastChild.textContent = ui.fr(!n ? 'Aucun réglage coché' : resultStep ? 'Appliquer et réimprimer' : 'Appliquer ' + n + ' réglage' + (n > 1 ? 's' : '') + (n < rows.length ? ' sur ' + rows.length : ''));
      applyBtn.disabled = !n;
      if (applyOnly) applyOnly.disabled = !n;
    }
    if (!applyBtn.lastChild || applyBtn.lastChild.nodeType !== 3) applyBtn.appendChild(ui.txt(''));
    count();
    rows.forEach(function (r) { r.check.addEventListener('change', count); });
    var confirmed = [];
    function go(andReprint) {
      var list = picked();
      var changes = list.map(function (r) { return Logic.sheetChange(r.s, confirmed); });
      fail.classList.add('hidden');
      applyBtn.classList.add('main');
      applyBtn.disabled = true;
      apply(changes, (a.defect && a.defect.name) || '', function (ok, text, result) {
        if (!ok) {
          count();
          fail.textContent = ui.fr(text);
          fail.classList.remove('hidden');
          // Refus de la dernière barrière ou d'Orca : réessayer, confirmer ce réglage, ou le montrer (comme le classique).
          foot.querySelectorAll('.refusal').forEach(function (x) { x.remove(); });
          // Fiche du projet incomplète, ou Plyo Slicer ailleurs : le bouton qui débloque (la fiche reste applicable ensuite).
          var unblock = panel.refusalActions(result, function () { go(andReprint); }, 'C’est noté. Ta fiche de réglages t’attend dans la conversation : clique sur « Appliquer ».');
          unblock.forEach(function (r) { foot.appendChild(ui.button(r.label, r.run, 'btn sm main refusal')); });
          // Un seul bouton plein : celui qui débloque, tant que la fiche ne peut pas s'appliquer.
          if (unblock.length) applyBtn.classList.remove('main');
          Logic.refusalActions(result || {}).forEach(function (r) {
            var rb = ui.button(r.label, function () {
              if (r.kind === 'show') { panel.post({ type: 'show_setting', key: r.key }); return; }
              rb.disabled = true;
              if (r.kind === 'confirm' && confirmed.indexOf(r.key) < 0) confirmed.push(r.key);
              go(andReprint);
            }, 'btn sm refusal', r.kind === 'show' ? 'eye' : null);
            foot.appendChild(rb);
          });
          return;
        }
        entry.applied = true;
        if (entry.hist) entry.hist.cards = 'applied';
        entry.data.suggestions = list.map(function (r) { return r.s; });
        save();
        rows.forEach(function (r) { if (!r.check.checked) r.row.remove(); else r.check.replaceWith(ui.icon('check', 14)); });
        sheet.querySelector('.sheet-title').textContent = ui.fr('Réglages appliqués');
        sheet.querySelectorAll('.hint').forEach(function (h) { h.remove(); });
        foot.textContent = '';
        foot.appendChild(ui.el('span', 'done-line ok', 'Appliqué'));
        var also = Logic.savedText(result);
        if (also) sheet.appendChild(ui.el('p', 'hint', also));
        var undoId = result && result.undo_id;
        if (undoId) {
          undone[undoId] = function (msg) {
            entry.applied = false;
            if (entry.hist) entry.hist.cards = 'undone';
            save();
            sheet.querySelector('.sheet-title').textContent = ui.fr('Réglages annulés');
            foot.textContent = '';
            foot.appendChild(ui.el('span', 'done-line', 'Réglages d’avant remis'));
            var kept = Logic.keptText(msg && msg.kept);
            if (kept) sheet.appendChild(ui.el('p', 'hint', kept));
          };
          var undo = ui.button('Annuler', function () { undo.disabled = true; ask({ type: 'undo', undo_id: undoId }, function (okU, t) { if (!okU) { undo.disabled = false; fail.textContent = ui.fr(t); fail.classList.remove('hidden'); } }); }, 'btn sm', 'undo');
          foot.appendChild(undo);
        }
        if (andReprint) reprintAfterFix();
      }, { data: entry.data, msg: { ask: { conv: conv() ? conv().id : '', defect: (a.defect && a.defect.key) || '' } } });
    }
    applyBtn.addEventListener('click', function () { go(resultStep); });
    if (applyOnly) applyOnly.addEventListener('click', function () { go(false); });
  }
  // Boutons d'action proposés par l'IA (ceux que la v2 sait faire ; les ordres sur la pièce sont dans v2/piece.js).
  var PIECE_KINDS = ['orient', 'arrange', 'scale_to_fit', 'open_tool', 'redesign'];
  function actionsInto(box, a, archived) {
    var list = (a.actions || []).filter(function (x) {
      return Logic.actionSupported(x) && PIECE_KINDS.indexOf(x.kind) < 0 && !(archived && (x.kind === 'open_calibration' || x.kind === 'slice' || x.kind === 'remember_success'));
    });
    if (!list.length) return;
    var row = ui.el('div', 'acts');
    list.forEach(function (x) {
      var b = ui.button(x.label, function () {
        if (x.kind === 'show' && x.target === 'preview') showPreview(b);
        else if (x.kind === 'show') panel.post({ type: 'show_me', target: x.target });
        else if (x.kind === 'show_setting') panel.post({ type: 'show_setting', key: x.target });
        else if (x.kind === 'open_calibration') confirmRawTest(x.target, row, b);
        else if (x.kind === 'remember_success') {
          b.disabled = true;
          var p = project(), s = X.sendOf(p);
          if (s) { s.marked = true; save(); }
          markAnswered();
          panel.post({ type: 'spool_success', spool: (p.filament && p.filament.spool && p.filament.spool.id) || '' });
        } else if (x.kind === 'slice') { b.disabled = true; var st = state(); st.sliceTried = ''; plateAction('slice', function (ok) { b.disabled = false; if (ok && inStep3() && step() === 'resultat') reprint(); }); }
      }, 'btn sm', x.kind === 'show' || x.kind === 'show_setting' ? 'eye' : null);
      row.appendChild(b);
    });
    box.appendChild(row);
  }
  // Test brut d'Orca : ce qui va se passer est dit avant, et rien ne part sans « Ouvrir le test ».
  function confirmRawTest(target, row, b) {
    var t = Logic.rawTestText(target);
    if (!t || (row.nextSibling && row.nextSibling.classList && row.nextSibling.classList.contains('raw-test'))) return;
    var box = noteBox('warn', 'alert', t.before, [ui.button('Ouvrir le test', function () {
      b.disabled = true;
      var c = conv(), from = c ? { id: c.id } : null;
      ask({ type: 'open_calibration', target: target }, null);
      rawFrom = from;
      box.remove();
    }, 'btn sm main'), link('Pas maintenant', function () { box.remove(); })]);
    box.classList.add('raw-test');
    row.parentNode.insertBefore(box, row.nextSibling);
  }
  var rawFrom = null;
  function onOpenCalibration(msg) {
    if (!(msg.request in waiters)) return;
    delete waiters[msg.request];
    var r = Logic.rawTestResult(msg), from = rawFrom;
    rawFrom = null;
    var acts = [];
    if (r.back && from && from.id && (!conv() || conv().id !== from.id)) acts.push({ label: 'Revenir à ma pièce', run: function () { panel.openConversation(from.id); } });
    panel.say(r.text, r.tone === 'error' ? 'error' : 'info', acts);
  }
  // Test de calibration proposé par l'IA : en secondaire quand la réponse a une fiche à appliquer (un seul bouton principal).
  function calibOfferInto(box, offer, secondary) {
    var info = X.CALIB[offer.test];
    if (!info) return;
    var b = ui.button('Lancer le test', function () { startCalib(offer.test, b); }, 'btn sm' + (secondary ? '' : ' main'), 'target');
    var n = noteBox('tip', 'target', '**' + info.name + '** · ' + info.duration + '\n' + (offer.reason || 'Ce test montre ' + info.shows + '.'), [b]);
    box.appendChild(n);
  }
  function answerExtras(entry, box, archived) {
    var a = entry.data;
    sheetInto(box, entry, archived);
    actionsInto(box, a, archived);
    if (!archived && a.calibration_offer) calibOfferInto(box, a.calibration_offer, !!(a.suggestions && a.suggestions.length));
  }
  // Suites d'une réponse neuve : journal des pièces, réponses aux questions d'intention.
  function afterAnswer(a, entry, o) {
    var c = conv(), key = a.defect && a.defect.key, part = partName();
    if (c && a.status === 'ok' && part && key && key !== 'general_question' && key !== 'unknown' && !(a.commands && a.commands.length && !a.suggestions.length)) {
      var first = o.photos && o.photos[0], ctx = (values() && values().context) || {};
      var src = first ? (first.preview || 'data:' + first.media_type + ';base64,' + first.data) : null;
      (src ? root.PlyoPhotos.scaled(src, 160, 0.7) : Promise.resolve('')).catch(function () { return ''; }).then(function (thumb) {
        panel.post({ type: 'journal_add', conv: c.id, parts: [part], printer: ctx.printer || '', filament: ctx.filament || '', problem: a.defect.name || '', defect: key, thumb: thumb });
      });
    }
    if (Array.isArray(a.intent_answers) && a.intent_answers.length && intentPending()) {
      var p = project(), r = I.mergeAnswers(X.intentAnswers(p), a.intent_answers);
      if (r.labels.length) { p.intent = Object.assign(p.intent || {}, r.answers); state().idk = false; changed(); note('J’ai noté pour ta pièce : ' + r.labels.join(', ') + '.', 'ok'); drive(); }
    }
  }
  // Fin d'impression dite dans la discussion (« elle est réussie ») : le Résultat suit, comme dans le classique.
  function printOutcome(outcome) {
    if (!conv() || !outcome || outcome === 'none') return;
    var p = project(), s = X.sendOf(p);
    var move = root.PlyoThread.outcomeMoves(step(), outcome, { success: !!p.success, failed: !!(s && s.failed) });
    if (!move.moves.length) return;
    move.moves.forEach(function (m) { if (m === 'started') started(); else if (m === 'success') success(); else if (m === 'failed') failed(); });
    note(move.text, 'ok');
  }
  function intentPending() { var c = conv(); return c && inStep3() ? X.intentPending(intentNow()) : null; }

  // ---------- « Ça a marché ? » des corrections appliquées ----------
  function resultAsks() { var p = project(), s = X.sendOf(p); return !!conv() && step() === 'resultat' && !p.success && !(s && s.failed); }
  function onOutcomePending(items) {
    var c = conv(), card2 = Logic.outcomeCard((items || []).filter(function (it) { return !outcomeAsked[it.at]; }), new Date(), c && c.id, resultAsks());
    if (!card2) return;
    outcomeAsked[card2.item.at] = true;
    var item = card2.item;
    if (card2.open) {
      var day = Logic.dayText(item.printed || item.at);
      panel.say((day ? 'Le ' + day + ', tu' : 'Tu') + ' as lancé une impression avec les réglages changés' + (item.why ? ' pour « ' + item.why + ' »' : '') + '. Ouvre son projet pour me dire si c’est réussi.', 'info',
        [{ label: 'Ouvrir le projet', primary: true, run: function () { panel.openConversation(item.conv); } }]);
      return;
    }
    var q = Logic.outcomeQuestion(item, function (id) { var p = paramOf(id); return p.label === id ? null : p; });
    // Comme la carte du classique : un mot facultatif (gardé sur l'ordinateur, jamais partagé) et la case « Partager
    // anonymement » (décochée par défaut, retenue dans les premiers pas).
    var said = ui.el('textarea', 'field');
    said.maxLength = 200;
    said.rows = 2;
    said.placeholder = ui.fr('Un mot à ajouter ? (facultatif)');
    said.setAttribute('aria-label', ui.fr('Un mot à ajouter sur le résultat (facultatif)'));
    var share = ui.el('input');
    share.type = 'checkbox';
    share.checked = !!shareOutcomes;
    share.addEventListener('change', function () { shareOutcomes = !!share.checked; panel.post({ type: 'firststeps_set', patch: { share_outcomes: shareOutcomes } }); });
    var shareLabel = ui.el('label', 'check-line');
    shareLabel.appendChild(share);
    shareLabel.appendChild(ui.el('span', '', 'Partager anonymement ce résultat pour améliorer Plyo : les noms de tes profils d’imprimante et de filament, le problème, les réglages changés et le jour ; jamais ton compte ni de photo.'));
    var box = panel.say('**' + q.title + '**\n' + q.text + (q.changes.length ? '\n' + q.changes.map(function (x) { return '- ' + x; }).join('\n') : ''), 'info', [
      { label: 'Oui, c’est réussi', run: function () { answerOutcome(item, 'ok', box, said.value.trim(), share.checked); } },
      { label: 'Non, c’est raté', run: function () { answerOutcome(item, 'bad', box, said.value.trim(), share.checked); } },
      { label: 'Pas encore imprimé', run: function () { answerOutcome(item, 'later', box, '', false); } }]);
    box.classList.add('outcome-ask');
    box.body.insertBefore(said, box.body.querySelector('.acts'));
    box.body.appendChild(shareLabel);
  }
  var outcomeAsked = {}, shareOutcomes = false;
  function answerOutcome(item, outcome, box, said, shared) {
    var word = outcome === 'later' ? '' : said || '';
    // Le mot reste sur l'ordinateur (mémoire de la machine, journal) ; il n'est jamais partagé.
    panel.post({ type: 'outcome_set', machine: item.machine, at: item.at, conv: item.conv, outcome: outcome, note: word });
    box.remove();
    if (outcome === 'later') { delete outcomeAsked[item.at]; panel.say('D’accord : je te redemanderai plus tard.'); return; }
    // Envoi discret : une réponse { ok, duplicate } (déjà reçu) comme une erreur ne changent rien pour toi.
    if (shared && panel.session()) panel.apiFetch('/api/outcomes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Logic.outcomePayload(item, outcome)) }).catch(function () {});
    if (outcome === 'ok') { note('Super ! Je m’en souviendrai pour mes prochains conseils sur cette imprimante.', 'ok'); return; }
    outcomeBad(item, word);
  }
  // « Ça n'a pas marché » : remettre les réglages d'avant là où la valeur essayée est encore en place (sans IA), les réglages
  // réussis du filament (restore_reliable, comme le classique), ou une autre piste.
  var reliableWaiter = null, reliableResult = null;
  function outcomeBad(item, word) {
    var box = panel.say('Je relis tes réglages…', 'warn');
    var status = ui.el('p', 'err hidden');
    panel.aiContext().then(function (ctx) {
      var plan = Logic.revertPlan(item, values() && values().params, ctx && ctx.snapshot ? ctx.snapshot : null);
      box.body.textContent = '';
      box.body.appendChild(ui.rich(Logic.revertText(plan)));
      var acts = ui.el('div', 'acts');
      if (plan.changes.length) {
        var back = ui.button(plan.changes.length > 1 ? 'Remettre mes anciens réglages' : 'Remettre mon ancien réglage', function () {
          back.disabled = true;
          status.classList.add('hidden');
          applyBatches(Logic.batchesOf(plan.changes), 'Retour aux réglages d’avant' + (item.why ? ' (' + item.why + ')' : ''), { revert: true }, function (ok, t, ids) {
            if (!ok) { back.disabled = false; status.textContent = ui.fr(t); status.classList.remove('hidden'); return; }
            var done = ui.el('span', 'done-line ok', 'Anciens réglages remis. La prochaine découpe en tiendra compte.');
            if (ids.length) done.appendChild(ui.button('Annuler', function () {
              undoBatches(ids, function (okU, tu) { if (!okU) { status.textContent = ui.fr(tu); status.classList.remove('hidden'); return; } done.replaceWith(ui.el('span', 'done-line', 'Réglages essayés remis.')); });
            }, 'link', 'undo'));
            back.replaceWith(done);
          });
        }, 'btn sm main', 'undo');
        acts.appendChild(back);
      }
      // Réglages réussis : ceux du filament lors de la dernière impression réussie (bobine, ou imprimante + filament).
      var reliableSlot = ui.el('div', 'reliable');
      reliableWaiter = function (info) {
        if (!info.available || !box.isConnected) return;
        reliableSlot.appendChild(ui.el('p', 'hint', Logic.reliablePreview(info)));
        if (info.count === 0) return;
        var rb = ui.button(Sp.restoreLabel(info.date), function () {
          rb.disabled = true;
          status.classList.add('hidden');
          reliableResult = function (res) {
            if (!res.ok) { rb.disabled = false; status.textContent = ui.fr(res.text || 'Je n’ai pas pu remettre ces réglages.'); status.classList.remove('hidden'); return; }
            var saved = Logic.savedText(res);
            var done = ui.el('span', 'done-line ok', (res.text || 'Réglages réussis remis.') + (saved ? ' ' + saved : ''));
            if (res.undo_id) done.appendChild(ui.button('Annuler', function () {
              ask({ type: 'undo', undo_id: res.undo_id }, function (okU, tu) { if (!okU) { status.textContent = ui.fr(tu); status.classList.remove('hidden'); return; } done.replaceWith(ui.el('span', 'done-line', 'Réglages d’avant remis.')); });
            }, 'link', 'undo'));
            rb.replaceWith(done);
          };
          panel.post({ type: 'restore_reliable' });
        }, 'btn sm', 'undo');
        reliableSlot.appendChild(rb);
      };
      panel.post({ type: 'reliable_get' });
      acts.appendChild(ui.button('Chercher une autre piste', function () { panel.prefill(Logic.retryPrompt(item, word || '')); }, 'btn sm'));
      box.body.appendChild(acts);
      box.body.appendChild(reliableSlot);
      box.body.appendChild(status);
    });
  }
  function onReliable(msg) { if (reliableWaiter) { var w = reliableWaiter; reliableWaiter = null; w(msg); } }
  function onRestoreReliable(msg) {
    var c = conv();
    // Réglages posés par l'assistant pour ce projet (comme un lot appliqué) : jamais présentés comme tes modifications.
    if (c && msg.ok && msg.undo_id && Array.isArray(msg.written) && c.project.assistant && typeof c.project.assistant === 'object') {
      c.project.assistant = Logic.noteWritten(c.project.assistant, msg.written, BATCH_TAG + ':' + msg.undo_id);
      save();
    }
    if (reliableResult) { var r = reliableResult; reliableResult = null; r(msg); }
  }
  // Lots d'une remise en arrière ou d'une réapplication, l'un après l'autre (comme postBatches du classique). `extra` : champs
  // ajoutés à chaque lot (`revert`). `done(ok, texte, identifiants)` à la fin, ou au premier refus.
  function applyBatches(batches, why, extra, done) {
    var ids = [];
    (function next(i) {
      if (i >= batches.length) { done(true, '', ids); return; }
      apply(batches[i], why, function (ok, t, res) { if (!ok) { done(false, t, ids); return; } if (res && res.undo_id) ids.push(res.undo_id); next(i + 1); }, extra ? { msg: extra } : null);
    })(0);
  }
  // « Annuler » d'une remise en plusieurs lots : le plus récent d'abord.
  function undoBatches(ids, done) {
    (function next(i) {
      if (i < 0) { done(true, ''); return; }
      ask({ type: 'undo', undo_id: ids[i] }, function (ok, t) { if (!ok) { done(false, t); return; } next(i - 1); });
    })(ids.length - 1);
  }
  function onOutcomeResult(msg) {
    var c = conv(), items = Array.isArray(msg.items) ? msg.items : [];
    if (!c || msg.conv !== c.id) return;
    if (items.length) { var s = X.sendRecord(c.project); s.corrections = items.map(function (it) { return it.at; }); save(); }
    if (msg.outcome === 'ok' && items.length) note(msg.reliable ? 'C’est noté : ces réglages ont marché. Je m’en souviendrai, et je les garde comme réglages réussis de ce filament.' : 'C’est noté : ces réglages ont marché, je m’en souviendrai pour mes prochains conseils.', 'ok');
    if (msg.outcome === 'bad' && items.length) outcomeBad(Logic.mergeCorrections(items), '');
  }

  // ---------- La carte de l'étape ----------
  V2.cards = V2.cards || {};
  V2.cards.imprimer = function (ctx) {
    if (!panel) return { title: 'Imprimer', body: null, primary: null };
    var p = project(), st = state();
    followIntent();
    if (P.nextStep(p) !== 'ready') return { title: 'Imprimer', sub: 'Termine d’abord les étapes 1 et 2.', body: null, primary: null };
    var it = step() === 'preparer' ? intentNow() : null;
    if (it && it.mode === 'ready' && !expert()) it = null; // débutant : sa réponse s'applique d'elle-même (préparation)
    if (it && it.mode === 'ready' && p.intent && p.intent.reapply) it = null;
    var sc = X.screen(p, { intent: it && it.mode !== 'auto' ? it : null, sending: !!st.sending, exported: !!st.exported, failed: st.screen === 'failed', result: st.screen === 'result', later: st.screen === 'later' });
    setTimeout(drive, 0);
    void ctx;
    shownCard = sc;
    switch (sc) {
      case 'usage': return usageCard(it);
      case 'preparing': return preparingCard();
      case 'sending': return sendingCard();
      case 'saved': return savedCard();
      case 'ready': return readyCard();
      case 'printing': return printingCard();
      case 'end': return endCard();
      case 'success': return successCard();
      case 'failed': return failedCard();
      case 'later': return laterCard();
      default: return resultCard();
    }
  };

  // ---------- Branchement sur le panneau (v2/panneau.js) ----------
  function plug(pn) {
    panel = pn;
    pn.on('tour_signals', onSignals);
    pn.on('preflight', function (msg) { onPreflight(msg.data); });
    pn.on('slice_result', onSliceResult);
    pn.on('orca_issues', onOrcaIssues);
    pn.on('plate_action', onPlateAction);
    pn.on('result', onResult);
    pn.on('manual_edits', function (msg) { var list = manualWaiters; manualWaiters = []; list.forEach(function (f) { f(msg.items || []); }); });
    pn.on('habits', function (msg) { habits = Object.assign(M.emptyHabits(), msg.habits || {}); });
    pn.on('firststeps', function (msg) { level = (msg.state || {}).level || ''; shareOutcomes = !!(msg.state || {}).share_outcomes; if (inStep3()) render(); });
    pn.on('project_reachable', function (msg) { reachable[msg.preset] = !!msg.ok; });
    // Plyo Slicer remis sur le projet (ou passé ailleurs) : la préparation reprend d'elle-même, ou attend ton choix.
    pn.on('values', function () { checkAdoptOffer(); if (inStep3()) { drive(); render(); } });
    pn.on('canvas_state', onCanvasState);
    pn.on('canvas_sent', onCanvasSent);
    pn.on('canvas_refused', function (msg) { var st = state(); st.refused = msg.text || 'La CC2 a refusé les emplacements choisis.'; stopWatch(); render(); });
    pn.on('canvas_started', function (msg) { note(msg.text || '', msg.ok ? 'ok' : 'warn'); });
    pn.on('print_started', onPrintStarted);
    pn.on('print_send_waiting', onSendWaiting);
    pn.on('print_upload', onPrintUpload);
    pn.on('print_watch', onPrintWatch);
    pn.on('printer_link_rechecked', function (msg) { var v = PF.linkRecheckView(msg, shortName()); panel.record({ kind: 'note', text: v.text, tone: v.tone === 'ok' ? 'ok' : 'warn' }); panel.tell(v.text, v.tone === 'ok' ? 'info' : 'warn'); });
    pn.on('spool_success_done', function (msg) { var st = state(); st.successNote = msg.ok && msg.name ? Sp.doneText(msg.name, msg.date) : msg.text || 'Je n’ai pas pu retenir ces réglages : je ne retrouve pas ceux de cet envoi. Ta prochaine impression réussie avec cette bobine les retiendra.'; if (inStep3()) render(); else note(st.successNote, msg.ok ? 'ok' : 'info'); });
    pn.on('spool_failure_done', function (msg) { if (msg && !msg.ok && msg.text) note(msg.text, 'info'); });
    pn.on('outcome_pending', function (msg) { onOutcomePending(msg.items); });
    pn.on('outcome_result_done', onOutcomeResult);
    pn.on('reliable', onReliable);
    pn.on('restore_reliable_result', onRestoreReliable);
    pn.on('orca_dialog', onOrcaDialog);
    pn.on('calib_started', onCalibStarted);
    pn.on('show_preview', onShowPreview);
    pn.on('open_calibration', onOpenCalibration);
    pn.on('spool_adopt_offer', onAdoptOffer);
    pn.on('spool_adopted', onSpoolAdopted);
    pn.on('spool_current', onSpoolCurrent);
    pn.on('project_restored', function (msg) { if (!msg.ok) note(msg.needs_confirmation ? 'Tu as des réglages non enregistrés dans Plyo Slicer : enregistre-les ou abandonne-les dans Plyo Slicer, puis réessaie.' : msg.text || 'Je n’ai pas pu remettre ce projet dans Plyo Slicer.', 'warn'); });
    // Photos d'un test de calibration prises au téléphone : lues pour le test, pas envoyées à l'assistant.
    pn.setPhoneRoute({ purpose: function () { return calib && calib.awaiting ? 'calibration' : 'defect'; }, take: function (sent) { if (!calib || !calib.awaiting) return false; calib.receive(sent.photos); return true; } });
    setInterval(function () { pn.post({ type: 'tour_signals' }); }, SIGNALS_MS);
    setInterval(function () { pn.post({ type: 'outcome_pending' }); }, 3 * 60 * 60 * 1000);
    pn.post({ type: 'outcome_pending' });
  }
  (V2.plugins = V2.plugins || []).push(plug);

  V2.imprimer = { answerExtras: answerExtras, afterAnswer: afterAnswer, printOutcome: printOutcome, intentPending: intentPending, state: function () { return state(); },
    // Pour le menu et les finitions (lot 5).
    calibChooser: calibChooser, startCalib: startCalib, applyBatches: applyBatches, undoBatches: undoBatches, ask: ask, issueNotice: issueNotice };
})(typeof window !== 'undefined' ? window : globalThis);
