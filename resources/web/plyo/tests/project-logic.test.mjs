// Tests de la logique du projet (fiche « Mon projet ») : node --test resources/web/plyo/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../project-logic.js');

const printer = { preset: 'Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Centauri Carbon 2' };
const filament = { type: 'PLA', preset: 'Generic PLA @ECC2', nozzle_temp: 215, bed_temp: 60 };

test('nextStep suit l’ordre imprimante, filament, pièce, puis ready', () => {
  assert.equal(P.nextStep(P.emptyProject()), 'printer');
  assert.equal(P.nextStep({ printer: printer, filament: null, part: null }), 'filament');
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
  assert.equal(P.partFromPlate({ printer: printer, filament: null, part: null }, { objects: 1, part_name: 'b.stl' }), null);
  assert.equal(P.partFromPlate(ready, null), null);
});
