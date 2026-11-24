// Logique partagée de l'étape « Machine et bobine » (materiel-logic.js), utilisée par le classique et la v2.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.PlyoCanvas = require('../canvas-logic.js');
globalThis.PlyoColours = require('../colours-logic.js');
const M = require('../materiel-logic.js');
const P = require('../project-logic.js');

const CFS = { ok: true, system: 'cfs', empty_blocks: true, colours: [{ t: 0, color: '#FFFFFF', type: 'PLA' }],
  canvases: [{ canvas_id: 0, connected: true, trays: [
    { tray_id: 0, type: 'PETG', color: '#FFFFFF', status: 1, label: '1A' }, { tray_id: 1, type: 'PLA', color: '#F0F0F0', status: 1, label: '1B' },
    { tray_id: 2, type: 'PLA', color: '#D1495B', status: 1, label: '1C' }, { tray_id: 3, type: '', color: '', status: 0, label: '1D' }] }] };
const K2 = { preset: 'K2', linked: true, slots: 'cfs' };

test('quand lire les emplacements, quand proposer la saisie manuelle', () => {
  assert.equal(M.slotsWanted(K2, true), true);
  assert.equal(M.slotsWanted(K2, false), false, 'seulement à l’étape de la bobine');
  assert.equal(M.slotsWanted({ preset: 'K2', slots: 'cfs', linked: false }, true), false, 'une machine non reliée ne se lit pas');
  assert.equal(M.manualWanted({ preset: 'K1C', linked: true }, true, {}), true, 'machine sans lecteur : saisie manuelle');
  assert.equal(M.manualWanted({ preset: 'CC2', linked: true, slots: 'canvas' }, true, {}), false, 'la CC2 garde sa liste');
  assert.equal(M.manualWanted(K2, true, { loading: false, preset: 'K2', state: { ok: false } }), true, 'CFS injoignable');
  assert.equal(M.manualWanted(K2, true, { loading: true, preset: 'K2', state: { ok: false } }), false);
  assert.equal(M.manualWanted(null, true, {}), false);
  assert.equal(M.knownPrinter([K2, { preset: 'X' }], 'K2'), K2);
  assert.equal(M.knownPrinter([K2], ''), null);
});

test('état des emplacements : la lecture réussie, sinon la saisie, sinon la lecture ratée', () => {
  const manual = { preset: 'K2', state: { ok: true, source: 'manual' } };
  assert.equal(M.slotState('K2', { preset: 'K2', state: CFS }, manual), CFS);
  assert.equal(M.slotState('K2', { preset: 'K2', state: { ok: false } }, manual), manual.state);
  assert.deepEqual(M.slotState('K2', { preset: 'K2', state: { ok: false } }, {}), { ok: false });
  assert.equal(M.slotState('K2', { preset: 'AUTRE', state: CFS }, {}), null);
  assert.equal(M.slotState('', { preset: 'K2', state: CFS }, {}), null);
  assert.deepEqual(M.canvasColours(null, null), [{ t: 0, color: '', type: '' }], 'au moins une couleur');
  assert.deepEqual(M.canvasColours(CFS, { colours: [{ t: 0 }, { t: 1 }] }).length, 2, 'les couleurs de la carte « Couleurs » d’abord');
  assert.deepEqual(M.canvasColours(CFS, null), CFS.colours);
});

test('proposition couleur → emplacement : le type du filament du projet, jamais un emplacement vide refusé, le choix déjà fait repris', () => {
  const one = M.canvasProposal([{ t: 0, color: '#FFFFFF', type: '' }], CFS, null, { type: 'PLA', preset: 'PLA' });
  assert.deepEqual(one.map((m) => m.tray_id), [1], 'PLA le plus proche du blanc, pas le PETG');
  const kept = M.canvasProposal([{ t: 0, color: '#FFFFFF' }], CFS, [{ t: 0, canvas_id: 0, tray_id: 2 }], null);
  assert.deepEqual(kept, [{ t: 0, color: '#FFFFFF', canvas_id: 0, tray_id: 2 }]);
  const two = M.canvasProposal([{ t: 0, color: '#FFFFFF', type: 'PLA' }, { t: 1, color: '#D00000', type: 'PLA' }], CFS, null, null);
  assert.deepEqual(two.map((m) => m.tray_id), [1, 2]);
  assert.ok(!M.canvasProposal([{ t: 0, color: '', type: '' }], CFS, null, null).some((m) => m.tray_id === 3), 'vide : pas proposé sur un CFS');
});

test('écran des emplacements (canvasMode) : chargement, rappel, trop de couleurs, Couleurs, plusieurs, un seul', () => {
  const base = { wantsFilament: true, wanted: true, manualWanted: false, loading: false, readFor: 'K2', preset: 'K2', state: CFS, colours: CFS.colours, coloursReady: true, coloursState: null, fileRows: 0 };
  assert.equal(M.canvasMode(base), 'single');
  assert.equal(M.canvasMode(Object.assign({}, base, { loading: true })), 'loading');
  assert.equal(M.canvasMode(Object.assign({}, base, { readFor: 'AUTRE' })), 'loading', 'pas encore lu pour cette machine');
  assert.equal(M.canvasMode(Object.assign({}, base, { coloursReady: false })), 'loading', 'la carte Couleurs suit tout de suite');
  assert.equal(M.canvasMode(Object.assign({}, base, { useList: true })), null);
  assert.equal(M.canvasMode(Object.assign({}, base, { manualForm: true })), 'manual');
  assert.equal(M.canvasMode(Object.assign({}, base, { tempsPending: true })), null, 'emplacement déjà choisi : les températures');
  assert.equal(M.canvasMode(Object.assign({}, base, { tempsPending: true, editing: true })), 'single');
  assert.equal(M.canvasMode(Object.assign({}, base, { colours: [{ t: 0 }, { t: 1 }] })), 'multi');
  assert.equal(M.canvasMode(Object.assign({}, base, { colours: [0, 1, 2, 3, 4].map((t) => ({ t })) })), 'tooMany');
  assert.equal(M.canvasMode(Object.assign({}, base, { fileRows: 2 })), 'colours');
  const parts = { ok: true, pieces: [{ ref: '1', name: 'Porte-clés', t: 0, parts: [{ ref: '2', t: 0 }, { ref: '3', t: 1 }] }], colours: [{ t: 0 }, { t: 1 }] };
  assert.equal(M.canvasMode(Object.assign({}, base, { coloursState: parts, colours: parts.colours })), 'colours', 'pièce en parties : la carte Couleurs');
  assert.equal(M.canvasMode(Object.assign({}, base, { state: Object.assign({}, CFS, { source: 'manual' }) })), 'recall');
  assert.equal(M.canvasMode(Object.assign({}, base, { state: Object.assign({}, CFS, { source: 'manual' }), manualConfirmed: true })), 'single');
  assert.equal(M.canvasMode(Object.assign({}, base, { state: { ok: false } })), null, 'lecture ratée : la liste des bobines');
  const single = { ok: true, system: 'cfs', canvases: [{ canvas_id: 0, connected: true, trays: [{ tray_id: 0, type: 'PLA', color: '#FFFFFF', label: '1' }] }] };
  assert.equal(M.canvasMode(Object.assign({}, base, { state: single })), null, 'un seul emplacement : aucune question');
});

test('températures de l’étiquette et matières d’une nouvelle bobine', () => {
  assert.equal(M.labelTemp('205'), 205);
  assert.equal(M.labelTemp('190-220 °C'), 205);
  assert.equal(M.labelTemp(60), 60);
  assert.equal(M.labelTemp('aucune'), null);
  assert.deepEqual(M.tempChanges('200', ''), [{ id: 'nozzle_temp', value: 200 }, { id: 'nozzle_temp_initial', value: 200 }]);
  assert.deepEqual(M.tempChanges('', '55-65').map((c) => c.id), ['bed_temp', 'bed_temp_initial']);
  assert.deepEqual(M.tempChanges('', ''), []);
  assert.deepEqual(M.MATERIALS.slice(0, 2), ['PLA', 'PETG'], 'PLA d’abord (présélectionné), puis PETG');
  for (const m of M.MATERIALS) assert.ok(M.materialHelp(m).length > 5, m);
});

test('profil copié « (Plyo) » : le filament du projet suit (followSaved, ex-syncProjectNames du classique)', () => {
  const project = { filament: { type: 'PLA', preset: 'Generic PLA' } };
  assert.equal(P.followSaved(project, [{ type: 'print', from: 'x', name: 'y' }, { type: 'filament', from: 'Generic PLA', name: 'Generic PLA (Plyo)' }]), true);
  assert.equal(project.filament.preset, 'Generic PLA (Plyo)');
  assert.equal(P.followSaved(project, [{ type: 'filament', from: 'Autre', name: 'Autre (Plyo)' }]), false);
  assert.equal(P.followSaved({ filament: null }, [{ type: 'filament', from: 'a', name: 'b' }]), false);
  assert.equal(P.followSaved(project, null), false);
});

test('nouvelle bobine : couleurs proposées et nom (marque, puis couleur ; matière et couleur ; sinon rien)', () => {
  assert.deepEqual(M.COLOURS.slice(0, 3).map((c) => c.name), ['blanc', 'noir', 'gris']);
  assert.ok(M.COLOURS.every((c) => /^#[0-9A-F]{6}$/.test(c.hex)));
  assert.equal(M.colourOf('noir').hex, '#1F1F1F');
  assert.equal(M.colourOf('fuchsia'), null);
  assert.equal(M.spoolName('Sunlu PLA+', 'PLA', 'noir', ''), 'Sunlu PLA+ noir');
  assert.equal(M.spoolName('', 'PETG', 'rouge', ''), 'PETG rouge');
  assert.equal(M.spoolName('Sunlu PLA+', 'PLA', '', ''), 'Sunlu PLA+');
  assert.equal(M.spoolName('', 'PLA', '', 'PLA du 24 novembre'), 'PLA du 24 novembre');
});
