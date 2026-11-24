// Assistant v2 : audit par parcours. La page v2 exécutée avec le DOM factice (tests/v2-dom.mjs) et le slicer simulé FIDÈLE
// (tests/v2-slicer-fidele.mjs : refus et textes du vrai C++). À chaque clic : (a) un retour visible dans la zone dépliée,
// (b) tout refus du slicer se lit là où l'on est, (c) une suite existe, (d) aucune exception.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2, response, sleep } from './v2-dom.mjs';
import { createSlicer, K1C, ENDER, TEXTS } from './v2-slicer-fidele.mjs';

const norm = (t) => String(t).replace(/[  ]/g, ' ').replace(/[’]/g, '\'');
const SESSION = { access_token: 'a', refresh_token: 'r', expires_at: 9999999999, email: 'moi@exemple.fr' };
const GAUGE = { plan: 'gratuit', used_pct: 41, state: 'ok', resets_at: '2026-12-01T00:00:00Z' };
const ANSWER = { type: 'final', status: 'ok', confidence: 'high', message: 'Une bordure plus large et un quart de tour.',
  suggestions: [{ id: 'brim_width', value: 8, delta: null, reason: 'Une bordure plus large.' }],
  commands: [{ op: 'rotate', axis: 'z', amount: 90 }], actions: [], questions: [], credits: { charged: 1, gauge: GAUGE } };

function service(o = {}) {
  return async (url) => {
    if (url.endsWith('/api/me')) return response(200, { email: 'moi@exemple.fr', gauge: o.gauge || GAUGE });
    if (url.endsWith('/api/diagnose')) return o.plan ? response(402, { error: 'plan_required' }) : response(200, null, { lines: [o.answer || ANSWER] });
    if (url.endsWith('/api/design')) return o.plan ? response(402, { error: 'plan_required' }) : response(500, {});
    return response(404, {});
  };
}
async function start(cfg = {}, o = {}) {
  const sim = createSlicer(Object.assign({ firststeps: { greeted: true } }, cfg));
  const p = loadV2({ bridge: (m, emit) => sim.bridge(m, emit), fetch: service(o) });
  p.sim = sim;
  await sleep(80);
  return p;
}
// Ce que voit l'utilisateur : la zone dépliée (l'étape avec son avis, ou la conversation), et une fenêtre ouverte.
function view(p) {
  const z = p.$('zones').dataset.open, f = p.document.getElementById('fenetre');
  return norm((z === 'chat' ? p.$('msgs').textContent : p.$('stepalert').textContent + ' ' + p.$('stepcard').textContent) + ' ' + (f ? f.textContent : ''));
}
function snap(p) {
  return p.$('zones').dataset.open + '|' + view(p) + '|' + norm(p.$('stepper').textContent) + '|' + p.document.querySelectorAll('button').map((b) => (b.disabled ? 1 : 0)).join('');
}
const card = (p) => p.$('stepcard');
const buttons = (el) => el.querySelectorAll('button');
const byText = (el, re) => buttons(el).find((b) => re.test(norm(b.textContent)));
const sent = (p, type) => p.posted.filter((m) => m.type === type);
// Un clic de l'utilisateur, avec les invariants (a) et (b).
async function click(p, el, label, ms = 150, opts = {}) {
  assert.ok(el, 'introuvable : ' + label);
  assert.ok(!el.disabled, 'grisé : ' + label);
  const before = snap(p), n = p.sim.S.refusals.length;
  el.click();
  await sleep(ms);
  assert.notEqual(snap(p), before, '(a) clic sans retour visible : ' + label);
  for (const r of p.sim.S.refusals.slice(n)) if (!(opts.retried && r.text === TEXTS.plate_busy)) assert.ok(view(p).includes(norm(r.text).slice(0, 40)), '(b) refus non vu après « ' + label + ' » : ' + r.text);
}
const tap = (p, re, label, ms) => click(p, byText(p.$('zones'), re) || byText(p.document.getElementById('fenetre') || p.$('zones'), re), label || String(re), ms);
async function pickBoat(p) {
  await tap(p, /Choisir dans la galerie/);
  await click(p, card(p).querySelectorAll('.gitem').find((b) => /Petit bateau/.test(b.textContent)), 'petit bateau', 200);
}
async function toReady(p) {
  await pickBoat(p);
  await tap(p, /^Continuer$/, 'Continuer', 300);
  await click(p, p.$('card-primary'), 'Oui, sur … avec du PLA', 400);
  await click(p, card(p).querySelectorAll('.card').find((b) => /Suggéré/.test(b.textContent)), 'usage suggéré', 900);
  assert.match(norm(card(p).textContent), /Tout est prêt/);
}

test('parcours 1 : débutant, de l’accueil à « Réussi » en Wi-Fi, sans un refus du slicer', async () => {
  const p = await start({ firststeps: {} });
  try {
    await click(p, byText(p.document.getElementById('fenetre'), /C'est parti/), 'C’est parti');
    await toReady(p);
    assert.equal(norm(p.$('card-primary').textContent), 'Lancer l\'impression sur Creality K1C');
    await click(p, p.$('card-primary'), 'Lancer', 400);
    assert.match(norm(card(p).textContent), /Impression en cours.*a démarré/);
    p.sim.finishPrint('finished');
    await sleep(50);
    await tap(p, /Réussi/);
    assert.match(norm(card(p).textContent), /Belle impression/);
    assert.deepEqual(p.sim.S.refusals, [], 'aucun refus du slicer');
    assert.equal(sent(p, 'apply').every((m) => m.project && m.project.printer), true, 'les lots partent avec la fiche');
  } finally { p.stop(); }
});

test('parcours 2 : clé USB, « Enregistrer pour la clé USB » puis « Compris » et le résultat', async () => {
  const p = await start({ printers: [ENDER] });
  try {
    await toReady(p);
    assert.equal(norm(p.$('card-primary').textContent), 'Enregistrer pour la clé USB');
    await click(p, p.$('card-primary'), 'Enregistrer pour la clé USB', 300);
    assert.match(norm(card(p).textContent), /Fichier enregistré/);
    await tap(p, /Compris/);
    await tap(p, /Réussi/);
    assert.deepEqual(p.sim.S.refusals, []);
  } finally { p.stop(); }
});

test('parcours 3 : plusieurs pièces, copies et taille pour « Toutes », « Couper » demande laquelle et l’ouvre sur elle', async () => {
  const p = await start();
  try {
    await pickBoat(p);
    // Une deuxième pièce sur le plateau (comme « Ajouter une pièce »), lue par ai_context.
    p.sim.S.plate.objects.push({ ref: '9', name: 'Crochet', size_mm: [40, 30, 30], copies: 1, scale_pct: 100 });
    p.ctx.PlyoV2.panel.post({ type: 'ai_context' });
    await sleep(60);
    await click(p, card(p).querySelector('.act'), 'Tourner (plusieurs pièces)');
    assert.match(norm(card(p).textContent), /Quelle pièce \? Choisis-la/);
    await tap(p, /^Toutes$/);
    await click(p, card(p).querySelectorAll('.act').find((b) => b.dataset.adjust === 'copies'), 'Copies');
    await click(p, card(p).querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Un exemplaire de plus pour chaque pièce'), '+1 chaque pièce');
    assert.match(norm(card(p).textContent), /2 exemplaires/);
    // « Couper » avec « Toutes » : une seule pièce à la fois, l'outil s'ouvre sur celle choisie (plus de « Clique d'abord sur la pièce »).
    await click(p, card(p).querySelectorAll('.act').find((b) => b.dataset.adjust === 'cut'), 'Couper');
    assert.match(norm(card(p).textContent), /Quelle pièce couper/);
    assert.ok(!byText(card(p), /^Toutes$/), 'pas de « Toutes » pour couper');
    await click(p, byText(card(p), /^Crochet/), 'Crochet');
    assert.deepEqual(sent(p, 'open_tool').at(-1), { type: 'open_tool', tool: 'cut', object: '9' });
    assert.match(norm(card(p).textContent), /J'ai ouvert l'outil « Couper » sur « Crochet »/);
    assert.deepEqual(p.sim.S.refusals, []);
  } finally { p.stop(); }
});

test('parcours 4 : aucune imprimante, ajoutée par la recherche Wi-Fi puis par le catalogue', async () => {
  const found = [{ ip: '192.168.1.42', name: 'K1C-1234', brand: 'Creality', host_type: 'moonraker', match: { vendor: 'Creality', model: 'Creality K1C', nozzles: ['0.4', '0.6'] } }];
  for (const way of ['wifi', 'catalogue']) {
    const p = await start({ printers: [], orcaPrinter: 'Default Printer', found: way === 'wifi' ? found : [] });
    try {
      await pickBoat(p);
      await tap(p, /^Continuer$/, 'Continuer', 300);
      if (way === 'wifi') {
        await click(p, card(p).querySelectorAll('.card').find((b) => /Trouvée sur ton Wi-Fi/.test(b.textContent)), 'imprimante trouvée', 300);
        await tap(p, /Enregistrer la connexion/);
      } else {
        await click(p, p.$('card-primary'), 'Ajouter mon imprimante', 300);
        const input = p.$('model-search');
        input.value = 'ender';
        input.dispatch('input');
        await click(p, p.$('model-results').querySelectorAll('.card').find((b) => /Ender-3 V3 SE/.test(b.textContent)), 'Ender-3 V3 SE', 300);
      }
      assert.match(norm(card(p).textContent), /Ton imprimante est prête/);
      await click(p, p.$('card-primary'), 'Continuer (installée)', 300);
      await click(p, p.$('card-primary'), 'Oui avec du PLA', 400);
      assert.match(norm(card(p).textContent), /À quoi va servir ta pièce/);
      assert.deepEqual(p.sim.S.refusals, []);
    } finally { p.stop(); }
  }
});

test('parcours 5 : changer de bobine et d’imprimante à l’étape 3, puis de pièce depuis l’étape 1', async () => {
  const p = await start({ printers: [K1C, ENDER] });
  try {
    await toReady(p);
    await click(p, p.$('stepper').querySelectorAll('button').find((b) => b.dataset.step === 'materiel'), 'barre : Imprimante et bobine');
    await click(p, card(p).querySelectorAll('.chip').find((b) => b.dataset.value === 'PETG'), 'PETG');
    await click(p, p.$('card-primary'), 'Oui avec du PETG', 900);
    assert.match(norm(card(p).textContent), /Tout est prêt.*de PETG/);
    await click(p, p.$('stepper').querySelectorAll('button').find((b) => b.dataset.step === 'materiel'), 'barre : Imprimante et bobine');
    await click(p, card(p).querySelectorAll('.card').find((b) => /Ender/.test(b.textContent)), 'Ender', 300);
    await click(p, p.$('card-primary'), 'Oui sur Ender', 900);
    assert.match(norm(card(p).textContent), /Tout est prêt/);
    assert.equal(norm(p.$('card-primary').textContent), 'Enregistrer pour la clé USB');
    await click(p, p.$('stepper').querySelectorAll('button').find((b) => b.dataset.step === 'piece'), 'barre : Ta pièce');
    await click(p, p.$('piece-change'), 'Changer');
    await pickBoat(p);
    assert.match(norm(card(p).textContent), /Ta pièce est sur le plateau/);
    assert.deepEqual(p.sim.S.refusals, []);
  } finally { p.stop(); }
});

test('parcours 6 : l’IA avant tout choix, à l’étape 1 et à l’étape 3 : chaque refus a son bouton, les gestes simples se font', async () => {
  const p = await start({ session: SESSION });
  try {
    // Avant tout choix : la fiche est refusée ; « Choisir ma machine et ma bobine » ramène à l'étape.
    p.$('note').value = 'Comment éviter le warping ?';
    await click(p, p.$('c-send'), 'Envoyer', 200);
    const sheetBtn = () => p.$('msgs').querySelectorAll('.sheet').at(-1).querySelectorAll('button').find((b) => b.classList.contains('main'));
    await click(p, sheetBtn(), 'Appliquer (rien de choisi)', 200);
    assert.match(view(p), /Pour appliquer ça, dis-moi d'abord sur quelle machine, quelle pièce et avec quelle bobine tu imprimes/);
    assert.doesNotMatch(view(p), /Pour que j'applique une correction/, 'le refus est dit une fois');
    const go = byText(p.$('msgs'), /Choisir ma machine et ma bobine/);
    assert.ok(go, 'le bouton qui débloque');
    // Les ordres de l'IA sur une pièce absente : refusés, avec le même bouton.
    assert.match(norm(p.$('msgs').textContent), /Réessayer/);
    await click(p, go, 'Choisir ma machine et ma bobine');
    assert.equal(p.$('zones').dataset.open, 'step');
    await pickBoat(p);
    await tap(p, /^Continuer$/, 'Continuer', 300);
    await click(p, p.$('card-primary'), 'Oui avec du PLA', 500);
    assert.match(norm(p.$('stepalert').textContent), /Ta fiche de réglages t'attend dans la conversation/);
    // Étape 1 d'un nouveau projet : un quart de tour proposé par l'IA se fait tout de suite (sans machine ni bobine).
    p.ctx.PlyoV2.panel.newConversation();
    await sleep(50);
    await pickBoat(p);
    p.$('note').value = 'Tourne-la';
    await click(p, p.$('c-send'), 'Envoyer (étape 1)', 250);
    assert.equal(byText(p.$('msgs'), /Faire ces changements sur le plateau/), undefined, 'plus de clic de confirmation');
    assert.match(norm(p.$('msgs').textContent), /tournée/);
  } finally { p.stop(); }
});

test('parcours 7 : pièce trop grande, « Réduire » puis « Continuer » ; découpe refusée par Orca expliquée', async () => {
  const p = await start({ modelSize: [300, 120, 80] });
  try {
    const stl = { name: 'grand.stl', size: 20 };
    p.ctx.FileReader = function () { this.readAsDataURL = () => { this.result = 'data:x;base64,AAAA'; setTimeout(() => this.onload(), 0); }; };
    p.ctx.PlyoV2.piece.addModels([stl]);
    await sleep(80);
    assert.match(norm(card(p).textContent), /Elle est trop grande pour le plateau/);
    assert.ok(p.$('card-primary').disabled, 'Continuer attend');
    await click(p, p.$('piece-reduce'), 'Réduire pour que ça tienne', 200);
    assert.match(norm(card(p).textContent), /Elle tient sur le plateau.*J'ai réduit la pièce/);
    await tap(p, /^Continuer$/);
  } finally { p.stop(); }
  const q = await start({ sliceRefused: [{ source: 'validate_error', code: 'unknown', level: 'error', text: 'Le support n’est pas valable.' }] });
  try {
    await pickBoat(q);
    await tap(q, /^Continuer$/, 'Continuer', 300);
    await click(q, q.$('card-primary'), 'Oui avec du PLA', 400);
    await click(q, card(q).querySelectorAll('.card').find((b) => /Suggéré/.test(b.textContent)), 'usage suggéré', 600);
    assert.match(norm(card(q).textContent), /Je prépare ton impression/);
    assert.ok(card(q).querySelectorAll('.note').some((n) => /error|warn/.test(n.className)), 'le refus d’Orca est expliqué dans la carte');
  } finally { q.stop(); }
});

test('parcours 8 : envoi injoignable, « Vérifier la liaison » se voit sur l’étape ; fin arrêtée ou en erreur sans quitter la carte', async () => {
  const p = await start({ send: 'unreachable' });
  try {
    await toReady(p);
    await click(p, p.$('card-primary'), 'Lancer (injoignable)', 400);
    assert.match(norm(card(p).textContent), /L'envoi à Creality K1C n'a pas abouti.*Je n'arrive pas à joindre/);
    await tap(p, /Vérifier la liaison de mon imprimante/);
    assert.match(norm(p.$('stepalert').textContent), /Je n'arrive toujours pas à joindre/);
  } finally { p.stop(); }
  for (const verdict of ['cancelled', 'error']) {
    const q = await start();
    try {
      await toReady(q);
      await click(q, q.$('card-primary'), 'Lancer', 400);
      q.sim.finishPrint(verdict);
      await sleep(40);
      if (verdict === 'cancelled') {
        await tap(q, /Ça se décollait du plateau/);
        assert.equal(q.$('zones').dataset.open, 'step', 'on reste sur la carte');
        assert.match(norm(card(q).textContent), /Qu'est-ce qui ne va pas/);
        assert.ok(card(q).querySelectorAll('.card.sel').some((c) => /Elle se décolle du plateau/.test(c.textContent)), 'le symptôme dit est coché');
        assert.equal(q.$('note').value, '', 'rien d’écrit à ta place dans la conversation');
      } else {
        await tap(q, /Écrire ce que dit l'écran/);
        assert.match(q.$('note').value, /Mon imprimante signale une erreur/);
        assert.match(norm(card(q).textContent), /Ta machine signale une erreur/, 'la carte garde la question');
        assert.doesNotMatch(norm(card(q).textContent), /Bonne impression/);
      }
    } finally { q.stop(); }
  }
});

test('parcours 8 bis : raté, symptôme, diagnostic, « Appliquer et réimprimer »', async () => {
  const p = await start({ session: SESSION });
  try {
    await toReady(p);
    await click(p, p.$('card-primary'), 'Lancer', 400);
    p.sim.finishPrint('finished');
    await sleep(40);
    await tap(p, /Raté/);
    await click(p, card(p).querySelectorAll('.card').find((b) => /Des fils/.test(b.textContent)), 'symptôme');
    await click(p, p.$('card-primary'), 'Trouver la solution', 300);
    await click(p, p.$('msgs').querySelectorAll('.sheet').at(-1).querySelectorAll('button').find((b) => b.classList.contains('main')), 'Appliquer et réimprimer', 900);
    assert.deepEqual(p.sim.S.refusals, []);
    assert.equal(p.$('zones').dataset.open, 'step', 'la préparation qui repart se voit');
    assert.match(norm(card(p).textContent), /Tout est prêt|Je prépare/);
  } finally { p.stop(); }
});

test('parcours 9 et 10 : pièces récentes, nouveau projet, « Comme la dernière fois ? » ; bascule et reprise du projet', async () => {
  const K = K1C.preset;
  const old = { title: 'Crochet mural', updated: '2026-11-22T18:00:00Z', history: [], entries: [{ kind: 'note', text: 'Une vieille erreur de la semaine dernière.', tone: 'error' }],
    plate: [{ ref: '7', name: 'Crochet mural', size_mm: [40, 30, 30], copies: 1, scale_pct: 100 }],
    project: { part: { name: 'Crochet mural' }, printer: { preset: K, name: K }, filament: { type: 'PLA', preset: 'Sunlu @K1C', spool: { id: 'sp-1', name: 'Sunlu PLA blanc' }, nozzle_temp: 210, bed_temp: 60, temps_ok: true }, step: 'after', success: true } };
  const p = await start({ conversations: { p1: old }, spools: { [K]: [{ id: 'sp-1', name: 'Sunlu PLA blanc', material: 'PLA', preset: 'Sunlu @K1C' }] } });
  try {
    await click(p, card(p).querySelectorAll('.card').find((b) => /Crochet mural/.test(b.textContent)), 'Mes pièces récentes', 200);
    assert.match(norm(card(p).textContent), /Belle impression/);
    assert.ok(p.$('stepalert').classList.contains('hidden'), 'une vieille erreur ne redevient pas un avis');
    p.ctx.PlyoV2.panel.newConversation();
    await sleep(50);
    // La pièce du projet d'avant est encore sur le plateau : dit, et remplacée par la nouvelle (jamais imprimées ensemble).
    assert.match(norm(card(p).textContent), /« Crochet mural », la pièce de ton projet d'avant, est encore sur le plateau/);
    await pickBoat(p);
    assert.equal(sent(p, 'model_add').at(-1).replace, true);
    assert.deepEqual(p.sim.S.plate.objects.map((o) => o.name), ['Petit bateau de test (3DBenchy)']);
    await tap(p, /^Continuer$/, 'Continuer', 300);
    assert.match(norm(card(p).textContent), /Comme la dernière fois/);
    await click(p, p.$('card-primary'), 'Oui, c’est ça', 500);
    assert.match(norm(card(p).textContent), /À quoi va servir ta pièce/);
    // Bascule vers le classique : la conversation est enregistrée avant de partir ; au retour, le projet reprend où il en était.
    await click(p, byText(card(p), /Suggéré/) || card(p).querySelectorAll('.card').find((b) => /Suggéré/.test(b.textContent)), 'usage', 900);
    p.$('btn-more').click();
    p.$('m-ui').click();
    await sleep(20);
    const types = p.posted.map((m) => m.type);
    assert.ok(types.lastIndexOf('conv_save') < types.lastIndexOf('firststeps_set'), 'enregistrée avant la bascule');
    const S = p.sim.S;
    const back = await start({ conversations: S.convs, attached: S.attached, plate: S.plate.objects, sliced: S.sliced, orcaPrinter: S.orca.printer, orcaFilament: S.orca.filament, settings: S.settings, spools: S.spools });
    try {
      await sleep(200);
      assert.match(norm(card(back).textContent), /Tout est prêt/);
      assert.deepEqual(back.sim.S.refusals, []);
    } finally { back.stop(); }
    assert.deepEqual(p.sim.S.refusals, []);
  } finally { p.stop(); }
});

test('parcours 11 : sans compte, « Créer ma pièce » demande la connexion sur l’étape ; formule requise : « Voir les formules »', async () => {
  const p = await start();
  try {
    await tap(p, /Créer avec l'IA/);
    const ta = p.$('design-text');
    ta.value = 'Une équerre';
    ta.dispatch('input');
    await click(p, p.$('card-primary'), 'Créer ma pièce (sans compte)');
    assert.match(norm(p.$('stepalert').textContent), /connecte-toi.*Me connecter/);
    await click(p, byText(p.$('stepalert'), /Me connecter/), 'Me connecter', 200);
    assert.ok(p.$('stepalert').classList.contains('hidden'), 'connecté : l’avis part');
  } finally { p.stop(); }
  const q = await start({ session: SESSION }, { plan: true });
  try {
    await tap(q, /Créer avec l'IA/);
    const ta = q.$('design-text');
    ta.value = 'Une équerre';
    ta.dispatch('input');
    await click(q, q.$('card-primary'), 'Créer ma pièce (formule requise)', 200);
    assert.equal(norm(q.$('card-primary').textContent), 'Voir les formules', 'pas d’impasse');
    await click(q, q.$('card-primary'), 'Voir les formules');
    assert.match(norm(q.document.getElementById('fenetre').textContent), /Les formules/);
  } finally { q.stop(); }
});

test('parcours 12 : Orca occupé : un refus des réglages s’arrête et se dit (pas de boucle) ; une découpe refusée n’est jamais muette', async () => {
  const p = await start();
  try {
    await pickBoat(p);
    await tap(p, /^Continuer$/, 'Continuer', 300);
    await click(p, p.$('card-primary'), 'Oui avec du PLA', 400);
    p.sim.busy(true);
    await click(p, card(p).querySelectorAll('.card').find((b) => /Suggéré/.test(b.textContent)), 'usage (Orca occupé)', 900);
    assert.equal(sent(p, 'apply').length, 1, 'une seule demande, pas une boucle');
    assert.match(norm(card(p).textContent), new RegExp(norm(TEXTS.busy).slice(0, 30)));
    p.sim.busy(false);
    await click(p, byText(card(p), /^Réessayer$/), 'Réessayer', 900);
    assert.match(norm(card(p).textContent), /Tout est prêt/);
  } finally { p.stop(); }
  const q = await start();
  try {
    await pickBoat(q);
    await tap(q, /^Continuer$/, 'Continuer', 300);
    await click(q, q.$('card-primary'), 'Oui avec du PLA', 400);
    q.sim.S.jobBusy = true; // Orca range le plateau : la découpe est refusée « occupé »
    setTimeout(() => { q.sim.S.jobBusy = false; }, 1200);
    await click(q, card(q).querySelectorAll('.card').find((b) => /Suggéré/.test(b.textContent)), 'usage (plateau occupé)', 2200, { retried: true });
    assert.match(norm(card(q).textContent), /Tout est prêt/, 'la découpe est redemandée d’elle-même');
    // Plateau vidé dans Orca : la découpe refusée est dite dans la carte, avec « Découper à nouveau ».
    q.sim.S.plate.objects = [];
    q.sim.S.sliced = false;
    q.ctx.PlyoV2.panel.post({ type: 'tour_signals' });
    await sleep(600);
    assert.match(norm(card(q).textContent), /Ta pièce n'est plus sur le plateau.*Revenir à l'étape 1/);
    assert.ok(q.$('card-primary').disabled, 'rien à lancer');
    await click(q, byText(card(q), /Revenir à l'étape 1/), 'Revenir à l’étape 1');
  } finally { q.stop(); }
});

test('parcours 13 : Plyo Slicer passé sur une autre machine : rien n’est découpé ni envoyé pour elle, « Remettre » reprend', async () => {
  const p = await start({ printers: [K1C, ENDER] });
  try {
    await toReady(p);
    const slices = sent(p, 'plate_action').filter((m) => m.kind === 'slice').length;
    p.sim.orcaSelectsPrinter(ENDER.preset);
    await sleep(300);
    assert.match(norm(card(p).textContent), /Plyo Slicer est passé sur/);
    assert.equal(sent(p, 'plate_action').filter((m) => m.kind === 'slice').length, slices, 'pas de découpe pour une autre machine');
    assert.ok(p.$('card-primary').disabled, 'pas d’envoi');
    assert.equal(norm(p.$('card-primary').textContent), 'Choisis d\'abord ci-dessus');
    await click(p, byText(card(p), /^Remettre /), 'Remettre K1C', 900);
    assert.equal(p.sim.S.orca.printer, K1C.preset);
    assert.match(norm(card(p).textContent), /Tout est prêt/);
    assert.ok(!p.$('card-primary').disabled);
  } finally { p.stop(); }
});

test('parcours : « Montre-moi » et « Voir l’aperçu » répondent sur le bouton ; « Annuler les derniers réglages » se voit sur l’étape', async () => {
  const p = await start();
  try {
    await toReady(p);
    await click(p, byText(card(p), /^Montre-moi$/), 'Montre-moi', 80);
    assert.ok(byText(card(p), /Ouvert dans Plyo Slicer/), 'le bouton dit que c’est fait');
    await click(p, byText(p.$('stepcard'), /Voir l'aperçu dans Orca/), 'Voir l’aperçu', 80);
    p.$('btn-more').click();
    await click(p, p.$('m-undo'), 'Annuler les derniers réglages', 200);
    assert.match(norm(p.$('stepalert').textContent), /Réglages d'avant remis/);
  } finally { p.stop(); }
});
