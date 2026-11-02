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
  assert.deepEqual(J.STEPS.map((s) => s.key), ['machine', 'piece', 'filament', 'preparer', 'imprimer', 'resultat']);
  assert.deepEqual(J.STEPS.map((s) => s.label), ['Machine', 'Pièce', 'Filament', 'Préparer', 'Imprimer', 'Résultat']);
});

test('currentStep suit la fiche puis project.step', () => {
  assert.equal(J.currentStep(null), 'machine');
  assert.equal(J.currentStep({ printer: printer }), 'piece');
  assert.equal(J.currentStep({ printer: printer, part: part }), 'filament');
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
  assert.equal(J.compactFiche({ folded: false, heightPx: 759 }), true);
  assert.equal(J.compactFiche({ folded: false, heightPx: 760 }), false);
  assert.equal(J.compactFiche({ folded: false, heightPx: 900 }), false);
});

test('ficheSummary omet les parties absentes', () => {
  assert.equal(J.ficheSummary(full()), 'Centauri Carbon 2 · flexyring.stl · PLA 215/60');
  const partial = J.ficheSummary({ printer: printer });
  assert.equal(partial, 'Centauri Carbon 2');
  assert.ok(!/undefined|null/.test(J.ficheSummary(null)));
});

test('suggestionsFor : aucune pendant les choix, deux au plus ensuite, et chaque tiroir reste accessible', () => {
  for (const key of ['machine', 'filament', 'piece']) assert.deepEqual(J.suggestionsFor(key), [], key);
  const opened = [];
  for (const key of ['preparer', 'imprimer', 'resultat']) {
    const list = J.suggestionsFor(key);
    assert.ok(list.length >= 1 && list.length <= 2, key);
    for (const x of list) { assert.ok(x.label && (x.kind === 'ask' || x.kind === 'open'), key); if (x.kind === 'open') opened.push(x.value); }
  }
  for (const what of ['check', 'parts', 'values', 'limits']) assert.ok(opened.includes(what), what + ' n’est plus accessible');
  assert.ok(J.suggestionsFor('preparer').some((x) => x.kind === 'open' && x.value === 'check'));
});

test('tabAfter : envoyer ouvre la Discussion, une réponse ailleurs allume le point, changer d’étape ne bouge rien', () => {
  const guide = { tab: 'guide', unread: false };
  assert.deepEqual(J.tabAfter(guide, 'send'), { tab: 'chat', unread: false });
  assert.deepEqual(J.tabAfter(guide, 'answer'), { tab: 'guide', unread: true });
  assert.deepEqual(J.tabAfter({ tab: 'chat', unread: false }, 'answer'), { tab: 'chat', unread: false });
  assert.deepEqual(J.tabAfter({ tab: 'guide', unread: true }, 'show-chat'), { tab: 'chat', unread: false });
  assert.deepEqual(J.tabAfter({ tab: 'chat', unread: true }, 'show-guide'), { tab: 'guide', unread: true });
  assert.deepEqual(J.tabAfter({ tab: 'chat', unread: true }, 'reset'), { tab: 'guide', unread: false });
  assert.deepEqual(J.tabAfter(guide, 'inconnu'), guide);
  assert.deepEqual(J.tabAfter(null, 'send'), { tab: 'chat', unread: false });
});

test('chatHello : l’accueil de « Poser une question » invite à poser une question, jamais à choisir son imprimante', () => {
  for (const ready of [true, false]) {
    const t = J.chatHello(ready);
    assert.ok(/question/i.test(t), 'parle de question');
    assert.ok(!/choisis d’abord|ton imprimante/i.test(t), 'ne reprend pas la consigne des étapes');
  }
  assert.match(J.chatHello(false), /Étapes/);
  assert.ok(!/Étapes/.test(J.chatHello(true)));
});

test('confirmation en un toucher : la machine et le filament proposés deviennent le bouton de la ligne d’action', () => {
  assert.deepEqual(J.primaryAction('machine', { proposal: { name: 'Centauri Carbon 2' } }), { label: 'Oui, sur Centauri Carbon 2', kind: 'confirmMachine', enabled: true });
  assert.deepEqual(J.primaryAction('filament', { proposal: { name: 'PLA' } }), { label: 'Oui, du PLA', kind: 'confirmFilament', enabled: true });
  assert.equal(J.primaryAction('machine', {}).kind, 'none');
  assert.equal(J.primaryAction('piece', { proposal: { name: 'x' } }).kind, 'none');
  assert.match(J.prompt('machine', { proposal: { name: 'Centauri Carbon 2' } }), /Imprimer sur Centauri Carbon 2 \?/);
  assert.match(J.prompt('filament', { proposal: { name: 'PLA' } }), /PLA, comme la dernière fois \?/);
  assert.match(J.prompt('filament', {}), /filament/i);
});

test('resetStepOnChange : changer de machine oublie l’adaptation du 3MF, changer de filament la garde', () => {
  const base = full({ step: 'print', adapted: 'flexyring.stl' });
  const otherPrinter = full({ step: 'print', adapted: 'flexyring.stl', printer: { preset: 'Autre', name: 'Autre' } });
  assert.equal(J.resetStepOnChange(base, otherPrinter).adapted, undefined);
  const otherFilament = full({ step: 'print', adapted: 'flexyring.stl', filament: Object.assign({}, filament, { preset: 'Generic PETG @ECC2' }) });
  assert.equal(J.resetStepOnChange(base, otherFilament).adapted, 'flexyring.stl');
  const early = full({ adapted: 'flexyring.stl', printer: { preset: 'Autre', name: 'Autre' } });
  assert.equal(J.resetStepOnChange(full({ adapted: 'flexyring.stl' }), early).adapted, undefined); // même avant la découpe
});
