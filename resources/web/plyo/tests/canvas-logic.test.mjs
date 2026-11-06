// Tests de la logique pure des emplacements du Canvas (canvas-logic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../canvas-logic.js');

// État renvoyé par canvas_read pour la CC2 de Jérôme (2026-11-03).
const STATE = { ok: true, canvases: [{ canvas_id: 0, connected: true, trays: [
  { tray_id: 0, type: 'PLA', color: '#FCEBD7', status: 0 },
  { tray_id: 1, type: 'PLA', color: '#F95D77', status: 1 },
  { tray_id: 2, type: 'ASA', color: '#898989', status: 1 },
  { tray_id: 3, type: 'PLA', color: '#7C4C00', status: 1 }] }] };

test('colourName : un nom français simple pour la couleur d’un emplacement', () => {
  assert.equal(C.colourName('#7C4C00'), 'brun');
  assert.equal(C.colourName('#F95D77'), 'rose');
  assert.equal(C.colourName('#898989'), 'gris');
  assert.equal(C.colourName('#FCEBD7'), 'crème');
  assert.equal(C.colourName('#000000'), 'noir');
  assert.equal(C.colourName('#FFFFFF'), 'blanc');
  assert.equal(C.colourName('#1E50D2'), 'bleu');
  assert.equal(C.colourName(''), '');
  assert.equal(C.colourName('rouge'), '');
});

test('trays : les emplacements des unités connectées, numérotés comme sur l’écran', () => {
  const list = C.trays(STATE);
  assert.equal(list.length, 4);
  assert.equal(list[3].label, '4 · PLA brun');
  assert.equal(list[3].tray_id, 3);
  assert.equal(list[0].empty, true);
  assert.equal(list[1].empty, false);
  const off = { ok: true, canvases: [{ canvas_id: 0, connected: false, trays: STATE.canvases[0].trays }] };
  assert.deepEqual(C.trays(off), []);
  assert.deepEqual(C.trays(null), []);
  assert.deepEqual(C.trays({ ok: false }), []);
});

test('propose : une couleur va sur un emplacement du même type, puis de la couleur la plus proche', () => {
  const trays = C.trays(STATE);
  // Pièce d'une couleur, filament du projet PLA, couleur du fichier brun foncé : emplacement 4.
  const one = C.propose([{ t: 0, color: '#6B4000', type: 'PLA' }], trays);
  assert.deepEqual(one.map(m => m.tray_id), [3]);
  // Type sans emplacement : pas d'association proposée.
  assert.equal(C.propose([{ t: 0, color: '#000000', type: 'PETG' }], trays)[0].tray_id, null);
  // Type inconnu : la couleur décide.
  assert.equal(C.propose([{ t: 0, color: '#8A8A8A' }], trays)[0].tray_id, 2);
  // Deux couleurs : jamais le même emplacement dans la proposition.
  const two = C.propose([{ t: 0, color: '#F95D77', type: 'PLA' }, { t: 1, color: '#FF6080', type: 'PLA' }], trays);
  assert.equal(two[0].tray_id, 1);
  assert.notEqual(two[1].tray_id, 1);
  assert.notEqual(two[1].tray_id, null);
  // Un emplacement vu vide reste proposé (status non fiable, voir le design du 03/11 : « ne pas en déduire qu'il est inutilisable »).
  assert.equal(C.propose([{ t: 0, color: '#FCEBD7', type: 'PLA' }], trays)[0].tray_id, 0);
  // Plus de couleurs que d'emplacements : les dernières restent sans emplacement.
  const five = C.propose([0, 1, 2, 3, 4].map(t => ({ t, color: '#808080' })), trays);
  assert.equal(five.filter(m => m.tray_id === null).length, 1);
});

test('complete et tooMany', () => {
  assert.equal(C.complete([{ t: 0, canvas_id: 0, tray_id: 3 }]), true);
  assert.equal(C.complete([{ t: 0, canvas_id: 0, tray_id: 3 }, { t: 1, canvas_id: 0, tray_id: null }]), false);
  assert.equal(C.complete([]), false);
  assert.equal(C.tooMany([0, 1, 2, 3, 4].map(t => ({ t })), C.trays(STATE)), true);
  assert.equal(C.tooMany([{ t: 0 }], C.trays(STATE)), false);
});

test('checkBeforeSend : bloque si un emplacement choisi a changé de type ou a disparu, prévient s’il semble vide', () => {
  const chosen = [{ t: 0, canvas_id: 0, tray_id: 3, type: 'PLA', color: '#7C4C00' }];
  assert.deepEqual(C.checkBeforeSend(chosen, C.trays(STATE)), { block: [], notes: [] });
  const asa = JSON.parse(JSON.stringify(STATE)); asa.canvases[0].trays[3].type = 'ASA';
  assert.equal(C.checkBeforeSend(chosen, C.trays(asa)).block.length, 1);
  assert.match(C.checkBeforeSend(chosen, C.trays(asa)).block[0], /emplacement 4/i);
  // « Vide » selon l'imprimante : seulement une remarque (la CC2 de Jérôme dit vide un emplacement chargé).
  const empty = JSON.parse(JSON.stringify(STATE)); empty.canvases[0].trays[3].status = 0;
  assert.equal(C.checkBeforeSend(chosen, C.trays(empty)).block.length, 0);
  assert.match(C.checkBeforeSend(chosen, C.trays(empty)).notes[0], /vide/);
  const gone = JSON.parse(JSON.stringify(STATE)); gone.canvases[0].trays.pop();
  assert.equal(C.checkBeforeSend(chosen, C.trays(gone)).block.length, 1);
  const recoloured = JSON.parse(JSON.stringify(STATE)); recoloured.canvases[0].trays[3].color = '#000000';
  const r = C.checkBeforeSend(chosen, C.trays(recoloured));
  assert.equal(r.block.length, 0);
  assert.equal(r.notes.length, 1);
});

test('profileTypes : le type exact, puis le type de base', () => {
  assert.deepEqual(C.profileTypes('PLA'), ['PLA']);
  assert.deepEqual(C.profileTypes('pla-cf'), ['PLA-CF', 'PLA']);
  assert.deepEqual(C.profileTypes('PETG+'), ['PETG+', 'PETG']);
  assert.deepEqual(C.profileTypes(''), []);
});

test('mapLabel : rappel de l’étape Imprimer', () => {
  assert.equal(C.mapLabel([{ t: 0, tray_id: 3, type: 'PLA', color: '#7C4C00' }]), 'Emplacement 4 · PLA brun');
  assert.equal(C.mapLabel([{ t: 0, tray_id: 3, type: 'PLA', color: '#7C4C00' }, { t: 1, tray_id: 2, type: 'ASA', color: '#898989' }]),
    'Couleur 1 → emplacement 4 · PLA brun, couleur 2 → emplacement 3 · ASA gris');
  assert.equal(C.mapLabel(null), '');
});

test('propose : un emplacement vu vide n’est pas écarté (status non fiable sur la CC2), il ne départage qu’à couleur égale', () => {
  const list = [
    { canvas_id: 0, tray_id: 0, type: 'PLA', color: '#101010', empty: false },
    { canvas_id: 0, tray_id: 1, type: 'PLA', color: '#F5F5F5', empty: true },
    { canvas_id: 0, tray_id: 2, type: 'PETG', color: '#D02020', empty: false }
  ];
  assert.equal(C.propose([{ t: 0, color: '#FFFFFF', type: 'PLA' }], list)[0].tray_id, 1, 'le PLA blanc, même vu vide');
  const two = C.propose([{ t: 0, color: '#FFFFFF', type: 'PLA' }, { t: 1, color: '#000000', type: 'PLA' }], list);
  assert.deepEqual(two.map((m) => m.tray_id), [1, 0], 'chaque couleur sur la bonne');
  const tie = [{ canvas_id: 0, tray_id: 0, type: 'PLA', color: '#FFFFFF', empty: true }, { canvas_id: 0, tray_id: 1, type: 'PLA', color: '#FFFFFF', empty: false }];
  assert.equal(C.propose([{ t: 0, color: '#FFFFFF', type: 'PLA' }], tie)[0].tray_id, 1, 'à égalité : celui vu chargé');
  assert.equal(C.propose([{ t: 0, color: '', type: '' }], tie)[0].tray_id, 1, 'couleur inconnue : celui vu chargé');
});
