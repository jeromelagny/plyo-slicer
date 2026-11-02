// Tests de la logique du parcours en six étapes : node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const J = require('../journey-logic.js');

const printer = { preset: 'Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Centauri Carbon 2' };
const filament = { type: 'PLA', preset: 'Generic PLA @ECC2', nozzle_temp: 215, bed_temp: 60 };
const part = { name: 'flexyring.stl' };
const full = (extra) => Object.assign({ printer: printer, filament: filament, part: part }, extra || {});

test('les six étapes sont dans l’ordre voulu', () => {
  assert.deepEqual(J.STEPS.map((s) => s.key), ['machine', 'filament', 'piece', 'preparer', 'imprimer', 'resultat']);
  assert.deepEqual(J.STEPS.map((s) => s.label), ['Machine', 'Filament', 'Pièce', 'Préparer', 'Imprimer', 'Résultat']);
});

test('currentStep suit la fiche puis project.step', () => {
  assert.equal(J.currentStep(null), 'machine');
  assert.equal(J.currentStep({ printer: printer }), 'filament');
  assert.equal(J.currentStep({ printer: printer, filament: filament }), 'piece');
  assert.equal(J.currentStep(full()), 'preparer');
  assert.equal(J.currentStep(full({ step: 'slice' })), 'preparer');
  assert.equal(J.currentStep(full({ step: 'print' })), 'imprimer');
  assert.equal(J.currentStep(full({ step: 'after' })), 'resultat');
});

test('une conversation ancienne (step absent ou done) est à Préparer', () => {
  assert.equal(J.currentStep(full({ step: 'done' })), 'preparer');
  assert.equal(J.currentStep(full({ step: 'inconnu' })), 'preparer');
});

test('steps marque les étapes faites, l’étape en cours et celles à venir', () => {
  const s = J.steps(full({ step: 'print' }));
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'done', 'done', 'current', 'todo']);
  assert.equal(s[4].label, 'Imprimer');
});

test('primaryAction : un seul bouton, pas de bouton pour les trois choix', () => {
  for (const step of ['machine', 'filament', 'piece']) {
    const a = J.primaryAction(step, { sliced: false, linked: false, risks: 0 });
    assert.equal(a.kind, 'none');
    assert.equal(a.enabled, false);
  }
  assert.deepEqual(J.primaryAction('preparer', { sliced: false, linked: true, risks: 0 }), { label: 'Découper', kind: 'slice', enabled: true });
  assert.deepEqual(J.primaryAction('preparer', { sliced: true, linked: true, risks: 2 }), { label: 'Appliquer les correctifs', kind: 'fix', enabled: true });
  assert.deepEqual(J.primaryAction('preparer', { sliced: true, linked: true, risks: 0 }), { label: 'Continuer', kind: 'advance', enabled: true });
  assert.deepEqual(J.primaryAction('imprimer', { sliced: true, linked: true, risks: 0 }), { label: 'Envoyer et imprimer', kind: 'send', enabled: true });
  assert.deepEqual(J.primaryAction('imprimer', { sliced: true, linked: false, risks: 0 }), { label: 'Exporter le fichier', kind: 'export', enabled: true });
  assert.deepEqual(J.primaryAction('imprimer', { sliced: false, linked: true, risks: 0 }), { label: 'Découper', kind: 'slice', enabled: true });
  assert.deepEqual(J.primaryAction('resultat', { sliced: true, linked: true, risks: 0 }), { label: 'Envoyer une photo', kind: 'photo', enabled: true });
});

test('prompt dit quoi faire à chaque étape', () => {
  for (const s of J.STEPS) assert.ok(J.prompt(s.key, { sliced: false, linked: false, risks: 0 }).length > 5, s.key);
  assert.match(J.prompt('machine', {}), /imprimante/i);
});

test('afterPreflight avance seulement sans risque', () => {
  assert.equal(J.afterPreflight(0), 'advance');
  assert.equal(J.afterPreflight(2), 'stay');
});

test('resetStepOnChange ramène à la découpe quand la machine ou le filament change', () => {
  const before = full({ step: 'print' });
  const other = full({ step: 'print', filament: Object.assign({}, filament, { preset: 'Generic PETG @ECC2' }) });
  assert.equal(J.resetStepOnChange(before, other).step, 'slice');
  assert.equal(J.resetStepOnChange(before, full({ step: 'print' })).step, 'print');
  assert.equal(J.resetStepOnChange(full({ step: 'slice' }), full({ step: 'slice', filament: other.filament })).step, 'slice');
  assert.equal(J.resetStepOnChange(null, before).step, 'print');
});

test('la barre passe en pastilles sous 340 px et la fiche se réduit sur fenêtre basse ou repliée', () => {
  assert.equal(J.barMode(320), 'pills');
  assert.equal(J.barMode(339), 'pills');
  assert.equal(J.barMode(340), 'names');
  assert.equal(J.barMode(380), 'names');
  assert.equal(J.compactFiche({ folded: false, heightPx: 500 }), true);
  assert.equal(J.compactFiche({ folded: true, heightPx: 900 }), true);
  assert.equal(J.compactFiche({ folded: false, heightPx: 900 }), false);
});

test('ficheSummary omet les parties absentes', () => {
  assert.equal(J.ficheSummary(full()), 'Centauri Carbon 2 · PLA 215/60 · flexyring.stl');
  const partial = J.ficheSummary({ printer: printer });
  assert.equal(partial, 'Centauri Carbon 2');
  assert.ok(!/undefined|null/.test(J.ficheSummary(null)));
});

test('suggestionsFor : quatre au plus, avec les bonnes ouvertures', () => {
  for (const s of J.STEPS) {
    const list = J.suggestionsFor(s.key);
    assert.ok(list.length >= 1 && list.length <= 4, s.key);
    for (const x of list) assert.ok(x.label && (x.kind === 'ask' || x.kind === 'open'), s.key);
  }
  assert.ok(J.suggestionsFor('preparer').some((x) => x.kind === 'open' && x.value === 'check'));
  assert.ok(J.suggestionsFor('imprimer').some((x) => x.kind === 'open' && x.value === 'parts'));
  assert.ok(J.suggestionsFor('machine').some((x) => x.kind === 'open' && x.value === 'values'));
  assert.ok(!J.suggestionsFor('machine').some((x) => x.value === 'limits'));
  assert.ok(J.suggestionsFor('filament').some((x) => x.value === 'limits'));
});

test('toggleFold : écrire replie, la flèche bascule, changer d’étape déplie', () => {
  assert.deepEqual(J.toggleFold({ folded: false, ficheOpen: true }, 'send'), { folded: true, ficheOpen: false });
  assert.deepEqual(J.toggleFold({ folded: true, ficheOpen: false }, 'toggle'), { folded: false, ficheOpen: false });
  assert.deepEqual(J.toggleFold({ folded: false, ficheOpen: false }, 'toggle'), { folded: true, ficheOpen: false });
  assert.deepEqual(J.toggleFold({ folded: true, ficheOpen: true }, 'stepChange'), { folded: false, ficheOpen: true });
  assert.deepEqual(J.toggleFold({ folded: true, ficheOpen: false }, 'inconnu'), { folded: true, ficheOpen: false });
});
