// Tests de la logique des machines et des habitudes de filament : node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../project-logic.js');
require('../journey-logic.js');
const M = require('../machines-logic.js');

const cc2 = { preset: 'Ma Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Ma Elegoo Centauri Carbon 2 0.4 nozzle', linked: true };
const k2 = { preset: 'Ma Creality K2 0.4 nozzle', name: 'Ma Creality K2 0.4 nozzle', linked: true };
const sys = { preset: 'Creality K2 0.4 nozzle', name: 'Creality K2 0.4 nozzle', linked: false };

test('machineQuestion : aucune machine reliée → installation', () => {
  assert.equal(M.machineQuestion([], { orcaPreset: '', lastPreset: '', hidden: [] }).mode, 'setup');
  assert.equal(M.machineQuestion([sys], { orcaPreset: '', lastPreset: '', hidden: [] }).mode, 'setup');
  assert.equal(M.machineQuestion(null, {}).mode, 'setup');
});

test('machineQuestion : une seule machine → choisie sans question', () => {
  const q = M.machineQuestion([cc2, sys], { orcaPreset: sys.preset, lastPreset: '', hidden: [] });
  assert.equal(q.mode, 'auto');
  assert.equal(q.machine.preset, cc2.preset);
});

test('machineQuestion : plusieurs machines → confirmation, celle d’Orca d’abord, sinon la dernière utilisée', () => {
  const list = [cc2, k2];
  assert.equal(M.machineQuestion(list, { orcaPreset: k2.preset, lastPreset: cc2.preset, hidden: [] }).machine.preset, k2.preset);
  assert.equal(M.machineQuestion(list, { orcaPreset: 'autre', lastPreset: k2.preset, hidden: [] }).machine.preset, k2.preset);
  const q = M.machineQuestion(list, { orcaPreset: '', lastPreset: '', hidden: [] });
  assert.equal(q.mode, 'confirm');
  assert.equal(q.machine.preset, cc2.preset);
});

test('machineQuestion : une machine masquée n’est jamais proposée', () => {
  const q = M.machineQuestion([cc2, k2], { orcaPreset: k2.preset, lastPreset: '', hidden: [k2.preset] });
  assert.equal(q.mode, 'auto');
  assert.equal(q.machine.preset, cc2.preset);
});

test('habitudes : se souvenir du filament par machine, sans toucher aux autres', () => {
  let h = M.emptyHabits();
  assert.equal(M.habitFor(h, cc2.preset), null);
  h = M.rememberFilament(h, cc2.preset, { type: 'PLA', nozzle_temp: 215, bed_temp: 60 });
  assert.deepEqual(M.habitFor(h, cc2.preset), { type: 'PLA', nozzle_temp: 215, bed_temp: 60 });
  assert.equal(M.habitFor(h, k2.preset), null);
  assert.equal(h.last, cc2.preset);
  h = M.rememberFilament(h, cc2.preset, { type: 'PETG', nozzle_temp: 240, bed_temp: 80 });
  assert.equal(M.habitFor(h, cc2.preset).type, 'PETG');
});

test('habitudes : remplacer copie sans effacer l’ancienne machine, retirer masque sans doublon', () => {
  let h = M.rememberFilament(M.emptyHabits(), cc2.preset, { type: 'PLA', nozzle_temp: 215, bed_temp: 60 });
  h = M.replaceMachine(h, cc2.preset, k2.preset);
  assert.equal(M.habitFor(h, k2.preset).type, 'PLA');
  assert.equal(M.habitFor(h, cc2.preset).type, 'PLA');
  h = M.hideMachine(M.hideMachine(h, cc2.preset), cc2.preset);
  assert.deepEqual(h.hidden, [cc2.preset]);
  h = M.unhideMachine(h, cc2.preset);
  assert.deepEqual(h.hidden, []);
  assert.deepEqual(M.replaceMachine(M.emptyHabits(), 'x', 'y'), M.emptyHabits());
});

test('habitudes : une valeur illisible ne casse rien', () => {
  assert.equal(M.habitFor(null, 'x'), null);
  assert.equal(M.habitFor({ machines: 'abc' }, 'x'), null);
  assert.equal(M.rememberFilament(null, 'x', { type: 'PLA' }).machines.x.filament.type, 'PLA');
});
