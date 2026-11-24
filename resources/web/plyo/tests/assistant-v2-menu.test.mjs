// Assistant v2, lot 5 : menu, fenêtres (v2/menu.js, v2/fenetres.js) et finitions (v2/finitions.js, reprises dans panneau.js et
// imprimer.js), exécutés avec un DOM factice et un pont simulé (tests/v2-dom.mjs). Mêmes messages que le panneau classique.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2, response, sleep, read } from './v2-dom.mjs';

const norm = (t) => String(t).replace(/[\u00a0\u202f]/g, ' ');
const texts = (el) => norm(el.textContent);
const byText = (el, re) => el.querySelectorAll('button').find((b) => re.test(texts(b)));
const K1C = 'Creality K1C 0.4 nozzle';
const PROJECT = { part: { name: 'Petit bateau' }, printer: { preset: K1C, name: K1C },
  filament: { type: 'PLA', preset: 'Sunlu PLA blanc @K1C', spool: { id: 's1', name: 'Sunlu PLA blanc' }, nozzle_temp: 210, bed_temp: 60, temps_ok: true } };
const conversation = (patch) => ({ title: 'Petit bateau', updated: '2026-11-23T10:00:00Z', history: [], entries: [], project: Object.assign(JSON.parse(JSON.stringify(PROJECT)), patch || {}) });
const SESSION = { access_token: 'a', refresh_token: 'r', expires_at: 9999999999, email: 'a@b.fr' };
const gauge = (pct, state) => ({ plan: 'gratuit', used_pct: pct, state: state || 'ok', resets_at: '2026-12-01T00:00:00Z' });
const CONVS = [{ id: 'c-1', title: 'Petit bateau', updated: '2026-11-23T10:00:00Z', project: { part: { name: 'Petit bateau' } } },
  { id: 'c-2', title: 'Crochet mural', updated: '2026-11-22T10:00:00Z', project: { part: { name: 'Crochet mural' }, step: 'done', success: true } },
  { id: 'c-3', title: 'Pourquoi des fils ?', updated: '2026-11-20T10:00:00Z', project: {} }];

function bridge(cfg = {}) {
  let convs = CONVS.slice();
  const values = () => ({ type: 'values', locale: 'fr', can_undo: !!cfg.canUndo, context: { printer: K1C, filament: 'Sunlu PLA blanc @K1C', process: '0.20mm Standard', nozzle_mm: 0.4 },
    params: [{ id: 'nozzle_temp', key: 'nozzle_temperature', label: 'Température de la buse', unit: '°C', value: 210 }] });
  return (m, emit) => {
    if (m.type === 'ready') { emit({ type: 'dictation', available: true, platform: 'mac' }); emit(values()); }
    else if (m.type === 'session_load') emit({ type: 'session', session: cfg.session || null });
    else if (m.type === 'project_resume_get') emit({ type: 'project_resume', attached: 'c-1', conversation: cfg.conversation || conversation({ step: 'print' }), items: [] });
    else if (m.type === 'tour_signals') emit({ type: 'tour_signals', objects: 1, sliced: false, slicing: false, linked: true, notices: cfg.notices || [] });
    else if (m.type === 'habits_get') emit({ type: 'habits', habits: cfg.habits || {} });
    else if (m.type === 'firststeps_state') emit({ type: 'firststeps', state: Object.assign({ level: 'novice', seen: true, greeted: true }, cfg.fs || {}) });
    else if (m.type === 'conv_list') emit({ type: 'conv_list', items: convs });
    else if (m.type === 'conv_delete') { convs = convs.filter((c) => c.id !== m.id); emit({ type: 'conv_list', items: convs }); }
    else if (m.type === 'journal_list') emit({ type: 'journal', projects: ['c-2'], events: [{ at: '2026-11-22T10:00:00Z', conv: 'c-2', parts: ['Crochet mural'], printer: K1C, filament: 'Sunlu PLA blanc @K1C', outcome: 'ok',
      changes: [{ key: 'nozzle_temperature', label: 'Température de la buse', before: 220, after: 210 }] }] });
    else if (m.type === 'spools_get') emit({ type: 'spools', items: [{ id: 's1', name: 'Sunlu PLA blanc', material: 'PLA', colour: '#F4F4F4', last_ok_at: '2026-11-22T10:00:00Z' }] });
    else if (m.type === 'project_printers') emit({ type: 'project_printers', printers: [{ preset: K1C, name: K1C, linked: true }, { preset: 'Ender 0.4 nozzle', name: 'Ender 0.4 nozzle', linked: false }] });
    else if (m.type === 'undo') emit({ type: 'result', request: m.request, ok: true, text: m.undo_id ? 'Annulé.' : 'Réglages d’avant remis : Lissage.', undone_id: m.undo_id });
    else if (m.type === 'apply') emit({ type: 'result', request: m.request, ok: true, text: 'Réglages appliqués.', undo_id: 9, applied: [{ id: 'nozzle_temp' }] });
    else if (m.type === 'orca_issues') emit({ type: 'orca_issues', purpose: m.purpose, issues: cfg.issues || [] });
    else if (m.type === 'outcome_pending') setTimeout(() => emit({ type: 'outcome_pending', items: cfg.outcome ? [cfg.outcome] : [] }), 30); // après la reprise du projet
    else if (m.type === 'ai_context') emit({ type: 'ai_context', snapshot: {}, plate: { objects: [] } });
    else if (m.type === 'reliable_get') emit({ type: 'reliable', available: true, count: 2, date: '2026-11-22', summary: 'Température de la buse 210 °C' });
    else if (m.type === 'restore_reliable') emit({ type: 'restore_reliable_result', ok: true, undo_id: 12, text: 'Réglages réussis remis.', written: [] });
    else if (m.type === 'retouches_get' && cfg.retouches) emit({ type: 'print_retouches', pending: { preset: '0.20mm Standard', project: 'Crochet mural', changes: [{ key: 'wall_loops', label: 'Parois', before: 2, after: 3 }] } });
    else if (m.type === 'retouches_keep') emit({ type: 'print_retouches_kept', ok: true, text: 'Retouches gardées dans « 0.20mm Standard ».' });
    else if (m.type === 'project_open') emit({ type: 'project_opened', conv: m.conv, reason: cfg.openReason === 'occupe' && !cfg.opened ? (cfg.opened = 1, 'occupe') : '' });
  };
}
function service(cfg = {}) {
  return async (url, init) => {
    if (url.endsWith('/api/me')) return response(200, { gauge: cfg.gauge || gauge(41), email: 'a@b.fr' });
    if (url.endsWith('/api/me/credits')) return response(200, { gauge: cfg.gauge || gauge(41) });
    if (url.endsWith('/api/feedback')) return response(200, { ok: true });
    if (url.endsWith('/api/outcomes')) return response(200, { ok: true });
    if (url.endsWith('/api/diagnose')) return cfg.error ? response(cfg.error.status, cfg.error.body) : response(200, null, { lines: [cfg.answer] });
    void init;
    return response(404, {});
  };
}
const start = async (cfg = {}) => { const p = loadV2({ bridge: bridge(cfg), fetch: service(cfg) }); await sleep(60); return p; };
const sent = (p, type) => p.posted.filter((m) => m.type === type);
const menuItem = (p, re) => { p.$('btn-more').click(); const b = byText(p.$('menu'), re); assert.ok(b, 'entrée du menu ' + re); return b; };
const win = (p) => p.$('fenetre');

test('lot 5 : le menu complet de la v2 (groupes de la maquette), « Revenir à l’ancien assistant » en dernier', async () => {
  const p = await start({ session: SESSION });
  try {
    await sleep(30);
    p.$('btn-more').click();
    const t = texts(p.$('menu'));
    for (const label of ['Projet', 'Nouveau projet', 'Annuler les derniers réglages de l’assistant', 'Mes affaires', 'Mes projets', 'Mes pièces', 'Mes machines', 'Mes bobines',
      'Améliorer ma bobine', 'Journal des impressions', 'Préférences', 'Réponses courtes', 'Disposition simple', 'Me guider pas à pas', 'Compte', 'a@b.fr', 'Mon utilisation',
      'Me déconnecter', 'Aide', 'Revenir à l’ancien assistant']) assert.ok(t.includes(label), label);
    assert.ok(t.indexOf('Aide') < t.indexOf('Revenir à l’ancien assistant'));
    // Rien à annuler : l'entrée reste visible, grisée (comme le classique).
    assert.equal(byText(p.$('menu'), /Annuler les derniers/).disabled, true);
    assert.equal(p.$('c-mic').classList.contains('hidden'), false, 'micro visible quand la dictée est disponible');
  } finally { p.stop(); }
});

test('lot 5 : Nouveau projet, Annuler les derniers réglages, préférences (réponses courtes, disposition simple, me guider pas à pas)', async () => {
  const p = await start({ session: SESSION, canUndo: true });
  try {
    await sleep(30);
    menuItem(p, /Annuler les derniers/).click();
    await sleep(20);
    assert.equal(sent(p, 'undo').at(-1).undo_id, undefined, 'le dernier lot, comme le classique');
    assert.match(texts(p.$('msgs')), /Réglages d’avant remis : Lissage\./);
    menuItem(p, /Réponses courtes/).click();
    assert.equal(sent(p, 'habits_set').at(-1).habits.level, 'short');
    assert.match(texts(p.$('msgs')), /courte et technique/);
    menuItem(p, /Disposition simple/).click();
    assert.deepEqual(sent(p, 'firststeps_set').at(-1).patch, { layout: 'simple', layout_chosen: true });
    menuItem(p, /Me guider pas à pas/).click();
    assert.deepEqual(sent(p, 'firststeps_set').at(-1).patch, { level: 'expert', greeted: true });
    p.$('btn-more').click();
    assert.equal(byText(p.$('menu'), /Réponses courtes/).getAttribute('aria-checked'), 'true');
    assert.equal(byText(p.$('menu'), /Me guider/).getAttribute('aria-checked'), 'false');
    byText(p.$('menu'), /Nouveau projet/).click();
    assert.ok(sent(p, 'project_detach').length > 0);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'piece');
  } finally { p.stop(); }
});

test('lot 5 : Mes projets (rouvrir, supprimer après confirmation), Mes pièces, Journal (réappliquer), Mes bobines, Mes machines, Améliorer ma bobine, Aide', async () => {
  const p = await start({ session: SESSION });
  try {
    await sleep(30);
    menuItem(p, /Mes projets/).click();
    await sleep(20);
    assert.match(texts(win(p)), /Crochet mural/);
    assert.match(texts(win(p)), /Pourquoi des fils/);
    const row = win(p).querySelectorAll('.li').find((l) => /Pourquoi des fils/.test(texts(l)));
    row.querySelector('.iconbtn').click();
    assert.match(texts(row), /Supprimer/);
    byText(row, /^Supprimer$/).click();
    await sleep(20);
    assert.equal(sent(p, 'conv_delete').at(-1).id, 'c-3');
    assert.doesNotMatch(texts(win(p)), /Pourquoi des fils/);
    byText(win(p).querySelectorAll('.li').find((l) => /Crochet/.test(texts(l))), /Rouvrir/).click();
    assert.equal(sent(p, 'conv_load').at(-1).id, 'c-2');
    assert.equal(win(p), null, 'la fenêtre se ferme');

    menuItem(p, /Mes pièces/).click();
    await sleep(20);
    assert.match(texts(win(p)), /Crochet mural/);
    assert.doesNotMatch(texts(win(p)), /Pourquoi des fils/, 'seulement les projets qui ont une pièce');

    menuItem(p, /Journal/).click();
    await sleep(20);
    assert.match(texts(win(p)), /Crochet mural/);
    byText(win(p), /Réappliquer/).click();
    await sleep(30);
    assert.equal(sent(p, 'apply').at(-1).why, 'Journal : Crochet mural');
    assert.match(texts(p.$('msgs')), /Réglages de « Crochet mural » réappliqués\./);

    menuItem(p, /Mes bobines/).click();
    await sleep(20);
    assert.equal(sent(p, 'spools_get').at(-1).printer, K1C);
    assert.match(texts(win(p)), /Sunlu PLA blanc/);
    byText(win(p), /Améliorer/).click();
    assert.match(texts(win(p)), /Améliorer ma bobine/);
    assert.match(texts(win(p)), /Tour de température|température/i);

    menuItem(p, /Mes machines/).click();
    await sleep(20);
    assert.match(texts(win(p)), /Ender/);
    byText(win(p), /Retirer de la liste/).click();
    assert.ok(sent(p, 'habits_set').at(-1).habits.hidden.length === 1);
    byText(win(p), /Tester la liaison/).click();
    assert.ok(sent(p, 'printer_link_recheck').length);
    byText(win(p), /Relier/).click();
    assert.ok(sent(p, 'printer_link_dialog_current').length);

    menuItem(p, /^Aide$/).click();
    assert.match(texts(win(p)), /Une IA qui te guide/);
    assert.match(texts(win(p)), /Signaler/);
    // Audit du 24/11 : les rubriques d'aide (premiers pas, pendant l'impression, si ça rate, annuler un changement, glossaire).
    assert.match(texts(win(p)), /Premiers pas.*Pendant l’impression.*Si ça rate.*Annuler un changement.*Glossaire.*Bordure/);
  } finally { p.stop(); }
});

test('lot 5 : jauge en pourcentage, « Mon utilisation » au clic, « Les formules » (seul endroit où paraît « environ N questions »)', async () => {
  const p = await start({ session: SESSION });
  try {
    await sleep(40);
    // Audit du 24/11 : la jauge dit ce qu'il reste (41 % utilisés → 59 % restants).
    assert.match(texts(p.$('gauge')), /IA restante.*59 %/);
    p.$('gauge').click();
    await sleep(20);
    assert.match(texts(win(p)), /Mon utilisation/);
    assert.match(texts(win(p)), /IA restante.*59 %.*te restent ce mois-ci/);
    assert.doesNotMatch(texts(win(p)), /questions|crédit|token/i, 'pas de nombre de questions dans « Mon utilisation »');
    byText(win(p), /Voir les formules/).click();
    assert.match(texts(win(p)), /Les formules arrivent/);
    assert.match(texts(win(p)), /environ 100 questions ou 40 photos par mois, Pro à environ 330 questions ou 130 photos/);
    assert.doesNotMatch(texts(win(p)), /€|\$/);
    p.ctx.PlyoV2.fenetre.close();
    assert.doesNotMatch(texts(p.document.body), /environ \d+ questions/);
  } finally { p.stop(); }
});

test('lot 5 : bloc des formules repris tel quel du classique ; plan_required garde sa logique et ouvre les formules', async () => {
  const classic = read('index.html'), v2 = read('v2/menu.js');
  for (const t of ['Plyo+ correspond à environ 100 questions ou 40 photos par mois, Pro à environ 330 questions ou 130 photos.', 'Le slicer, l’onglet Étapes et l’envoi à l’imprimante ne touchent jamais la jauge.'])
    assert.ok(classic.includes(t) && v2.includes(t), t);
  const p = await start({ session: SESSION, error: { status: 403, body: { error: 'plan_required', plan: 'plus' } } });
  try {
    await sleep(30);
    p.$('note').value = 'Voici mes trois photos';
    p.$('c-send').click();
    await sleep(60);
    assert.match(texts(p.$('msgs')), /Plusieurs photos dans une même demande font partie de Plyo\+/);
    byText(p.$('msgs'), /Voir les formules/).click();
    assert.match(texts(win(p)), /Les formules/);
  } finally { p.stop(); }
});

test('lot 5 : message doux de la jauge vers 80 %, une fois ; « Signaler » sous la réponse envoie /api/feedback', async () => {
  const answer = { type: 'final', status: 'ok', defect: { key: 'stringing', name: 'Des fils' }, message: 'Baisse la température.', suggestions: [], questions: [], actions: [], credits: { charged: 1, gauge: gauge(81, 'low') } };
  const p = await start({ session: SESSION, answer, gauge: gauge(60) });
  try {
    await sleep(40);
    p.$('note').value = 'Des fils entre les tours';
    p.$('c-send').click();
    await sleep(80);
    const t = texts(p.$('msgs'));
    assert.match(t, /Il te reste 19 % d’IA ce mois-ci/);
    byText(p.$('msgs'), /^Signaler$/).click();
    p.$('msgs').querySelector('.feedback').querySelector('textarea').value = 'Faux';
    byText(p.$('msgs'), /Envoyer le signalement/).click();
    await sleep(30);
    const call = p.calls.find((c) => c.url.endsWith('/api/feedback'));
    const body = JSON.parse(call.init.body);
    assert.equal(body.verdict, 'bad');
    assert.equal(body.comment, 'Faux');
    assert.equal(body.question, 'Des fils entre les tours');
    assert.match(texts(p.$('msgs')), /Merci, c’est noté/);
    assert.equal(p.ctx.PlyoV2.panel.conv().entries.find((e) => e.kind === 'answer').flagged, true);
  } finally { p.stop(); }
});

test('lot 5 : « Ça a marché ? » avec le mot facultatif et le partage anonyme ; « Ça n’a pas marché » propose les réglages réussis (restore_reliable)', async () => {
  const outcome = { machine: K1C, at: '2026-11-20T10:00:00Z', printed: '2026-11-20T11:00:00Z', conv: 'c-1', why: 'des fils', changes: [{ id: 'nozzle_temp', before: 220, after: 210 }] };
  const p = await start({ session: SESSION, outcome });
  try {
    await sleep(40);
    const box = p.$('msgs').querySelector('.outcome-ask');
    assert.ok(box, 'question posée');
    box.querySelector('textarea').value = 'encore des fils';
    const share = box.querySelector('input');
    share.checked = true;
    share.dispatch('change');
    assert.deepEqual(sent(p, 'firststeps_set').at(-1).patch, { share_outcomes: true });
    byText(box, /Non, c’est raté/).click();
    await sleep(40);
    const set = sent(p, 'outcome_set').at(-1);
    assert.deepEqual([set.outcome, set.note], ['bad', 'encore des fils']);
    assert.ok(p.calls.some((c) => c.url.endsWith('/api/outcomes')), 'partagé anonymement, case cochée');
    assert.ok(sent(p, 'reliable_get').length);
    const rb = p.$('msgs').querySelector('.reliable').querySelector('button');
    assert.ok(rb, 'bouton des réglages réussis');
    rb.click();
    await sleep(20);
    assert.ok(sent(p, 'restore_reliable').length);
    assert.match(texts(p.$('msgs')), /Réglages réussis remis\./);
    byText(p.$('msgs').querySelector('.reliable'), /Annuler/).click();
    await sleep(20);
    assert.equal(sent(p, 'undo').at(-1).undo_id, 12);
    assert.match(texts(p.$('msgs')), /Retour aux réglages d’avant|Chercher une autre piste/);
  } finally { p.stop(); }
});

test('lot 5 : retouches faites à la main (print_retouches, spool_kept, file_filament) et « J’ai adapté ce fichier » avec « Annuler »', async () => {
  const p = await start({ session: SESSION, fs: { level: 'expert' }, retouches: true });
  try {
    p.ctx.PlyoV2.panel.askRetouches(0);
    await sleep(40);
    assert.match(texts(p.$('msgs')), /Tu as retouché un réglage d’impression pendant « Crochet mural »/);
    byText(p.$('msgs'), /Les garder dans mon profil/).click();
    await sleep(20);
    assert.ok(sent(p, 'retouches_keep').length);
    assert.match(texts(p.$('msgs')), /Retouches gardées/);
    p.emit({ type: 'spool_kept', spool: 'Sunlu PLA blanc', changes: [{ key: 'filament_flow_ratio', label: 'Débit', before: 1, after: 0.96 }], token: 4 });
    assert.match(texts(p.$('msgs')), /Gardé dans ta bobine « Sunlu PLA blanc »/);
    p.$('msgs').querySelectorAll('button').filter((b) => /Annuler/.test(texts(b))).at(-1).click();
    assert.equal(sent(p, 'spool_kept_undo').at(-1).token, 4);
    p.emit({ type: 'file_filament', info: { spool: 'Sunlu PLA blanc', changes: [{ key: 'nozzle_temperature', label: 'Température de la buse', before: 210, after: 220 }] } });
    byText(p.$('msgs'), /Prendre ceux du fichier/).click();
    assert.ok(sent(p, 'file_filament_take').length);
    p.emit({ type: 'model_adapted', adaptation: { adapted: [{ label: 'Vitesse', before: 300, after: 250 }], dropped: [], undo_id: 31 } });
    const card = p.$('msgs').querySelector('.adapted');
    assert.match(texts(card), /J’ai adapté ce fichier à ton imprimante et à ton filament : 1 réglage changé\./);
    byText(card, /Annuler/).click();
    await sleep(20);
    assert.equal(sent(p, 'undo').at(-1).undo_id, 31);
    assert.match(texts(card), /Annulé : j’ai remis les réglages d’avant\./);
  } finally { p.stop(); }
});

test('lot 5 : fenêtres d’Orca (orca_dialog), avertissements après un lot (after_apply), bulles d’Orca (notices)', async () => {
  const issues = [{ source: 'validate_warning', code: 'unknown', level: 'warning', text: 'Température élevée pour ce filament.', opt_key: 'nozzle_temperature' }];
  const p = await start({ session: SESSION, issues });
  try {
    await sleep(30);
    p.emit({ type: 'orca_dialog', phase: 'open', id: 3, kind: 'error' });
    assert.match(texts(p.$('msgs')), /Plyo Slicer attend ta réponse dans sa fenêtre/);
    p.emit({ type: 'orca_dialog', phase: 'closed', id: 3, kind: 'error', text: 'Couche vide.' });
    assert.doesNotMatch(texts(p.$('msgs')), /attend ta réponse/);
    // Dans « Tout est prêt » / « Je prépare… », la carte rejoint celles de l'étape ; ailleurs, la discussion.
    const all = () => texts(p.$('stepcard')) + texts(p.$('msgs'));
    assert.match(all(), /Plyo Slicer a affiché une erreur/);
    assert.match(all(), /« Couche vide\. »/);
    // Un lot appliqué : Orca est relu après (after_apply), ses avertissements sont dits.
    p.ctx.PlyoV2.imprimer.applyBatches([[{ key: 'nozzle_temperature', value: 230, label: 'Température de la buse', confirmed: true }]], 'test', null, () => {});
    await sleep(700);
    assert.equal(sent(p, 'orca_issues').at(-1).purpose, 'after_apply');
    assert.match(all(), /Plyo Slicer prévient/);
    // Une bulle d'Orca apparaît (tour_signals.notices) : demandée en détail.
    p.emit({ type: 'tour_signals', objects: 1, sliced: false, notices: ['unknown'] });
    await sleep(20);
    assert.equal(sent(p, 'orca_issues').at(-1).purpose, 'notices');
  } finally { p.stop(); }
});

test('lot 5 : reprise de project_open quand Orca est occupé, phone_pick_files, « Tu regardes », accueil du débutant', async () => {
  const p = await start({ session: SESSION, openReason: 'occupe', fs: { greeted: false } });
  try {
    await sleep(30);
    // Accueil du débutant : la fenêtre de bienvenue, « Je connais déjà » en case à cocher.
    assert.match(texts(win(p)), /Je t’aide à imprimer, étape par étape/);
    win(p).querySelector('input').checked = true;
    byText(win(p), /C’est parti/).click();
    assert.deepEqual(sent(p, 'firststeps_set').at(-1).patch, { level: 'expert', greeted: true });
    // Mes projets › Rouvrir : Orca occupé, la v2 le dit et redemande.
    p.ctx.PlyoV2.panel.openConversation('c-2');
    await sleep(20);
    p.emit({ type: 'conv_loaded', id: 'c-2', conversation: { title: 'Crochet', entries: [], history: [], project: { part: { name: 'Crochet mural' } } } });
    await sleep(20);
    assert.equal(sent(p, 'project_open').length, 1);
    assert.match(texts(p.$('msgs')), /occupé|Plyo Slicer/);
    await sleep(3100);
    assert.equal(sent(p, 'project_open').length, 2, 'nouvelle demande au bout de 3 s');
    p.emit({ type: 'phone_pick_files' });
    assert.ok(byText(p.$('msgs'), /Choisir mes photos/));
    p.emit({ type: 'focus_setting', key: 'retraction_length', label: 'Longueur de rétraction' });
    assert.equal(p.$('focus-chip').classList.contains('hidden'), false);
    assert.match(texts(p.$('focus-chip')), /Longueur de rétraction/);
    p.$('focus-explain').click();
    assert.equal(sent(p, 'explain').at(-1).key, 'retraction_length');
  } finally { p.stop(); }
});

test('lot 5 : la page v2 inclut le menu, les fenêtres et les finitions ; la valeur par défaut de « ui » reste « classique »', () => {
  const page = read('v2/index.html');
  for (const n of ['v2/fenetres.js', 'v2/menu.js', 'v2/finitions.js', 'machines-view.js']) assert.ok(page.includes('<!--plyo-include:' + n + '-->'), n);
  for (const f of ['v2/menu.js', 'v2/fenetres.js', 'v2/finitions.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /innerHTML|onclick=|eval\(/, f);
  }
  // Le bouton plein de la carte n'est plus collé par-dessus le contenu : rien n'est masqué.
  assert.doesNotMatch(page.slice(page.indexOf('.stepcard .foot'), page.indexOf('.stepcard .foot') + 200), /sticky/);
});
