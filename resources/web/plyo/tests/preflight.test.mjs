import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { preflightRisks, riskKey } = require('../preflight.js');

const noBrim = { brim_type: 'no_brim', brim_width: 0, support: false };
const cube = { name: 'Cube', height: 20, foot: [20, 20], contact_mm2: 400, needs_support: false, fits: true };
const plate = (objects, settings = noBrim) => ({ settings, objects });

test('une plaque sans risque ne donne aucune alerte', () => {
  assert.deepEqual(preflightRisks(plate([cube])), []);
});

test('pièce haute et fine sans bordure : risque de bascule, avec la bordure en correction', () => {
  const tower = { ...cube, name: 'Tour', height: 90, foot: [12, 15], contact_mm2: 180 };
  const [r] = preflightRisks(plate([tower]));
  assert.equal(r.kind, 'tall');
  assert.match(r.text, /« Tour »/);
  assert.match(r.text, /basculer/);
  assert.deepEqual(r.fixes[0], { label: 'Ajouter une bordure', changes: [{ id: 'brim_type', value: 'outer_only' }, { id: 'brim_width', value: 5 }] });
});

test('une bordure déjà prévue (auto ou largeur > 0) supprime les risques de bascule et de décollement', () => {
  const tower = { ...cube, height: 90, foot: [12, 15], contact_mm2: 10 };
  assert.deepEqual(preflightRisks(plate([tower], { brim_type: 'auto_brim', brim_width: 0, support: false })), []);
  assert.deepEqual(preflightRisks(plate([tower], { brim_type: 'outer_only', brim_width: 3, support: false })), []);
});

test('bordure extérieure de largeur 0 : la correction ne change que la largeur', () => {
  const tower = { ...cube, height: 90, foot: [12, 15] };
  const [r] = preflightRisks(plate([tower], { brim_type: 'outer_only', brim_width: 0, support: false }));
  assert.deepEqual(r.fixes[0].changes, [{ id: 'brim_width', value: 5 }]);
});

test('petite surface posée : risque de décollement, bordure ou orientation', () => {
  const ball = { ...cube, name: 'Boule', height: 30, foot: [30, 30], contact_mm2: 12 };
  const [r] = preflightRisks(plate([ball]));
  assert.equal(r.kind, 'contact');
  assert.match(r.text, /décoller/);
  assert.deepEqual(r.fixes.map((f) => f.label), ['Ajouter une bordure', 'Orienter automatiquement']);
  assert.equal(r.fixes[1].action, 'orient');
});

test('une pièce haute et peu posée ne reçoit qu’une alerte de bordure (la bascule)', () => {
  const tower = { ...cube, height: 90, foot: [12, 15], contact_mm2: 5 };
  assert.deepEqual(preflightRisks(plate([tower])).map((r) => r.kind), ['tall']);
});

test('parties dans le vide signalées par Orca, supports désactivés : activer les supports ou orienter', () => {
  const arch = { ...cube, name: 'Arche', needs_support: true };
  const [r] = preflightRisks(plate([arch]));
  assert.equal(r.kind, 'support');
  assert.match(r.text, /vide/);
  assert.deepEqual(r.fixes[0], { label: 'Activer les supports', changes: [{ id: 'support', value: true }] });
  assert.equal(preflightRisks(plate([arch], { ...noBrim, support: true })).length, 0);
});

test('pièce trop grande pour le plateau : la réduire', () => {
  const [r] = preflightRisks(plate([{ ...cube, name: 'Grand', fits: false }]));
  assert.equal(r.kind, 'fit');
  assert.deepEqual(r.fixes, [{ label: 'Réduire pour que ça tienne', action: 'scale_to_fit' }]);
});

test('un même risque sur plusieurs pièces devient une seule alerte qui les nomme', () => {
  const a = { ...cube, name: 'A', needs_support: true };
  const b = { ...cube, name: 'B', needs_support: true };
  const c = { ...cube, name: 'C', needs_support: true };
  const risks = preflightRisks(plate([a, b, c]));
  assert.equal(risks.length, 1);
  assert.match(risks[0].text, /« A », « B » et 1 autre pièce ont/);
});

test('ordre des alertes : plateau, supports, bascule, décollement', () => {
  const objs = [
    { ...cube, name: 'D', contact_mm2: 1, foot: [30, 30], height: 10 },
    { ...cube, name: 'T', height: 90, foot: [10, 10] },
    { ...cube, name: 'S', needs_support: true },
    { ...cube, name: 'F', fits: false },
  ];
  assert.deepEqual(preflightRisks(plate(objs)).map((r) => r.kind), ['fit', 'support', 'tall', 'contact']);
});

test('riskKey identifie un risque par son type et ses pièces', () => {
  const r = preflightRisks(plate([{ ...cube, name: 'Arche', needs_support: true }]))[0];
  assert.equal(riskKey(r), 'support:Arche');
});

test('données absentes ou abîmées : aucune alerte', () => {
  assert.deepEqual(preflightRisks(null), []);
  assert.deepEqual(preflightRisks({}), []);
  assert.deepEqual(preflightRisks({ settings: noBrim, objects: [{ name: 'X' }] }), []);
});

// Carte « Avant d'imprimer » : les risques regroupés par pièce, et une liste de corrections sans doublon.
const { preflightPlan, fixChanges } = require('../preflight.js');

test('preflightPlan : un bloc par pièce, ses soucis en phrases courtes', () => {
  const casque = { ...cube, name: 'Support_casque.stl', height: 120, foot: [18, 22], contact_mm2: 300, needs_support: true };
  const boule = { ...cube, name: 'Boule.stl', height: 30, foot: [30, 30], contact_mm2: 9 };
  const plan = preflightPlan(plate([casque, boule]));
  assert.deepEqual(plan.parts.map((p) => p.name), ['Support_casque.stl', 'Boule.stl']);
  assert.deepEqual(plan.parts[0].issues, ['Des parties dans le vide : sans supports, elles risquent de s’effondrer.',
    'Haute et fine : sans bordure, elle risque de basculer.']);
  assert.deepEqual(plan.parts[1].issues, ['Touche peu le plateau : sans bordure, elle risque de se décoller.']);
});

test('preflightPlan : la bordure n’apparaît qu’une fois ; l’orientation est proposée décochée', () => {
  const casque = { ...cube, name: 'Casque', height: 120, foot: [18, 22], contact_mm2: 300, needs_support: true };
  const boule = { ...cube, name: 'Boule', height: 30, foot: [30, 30], contact_mm2: 9 };
  const plan = preflightPlan(plate([casque, boule]));
  assert.deepEqual(plan.fixes.map((f) => [f.key, f.checked]), [['support', true], ['brim', true], ['orient', false]]);
  const brim = plan.fixes.find((f) => f.key === 'brim');
  assert.equal(brim.label, 'Ajouter une bordure de 5 mm');
  assert.deepEqual(brim.objects, ['Casque', 'Boule']);
  assert.deepEqual(brim.changes, [{ id: 'brim_type', value: 'outer_only' }, { id: 'brim_width', value: 5 }]);
});

test('preflightPlan : pièce trop grande → réduire (action du plateau), cochée', () => {
  const plan = preflightPlan(plate([{ ...cube, name: 'Grand', fits: false }]));
  assert.deepEqual(plan.fixes, [{ key: 'fit', label: 'Réduire pour que tout tienne sur le plateau', action: 'scale_to_fit', objects: ['Grand'], checked: true }]);
  assert.equal(plan.count, 1);
});

test('preflightPlan : rien à signaler → aucune pièce, aucune correction', () => {
  assert.deepEqual(preflightPlan(plate([cube])), { parts: [], fixes: [], count: 0 });
  assert.deepEqual(preflightPlan(null), { parts: [], fixes: [], count: 0 });
});

test('fixChanges : les réglages des corrections cochées partent en un seul envoi', () => {
  const fixes = [{ key: 'support', changes: [{ id: 'support', value: true }] }, { key: 'fit', action: 'scale_to_fit' },
    { key: 'brim', changes: [{ id: 'brim_width', value: 5 }] }];
  assert.deepEqual(fixChanges(fixes), [{ id: 'support', value: true }, { id: 'brim_width', value: 5 }]);
  assert.deepEqual(fixChanges([]), []);
});
