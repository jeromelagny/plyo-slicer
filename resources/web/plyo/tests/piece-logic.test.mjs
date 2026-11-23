// Étape « Ta pièce » : logique partagée par le panneau classique et la v2 (piece-logic.js).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const Piece = require('../piece-logic.js');
const here = new URL('..', import.meta.url).pathname;
const fixture = (name) => JSON.parse(fs.readFileSync(here + 'tests/fixtures/designs/' + name + '.json', 'utf8'));

test('taille mesurée ailleurs : seulement si le projet vise une autre machine que celle d’Orca', () => {
  const proposed = { printer: { preset: 'K2 Plus', proposed: true }, part: null, filament: null };
  assert.equal(Piece.measuredElsewhere(proposed, 'K1C'), true);
  assert.equal(Piece.measuredElsewhere(proposed, 'K2 Plus'), false, 'même machine : « trop grande » est vrai');
  assert.equal(Piece.measuredElsewhere({ printer: { preset: 'K2 Plus' } }, 'K1C'), false, 'machine choisie : la mesure est la sienne');
  assert.equal(Piece.measuredElsewhere({ printer: null }, 'K1C'), false);
});

test('tient sur le plateau : même règle que PlateActions::fits (à plat dans un sens ou l’autre, hauteur)', () => {
  assert.equal(Piece.fits([200, 100, 50], [220, 220, 250]), true);
  assert.equal(Piece.fits([100, 230, 50], [235, 220, 250]), true, 'tournée d’un quart de tour, elle passe');
  assert.equal(Piece.fits([221.8, 100, 50], [220, 220, 250]), false);
  assert.equal(Piece.fits([100, 100, 260], [220, 220, 250]), false, 'trop haute');
  assert.equal(Piece.fits([500, 500, 500], [0, 0, 0]), true, 'plateau inconnu : rien n’est refusé');
  const t = Piece.tooBigText([300, 100, 40], [220, 220, 250]);
  assert.equal(t.title, 'Elle est trop grande pour le plateau.');
  assert.equal(t.text, 'Elle mesure 300 × 100 × 40 mm, et ton imprimante imprime jusqu’à 220 × 220 × 250 mm.');
  assert.equal(Piece.mm([60.04, 31.26, 48]), '60 × 31,3 × 48 mm');
});

test('réponse du concepteur de pièces : session, formule, erreur, questions, refus, pièce', () => {
  const g = { plan: 'gratuit', used_pct: 30 };
  assert.deepEqual(Piece.designOutcome(401, {}), { gauge: null, kind: 'login', text: 'Ta session a expiré : reconnecte-toi pour créer ta pièce.' });
  assert.equal(Piece.designOutcome(403, { error: 'plan_required' }).text, 'Les pièces sur mesure font partie de Plyo+.');
  const poor = Piece.designOutcome(402, { error: 'insufficient_credits', gauge: g });
  assert.equal(poor.kind, 'error');
  assert.equal(poor.spent, g, 'jauge vide rendue avec l’erreur');
  assert.equal(Piece.designOutcome(500, {}).kind, 'error');
  const q = Piece.designOutcome(200, { status: 'question', questions: [{ text: 'Quelle largeur ?', choices: ['5 cm', '8 cm'] }], message: 'Une précision', credits: { gauge: g } });
  assert.equal(q.kind, 'question');
  assert.equal(q.gauge, g, 'la jauge suit la réponse');
  assert.equal(q.message, 'Une précision');
  assert.deepEqual(Piece.designOutcome(200, { status: 'off_topic', message: 'Pas de figurines.' }), { gauge: null, kind: 'refused', text: 'Pas de figurines.' });
  assert.equal(Piece.designOutcome(200, { status: 'design', part: {} }).kind, 'design');
});

test('pièce dessinée → STL en base64 pour model_add, nom de fichier sûr', async () => {
  const Module = (await import('../vendor/manifold/manifold.js')).default;
  const wasm = await Module(); wasm.setup();
  const M = { Manifold: wasm.Manifold, CrossSection: wasm.CrossSection };
  const r = Piece.designFile(M, fixture('entretoise-m4'));
  assert.equal(r.ok, true);
  assert.match(r.name, /\.stl$/);
  const bin = Buffer.from(r.data, 'base64');
  assert.equal(bin.length, 84 + 50 * bin.readUInt32LE(80), 'STL binaire complet');
  const bad = fixture('entretoise-m4'); bad.nodes[1].radius = 900;
  assert.equal(Piece.designFile(M, bad).ok, false);
  assert.equal(Piece.base64(new Uint8Array([80, 108, 121, 111])), 'UGx5bw==');
});

test('bibliothèque de dessin : demandée une fois, chargée avec le jeton de la page, réessayée après un échec', async () => {
  const posted = [], added = [];
  const doc = { createElement: () => ({}), querySelector: (s) => (s === 'script[nonce]' ? { nonce: 'n0nce' } : null), head: { appendChild: (t) => added.push(t) } };
  const win = { atob: (s) => Buffer.from(s, 'base64').toString('binary'), __plyoManifold: async (o) => ({ setup() {}, Manifold: 'M', CrossSection: 'C', bytes: o.wasmBinary }) };
  const lib = Piece.designLibLoader({ post: (m) => posted.push(m), document: doc, window: win });
  const p1 = lib.load(), p2 = lib.load();
  assert.equal(p1, p2);
  assert.deepEqual(posted, [{ type: 'design_lib_get' }]);
  lib.onMessage({ ok: true, js: 'const x = import.meta.url;\nexport default Module;', wasm: Buffer.from([1, 2, 3]).toString('base64') });
  assert.deepEqual(await p1, { Manifold: 'M', CrossSection: 'C' });
  assert.equal(added[0].nonce, 'n0nce');
  assert.equal(added[0].textContent, 'const x = "plyo://manifold.js";\nwindow.__plyoManifold = Module;');
  const lib2 = Piece.designLibLoader({ post: (m) => posted.push(m), document: doc, window: win });
  const failed = lib2.load();
  lib2.onMessage({ ok: false });
  await assert.rejects(failed);
  lib2.load();
  assert.equal(posted.length, 3, 'nouvel essai après un échec');
});

test('« Envie d’ajuster ? » : les ordres que le slicer exécute pour l’assistant, avec leur phrase', () => {
  assert.deepEqual(Piece.adjustCommands('rotate', { ref: 12 }), [{ op: 'rotate', axis: 'z', amount: 90, summary: 'Pièce tournée d’un quart de tour', object: '12' }]);
  assert.deepEqual(Piece.adjustCommands('flat', {}), [{ op: 'lay_flat', summary: 'Pièce posée sur sa plus grande face' }]);
  assert.deepEqual(Piece.adjustCommands('copies', { copies: 3, ref: '7' }), [{ op: 'set_copies', amount: 3, summary: '3 exemplaires sur le plateau', object: '7' }]);
  assert.equal(Piece.adjustCommands('copies', { copies: 99 })[0].amount, 50, 'limite du slicer');
  assert.equal(Piece.adjustCommands('copies', { copies: 0 })[0].summary, 'Un seul exemplaire sur le plateau');
  // Taille : le slicer met à l'échelle par rapport à la taille actuelle ; on vise un pourcentage de la taille posée.
  assert.deepEqual(Piece.adjustCommands('scale', { from: 100, to: 80 }), [{ op: 'scale', amount: 80, summary: 'Pièce mise à 80 % de sa taille d’origine' }]);
  assert.equal(Piece.adjustCommands('scale', { from: 80, to: 100 })[0].amount, 125);
  assert.equal(Piece.adjustCommands('scale', { from: 80, to: 100 })[0].summary, 'Pièce remise à sa taille d’origine');
  assert.equal(Piece.adjustCommands('scale', { from: 100, to: 100 }), null, 'rien à faire');
  assert.equal(Piece.adjustCommands('scale', { from: 100, to: 500 })[0].amount, 200);
  assert.equal(Piece.adjustCommands('cut'), null, 'Couper ouvre l’outil d’Orca (open_tool)');
  assert.equal(Piece.sizePct([60, 31, 48], [48, 24.8, 38.4]), 80);
  assert.equal(Piece.sizePct([60, 31, 48], [31, 60, 48]), 100, 'un quart de tour ne change pas la taille');
  const objects = [{ ref: '1', name: 'Cube' }, { ref: '2', name: 'crochet', selected: true }, { ref: '3', name: 'benchy.3mf' }];
  assert.equal(Piece.pieceObject(objects, 'benchy.stl').ref, '3', 'la pièce du projet, d’après son nom');
  assert.equal(Piece.pieceObject(objects, 'autre.stl').ref, '2', 'sinon la sélectionnée');
  assert.equal(Piece.pieceObject([], 'x'), null);
});

test('« Mes pièces récentes » : projets avec une pièce, les plus récents d’abord, sans celui affiché', () => {
  const items = [
    { id: 'a', title: 'Question', updated: '2026-11-22T10:00:00Z', project: { part: null } },
    { id: 'b', updated: '2026-11-18T10:00:00Z', project: { part: { name: 'benchy.3mf' }, printer: { preset: 'K1C' }, filament: { preset: 'PLA' }, step: 'after', success: true } },
    { id: 'c', updated: '2026-11-22T09:00:00Z', project: { part: { name: 'crochet.stl' } } },
    { id: 'd', updated: '2026-11-23T09:00:00Z', project: { part: { name: 'en-cours.stl' } } },
  ];
  const list = Piece.recentParts(items, 'd');
  assert.deepEqual(list.map((x) => x.id), ['c', 'b']);
  assert.equal(list[0].title, 'crochet.stl');
  assert.match(list[1].detail, /^Imprimé le .*, réussi$/);
  assert.equal(Piece.recentParts(items, null, 1).length, 1);
  assert.deepEqual(Piece.recentParts(null), []);
});
