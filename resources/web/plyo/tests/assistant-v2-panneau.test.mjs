// Assistant v2, lot 1 : structure du panneau (en-tête, barre des étapes, carte de l'étape, discussion, champ de saisie),
// exécutée avec un DOM factice et un pont simulé (tests/v2-dom.mjs).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2, response, sleep, read } from './v2-dom.mjs';

const SESSION = { access_token: 'jeton', refresh_token: 'renouv', expires_at: 9999999999, email: 'a@b.fr' };
const VALUES = { type: 'values', locale: 'fr', params: [{ id: 'ironing', key: 'ironing_type', label: 'Lissage', unit: '', value: false }], context: { printer: 'K1C', filament: 'PLA', process: '0.20mm' } };
const GAUGE = (pct) => ({ plan: 'gratuit', used_pct: pct, state: 'ok', resets_at: '2026-12-01T00:00:00Z' });
const FINAL = { type: 'final', status: 'ok', defect: { key: 'user_goal', name: 'Un dessus bien lisse' }, message: 'J’active le **lissage**.', suggestions: [{ id: 'ironing', value: true, delta: null }], questions: [], actions: [], credits: { charged: 1, gauge: GAUGE(42) } };

// Pont : réponses du slicer aux messages de la page ; `cfg` : session, conversation attachée.
function bridge(cfg = {}) {
  return (m, emit) => {
    if (m.type === 'ready') emit(VALUES);
    else if (m.type === 'session_load') emit({ type: 'session', session: cfg.session || null });
    else if (m.type === 'project_resume_get') emit({ type: 'project_resume', attached: cfg.attached || '', conversation: cfg.conversation || null, items: [] });
    else if (m.type === 'tour_signals') emit({ type: 'tour_signals', objects: 0, user_file: false });
    else if (m.type === 'ai_context') emit({ type: 'ai_context', context: {}, plate: { objects: [{ name: 'crochet.stl' }] } });
  };
}
// Service : /api/me (jauge) et /api/diagnose (flux NDJSON par défaut).
function service(diagnose) {
  return async (url, init) => {
    if (url.endsWith('/api/me')) return response(200, { email: 'a@b.fr', gauge: GAUGE(41) });
    if (url.endsWith('/api/diagnose')) return diagnose ? diagnose(init) : response(200, null, { lines: [{ type: 'partial', name: 'Un dessus', message: 'J’ac' }, { type: 'wait' }, FINAL] });
    return response(404, {});
  };
}
// Les espaces insécables du français (Logic.fr) deviennent des espaces simples pour les comparaisons.
const norm = (t) => String(t).replace(/[\u00a0\u202f]/g, ' ');
const texts = (el) => norm(el.textContent);

test('lot 1 : en-tête, barre des trois étapes, carte de l’étape, objectifs et champ de saisie', async () => {
  const p = loadV2({ bridge: bridge(), fetch: service() });
  try {
    await sleep(30);
    const types = p.posted.map((m) => m.type);
    for (const t of ['ready', 'session_load', 'project_resume_get', 'tour_signals', 'habits_get']) assert.ok(types.includes(t), t);
    assert.ok(types.includes('project_detach'), 'aucun plateau attaché : détaché comme dans le classique');
    assert.match(texts(p.$('stepper')), /1Ta pièce.*2Imprimante et bobine.*3Imprimer/);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'piece', 'étape en cours d’après le projet');
    assert.match(texts(p.$('stepcard')), /Étape 1 sur 3/);
    assert.match(texts(p.$('stepcard')), /Qu’est-ce qu’on imprime/);
    assert.equal(p.$('hello').classList.contains('hidden'), false, 'discussion vide : les objectifs');
    assert.equal(p.$('hello').querySelectorAll('.chip').length, 5);
    assert.equal(p.$('gauge').classList.contains('hidden'), true, 'sans compte, pas de jauge');
    assert.equal(p.$('phone-pill').classList.contains('hidden'), true, 'téléphone non relié');
    for (const id of ['c-file', 'c-phone', 'c-mic', 'c-send', 'note']) assert.ok(p.$(id), id);
    // Le micro n'apparaît que si le slicer sait dicter.
    p.emit({ type: 'dictation', available: true });
    assert.equal(p.$('c-mic').classList.contains('hidden'), false);
  } finally { p.stop(); }
});

test('lot 1 : la page n’affiche jamais de nombre de questions, de crédits ni de tokens', () => {
  const sources = [read('v2/index.html'), read('v2/panneau.js'), read('v2/discussion.js'), read('v2/etapes.js'), read('v2/ui.js')].join('\n');
  assert.ok(!/crédit|token|questions restantes|environ \d+ questions/i.test(sources.replace(/\/\/.*$/gm, '')));
});

test('lot 1 : une question part au service (même flux que le classique) et la réponse s’affiche ; jauge en % ; conversation enregistrée', async () => {
  const p = loadV2({ bridge: bridge({ session: SESSION }), fetch: service() });
  try {
    await sleep(30);
    assert.equal(p.$('gauge').classList.contains('hidden'), false);
    assert.equal(texts(p.$('gauge-pct')), '41 %');
    p.$('note').value = 'Je veux un dessus bien lisse';
    p.$('c-send').click();
    await sleep(60);
    const call = p.calls.find((c) => c.url.endsWith('/api/diagnose'));
    assert.ok(call, 'POST /api/diagnose');
    assert.equal(call.init.headers.Authorization, 'Bearer jeton');
    assert.equal(call.init.headers.Accept, 'application/x-ndjson');
    const body = JSON.parse(call.init.body);
    assert.equal(body.note, 'Je veux un dessus bien lisse');
    assert.match(body.request_id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(body.capabilities, ['show_preview', 'open_calibration'], 'la v2 exécute l’aperçu et les tests d’Orca (lot 4), comme le classique');
    assert.deepEqual(body.plate, { objects: [{ name: 'crochet.stl' }] }, 'contexte lu par ai_context');
    assert.equal(body.project.step, 'piece');
    const ai = p.$('msgs').querySelector('.msg.ai');
    assert.ok(ai, 'réponse dans le fil');
    assert.match(texts(ai), /Un dessus bien lisse/);
    // Fiche de réglages à appliquer (lot 4) : valeur d’avant et valeur proposée, case cochée, « Appliquer 1 réglage ».
    assert.match(texts(ai), /Réglages proposés.*Lissage.*Non → Oui.*Appliquer 1 réglage.*Ignorer/);
    assert.equal(p.$('msgs').querySelectorAll('.waiting').length, 0, 'l’attente disparaît');
    assert.equal(texts(p.$('gauge-pct')), '42 %', 'jauge de la réponse');
    assert.equal(p.$('note').value, '', 'champ vidé');
    assert.equal(p.$('hello').classList.contains('hidden'), true);
    await sleep(450);
    const save = p.posted.filter((m) => m.type === 'conv_save').at(-1);
    assert.deepEqual(save.conversation.entries.map((e) => e.kind), ['me', 'answer']);
    assert.equal(save.conversation.entries[1].question, 'Je veux un dessus bien lisse');
    assert.equal(save.conversation.history.length, 2);
    assert.equal(save.conversation.history[1].cards, 'proposed');
    assert.equal(save.conversation.title, 'Je veux un dessus bien lisse');
  } finally { p.stop(); }
});

test('lot 1 : connexion demandée seulement au premier appel à l’IA, puis la question part seule', async () => {
  const p = loadV2({ bridge: bridge(), fetch: service() });
  try {
    await sleep(30);
    p.$('note').value = 'Plus vite ?';
    p.$('c-send').click();
    await sleep(20);
    assert.ok(!p.calls.some((c) => c.url.endsWith('/api/diagnose')), 'rien ne part sans compte');
    const card = p.$('msgs').querySelector('.notice');
    assert.match(texts(card), /connecte-toi/);
    card.querySelector('button').click();
    assert.equal(p.posted.at(-1).type, 'login');
    p.emit({ type: 'session', session: SESSION });
    await sleep(60);
    assert.ok(p.calls.some((c) => c.url.endsWith('/api/diagnose')), 'la question repart après la connexion');
    assert.equal(p.$('msgs').querySelectorAll('.msg.me').length, 1, 'affichée une seule fois');
    assert.equal(p.$('msgs').querySelectorAll('.notice').length, 0, 'carte de connexion retirée');
  } finally { p.stop(); }
});

test('lot 1 : erreurs du service : texte de assistant-logic, la demande revient dans le champ ; plan_required affiché tel quel', async () => {
  let reply = response(429, { error: 'rate_limited', retry_after: 3 });
  const p = loadV2({ bridge: bridge({ session: SESSION }), fetch: service(async () => reply) });
  try {
    await sleep(30);
    p.$('note').value = 'Ma question';
    p.$('c-send').click();
    await sleep(40);
    const box = p.$('msgs').querySelector('.notice.error');
    assert.match(texts(box), /Trop de demandes d’un coup : réessaie dans 3 s\./);
    assert.match(texts(box), /Réessayer/);
    assert.equal(p.$('note').value, 'Ma question', 'rien à retaper');
    reply = response(403, { error: 'plan_required' });
    p.$('note').value = '';
    p.$('note').value = 'Deux photos';
    p.$('c-send').click();
    await sleep(40);
    assert.match(texts(p.$('msgs')), /Plusieurs photos dans une même demande font partie de Plyo\+/);
  } finally { p.stop(); }
});

test('lot 1 : « Annuler » pendant l’attente arrête la demande, le texte d’annulation est dit', async () => {
  const p = loadV2({ bridge: bridge({ session: SESSION }), fetch: service((init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort'))))) });
  try {
    await sleep(30);
    p.$('note').value = 'Longue question';
    p.$('c-send').click();
    await sleep(30);
    const wait = p.$('msgs').querySelector('.waiting');
    assert.match(texts(wait), /Je réfléchis/);
    assert.equal(p.$('c-send').disabled, true, 'une seule demande à la fois');
    wait.querySelector('.link').click();
    await sleep(30);
    assert.match(texts(p.$('msgs')), /Demande annulée/);
    assert.equal(p.$('c-send').disabled, false);
    assert.equal(p.$('note').value, 'Longue question');
  } finally { p.stop(); }
});

test('lot 1 : reprise de la conversation en cours (bascule) : son fil, son étape, la barre rouvre une étape faite', async () => {
  const conversation = { title: 'crochet', updated: '2026-11-23T10:00:00Z', history: [],
    entries: [{ kind: 'me', text: 'Elle tiendra une serviette.', thumbs: [] }, { kind: 'answer', data: Object.assign({}, FINAL, { suggestions: [] }), photoCount: 0, question: 'x', date: '2026-11-23T10:00:00Z', applied: false }],
    project: { printer: { preset: 'K1C 0.4', name: 'Creality K1C' }, part: { name: 'crochet.stl' }, filament: null } };
  const p = loadV2({ bridge: bridge({ session: SESSION, attached: 'c-1', conversation }), fetch: service() });
  try {
    await sleep(30);
    assert.ok(p.posted.some((m) => m.type === 'project_attach' && m.conv === 'c-1'), 'le plateau reste celui de la conversation');
    assert.ok(!p.posted.some((m) => m.type === 'project_detach'));
    assert.equal(p.$('msgs').querySelectorAll('.msg.me').length, 1);
    assert.match(texts(p.$('msgs').querySelector('.msg.ai')), /Un dessus bien lisse/);
    const steps = p.$('stepper').querySelectorAll('.st');
    assert.deepEqual(steps.map((s) => ['done', 'cur'].filter((c) => s.classList.contains(c)).join()), ['done', 'cur', '']);
    assert.match(texts(p.$('stepcard')), /Étape 2 sur 3/);
    // L'étape 2 (lot 3) montre la machine du projet, cochée, dès que le slicer a donné la liste des machines.
    p.emit({ type: 'project_printers', printers: [{ preset: 'K1C 0.4', name: 'Creality K1C', linked: false }] });
    assert.match(texts(p.$('stepcard').querySelector('.card.sel')), /Creality K1C/, 'ce qui est choisi vient du projet');
    // Une étape faite se rouvre d'un clic ; le bouton plein de la carte ramène à l'étape en cours.
    steps[0].click();
    assert.match(texts(p.$('stepcard')), /Étape 1 sur 3 · rouverte/);
    p.$('card-primary').click();
    assert.match(texts(p.$('stepcard')), /Étape 2 sur 3/);
    assert.equal(steps[2].disabled, true, 'une étape à venir ne s’ouvre pas');
    // La conversation reprise continue : la question suivante part avec son historique.
    p.$('note').value = 'Et pour la solidité ?';
    p.$('c-send').click();
    await sleep(60);
    assert.equal(JSON.parse(p.calls.find((c) => c.url.endsWith('/api/diagnose')).init.body).project.step, 'filament');
    await sleep(450);
    assert.equal(p.posted.filter((m) => m.type === 'conv_save').at(-1).id, 'c-1', 'même conversation des deux côtés');
  } finally { p.stop(); }
});

test('lot 1 : un autre projet ouvert dans Orca repart sur une conversation neuve, imprimante proposée', async () => {
  const conversation = { title: 't', updated: '', history: [], entries: [{ kind: 'me', text: 'x', thumbs: [] }], project: { printer: { preset: 'K1C 0.4', name: 'Creality K1C' }, part: { name: 'a.stl' }, filament: null } };
  const p = loadV2({ bridge: bridge({ session: SESSION, attached: 'c-1', conversation }), fetch: service() });
  try {
    await sleep(30);
    p.emit({ type: 'project_changed' });
    assert.equal(p.$('msgs').children.length, 0);
    assert.equal(p.$('hello').classList.contains('hidden'), false);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'piece');
    // Le plateau d'avant est détaché, puis, comme le classique (lot 5), le filament du fichier ouvert est demandé.
    assert.deepEqual(p.posted.slice(-2).map((m) => m.type), ['project_detach', 'file_filament_get']);
  } finally { p.stop(); }
});

test('lot 1 : la page v2 tient dans la politique de sécurité (une seule balise <script>, modules du panneau, aucun attribut d’événement)', () => {
  const page = read('v2/index.html');
  assert.equal((page.match(/<script\b/g) || []).length, 1);
  const names = [...page.matchAll(/<!--plyo-include:([^>]*?)-->/g)].map((m) => m[1]);
  for (const n of names) assert.match(n, /^(?:[a-z0-9-]+\/)?[a-z0-9-]+\.js$/, n);
  for (const n of ['journey-logic.js', 'project-logic.js', 'assistant-logic.js', 'ai-client.js', 'conversation-logic.js', 'v2/panneau.js']) assert.ok(names.includes(n), n);
  for (const source of [page, ...names.map(read)]) {
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(source.replace(/\/\/.*$/gm, '')), 'attribut « on…= »');
    assert.ok(!/\beval\s*\(|new Function\s*\(|innerHTML/.test(source), 'eval, new Function ou innerHTML');
  }
});

test('deux zones : une seule dépliée, l’autre en barre ; écrire déplie la conversation, une réponse sur l’étape allume le badge', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = loadV2({ bridge: bridge({ session: SESSION }), fetch: service(async () => { await gate; return response(200, null, { lines: [FINAL] }); }) });
  try {
    await sleep(30);
    const zone = () => p.$('zones').dataset.open;
    assert.equal(zone(), 'step', 'à l’ouverture : l’étape');
    assert.match(texts(p.$('stepbar-kicker')) + ' ' + texts(p.$('stepbar-title')), /Étape 1 sur 3 Qu’est-ce qu’on imprime/);
    p.$('chatbar').click();
    assert.equal(zone(), 'chat');
    p.$('chat-reduce').click();
    assert.equal(zone(), 'step');
    // Une question : la conversation se déplie ; on revient sur l'étape avant la réponse, qui allume alors le badge.
    p.$('note').value = 'Je veux un dessus bien lisse';
    p.$('c-send').click();
    assert.equal(zone(), 'chat', 'écrire déplie la conversation');
    p.$('stepbar-show').click();
    assert.equal(zone(), 'step');
    release();
    await sleep(80);
    assert.equal(zone(), 'step', 'la réponse ne change pas de zone');
    assert.equal(texts(p.$('chatbar-badge')), '1');
    assert.equal(p.$('chatbar-badge').classList.contains('hidden'), false);
    assert.match(texts(p.$('chatbar-last')), /Un dessus bien lisse/, 'la dernière ligne de la conversation dans la barre');
    p.$('chatbar').click();
    assert.equal(p.$('chatbar-badge').classList.contains('hidden'), true, 'lu : le badge s’éteint');
  } finally { p.stop(); }
});

test('barre de l’étape : son bouton fait la même chose que le bouton plein de la carte', async () => {
  const p = loadV2({ bridge: bridge(), fetch: service() });
  try {
    await sleep(30);
    const primary = p.$('card-primary');
    const go = p.$('stepbar-go');
    assert.equal(go.classList.contains('hidden'), !primary);
    if (primary) assert.equal(texts(go), texts(primary));
  } finally { p.stop(); }
});

test('reprise : l’étape gardée à l’écran est notée dans le projet et revient quand le plateau est encore attaché', async () => {
  const p = loadV2({ bridge: bridge({ session: SESSION }), fetch: service() });
  try {
    await sleep(30);
    const panel = p.ctx.PlyoV2.panel;
    panel.hold('piece');
    assert.equal(panel.conv().project.held, 'piece');
    panel.hold(null);
    assert.equal(panel.conv().project.held, undefined, 'relâchée : oubliée');
  } finally { p.stop(); }
  // Panneau rouvert (bascule) sur ce projet, plateau encore attaché : l'étape gardée revient.
  const conversation = { title: 'Bateau', entries: [], history: [], project: { part: { name: 'Petit bateau' }, printer: { preset: 'K1C', name: 'K1C' }, held: 'piece' } };
  const q = loadV2({ bridge: bridge({ session: SESSION, attached: 'c1', conversation }), fetch: service() });
  try {
    await sleep(60);
    assert.equal(q.$('stepcard').dataset.step, 'piece');
  } finally { q.stop(); }
});
