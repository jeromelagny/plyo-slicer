// Tests de la logique du projet (fiche « Mon projet ») : node --test resources/web/plyo/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../project-logic.js');

const printer = { preset: 'Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Centauri Carbon 2' };
const filament = { type: 'PLA', preset: 'Generic PLA @ECC2', nozzle_temp: 215, bed_temp: 60 };

test('nextStep suit l’ordre imprimante, pièce, filament, puis ready', () => {
  assert.equal(P.nextStep(P.emptyProject()), 'printer');
  assert.equal(P.nextStep({ printer: printer, filament: null, part: null }), 'part');
  assert.equal(P.nextStep({ printer: printer, filament: null, part: { name: 'a.stl' } }), 'filament');
  assert.equal(P.nextStep({ printer: printer, filament: filament, part: null }), 'part');
  assert.equal(P.nextStep({ printer: printer, filament: filament, part: { name: 'a.stl' } }), 'ready');
});

test('nextStep accepte un projet absent ou abîmé', () => {
  assert.equal(P.nextStep(null), 'printer');
  assert.equal(P.nextStep('abc'), 'printer');
});

test('proposeFrom reprend imprimante et filament à confirmer, sans pièce', () => {
  const p = P.proposeFrom({ printer: printer, filament: filament, part: { name: 'a.stl' } });
  assert.equal(p.printer.proposed, true);
  assert.equal(p.filament.proposed, true);
  assert.equal(p.part, null);
  assert.equal(P.nextStep(p), 'printer');
});

test('confirm retire la marque « proposé »', () => {
  const p = P.confirm(P.proposeFrom({ printer: printer, filament: filament, part: null }));
  assert.equal(p.printer.proposed, undefined);
  assert.equal(P.nextStep(p), 'part');
});

test('nextGuidedStep va de slice à after puis null', () => {
  assert.deepEqual(P.GUIDED_STEPS, ['slice', 'print', 'after']);
  assert.equal(P.nextGuidedStep('slice'), 'print');
  assert.equal(P.nextGuidedStep('after'), null);
});

test('partFromPlate prend la pièce posée sur le plateau quand la fiche attend la pièce', () => {
  const ready = { printer: printer, filament: filament, part: null };
  assert.equal(P.partFromPlate(ready, { objects: 1, part_name: 'bague.3mf' }), 'bague.3mf');
  assert.equal(P.partFromPlate(ready, { objects: 2, part_name: '' }), 'Pièce posée sur le plateau');
  assert.equal(P.partFromPlate(ready, { objects: 0, part_name: '' }), null);
  assert.equal(P.partFromPlate({ printer: printer, filament: filament, part: { name: 'a.stl' } }, { objects: 1, part_name: 'b.stl' }), null);
  assert.equal(P.partFromPlate({ printer: printer, filament: null, part: null }, { objects: 1, part_name: 'b.stl' }), 'b.stl');
  assert.equal(P.partFromPlate(P.emptyProject(), { objects: 1, part_name: 'b.stl' }), 'b.stl'); // pièce déjà sur le plateau avant même la machine
  assert.equal(P.partFromPlate(ready, null), null);
});

test('needsAdaptation : un 3MF se règle sur le projet une fois machine, pièce et filament choisis, une seule fois par pièce et par machine', () => {
  const ready = { printer: printer, filament: filament, part: { name: 'bague.3mf' } };
  assert.equal(P.needsAdaptation(ready), true);
  assert.equal(P.needsAdaptation(Object.assign({ adapted: 'bague.3mf' }, ready)), false);
  assert.equal(P.needsAdaptation(Object.assign({ adapted: 'autre.3mf' }, ready)), true);
  assert.equal(P.needsAdaptation({ printer: printer, filament: filament, part: { name: 'bague.stl' } }), false);
  assert.equal(P.needsAdaptation({ printer: printer, filament: null, part: { name: 'bague.3mf' } }), false);
  assert.equal(P.needsAdaptation({ printer: printer, filament: Object.assign({ proposed: true }, filament), part: { name: 'bague.3mf' } }), false);
  assert.equal(P.needsAdaptation(null), false);
});

test('restorable : remettre le projet dans Orca ne demande que la machine, le filament est facultatif', () => {
  assert.equal(P.restorable({ printer: printer }), true);
  assert.equal(P.restorable({ printer: printer, part: { name: 'a.stl' } }), true);
  assert.equal(P.restorable({ printer: Object.assign({ proposed: true }, printer) }), false);
  assert.equal(P.restorable(P.emptyProject()), false);
  assert.equal(P.restorable(null), false);
});

test('partFromPlate : la pièce du projet précédent n’est pas reprise en silence', () => {
  const old = { name: 'premier.stl', objects: 1 };
  assert.equal(P.partFromPlate({}, { objects: 1, part_name: 'premier.stl' }, old), null);
  assert.equal(P.partFromPlate({}, { objects: 1, part_name: 'neuf.stl' }, old), 'neuf.stl', 'une autre pièce est reconnue');
  assert.equal(P.partFromPlate({}, { objects: 2, part_name: 'premier.stl' }, old), 'Pièce posée sur le plateau', 'une pièce de plus est reconnue');
  assert.equal(P.partFromPlate({}, { objects: 1, part_name: 'premier.stl' }), 'premier.stl', 'sans projet précédent : comme avant');
});

test('les emplacements du projet gardent leur numéro et leur nature à la copie', async () => {
  const entry = { t: 0, canvas_id: 1, tray_id: 0, label: '1A', imposable: true, source: 'printer', system: 'cfs' };
  assert.deepEqual(P.confirm({ printer: null, filament: null, part: null, canvas: [entry] }).canvas, [entry]);
});
