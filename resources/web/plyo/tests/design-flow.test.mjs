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
  assert.match(card, /ui\.button\('Je n’ai pas de fichier : crée-moi une pièce', h\.designOpen, 'btn ghost sm', 'wand'\)/);
  assert.match(page, /<!--plyo-include:design-builder\.js-->\n<!--plyo-include:design-flow\.js-->/);
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'design_lib_get' \}\)/);
  assert.match(page, /replace\(\/import\\\.meta\\\.url\/g, '"plyo:\/\/manifold\.js"'\)/);
  assert.match(page, /window\.__plyoManifold\(\{ wasmBinary: bytes \}\)/);
  assert.match(page, /apiFetch\('\/api\/design'/);
  assert.match(page, /replace: asked\.retouch \|\| PlyoProject\.replacesPlate/);
  assert.match(page, /onModelAdded\(msg\);\n\s*designPlaced\(msg\);/);
});
