// Assistant v2, lot 2 : étape 1 « Ta pièce » (v2/piece.js), exécutée avec un DOM factice et un pont simulé (tests/v2-dom.mjs).
// Les messages envoyés au slicer sont ceux du panneau classique (model_add, gallery_get, plate_action, commands, open_tool).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2, response, sleep, read } from './v2-dom.mjs';

const SESSION = { access_token: 'jeton', refresh_token: 'renouv', expires_at: 9999999999, email: 'a@b.fr' };
const VALUES = { type: 'values', locale: 'fr', params: [], context: { printer: 'Creality K1C 0.4 nozzle', filament: 'PLA', process: '0.20mm' } };
const GAUGE = (pct) => ({ plan: 'gratuit', used_pct: pct, state: 'ok', resets_at: '2026-12-01T00:00:00Z' });
const norm = (t) => String(t).replace(/[  ]/g, ' ');
const texts = (el) => norm(el.textContent);
const buttonsOf = (el) => el.querySelectorAll('button');
const byText = (el, re) => buttonsOf(el).find((b) => re.test(texts(b)));

// Pont : `cfg.items` (projets enregistrés), `cfg.plate` (objets lus par ai_context), `cfg.conversation` (attachée).
function bridge(cfg = {}) {
  return (m, emit) => {
    if (m.type === 'ready') emit(VALUES);
    else if (m.type === 'session_load') emit({ type: 'session', session: cfg.session || null });
    else if (m.type === 'project_resume_get') emit({ type: 'project_resume', attached: cfg.attached || '', conversation: cfg.conversation || null, items: cfg.items || [] });
    else if (m.type === 'tour_signals') emit({ type: 'tour_signals', objects: 0, user_file: false });
    else if (m.type === 'ai_context') emit({ type: 'ai_context', context: {}, plate: cfg.plate || { objects: [], bed_mm: [220, 220, 250] } });
  };
}
function service(routes = {}) {
  return async (url, init) => {
    if (url.endsWith('/api/me')) return response(200, { email: 'a@b.fr', gauge: GAUGE(41) });
    for (const [k, fn] of Object.entries(routes)) if (url.endsWith(k)) return fn(init);
    return response(404, {});
  };
}
const BOAT = { type: 'model_added', ok: true, name: 'Petit bateau', size_mm: [60, 31, 48], bed_mm: [220, 220, 250], fits: true, count: 1, sample: 'benchy' };
const PLATE = { objects: [{ ref: '7', name: 'Petit bateau', size_mm: [60, 31, 48], copies: 1 }], bed_mm: [220, 220, 250] };

test('lot 2 : étape 1 vide : zone de dépôt, ouvrir, galerie, créer avec l’IA, petit bateau', async () => {
  const p = loadV2({ bridge: bridge(), fetch: service() });
  try {
    await sleep(30);
    const card = p.$('stepcard');
    assert.match(texts(card), /Qu’est-ce qu’on imprime \?/);
    assert.ok(card.querySelector('.dropzone'), 'zone « Dépose ta pièce ici »');
    assert.match(texts(card.querySelector('.dropzone')), /Dépose ta pièce ici.*STL, 3MF, OBJ ou STEP/);
    assert.deepEqual(card.querySelectorAll('.card').map((c) => texts(c.querySelector('strong'))), ['Ouvrir un fichier', 'Choisir dans la galerie', 'Créer avec l’IA']);
    assert.match(texts(card.querySelectorAll('.card')[2]), /IA/, 'badge IA');
    assert.ok(!/Mes pièces récentes/.test(texts(card)), 'premier lancement : pas de pièces récentes');
    assert.equal(card.querySelector('#card-primary'), null, 'aucun bouton plein avant le choix');
    // Le petit bateau : le slicer le pose comme un fichier choisi (même message que le classique).
    p.$('piece-boat').click();
    const add = p.posted.at(-1);
    assert.equal(add.type, 'model_add');
    assert.equal(add.sample, 'benchy');
    assert.equal(add.replace, false);
    assert.equal(add.conv, p.ctx.PlyoV2.panel.conv().id, 'le plateau devient celui de la conversation');
    assert.match(texts(card), /Je pose le petit bateau de test sur le plateau…/);
  } finally { p.stop(); }
});

test('lot 2 : pièce posée : fiche, « Envie d’ajuster ? », l’étape 1 reste à l’écran jusqu’à « Continuer »', async () => {
  const p = loadV2({ bridge: bridge({ plate: PLATE }), fetch: service() });
  try {
    await sleep(30);
    p.$('piece-boat').click();
    p.emit(BOAT);
    await sleep(20);
    const card = p.$('stepcard');
    assert.match(texts(card), /Étape 1 sur 3/);
    assert.match(texts(card), /Ta pièce est sur le plateau/);
    assert.match(texts(card.querySelector('.summary-line')), /Petit bateau.*60 × 31 × 48 mm.*Changer/);
    assert.match(texts(card), /Elle tient sur le plateau\./);
    assert.deepEqual(card.querySelectorAll('.act').map((b) => texts(b)), ['Tourner', 'Taille', 'Copies', 'Poser à plat', 'Couper', 'Ajouter une pièce']);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'piece', 'la barre reste sur « Ta pièce »');
    assert.ok(p.posted.some((m) => m.type === 'ai_context'), 'mesures relues sur le plateau');
    const conv = p.ctx.PlyoV2.panel.conv();
    assert.deepEqual(JSON.parse(JSON.stringify(conv.project.part)), { name: 'Petit bateau' });
    assert.equal(conv.entries.at(-1).kind, 'model');
    assert.match(conv.project.thread.at(-1).text, /Pièce posée : « Petit bateau », 60 × 31 × 48 mm\./, 'l’assistant sait ce qui s’est passé');
    // Tourner : l'ordre « commands » que le slicer exécute pour l'assistant, sur la pièce du projet.
    card.querySelector('.act').click();
    const rot = p.posted.at(-1);
    assert.equal(rot.type, 'commands');
    assert.deepEqual(rot.commands, [{ op: 'rotate', axis: 'z', amount: 90, summary: 'Pièce tournée d’un quart de tour', object: '7' }]);
    p.emit({ type: 'commands', request: rot.request, ok: true, done: ['Pièce tournée d’un quart de tour'], text: '', skipped: [], undo_token: 55 });
    assert.match(texts(card.querySelector('.done-line')), /Pièce tournée d’un quart de tour.*Annuler/);
    byText(card.querySelector('.done-line'), /Annuler/).click();
    assert.deepEqual(p.posted.at(-1), { type: 'plate_action', kind: 'undo', request: p.posted.at(-1).request, undo_token: 55 });
    p.emit({ type: 'plate_action', kind: 'undo', request: p.posted.at(-1).request, ok: true, text: 'C’est annulé.' });
    assert.match(texts(card), /C’est annulé : le plateau est revenu comme avant\./);
    // Copies : − / + ; Taille : en % de la taille posée ; Poser à plat ; Couper ouvre l'outil d'Orca.
    card.querySelectorAll('.act')[2].click();
    byText(card, /^\+$/).click();
    assert.deepEqual(p.posted.at(-1).commands, [{ op: 'set_copies', amount: 2, summary: '2 exemplaires sur le plateau', object: '7' }]);
    // Geste fait à la main : marqué pour le slicer, qui le fait sans imprimante ni bobine choisies (étape 1).
    assert.equal(rot.by_user, true);
    assert.equal(p.posted.at(-1).by_user, true);
    p.emit({ type: 'commands', request: p.posted.at(-1).request, ok: true, done: ['2 exemplaires sur le plateau'], skipped: [], undo_token: 56 });
    card.querySelectorAll('.act')[1].click();
    byText(card.querySelector('.inline-pop'), /^75 %$/).click();
    assert.deepEqual(p.posted.at(-1).commands, [{ op: 'scale', amount: 75, summary: 'Pièce mise à 75 % de sa taille d’origine', object: '7' }]);
    p.emit({ type: 'commands', request: p.posted.at(-1).request, ok: true, done: ['Pièce mise à 75 % de sa taille d’origine'], skipped: [], undo_token: 57 });
    card.querySelectorAll('.act')[3].click();
    assert.equal(p.posted.at(-1).commands[0].op, 'lay_flat');
    p.emit({ type: 'commands', request: p.posted.at(-1).request, ok: true, done: ['Pièce posée sur sa plus grande face'], skipped: [], undo_token: 58 });
    card.querySelectorAll('.act')[4].click();
    assert.deepEqual(p.posted.at(-1), { type: 'open_tool', tool: 'cut' });
    p.emit({ type: 'open_tool', ok: true, text: 'J’ai ouvert l’outil « Couper » sur « Petit bateau ».' });
    assert.match(texts(card), /J’ai ouvert l’outil « Couper »/);
    // Ajouter une pièce : le choix d'un fichier, posé à côté (sans remplacer).
    card.querySelectorAll('.act')[5].click();
    assert.match(texts(card), /Quelle pièce ajouter \?.*Elle se posera à côté de « Petit bateau »/);
    byText(card, /^Annuler$/).click();
    assert.match(texts(card), /Ta pièce est sur le plateau/);
    // « Continuer » : l'étape 2.
    p.$('card-primary').click();
    assert.match(texts(card), /Étape 2 sur 3/);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'materiel');
    // Étape 1 rouverte depuis la barre : la fiche et les réglages, et le retour à l'étape en cours.
    p.$('stepper').querySelector('.st.done').click();
    assert.match(texts(card), /Étape 1 sur 3 · rouverte.*Ta pièce est sur le plateau/);
    assert.match(texts(p.$('card-primary')), /Revenir à l’étape en cours/);
  } finally { p.stop(); }
});

test('lot 2 : pièce trop grande : alerte, « Réduire pour que ça tienne » (scale_to_fit), « Continuer » attend', async () => {
  const big = { ...BOAT, size_mm: [300, 120, 80], fits: false };
  const p = loadV2({ bridge: bridge({ plate: { objects: [{ ref: '7', name: 'Petit bateau', size_mm: [300, 120, 80], copies: 1 }], bed_mm: [220, 220, 250] } }), fetch: service() });
  try {
    await sleep(30);
    p.$('piece-boat').click();
    p.emit(big);
    await sleep(20);
    const card = p.$('stepcard');
    assert.match(texts(card.querySelector('.note.warn')), /Elle est trop grande pour le plateau\.Elle mesure 300 × 120 × 80 mm, et ton imprimante imprime jusqu’à 220 × 220 × 250 mm\./);
    assert.equal(p.$('card-primary').disabled, true);
    p.$('piece-reduce').click();
    const r = p.posted.at(-1);
    assert.equal(r.type, 'plate_action');
    assert.equal(r.kind, 'scale_to_fit');
    p.emit({ type: 'plate_action', kind: 'scale_to_fit', request: r.request, ok: true, text: 'J’ai réduit la pièce pour qu’elle tienne sur le plateau.', undo_token: 9 });
    assert.equal(card.querySelector('.note.warn'), null);
    assert.match(texts(card), /J’ai réduit la pièce pour qu’elle tienne sur le plateau\./);
    assert.equal(p.$('card-primary').disabled, false);
    assert.equal(p.ctx.PlyoV2.panel.conv().entries.find((e) => e.kind === 'model').reduced, true);
  } finally { p.stop(); }
});

test('lot 2 : machine proposée différente de celle d’Orca : « trop grande » n’est pas dit', async () => {
  const p = loadV2({ bridge: bridge(), fetch: service() });
  try {
    await sleep(30);
    p.ctx.PlyoV2.panel.conv().project.printer = { preset: 'Creality K2 Plus', proposed: true };
    p.$('piece-boat').click();
    p.emit({ ...BOAT, fits: false, size_mm: [300, 120, 80] });
    assert.equal(p.$('stepcard').querySelector('.note.warn'), null);
    assert.equal(p.$('card-primary').disabled, false);
  } finally { p.stop(); }
});

test('lot 2 : galerie par catégories, un clic pose le modèle (gallery_get, model_add sample)', async () => {
  const p = loadV2({ bridge: bridge(), fetch: service() });
  try {
    await sleep(30);
    byText(p.$('stepcard'), /Choisir dans la galerie/).click();
    assert.equal(p.posted.at(-1).type, 'gallery_get');
    p.emit({ type: 'gallery', items: [{ id: 'support-casque', name: 'Support casque', category: 'utile', author: 'Plyo', license: 'CC BY' }] });
    const card = p.$('stepcard');
    assert.match(texts(card), /Galerie/);
    assert.deepEqual(card.querySelector('.tabs').querySelectorAll('.chip').map((c) => texts(c)), ['Tout', 'Utile', 'Jouet', 'Déco', 'Test']);
    assert.equal(card.querySelectorAll('.gitem').length, 7);
    byText(card.querySelector('.tabs'), /^Utile$/).click();
    assert.deepEqual(card.querySelectorAll('.gitem').map((g) => texts(g.querySelector('strong'))), ['Support casque']);
    assert.match(texts(card.querySelector('.gitem')), /utile · par Plyo · CC BY/);
    card.querySelector('.gitem').click();
    assert.deepEqual([p.posted.at(-1).type, p.posted.at(-1).sample], ['model_add', 'support-casque']);
    // Retour : l'écran du choix.
    p.emit({ type: 'model_added', ok: false, sample: 'support-casque', text: 'Je ne trouve pas cette pièce dans les fichiers de Plyo.' });
    assert.match(texts(card), /Je ne trouve pas cette pièce.*printables\.com/);
  } finally { p.stop(); }
});

test('lot 2 : un fichier 3D par la zone, le trombone ou le glisser-déposer : model_add comme le classique', async () => {
  const p = loadV2({ bridge: bridge({ plate: PLATE }), fetch: service() });
  try {
    await sleep(30);
    p.ctx.FileReader = class { readAsDataURL(f) { this.result = 'data:model/stl;base64,' + f.b64; setTimeout(() => this.onload(), 0); } };
    const file = { name: 'crochet.stl', size: 1200, b64: 'U1RM', type: '' };
    // Trombone : un modèle 3D part au plateau, pas à l'IA.
    const input = p.$('file-input');
    input.files = [file];
    input.dispatch('change');
    await sleep(10);
    const add = p.posted.at(-1);
    assert.deepEqual({ ...add, project: undefined, conv: undefined }, { type: 'model_add', name: 'crochet.stl', data: 'U1RM', replace: false, project: undefined, conv: undefined });
    assert.equal(p.$('attached').classList.contains('hidden'), true, 'pas joint comme une photo');
    p.emit({ type: 'model_added', ok: true, name: 'crochet', size_mm: [40, 20, 80], bed_mm: [220, 220, 250], fits: true, count: 1,
      adaptation: { adapted: [{ label: 'Hauteur de couche', before: 0.1, after: 0.2 }, { label: 'Vitesse', before: 300, after: 200 }] }, colours_ignored: 3 });
    assert.match(texts(p.$('stepcard')), /J’ai adapté ce fichier à ton imprimante et à ton filament : 2 réglages changés\./);
    assert.match(texts(p.$('stepcard')), /« crochet » prévoit 3 couleurs, mais ta machine imprime une bobine à la fois/);
    assert.equal(p.ctx.PlyoV2.panel.conv().project.adapted, 'crochet', '3MF adapté dès l’import : pas une deuxième fois');
    // Une autre pièce déposée ensuite : sur ce plateau, ou un nouveau projet ?
    const drop = p.$('stepcard').querySelector('.dropzone');
    assert.equal(drop, null, 'la pièce est posée : plus de zone de dépôt');
    p.document.listeners.drop[0]({ preventDefault() {}, dataTransfer: { files: [{ name: 'cale.stl', size: 10, b64: 'Q0FMRQ==' }] } });
    assert.match(texts(p.$('stepcard')), /« cale\.stl » : sur le même plateau que « crochet », ou dans un nouveau projet \?/);
    byText(p.$('stepcard'), /L’ajouter à ce plateau/).click();
    await sleep(10);
    assert.deepEqual([p.posted.at(-1).name, p.posted.at(-1).replace], ['cale.stl', false]);
    p.emit({ type: 'model_added', ok: true, name: 'cale', size_mm: [10, 10, 5], bed_mm: [220, 220, 250], fits: true, count: 2 });
    assert.deepEqual(JSON.parse(JSON.stringify(p.ctx.PlyoV2.panel.conv().project.part)), { name: 'crochet', extra: ['cale'] });
    assert.ok(p.posted.some((m) => m.type === 'plate_action' && m.kind === 'arrange'), 'plateau rangé après l’ajout');
    assert.match(texts(p.$('stepcard')), /Tes pièces sont sur le plateau/);
    // Trop lourd pour le panneau.
    p.ctx.PlyoV2.panel.conv().project.part = null;
    p.ctx.PlyoV2.panel.render();
    input.files = [{ name: 'enorme.3mf', size: 200 * 1024 * 1024 }];
    input.dispatch('change');
    assert.match(texts(p.$('stepcard')), /trop lourd pour passer par ce panneau/);
  } finally { p.stop(); }
});

test('lot 2 : « Changer » : une autre pièce ouvre un nouveau projet, l’ancienne est remplacée sur le plateau', async () => {
  const p = loadV2({ bridge: bridge({ plate: PLATE }), fetch: service() });
  try {
    await sleep(30);
    p.$('piece-boat').click();
    p.emit(BOAT);
    const first = p.ctx.PlyoV2.panel.conv();
    p.$('piece-change').click();
    assert.match(texts(p.$('stepcard')), /Une autre pièce choisie ici ouvre un nouveau projet/);
    assert.match(texts(p.$('stepcard')), /Garder « Petit bateau »/);
    p.$('piece-boat').click();
    const now = p.ctx.PlyoV2.panel.conv();
    assert.notEqual(now.id, first.id, 'nouvelle conversation');
    const add = p.posted.at(-1);
    assert.deepEqual([add.type, add.sample, add.conv, add.replace], ['model_add', 'benchy', now.id, true]);
    assert.match(texts(p.$('msgs')), /Nouveau projet pour cette pièce : « Petit bateau » reste dans tes projets\./);
  } finally { p.stop(); }
});

test('lot 2 : « Créer avec l’IA » : connexion au premier appel, questions, pièce dessinée posée, « Changer quelque chose »', async () => {
  let reply = response(200, { status: 'question', message: 'Une précision :', questions: [{ text: 'Quelle largeur ?', choices: ['4 cm', '6 cm'] }], credits: { gauge: GAUGE(43) } });
  const p = loadV2({ bridge: bridge({ plate: PLATE }), fetch: service({ '/api/design': async () => reply }) });
  try {
    await sleep(30);
    byText(p.$('stepcard'), /Créer avec l’IA/).click();
    const card = p.$('stepcard');
    assert.match(texts(card), /Créer avec l’IA.*Décris la pièce avec tes mots/);
    assert.ok(byText(card, /Joindre un croquis/));
    assert.ok(byText(card, /Photo avec mon téléphone/));
    byText(card, /Un crochet pour serviette/).click();
    assert.equal(p.$('design-text').value, 'Un crochet pour serviette');
    p.$('card-primary').click();
    await sleep(10);
    assert.ok(!p.calls.some((c) => c.url.endsWith('/api/design')), 'rien ne part sans compte');
    assert.match(texts(p.$('msgs')), /Pour dessiner ta pièce.*connecte-toi/);
    p.emit({ type: 'session', session: SESSION });
    await sleep(30);
    const call = p.calls.find((c) => c.url.endsWith('/api/design'));
    assert.ok(call, 'la description part après la connexion');
    const body = JSON.parse(call.init.body);
    assert.equal(body.text, 'Un crochet pour serviette');
    assert.equal(body.locale, 'fr');
    assert.match(body.request_id, /^[0-9a-f-]{36}$/);
    assert.ok(p.posted.some((m) => m.type === 'design_lib_get'), 'bibliothèque de dessin demandée en parallèle');
    assert.match(texts(card), /Quelle largeur \?/);
    assert.equal(texts(p.$('gauge-pct')), '43 %', 'la jauge suit la réponse');
    // La réponse aux questions repart toute seule ; la pièce est construite et posée.
    reply = response(200, { status: 'design', message: 'Voici ton crochet.', part: { name: 'Crochet serviette', dimensions: [{ label: 'largeur', value_mm: 40, assumed: true }] }, credits: { gauge: GAUGE(45) } });
    p.ctx.PlyoPiece.designFile = (M, part) => ({ ok: true, name: 'Crochet serviette.stl', data: 'U1RMIQ==', size: [40, 20, 60] });
    p.ctx.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    p.ctx.__plyoManifold = async () => ({ setup() {}, Manifold: {}, CrossSection: {} });
    p.emit({ type: 'design_lib', ok: true, js: 'export default Module;', wasm: '' });
    byText(card, /^4 cm$/).click();
    await sleep(30);
    assert.equal(JSON.parse(p.calls.filter((c) => c.url.endsWith('/api/design')).at(-1).init.body).text, 'Quelle largeur ? 4 cm');
    const add = p.posted.filter((m) => m.type === 'model_add').at(-1);
    assert.deepEqual([add.name, add.data, add.replace], ['Crochet serviette.stl', 'U1RMIQ==', false]);
    assert.deepEqual(p.ctx.PlyoV2.panel.conv().project.design.part.name, 'Crochet serviette');
    p.emit({ type: 'model_added', ok: true, name: 'Crochet serviette', size_mm: [40, 20, 60], bed_mm: [220, 220, 250], fits: true, count: 1 });
    assert.match(texts(card), /Voici ton crochet\. Cotes : largeur 40 mm \(supposé : vérifie\)/);
    // « Changer quelque chose » : la retouche part avec la pièce en cours et la remplace.
    byText(card, /Changer quelque chose sur la pièce/).click();
    assert.match(texts(card), /Qu’est-ce que je change \?/);
    p.$('design-text').value = 'Plus épaisse de 2 mm';
    p.$('design-text').dispatch('input');
    p.$('card-primary').click();
    await sleep(30);
    const retouch = JSON.parse(p.calls.filter((c) => c.url.endsWith('/api/design')).at(-1).init.body);
    assert.equal(retouch.current.name, 'Crochet serviette');
    assert.equal(p.posted.filter((m) => m.type === 'model_add').at(-1).replace, true);
  } finally { p.stop(); }
});

test('lot 2 : « Créer avec l’IA » en formule gratuite : le texte de la formule, rien d’autre à cliquer', async () => {
  const p = loadV2({ bridge: bridge({ session: SESSION }), fetch: service({ '/api/design': async () => response(403, { error: 'plan_required' }) }) });
  try {
    await sleep(30);
    byText(p.$('stepcard'), /Créer avec l’IA/).click();
    p.$('design-text').value = 'Une boîte';
    p.$('design-text').dispatch('input');
    p.$('card-primary').click();
    await sleep(30);
    assert.match(texts(p.$('stepcard')), /Les pièces sur mesure font partie de Plyo\+\./);
    assert.equal(p.$('card-primary'), null);
  } finally { p.stop(); }
});

test('lot 2 : croquis par le téléphone : le lien demande un croquis et l’envoi rejoint le formulaire', async () => {
  const p = loadV2({ bridge: bridge({ session: SESSION }), fetch: service({
    '/api/phone-sessions': async (init) => response(200, { id: 'tel-1', qr_svg: '<svg/>', purpose: JSON.parse(init.body).purpose }),
    '/api/phone-sessions/tel-1': async () => response(200, { pending_batches: 1, status: 'open' }),
    '/api/phone-sessions/tel-1/photos': async () => response(200, { message: 'mon croquis', images: [{ media_type: 'image/jpeg', data: 'QUJD' }] }),
  }) });
  try {
    await sleep(30);
    byText(p.$('stepcard'), /Créer avec l’IA/).click();
    byText(p.$('stepcard'), /Photo avec mon téléphone/).click();
    await sleep(30);
    const created = p.calls.find((c) => c.url.endsWith('/api/phone-sessions'));
    assert.equal(JSON.parse(created.init.body).purpose, 'sketch');
    assert.equal(p.posted.at(-1).type, 'phone');
    p.emit({ type: 'phone_batch_ready' });
    await sleep(40);
    assert.match(texts(p.$('stepcard')), /Photo du téléphone/);
    assert.equal(p.$('design-text').value, 'mon croquis');
    assert.ok(!p.calls.some((c) => c.url.endsWith('/api/diagnose')), 'le croquis ne part pas à l’assistant');
  } finally { p.stop(); }
});

test('lot 2 : deuxième projet : « Mes pièces récentes », un clic rouvre le projet et son plateau', async () => {
  const items = [
    { id: 'p1', title: 'Crochet mural', updated: '2026-11-22T18:00:00Z', project: { part: { name: 'Crochet mural' }, printer: { preset: 'K1C' }, filament: { preset: 'PLA' }, step: 'after', success: true } },
    { id: 'p0', title: 'Question', updated: '2026-11-23T18:00:00Z', project: { part: null } },
  ];
  const saved = { title: 'Crochet mural', updated: '2026-11-22T18:00:00Z', entries: [], history: [], project: items[0].project };
  const p = loadV2({ bridge: (m, emit) => {
    bridge({ items })(m, emit);
    if (m.type === 'conv_load') emit({ type: 'conv_loaded', id: m.id, conversation: saved });
  }, fetch: service() });
  try {
    await sleep(30);
    const card = p.$('stepcard');
    assert.match(texts(card), /Mes pièces récentes/);
    const recent = card.querySelectorAll('.card').filter((c) => /Crochet mural/.test(texts(c)));
    assert.equal(recent.length, 1);
    assert.match(texts(recent[0]), /Imprimé le .*, réussi/);
    recent[0].click();
    await sleep(20);
    assert.ok(p.posted.some((m) => m.type === 'conv_load' && m.id === 'p1'));
    assert.ok(p.posted.some((m) => m.type === 'project_open' && m.conv === 'p1'), 'son plateau revient, comme dans le classique');
    assert.equal(p.ctx.PlyoV2.panel.conv().id, 'p1');
  } finally { p.stop(); }
});

test('lot 2 : ordres sur le plateau proposés par l’IA : exécutés, annulables ; actions sur la pièce en boutons', async () => {
  const FINAL = { type: 'final', status: 'ok', defect: { key: 'user_goal', name: 'Pièce couchée' }, message: 'Je la couche.', suggestions: [], questions: [],
    commands: [{ op: 'rotate', axis: 'x', amount: 90 }], actions: [{ kind: 'orient', label: 'Orienter au mieux' }, { kind: 'show', target: 'preview', label: 'Aperçu' }], credits: { charged: 1, gauge: GAUGE(44) } };
  const p = loadV2({ bridge: bridge({ session: SESSION, plate: PLATE }), fetch: service({ '/api/diagnose': async () => response(200, null, { lines: [FINAL] }) }) });
  try {
    await sleep(30);
    p.$('note').value = 'Couche-la';
    p.$('c-send').click();
    await sleep(60);
    const cmd = p.posted.find((m) => m.type === 'commands');
    assert.deepEqual(cmd.commands, [{ op: 'rotate', axis: 'x', amount: 90, summary: 'Pièce tournée de 90°' }]);
    assert.equal(cmd.by_user, undefined, 'un ordre de l’IA reste soumis à la fiche du projet');
    p.emit({ type: 'commands', request: cmd.request, ok: true, done: ['Pièce tournée de 90°'], text: '', skipped: [], undo_token: 3 });
    const ai = p.$('msgs').querySelector('.msg.ai');
    assert.match(texts(ai), /Pièce tournée de 90°.*Annuler/);
    assert.deepEqual(buttonsOf(ai.querySelector('.acts')).map((b) => texts(b)), ['Orienter au mieux'], 'les autres actions viennent avec leurs étapes');
    byText(ai, /Orienter au mieux/).click();
    assert.deepEqual([p.posted.at(-1).type, p.posted.at(-1).kind], ['plate_action', 'orient']);
    byText(ai, /^Annuler$/).click();
    const undo = p.posted.at(-1);
    assert.deepEqual([undo.kind, undo.undo_token], ['undo', 3]);
    p.emit({ type: 'plate_action', kind: 'undo', request: undo.request, ok: true, text: 'C’est annulé.' });
    assert.match(texts(ai), /Annulé : le plateau est revenu comme avant\./);
    await sleep(450);
    const save = p.posted.filter((m) => m.type === 'conv_save').at(-1);
    assert.equal(save.conversation.entries.find((e) => e.kind === 'answer').commandsResult.undone, true);
    assert.match(save.conversation.history.at(-1).text, /fait : Pièce tournée de 90°/, 'l’IA sait ce qui a été fait');
  } finally { p.stop(); }
});

test('lot 2 : la vue de l’étape n’affiche ni crédits ni tokens, et le classique utilise la logique partagée', () => {
  const src = read('v2/piece.js').replace(/\/\/.*$/gm, '');
  const strings = [...src.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0]).join('\n');
  assert.ok(!/crédit|token|questions restantes|environ \d+ questions/i.test(strings));
  const page = read('v2/index.html');
  for (const f of ['premiers-pas.js', 'design-builder.js', 'design-flow.js', 'piece-logic.js', 'v2/piece.js']) assert.ok(page.includes('<!--plyo-include:' + f + '-->'), f);
  const classic = read('index.html');
  assert.match(classic, /var j = res\.j \|\| \{\}, o = PlyoPiece\.designOutcome\(res\.status, j\);/);
  assert.match(classic, /var built = PlyoPiece\.designFile\(M, answer\.part\);/);
  assert.match(classic, /data: built\.data, project: conv\.project, conv: conv\.id,/);
});
