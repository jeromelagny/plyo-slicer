// Assistant v2, lot 4 : étape 3 « Imprimer » (v2/imprimer.js), exécutée avec un DOM factice et un pont simulé
// (tests/v2-dom.mjs). Les messages envoyés au slicer sont ceux du panneau classique.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2, response, sleep, read } from './v2-dom.mjs';

const norm = (t) => String(t).replace(/[  ]/g, ' ');
const texts = (el) => norm(el.textContent);
const byText = (el, re) => el.querySelectorAll('button').find((b) => re.test(texts(b)));
const K1C = 'Creality K1C 0.4 nozzle';
const PROJECT = { part: { name: 'Petit bateau' }, printer: { preset: K1C, name: K1C },
  filament: { type: 'PLA', preset: 'Sunlu PLA blanc @K1C', spool: { id: 's1', name: 'Sunlu PLA blanc' }, nozzle_temp: 210, bed_temp: 60, temps_ok: true } };
const conversation = (patch) => ({ title: 'Petit bateau', updated: '2026-11-23T10:00:00Z', history: [], entries: [], project: Object.assign(JSON.parse(JSON.stringify(PROJECT)), patch || {}) });
const SESSION = { access_token: 'a', refresh_token: 'r', expires_at: 9999999999, email: 'a@b.fr' };
const GAUGE = { plan: 'gratuit', used_pct: 41, state: 'ok', resets_at: '2026-12-01T00:00:00Z' };

// Pont simulé : découpe (plate_action → slice_result et signaux), vérification avant impression, réglages appliqués, envoi.
function bridge(cfg = {}) {
  const S = { sliced: !!cfg.sliced, settings: { support: false, brim_type: 'no_brim', brim_width: 0, spiral_mode: false, top_shell_layers: 4, sparse_infill_density: '15%' } };
  const signals = () => ({ type: 'tour_signals', objects: 1, sliced: S.sliced, slicing: false, linked: cfg.linked !== false, time_s: S.sliced ? 3900 : 0, weight_g: S.sliced ? 41.6 : 0,
    ...(S.sliced && cfg.cost ? { cost: 0.92 } : {}), ready_for_print: true, notices: [] });
  const values = () => ({ type: 'values', locale: 'fr', context: { printer: K1C, filament: cfg.orcaFilament || 'Sunlu PLA blanc @K1C', process: '0.20mm Standard', nozzle_mm: 0.4 },
    params: [{ id: 'brim_width', key: 'brim_width', label: 'Largeur de la bordure', unit: 'mm', value: 0 }] });
  const fn = (m, emit) => {
    if (m.type === 'ready') emit(values());
    else if (m.type === 'session_load') emit({ type: 'session', session: cfg.session || null });
    else if (m.type === 'project_resume_get') emit({ type: 'project_resume', attached: 'c-1', conversation: cfg.conversation || conversation(), items: [] });
    else if (m.type === 'tour_signals') emit(signals());
    else if (m.type === 'habits_get') emit({ type: 'habits', habits: cfg.habits || {} });
    else if (m.type === 'firststeps_state') emit({ type: 'firststeps', state: { level: cfg.level || 'novice', seen: true } });
    else if (m.type === 'project_printers') emit({ type: 'project_printers', printers: [{ preset: K1C, name: K1C, linked: cfg.linked !== false, host: '192.168.1.31', slots: cfg.slots || '' }] });
    else if (m.type === 'manual_edits_get') emit({ type: 'manual_edits', items: [] });
    else if (m.type === 'ai_context') emit({ type: 'ai_context', context: {}, plate: { objects: [{ ref: '1', name: 'Petit bateau' }] } });
    else if (m.type === 'plate_action') {
      emit({ type: 'plate_action', request: m.request, kind: m.kind, ok: true, text: 'Fait.' });
      if (m.kind === 'slice' && !cfg.holdSlice) setTimeout(() => { S.sliced = true; emit({ type: 'slice_result', status: 'ok', issues: [], ready_for_print: true }); emit(signals()); }, 5);
    } else if (m.type === 'preflight') emit({ type: 'preflight', data: { sliced: S.sliced, settings: JSON.parse(JSON.stringify(S.settings)), objects: [{ name: 'Petit bateau', height: 48, contact_mm2: 20, foot: [30, 10], needs_support: true, fits: true }] } });
    else if (m.type === 'apply') {
      (m.changes || []).forEach((c) => { const k = c.id || c.key; if (k === 'support') S.settings.support = c.value; if (k === 'brim_type') S.settings.brim_type = c.value; if (k === 'brim_width') S.settings.brim_width = c.value; });
      S.sliced = false;
      emit({ type: 'result', request: m.request, ok: true, text: 'Réglages appliqués.', undo_id: 7, applied: [] });
    } else if (m.type === 'print_start') {
      if (m.export) { emit({ type: 'print_started', ok: true, export: true, file: 'petit-bateau.gcode' }); return; }
      S.watch = m.watch_id;
      emit({ type: 'print_started', ok: true, route: 'host' });
    } else if (m.type === 'canvas_read') emit(Object.assign({ type: 'canvas_state', preset: m.preset, id: m.id, send: !!m.send }, cfg.canvas || { ok: false }));
    else if (m.type === 'calib_start') emit({ type: 'calib_started', request: m.request, test: m.test, pass: 1, instructions: 'Imprime-la.', sections: [{ index: 0, label: '215 °C', value: 215 }, { index: 1, label: '210 °C', value: 210 }] });
    else if (m.type === 'calib_save') emit({ type: 'result', request: m.request, ok: true, text: '210 °C gardé pour ta bobine.' });
    else if (m.type === 'spool_success') emit({ type: 'spool_success_done', ok: true, name: 'Sunlu PLA blanc', date: '2026-11-23' });
    else if (m.type === 'explain') emit({ type: 'explain', key: m.key, label: 'Rétraction', value: 0.8, unit: 'mm', min: 0, max: 5 });
  };
  fn.S = S;
  return fn;
}
const DIAG = { type: 'final', status: 'ok', confidence: 'high', defect: { key: 'warping', name: 'Ta pièce s’est décollée du plateau', explanation: 'Les coins refroidissent trop vite.' },
  message: 'Nettoie le plateau.', suggestions: [{ id: 'brim_width', value: 8, delta: null, reason: 'Une bordure plus large.' }], questions: [], actions: [{ kind: 'show_setting', target: 'brim_width', label: 'Montre-moi la bordure' }],
  calibration_offer: { test: 'temperature', reason: 'Pour trouver la bonne température.' }, credits: { charged: 1, gauge: GAUGE } };
function service() {
  return async (url) => {
    if (url.endsWith('/api/me')) return response(200, { gauge: GAUGE });
    if (url.endsWith('/api/diagnose')) return response(200, null, { lines: [DIAG] });
    return response(404, {});
  };
}
const start = async (cfg = {}) => { const b = bridge(cfg); const p = loadV2({ bridge: b, fetch: service() }); p.S = b.S; await sleep(60); return p; };
const sent = (p, type) => p.posted.filter((m) => m.type === type);
const card = (p) => p.$('stepcard');

test('lot 4 : une question d’usage (réponse suggérée), puis la préparation se fait d’elle-même jusqu’à « Tout est prêt »', async () => {
  const p = await start({ holdSlice: true });
  try {
    assert.match(texts(card(p)), /Étape 3 sur 3.*À quoi va servir ta pièce \?/);
    const cards = card(p).querySelectorAll('.card');
    assert.equal(cards.length, 5);
    assert.match(texts(cards[2]), /M’en servir tous les jours.*Suggéré/, 'sans indice dans le nom : la réponse la plus sûre');
    assert.equal(card(p).querySelectorAll('.badge').length, 1);
    assert.ok(byText(card(p), /Je ne sais pas : choisis pour moi/));
    byText(card(p), /M’en servir tous les jours/).click();
    await sleep(40);
    const apply = sent(p, 'apply')[0];
    assert.ok(apply, 'réglages de l’usage appliqués, comme le classique');
    assert.match(apply.why, /^Intention : Pour un objet du quotidien, équilibrée, sans te presser/);
    assert.ok(apply.changes.every((c) => c.confirmed), 'valeurs de la table du panneau, confirmées');
    assert.ok(sent(p, 'plate_action').some((m) => m.kind === 'slice'), 'découpe lancée');
    assert.match(texts(card(p)), /Je prépare ton impression….*Je règle Plyo Slicer pour « Objet du quotidien ».*Je découpe la pièce en couches.*Je vérifie que tout va bien se passer/);
    const conv = p.ctx.PlyoV2.panel.conv();
    assert.equal(conv.project.intent.applied, true);
  } finally { p.stop(); }
});

test('lot 4 : « Tout est prêt » : supports et bordure ajoutés d’office, Retirer / Remettre, coût seulement avec un prix, « Ajuster »', async () => {
  for (const cost of [true, false]) {
    const p = await start({ cost, conversation: conversation({ intent: { use: 'daily', pref: 'balanced', speed: 'normal', applied: true, for: K1C + '|Sunlu PLA blanc @K1C' } }) });
    try {
      await sleep(80);
      const t = texts(card(p));
      assert.match(t, /Tout est prêt/);
      assert.match(t, /1 h 05.*d’impression.*42 g.*de PLA/);
      assert.equal(/€/.test(t), cost, cost ? 'coût du préréglage filament' : 'sans prix : case masquée');
      assert.match(t, /Elle tient sur le plateau de Creality K1C.*J’ai ajouté des supports.*Retirer.*J’ai ajouté une bordure.*Retirer.*Températures de ta bobine.*210 °C \/ 60 °C.*Montre-moi/);
      const fix = sent(p, 'apply').find((m) => m.why === 'Vérification avant impression');
      assert.deepEqual(fix.changes.map((c) => c.id), ['support', 'brim_type', 'brim_width'], 'les corrections conseillées, en un seul lot');
      assert.match(t, /Réglages : Objet du quotidien.*Équilibrée · Normal.*Ajuster/);
      assert.equal(texts(p.$('card-primary')), 'Lancer l’impression sur Creality K1C');
      assert.doesNotMatch(t, /crédit|token/i);
      if (!cost) continue;
      // « Montre-moi » ouvre le réglage dans Orca ; « Retirer » la bordure : réglage appliqué, plaque redécoupée, « Remettre ».
      byText(card(p), /^Montre-moi$/).click();
      assert.deepEqual(p.posted.at(-1), { type: 'show_setting', key: 'nozzle_temperature' });
      card(p).querySelectorAll('li').find((li) => /bordure/.test(texts(li))).querySelector('button').click();
      await sleep(80);
      assert.deepEqual(sent(p, 'apply').at(-1).changes, [{ id: 'brim_type', value: 'no_brim' }]);
      assert.match(texts(card(p)), /Pas de bordure.*Remettre/);
      // « Ajuster » : un autre usage réapplique les réglages et redécoupe.
      byText(card(p), /^Ajuster$/).click();
      byText(card(p), /^Pièce qui force$/).click();
      await sleep(80);
      assert.match(sent(p, 'apply').filter((m) => /^Intention/.test(m.why)).at(-1).why, /pièce qui force/);
      assert.match(texts(card(p)), /Réglages : Pièce qui force/);
    } finally { p.stop(); }
  }
});

test('lot 4 : envoi (print_start avec suivi), transfert, démarrage vérifié, fin lue, Réussi : bobine retenue et journal', async () => {
  const p = await start({ sliced: true, conversation: conversation({ step: 'print', intent: { skipped: true } }) });
  try {
    await sleep(60);
    p.$('card-primary').click();
    await sleep(20);
    const ps = sent(p, 'print_start')[0];
    assert.equal(ps.export, false);
    assert.equal(ps.preset, K1C);
    assert.ok(ps.watch_id, 'l’envoi est suivi');
    assert.match(texts(card(p)), /Impression.*J’envoie le fichier à Creality K1C/);
    p.emit({ type: 'print_upload', phase: 'progress', percent: 45 });
    assert.match(texts(card(p)), /45 %/);
    p.emit({ type: 'print_upload', phase: 'arrived' });
    await sleep(10);
    const conv = p.ctx.PlyoV2.panel.conv();
    assert.equal(conv.project.step, 'after');
    assert.equal(conv.project.send.watch, ps.watch_id);
    assert.ok(sent(p, 'outcome_printed').length && sent(p, 'journal_add').length, 'impression lancée : corrections et journal');
    assert.match(texts(card(p)), /Impression en cours.*Creality K1C imprime Petit bateau.*Ça a l’air de mal se passer/);
    p.emit({ type: 'print_watch', id: 'autre', verdict: 'started' });
    assert.doesNotMatch(texts(card(p)), /a démarré/, 'un autre envoi est ignoré');
    p.emit({ type: 'print_watch', id: ps.watch_id, verdict: 'started', file: 'petit-bateau.gcode' });
    assert.match(texts(card(p)), /Creality K1C a démarré l’impression/);
    // « Ça a l’air de mal se passer » : les symptômes, « Retour » revient au suivi.
    byText(card(p), /mal se passer/).click();
    assert.match(texts(card(p)), /Qu’est-ce qui ne va pas \?/);
    assert.ok(p.$('card-primary').disabled, 'il faut choisir ce qui ressemble');
    byText(card(p), /^Retour$/).click();
    assert.match(texts(card(p)), /Impression en cours/);
    p.emit({ type: 'print_watch', id: ps.watch_id, phase: 'end', verdict: 'finished', file: 'petit-bateau.gcode' });
    assert.match(texts(card(p)), /Résultat.*C’est fini ! Alors, c’est réussi \?.*Creality K1C a fini d’imprimer « petit-bateau\.gcode ».*Réussi.*Raté.*Je montre/);
    byText(card(p), /Réussi/).click();
    await sleep(20);
    assert.deepEqual(sent(p, 'spool_success')[0], { type: 'spool_success', spool: 's1', change_of_mind: false });
    assert.equal(sent(p, 'outcome_result')[0].outcome, 'ok');
    assert.equal(sent(p, 'journal_add').at(-1).outcome, 'ok');
    assert.equal(conv.project.success, true);
    assert.match(texts(card(p)), /Bravo !.*Belle impression !.*Sunlu PLA blanc.*Imprimer une autre pièce.*Réimprimer la même.*Améliorer ma bobine/);
    // Calibration proposée : le test posé, choisi, gardé.
    byText(card(p), /Améliorer ma bobine/).click();
    byText(card(p), /Test de débit/).click();
    await sleep(20);
    assert.equal(sent(p, 'calib_start')[0].test, 'flow');
    const cal = p.$('msgs').querySelector('.calib');
    assert.match(texts(cal), /Test de débit — passe 1 sur 2.*215 °C.*210 °C.*Remettre ma pièce/);
  } finally { p.stop(); }
});

test('lot 4 : fin arrêtée ou en erreur : la question formulée selon l’état, comme le classique', async () => {
  const p = await start({ sliced: true, conversation: conversation({ step: 'after', send: { spool: { id: 's1', name: 'Sunlu PLA blanc' }, watch: 'w1', answered: false, end: { verdict: 'cancelled', file: 'b.gcode' }, outcome: '' } }) });
  try {
    assert.match(texts(card(p)), /Impression arrêtée.*a été arrêtée sur Creality K1C.*Ça se décollait du plateau.*J’ai changé d’avis/);
    byText(card(p), /Ça se décollait/).click();
    await sleep(10);
    assert.equal(sent(p, 'spool_failure')[0].spool, 's1', 'raté : la bobine le retient');
    // Audit des parcours : la carte « Qu'est-ce qui ne va pas ? » reprend la raison (symptôme coché) ; on reste sur l'étape.
    assert.equal(p.$('note').value, '', 'rien d’écrit à ta place dans la discussion');
    assert.match(texts(card(p)), /Qu’est-ce qui ne va pas/);
    assert.ok(card(p).querySelectorAll('.card.sel').some((c) => /Elle se décolle du plateau/.test(texts(c))), 'symptôme coché');
  } finally { p.stop(); }
});

test('lot 4 : Raté, symptôme, diagnostic de l’IA, « Appliquer et réimprimer » ; test de calibration proposé', async () => {
  const p = await start({ sliced: true, session: SESSION, conversation: conversation({ step: 'after', intent: { skipped: true }, send: { spool: { id: 's1', name: 'Sunlu PLA blanc' }, watch: 'w1', answered: false, end: { verdict: 'finished', file: 'b.gcode' }, outcome: '' } }) });
  try {
    byText(card(p), /Raté/).click();
    await sleep(10);
    assert.equal(sent(p, 'outcome_result')[0].outcome, 'bad');
    byText(card(p), /Montrer une photo/).click();
    assert.match(texts(card(p)), /Avec mon téléphone.*Depuis l’ordinateur/);
    byText(card(p), /Elle se décolle du plateau/).click();
    p.$('card-primary').click();
    await sleep(80);
    const diag = p.calls.find((c) => c.url.endsWith('/api/diagnose'));
    assert.match(JSON.parse(diag.init.body).note, /est ratée : elle se décolle du plateau/);
    const ai = p.$('msgs').querySelectorAll('.msg.ai').at(-1);
    assert.match(texts(ai), /Ta pièce s’est décollée du plateau.*Largeur de la bordure.*0 mm → 8 mm.*Appliquer et réimprimer.*Appliquer sans réimprimer.*Ignorer.*Montre-moi la bordure.*Tour de température.*Lancer le test/);
    assert.match(texts(card(p)), /Je t’ai répondu dans la discussion/);
    byText(ai, /Montre-moi la bordure/).click();
    assert.deepEqual(p.posted.at(-1), { type: 'show_setting', key: 'brim_width' });
    byText(ai, /Appliquer et réimprimer/).click();
    await sleep(80);
    const ap = sent(p, 'apply').find((m) => m.ask);
    assert.deepEqual(ap.ask, { conv: p.ctx.PlyoV2.panel.conv().id, defect: 'warping' });
    assert.deepEqual(ap.changes.map((c) => c.id), ['brim_width']);
    assert.match(texts(ai), /Réglages appliqués.*Appliqué.*Annuler/);
    const conv = p.ctx.PlyoV2.panel.conv();
    assert.equal(conv.entries.find((e) => e.kind === 'answer').applied, true);
    assert.ok(['slice', 'print'].includes(conv.project.step), 'la prochaine impression se prépare');
    byText(ai, /^Annuler$/).click();
    assert.deepEqual(sent(p, 'undo').at(-1).undo_id, 7);
  } finally { p.stop(); }
});

test('lot 4 : clé USB (export), confirmé (trois questions), fiche gratuite, relecture des emplacements avant l’envoi', async () => {
  let p = await start({ linked: false, sliced: true, conversation: conversation({ step: 'print', intent: { skipped: true } }) });
  try {
    await sleep(40);
    assert.equal(texts(p.$('card-primary')), 'Enregistrer pour la clé USB');
    p.$('card-primary').click();
    await sleep(20);
    assert.equal(sent(p, 'print_start')[0].export, true);
    assert.match(texts(card(p)), /Fichier enregistré.*petit-bateau\.gcode.*Retire la clé.*Compris, j’ai lancé l’impression/);
    p.$('card-primary').click();
    await sleep(10);
    assert.equal(p.ctx.PlyoV2.panel.conv().project.step, 'after');
    assert.match(texts(card(p)), /Bonne impression !.*Sunlu PLA blanc.*Réussi.*Raté/);
  } finally { p.stop(); }

  p = await start({ level: 'expert', holdSlice: true });
  try {
    byText(card(p), /M’en servir tous les jours/).click();
    assert.match(texts(card(p)), /Pour aller plus loin.*Elle doit surtout être….*Équilibrée.*Tu es pressé \?/);
    assert.ok(p.$('card-primary').disabled);
    byText(card(p), /^Robuste$/).click();
    byText(card(p), /^Soigné$/).click();
    assert.equal(p.$('card-primary').disabled, false);
    p.$('card-primary').click();
    await sleep(30);
    assert.match(sent(p, 'apply')[0].why, /robuste, avec soin/);
    // « C’est quoi la rétraction ? » : la fiche répond, gratuitement, sans appel au service.
    p.$('note').value = 'C’est quoi la rétraction ?';
    p.$('c-send').click();
    await sleep(20);
    assert.ok(sent(p, 'explain').length);
    assert.ok(!p.calls.some((c) => c.url.endsWith('/api/diagnose')));
    const f = p.$('msgs').querySelector('.fiche');
    assert.match(texts(f), /explication gratuite.*Longueur de rétraction.*À quoi ça sert.*Valeur : 0,8 mm.*Montre-moi où il est/);
    assert.equal(p.ctx.PlyoV2.panel.conv().entries.at(-1).kind, 'fiche');
  } finally { p.stop(); }

  const CFS = { ok: true, system: 'cfs', imposable: true, validated: true, empty_blocks: true, colours: [{ t: 0, color: '#FFFFFF', type: 'PLA' }],
    canvases: [{ canvas_id: 0, connected: true, trays: [{ tray_id: 0, type: 'PLA', color: '#F4F4F4', status: 1, label: '1A' }] }] };
  p = await start({ sliced: true, slots: 'cfs', canvas: CFS, conversation: conversation({ step: 'print', intent: { skipped: true }, canvas: [{ t: 0, canvas_id: 0, tray_id: 0, type: 'PLA', color: '#F4F4F4', preset: 'Sunlu PLA blanc @K1C', label: '1A', system: 'cfs' }] }) });
  try {
    await sleep(40);
    assert.match(texts(card(p)), /Changer les emplacements/);
    p.$('card-primary').click();
    await sleep(30);
    const read2 = sent(p, 'canvas_read').find((m) => m.send);
    assert.ok(read2, 'les emplacements sont relus avant l’envoi');
    assert.ok(sent(p, 'print_start').length + sent(p, 'canvas_send').length === 1, 'puis l’envoi part');
  } finally { p.stop(); }
});

test('lot 4 : page et inclusions (modules partagés, aucun HTML ni gestionnaire en ligne)', () => {
  const page = read('v2/index.html'), js = read('v2/imprimer.js');
  for (const m of ['imprimer-logic.js', 'intent-logic.js', 'preflight.js', 'retouches-logic.js', 'fiches.js', 'v2/imprimer.js']) assert.ok(page.includes('<!--plyo-include:' + m + '-->'), m);
  assert.ok(page.indexOf('<!--plyo-include:v2/imprimer.js-->') < page.indexOf('<!--plyo-include:v2/panneau.js-->'));
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|onclick=|eval\(/);
  for (const t of ['print_start', 'print_watch_start', 'print_watch_replay', 'print_declared', 'outcome_printed', 'outcome_result', 'spool_success', 'spool_failure', 'journal_add', 'calib_start', 'calib_save', 'calib_restore', 'preflight', 'orca_issues', 'canvas_send', 'spool_adopt_check', 'project_restore', 'show_preview', 'open_calibration'])
    assert.ok(js.includes("'" + t + "'"), t);
});
