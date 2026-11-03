// Tests des questions d'intention : node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const I = require('../intent-logic.js');

const MANAGED = ['layer_height', 'wall_loops', 'sparse_infill_density', 'sparse_infill_pattern', 'top_shell_layers', 'bottom_shell_layers', 'brim_width'];

test('trois questions au plus, la deuxième dépend de la première', () => {
  assert.equal(I.nextQuestion({}).id, 'use');
  assert.equal(I.nextQuestion({ use: 'flex' }).id, 'pref');
  assert.match(I.nextQuestion({ use: 'flex' }).text, /souple/i);
  assert.notEqual(I.nextQuestion({ use: 'deco' }).text, I.nextQuestion({ use: 'flex' }).text);
  assert.equal(I.nextQuestion({ use: 'flex', pref: 'balanced' }).id, 'speed');
  assert.equal(I.nextQuestion({ use: 'flex', pref: 'balanced', speed: 'normal' }), null);
  assert.equal(I.nextQuestion({ use: 'test' }), null); // un test rapide : rien d'autre à demander
  for (const q of [I.nextQuestion({}), I.nextQuestion({ use: 'strong' }), I.nextQuestion({ use: 'daily', pref: 'sturdy' })]) {
    assert.ok(q.choices.length >= 3 && q.choices.length <= 5, q.id);
  }
});

test('« je ne sais pas » propose des exemples concrets qui mènent chacun à une réponse, et un choix sûr', () => {
  for (const answers of [{}, { use: 'flex' }, { use: 'flex', pref: 'softer' }, { use: 'strong' }]) {
    const q = I.nextQuestion(answers);
    const help = I.idkOptions(q.id, answers);
    assert.ok(help.options.length >= 2, q.id);
    for (const o of help.options) assert.ok(o.label && q.choices.some((c) => c.id === o.answer), q.id + ' ' + o.label);
    assert.ok(q.choices.some((c) => c.id === help.safe), q.id + ' choix sûr');
  }
});

test('guessUse devine l’usage d’après le nom du fichier, sinon ne dit rien', () => {
  assert.equal(I.guessUse('flexyring.stl'), 'flex');
  assert.equal(I.guessUse('Vase_spirale.3mf'), 'deco');
  assert.equal(I.guessUse('gear-bracket v2.stl'), 'strong');
  assert.equal(I.guessUse('3DBenchy.stl'), 'test');
  assert.equal(I.guessUse('piece.stl'), null);
  assert.equal(I.guessUse(''), null);
});

test('settingsFor : chaque intention règle exactement les mêmes réglages, en valeurs absolues', () => {
  const combos = [{ use: 'deco', pref: 'all', speed: 'fine' }, { use: 'daily', pref: 'balanced', speed: 'normal' }, { use: 'strong', pref: 'heavy', speed: 'normal' },
    { use: 'flex', pref: 'softer', speed: 'fast' }, { use: 'test' }];
  for (const a of combos) {
    const keys = I.settingsFor(a, 'PLA').map((c) => c.key).sort();
    assert.deepEqual(keys, [...MANAGED].sort(), JSON.stringify(a));
    for (const c of I.settingsFor(a, 'PLA')) assert.ok(c.label, c.key);
  }
  const get = (a, k) => I.settingsFor(a, 'PLA').find((c) => c.key === k).value;
  assert.ok(get({ use: 'strong', pref: 'heavy', speed: 'normal' }, 'wall_loops') > get({ use: 'deco', pref: 'top', speed: 'normal' }, 'wall_loops'));
  assert.equal(get({ use: 'flex', pref: 'balanced', speed: 'normal' }, 'brim_width'), 5);
  assert.equal(get({ use: 'daily', pref: 'balanced', speed: 'normal' }, 'brim_width'), 0);
  assert.equal(get({ use: 'daily', pref: 'balanced', speed: 'fine' }, 'layer_height'), 0.12);
  assert.equal(get({ use: 'test' }, 'layer_height'), 0.28);
  assert.match(String(get({ use: 'daily', pref: 'balanced', speed: 'normal' }, 'sparse_infill_density')), /^\d+%$/);
});

test('keepManual : un réglage modifié à la main est gardé et signalé', () => {
  const r = I.keepManual(I.settingsFor({ use: 'daily', pref: 'balanced', speed: 'normal' }, 'PLA'), ['layer_height']);
  assert.ok(!r.apply.some((c) => c.key === 'layer_height'));
  assert.deepEqual(r.kept.map((c) => c.key), ['layer_height']);
  assert.equal(I.keepManual(I.settingsFor({ use: 'test' }, 'PLA'), null).kept.length, 0);
});

test('summary : une phrase claire, des puces sans jargon, un avertissement honnête quand le filament ne colle pas', () => {
  const s = I.summary({ use: 'flex', pref: 'balanced', speed: 'normal' }, 'PLA');
  assert.match(s.sentence, /souple/i);
  assert.ok(s.bullets.length >= 2);
  for (const b of s.bullets) assert.ok(!/sparse|wall_loops|brim/.test(b), b);
  assert.match(s.warning, /TPU/);
  assert.equal(I.summary({ use: 'flex', pref: 'balanced', speed: 'normal' }, 'TPU').warning, '');
  assert.equal(I.summary({ use: 'daily', pref: 'balanced', speed: 'normal' }, 'PLA').warning, '');
});

test('detectLevel : courtes si l’utilisateur emploie le vocabulaire technique, détaillées sinon', () => {
  assert.equal(I.detectLevel(['ma pièce se décolle du plateau, je fais quoi ?']), 'detailed');
  assert.equal(I.detectLevel(['brim ou mouse ears sur du PETG ?', 'infill gyroid 20% ça suffit ?']), 'short');
  assert.equal(I.detectLevel(['rétraction à 0,8 mm et débit à 95 %, ok ?']), 'short');
  assert.equal(I.detectLevel([]), 'detailed');
  assert.equal(I.detectLevel(null), 'detailed');
});

test('settingsFor : la hauteur de couche reste sous 75 % de la buse', () => {
  const layer = (a, nozzle) => I.settingsFor(a, 'PLA', nozzle).find((c) => c.key === 'layer_height').value;
  assert.equal(layer({ use: 'test' }, 0.2), 0.15);
  assert.equal(layer({ use: 'test' }, 0.4), 0.28);
  assert.equal(layer({ use: 'daily', pref: 'balanced', speed: 'normal' }, 0.2), 0.15);
  assert.equal(layer({ use: 'daily', pref: 'balanced', speed: 'fine' }, 0.2), 0.12);
  assert.equal(layer({ use: 'test' }, undefined), 0.28);
});

test('mergeAnswers : les réponses comprises par l’IA remplissent les questions, dans n’importe quel ordre, sans choix inventé', () => {
  const r = I.mergeAnswers({}, [{ question: 'speed', choice: 'normal' }, { question: 'use', choice: 'flex' }, { question: 'pref', choice: 'balanced' }]);
  assert.deepEqual(r.answers, { use: 'flex', pref: 'balanced', speed: 'normal' });
  assert.deepEqual(r.labels, ['souple / à plier', 'équilibrée', 'normal']);
  assert.deepEqual(I.mergeAnswers({}, [{ question: 'use', choice: 'solide' }, { question: 'color', choice: 'red' }]).answers, {});
  assert.deepEqual(I.mergeAnswers({ use: 'deco' }, [{ question: 'pref', choice: 'balanced' }]).answers, { use: 'deco' }); // « équilibrée » n'existe pas pour la déco
  assert.deepEqual(I.mergeAnswers({ use: 'flex' }, null).answers, { use: 'flex' });
});

test('detectLevel compte des termes différents : répéter « première couche » ou « PETG » ne suffit pas', () => {
  assert.equal(I.detectLevel(['ma première couche ne colle pas', 'toujours la première couche qui se décolle']), 'detailed');
  assert.equal(I.detectLevel(['PETG ou PETG ?']), 'detailed');
  assert.equal(I.detectLevel(['première couche et rétraction']), 'short');
});
