// Tests de la logique des premiers pas : node --test resources/web/plyo/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FICHES } = require('../fiches.js');
const { matchSettingQuestion, judgeValue, nextTourStep, TOUR_STEPS } = require('../premiers-pas.js');

// Clés de la liste blanche de l'assistant (PlyoSettingsBridge.cpp) ; la température de plateau a une clé par type de plateau.
const WHITELIST_KEYS = ['nozzle_temperature', 'nozzle_temperature_initial_layer', 'hot_plate_temp', 'textured_plate_temp',
  'cool_plate_temp', 'eng_plate_temp', 'layer_height', 'outer_wall_speed', 'filament_retraction_length', 'brim_width',
  'enable_support', 'ironing_type', 'ironing_speed', 'ironing_flow', 'ironing_spacing', 'support_type', 'support_style',
  'support_on_build_plate_only', 'support_threshold_angle', 'wall_loops', 'sparse_infill_density', 'top_shell_layers',
  'bottom_shell_layers'];
const COMMON_KEYS = ['sparse_infill_pattern', 'seam_position', 'skirt_loops', 'initial_layer_print_height', 'fan_max_speed',
  'filament_flow_ratio', 'pressure_advance', 'wall_generator', 'inner_wall_speed', 'travel_speed', 'initial_layer_speed',
  'enable_prime_tower'];

test('chaque réglage de la liste blanche et des réglages courants a une fiche complète', () => {
  for (const key of [...WHITELIST_KEYS, ...COMMON_KEYS]) {
    const f = FICHES[key];
    assert.ok(f, 'fiche manquante : ' + key);
    for (const field of ['label', 'what', 'high', 'low', 'touch']) assert.ok(f[field] && f[field].trim(), key + '.' + field);
    assert.ok(Array.isArray(f.aliases), key + '.aliases');
  }
});

test('une question de définition ouvre la fiche', () => {
  assert.equal(matchSettingQuestion('C’est quoi la rétraction ?', FICHES), 'filament_retraction_length');
  assert.equal(matchSettingQuestion('à quoi sert le remplissage', FICHES), 'sparse_infill_density');
  assert.equal(matchSettingQuestion("Qu'est-ce que le lissage ?", FICHES), 'ironing_type');
  assert.equal(matchSettingQuestion('explique-moi la bordure', FICHES), 'brim_width');
});

test('une vraie question de conseil part à l’IA', () => {
  assert.equal(matchSettingQuestion('Mon benchy a des fils, je fais quoi ?', FICHES), null);
  assert.equal(matchSettingQuestion('quelle rétraction pour du PETG ?', FICHES), null);
  assert.equal(matchSettingQuestion('c’est quoi le problème sur ma photo ?', FICHES), null);
  assert.equal(matchSettingQuestion('', FICHES), null);
});

test('jugement d’une valeur', () => {
  const same = judgeValue({ value: 0.8, min: 0, max: 8, systemValue: 0.8 });
  assert.equal(same.inRange, true);
  assert.equal(same.changed, false);
  assert.ok(same.text);
  const changed = judgeValue({ value: 1.2, min: 0, max: 8, systemValue: 0.8 });
  assert.equal(changed.changed, true);
  assert.match(changed.text, /0,8/);
  assert.equal(judgeValue({ value: 12, min: 0, max: 8 }).inRange, false);
  const unknown = judgeValue({ value: 2 });
  assert.equal(unknown.inRange, null);
  assert.equal(unknown.changed, null);
});

test('le parcours avance tout seul quand l’étape est faite', () => {
  assert.deepEqual(TOUR_STEPS, ['model', 'presets', 'slice', 'print', 'after']);
  assert.equal(nextTourStep('model', { objects: 0, sliced: false }), 'model');
  assert.equal(nextTourStep('model', { objects: 1, sliced: false }), 'presets');
  assert.equal(nextTourStep('slice', { objects: 1, sliced: true }), 'print');
  assert.equal(nextTourStep('presets', { objects: 3, sliced: true }), 'presets');
  assert.equal(nextTourStep('print', { objects: 3, sliced: true }), 'print');
});

const { isModelFile, modelAddedText } = require('../premiers-pas.js');

test('reconnaît un modèle 3D à son extension', () => {
  for (const name of ['benchy.stl', 'Support.STL', 'piece.3mf', 'a.obj', 'b.step', 'c.stp', 'd.amf']) assert.equal(isModelFile(name), true, name);
  for (const name of ['photo.jpg', 'notes.txt', 'stl', '', 'piece.stl.zip']) assert.equal(isModelFile(name), false, name);
});

test('message après la pose d’un modèle', () => {
  const fits = modelAddedText({ name: 'support-casque.stl', size_mm: [82, 40, 115], bed_mm: [256, 256, 256], fits: true });
  assert.match(fits, /support-casque\.stl/);
  assert.match(fits, /82 × 40 × 115 mm/);
  assert.doesNotMatch(fits, /dépasse/);
  const big = modelAddedText({ name: 'tour.stl', size_mm: [300, 40, 120], bed_mm: [256, 256, 256], fits: false });
  assert.match(big, /dépasse/);
  assert.match(big, /256 × 256 × 256 mm/);
});
