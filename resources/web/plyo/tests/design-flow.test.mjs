import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const F = require('../design-flow.js');
const here = new URL('..', import.meta.url).pathname;
const read = f => fs.readFileSync(here + f, 'utf8');
const plate = JSON.parse(read('tests/fixtures/designs/plaque-percee.json'));

test('demande au concepteur : texte, conversation, pièce en cours seulement pour une retouche', () => {
  const st = { text: '  une boîte de 6 cm  ', conversation: [{ role: 'user', text: 'x' }], retouch: false, part: plate };
  assert.deepEqual(F.request(st, { locale: 'fr', material: 'PLA', requestId: 'r1' }),
    { locale: 'fr', text: 'une boîte de 6 cm', conversation: [{ role: 'user', text: 'x' }], current: null, material: 'PLA', request_id: 'r1' });
  assert.equal(F.request({ ...st, retouch: true }, {}).current, plate);
  assert.equal(F.request({ text: 'a'.repeat(3000) }, {}).text.length, 2000);
});

test('réponses aux questions, cotes et nom de fichier', () => {
  assert.equal(F.answersText([{ text: 'Quelle largeur ?' }, { text: 'Pour quoi ?' }], ['8 cm', 'un téléphone']), 'Quelle largeur ? 8 cm · Pour quoi ? un téléphone');
  assert.deepEqual(F.dimensionLines(plate), ['longueur 100 mm', 'largeur 60 mm', 'épaisseur 3 mm (supposé : vérifie)', 'trous 4,4 mm']);
  assert.equal(F.fileName(plate), 'Plaque 100x60 percee.stl');
  assert.equal(F.fileName({ name: '<<>>' }), 'Piece.stl');
});

test('page : entrée à l’étape Pièce, bibliothèque chargée à la demande, pose comme un fichier, retouche qui remplace', () => {
  const page = read('index.html'), card = read('project-card.js');
  assert.match(card, /ui\.button\('Créer avec l’IA', h\.designOpen, 'pick-card ai-action', 'wand'\)/); // lot 6 : une carte de l'étape Pièce
  assert.match(page, /<!--plyo-include:design-builder\.js-->\n<!--plyo-include:design-flow\.js-->/);
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'design_lib_get' \}\)/);
  assert.match(page, /replace\(\/import\\\.meta\\\.url\/g, '"plyo:\/\/manifold\.js"'\)/);
  assert.match(page, /window\.__plyoManifold\(\{ wasmBinary: bytes \}\)/);
  assert.match(page, /apiFetch\('\/api\/design'/);
  assert.match(page, /replace: asked\.retouch \|\| PlyoProject\.replacesPlate/);
  assert.match(page, /onModelAdded\(msg\);\n\s*designPlaced\(msg\);/);
});

test('croquis ou photo joints : deux au plus, formats acceptés seulement, envoyés avec la demande', () => {
  const img = { name: 'croquis.png', media_type: 'image/jpeg', data: 'QUJD' };
  const body = F.request({ text: 'un support', images: [img, img, img] }, {});
  assert.equal(body.images.length, 2);
  assert.deepEqual(body.images[0], { media_type: 'image/jpeg', data: 'QUJD' }, 'le nom du fichier ne part pas');
  assert.equal(F.request({ text: 'x', images: [{ media_type: 'image/gif', data: 'R0lG' }] }, {}).images, undefined);
  assert.equal(F.request({ text: 'x' }, {}).images, undefined);
  assert.match(read('index.html'), /Math\.min\(1, 1600 \/ Math\.max\(img\.width, img\.height\)\)/);
});

test('discussion : pièce dessinée par Plyo → capacité « redesign », bouton « Modifier ma pièce » qui part au concepteur', () => {
  const page = read('index.html'), L = require('../assistant-logic.js');
  // Corps de la demande : ai-client.js, avec le projet de la conversation.
  assert.match(read('ai-client.js'), /if \(project\.design && project\.design\.part\) body\.capabilities\.push\('redesign'\);/);
  assert.match(page, /PlyoAiClient\.diagnoseBody\(\{[^}]*project: conv\.project,/);
  assert.match(page, /conv\.project\.design = \{ part: answer\.part \};/);
  assert.match(page, /else if \(a\.kind === 'redesign'\) \{[\s\S]{0,400}designStart\(true\);[\s\S]{0,200}designSubmit\(\);/);
  assert.equal(L.actionSupported({ kind: 'redesign', target: 'Retire l’encoche', label: 'Modifier ma pièce' }), true);
  assert.equal(L.actionSupported({ kind: 'redesign', target: ' ', label: 'Modifier ma pièce' }), false);
});

test('pièce retouchée après la préparation ou une réussite : le parcours repart de « Préparer »', () => {
  for (const step of ['preparer', 'imprimer', 'resultat']) assert.equal(F.redoesPreparation(step, true), true, step);
  for (const step of ['machine', 'piece', 'filament']) assert.equal(F.redoesPreparation(step, true), false, step);
  assert.equal(F.redoesPreparation('resultat', false), false, 'une première pièce posée ne touche pas au parcours');
  const page = read('index.html');
  assert.match(page, /if \(tourSignals\) tourSignals\.sliced = false;\n\s*plateChecked = null; openRisks = 0;/);
});

// Faux DOM minimal : chaque nœud garde ses enfants, ses textes et ses boutons.
function fakeUi() {
  const node = (tag, cls, text) => ({ tag, cls, text: text || '', children: [], dataset: {}, value: '', appendChild(c) { this.children.push(c); return c; }, setAttribute() {}, addEventListener() {}, focus() {}, set textContent(t) { this.children = []; this.text = t; } });
  return { el: node, button: (label, fn, cls) => ({ ...node('button', cls, label), fn }), icon: () => node('i') };
}
const texts = (n) => [n.text, ...n.children.flatMap(texts)].filter(Boolean);
const buttons = (n) => [...(n.fn ? [n] : []), ...n.children.flatMap(buttons)];

test('plan_required : « Les pièces sur mesure font partie de Plyo+. » et le bouton vers les formules à la place de « Créer »', () => {
  const ui = fakeUi(), slot = ui.el('div');
  let opened = 0;
  const h = { input() {}, submit() {}, cancel() {}, login() {}, plans: () => { opened++; } };
  F.render(slot, ui, { text: 'une boîte', planRequired: true, message: F.TEXT.planRequired, failed: false }, h);
  assert.ok(texts(slot).includes('Les pièces sur mesure font partie de Plyo+.'));
  const labels = buttons(slot).map((b) => b.text);
  assert.ok(labels.includes('Voir les formules'));
  assert.ok(!labels.includes(F.TEXT.go));
  buttons(slot).find((b) => b.text === 'Voir les formules').fn();
  assert.equal(opened, 1);
  const normal = ui.el('div');
  F.render(normal, ui, { text: 'une boîte' }, h);
  assert.ok(buttons(normal).map((b) => b.text).includes(F.TEXT.go));
});
