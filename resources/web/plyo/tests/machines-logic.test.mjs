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

test('visiblePrinters : une machine masquée disparaît avec tous ses profils, sans rien supprimer', () => {
  const list = [
    cc2, k2, sys,
    { preset: 'Ma Elegoo Centauri Carbon 2 0.4 nozzle - Copie', name: 'Ma Elegoo Centauri Carbon 2 0.4 nozzle - Copie', linked: true }
  ];
  const shown = M.visiblePrinters(list, [k2.preset]);
  assert.deepEqual(shown.map((p) => p.preset).sort(), [cc2.preset, 'Ma Elegoo Centauri Carbon 2 0.4 nozzle - Copie'].sort());
  assert.equal(M.visiblePrinters(list, []).length, 4);
  assert.equal(M.visiblePrinters(null, []).length, 0);
  assert.equal(list.length, 4); // la liste d'origine n'est pas modifiée
});

test('isKnownHost : une machine trouvée sur le réseau est connue si une machine a déjà cette adresse', () => {
  const printers = [{ preset: 'a', host: '192.168.1.29', linked: true }, { preset: 'b', host: '192.168.1.40:7125', linked: true }, { preset: 'c', host: '', linked: false }];
  assert.equal(M.isKnownHost(printers, '192.168.1.29'), true);
  assert.equal(M.isKnownHost(printers, '192.168.1.40'), true);
  assert.equal(M.isKnownHost(printers, '192.168.1.99'), false);
  assert.equal(M.isKnownHost(printers, ''), false);
  assert.equal(M.isKnownHost(null, '192.168.1.1'), false);
});

test('machineThatFits : propose une autre machine reliée dont le plateau accepte la pièce', () => {
  const k2b = Object.assign({}, k2, { bed_mm: [220, 220] });
  const cc2b = Object.assign({}, cc2, { bed_mm: [256, 256] });
  assert.equal(M.machineThatFits([k2b, cc2b], k2b.preset, [260, 100, 10]), null);          // aucune ne tient
  assert.equal(M.machineThatFits([k2b, cc2b], k2b.preset, [240, 100, 10]).preset, cc2b.preset);
  assert.equal(M.machineThatFits([k2b, cc2b], cc2b.preset, [240, 100, 10]), null);        // la machine actuelle tient déjà : rien à proposer
  assert.equal(M.machineThatFits([k2b, cc2b], k2b.preset, [100, 240, 10]).preset, cc2b.preset);
  assert.equal(M.machineThatFits([k2b, Object.assign({}, cc2b, { linked: false })], k2b.preset, [240, 100, 10]), null); // pas reliée
  assert.equal(M.machineThatFits(null, 'x', [1, 1, 1]), null);
});

test('niveau d’explication : deviné tant que l’utilisateur ne l’a pas choisi, puis figé', () => {
  let h = M.emptyHabits();
  assert.equal(M.levelOf(h), 'detailed');
  h = M.guessLevel(h, 'short');
  assert.equal(M.levelOf(h), 'short');
  h = M.chooseLevel(h, 'detailed');
  assert.equal(M.levelOf(h), 'detailed');
  h = M.guessLevel(h, 'short'); // choisi à la main : la supposition ne change plus rien
  assert.equal(M.levelOf(h), 'detailed');
});

test('questions d’intention : après trois projets passés de suite, on propose de ne plus les poser', () => {
  let h = M.emptyHabits();
  assert.equal(M.askIntent(h), true);
  h = M.noteIntent(M.noteIntent(h, true), true);
  assert.equal(M.offerStopAsking(h), false);
  h = M.noteIntent(h, true);
  assert.equal(M.offerStopAsking(h), true);
  assert.equal(M.offerStopAsking(M.noteIntent(h, false)), false); // une réponse remet le compteur à zéro
  h = M.stopAsking(h, true);
  assert.equal(M.askIntent(h), false);
  assert.equal(M.offerStopAsking(h), false);
  assert.equal(M.askIntent(M.stopAsking(h, false)), true);
});
