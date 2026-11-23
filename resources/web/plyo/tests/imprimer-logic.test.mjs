// Étape « Imprimer » : logique partagée par le panneau classique et la v2 (imprimer-logic.js).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const X = require('../imprimer-logic.js');
const M = require('../machines-logic.js');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('durée, poids, coût : le coût seulement si le slicer le donne (prix du préréglage filament)', () => {
  assert.equal(X.durationText(3900), 'environ 1 h 05');
  assert.equal(X.durationText(20), 'environ 1 min');
  assert.equal(X.printSummary({ sliced: true, time_s: 3900, weight_g: 41.6 }), 'Ton impression prendra environ 1 h 05 et 42 g de filament.');
  assert.equal(X.printSummary({ sliced: false, time_s: 3900 }), '');
  assert.deepEqual(X.stats({ sliced: true, time_s: 3900, weight_g: 41.6, cost: 0.915 }, 'PLA'), { time: '1 h 05', grams: '42 g', material: 'PLA', cost: '≈ 0,92 €' });
  assert.equal(X.stats({ sliced: true, time_s: 600, weight_g: 4 }, 'PLA').cost, '', 'pas de prix : la case est masquée');
  assert.equal(X.stats({ sliced: true, time_s: 600, weight_g: 4, cost: 0 }).cost, '');
  assert.equal(X.stats({ sliced: false, time_s: 0 }), null, 'rien avant la découpe');
});

test('envoi gardé dans le projet : bobine de l’envoi, suivi, question de fin selon l’état', () => {
  const p = { printer: { preset: 'Creality K1C 0.4 nozzle', name: 'Creality K1C 0.4 nozzle' }, filament: { type: 'PLA', spool: { id: 's1', name: 'Sunlu PLA blanc' } } };
  assert.equal(X.sendOf(p), null);
  assert.deepEqual(X.sendRecord(p), { spool: { id: 's1', name: 'Sunlu PLA blanc' } });
  assert.deepEqual(X.sendRecord({ filament: p.filament, canvas: [{ t: 0 }] }), {}, 'jamais la bobine avec des emplacements');
  X.noteWatched(p, 'w1');
  assert.equal(X.watching(p), true);
  assert.equal(X.spoolAsk(p), 'Sunlu PLA blanc');
  assert.equal(X.endQuestionNow(p), null, 'aucune fin lue');
  p.send.end = { verdict: 'finished', file: 'bateau.gcode' };
  assert.equal(X.watching(p), false);
  const q = X.endQuestionNow(p);
  assert.equal(q.verdict, 'finished');
  assert.match(q.text, /Creality K1C a fini d’imprimer « bateau\.gcode »/);
  p.send.end = { verdict: 'cancelled', file: '' };
  assert.equal(X.endQuestionNow(p).choices.length, 5, 'arrêt : pourquoi ?');
  p.send.end = { verdict: 'error', file: '' };
  assert.match(X.endQuestionNow(p).text, /signale une erreur/);
  p.send.end = { verdict: 'lost', file: '' };
  assert.equal(X.endQuestionNow(p), null, 'fin dont on ne sait rien : pas de question de fin');
  p.send.answered = true; p.send.outcome = 'cancelled';
  assert.equal(X.endOutcome(p), 'cancelled');
  p.success = true;
  assert.equal(X.spoolAsk(p), '');
  const fresh = X.newSend(p);
  assert.deepEqual(fresh, { spool: { id: 's1', name: 'Sunlu PLA blanc' } }, 'un nouvel envoi remplace le précédent');
});

test('questions d’intention : débutant (une question), confirmé (trois, ou « comme la dernière fois »), réglages prêts', () => {
  const base = { part: { name: 'crochet mural' }, filament: { type: 'PLA' } };
  const habits = M.emptyHabits();
  const novice = X.intentState(base, { step: 'preparer', sliced: false, habits, level: 'novice' });
  assert.equal(novice.mode, 'asking');
  assert.equal(novice.total, 1);
  assert.equal(novice.guess, 'strong', 'suggérée d’après le nom de la pièce');
  assert.equal(X.intentState(base, { step: 'imprimer', habits }), null);
  assert.equal(X.intentState(base, { step: 'preparer', sliced: true, habits }), null);
  const expert = X.intentState(Object.assign({}, base, { intent: { use: 'daily' } }), { step: 'preparer', habits, level: 'expert' });
  assert.equal(expert.total, 3);
  assert.equal(expert.question.id, 'pref');
  const last = Object.assign(M.emptyHabits(), { last_intent: { use: 'deco', pref: 'all', speed: 'normal' } });
  assert.equal(X.intentState(base, { step: 'preparer', habits: last, level: 'expert' }).mode, 'repeat');
  assert.equal(X.intentState(base, { step: 'preparer', habits: last, level: 'expert', changing: true }).mode, 'asking', '« Changer » repose les questions');
  const ready = X.intentState(Object.assign({}, base, { intent: { use: 'daily', pref: 'balanced', speed: 'normal' } }), { step: 'preparer', habits, level: 'novice', manual: ['wall_loops'], nozzleMm: 0.4 });
  assert.equal(ready.mode, 'ready');
  assert.equal(ready.needsManual, false);
  assert.deepEqual(ready.kept.map((c) => c.key), ['wall_loops'], 'un réglage changé à la main est gardé');
  assert.equal(X.intentState(Object.assign({}, base, { intent: { use: 'test' } }), { step: 'preparer', habits, level: 'novice', applying: true }).mode, 'auto');
  assert.equal(X.intentState(Object.assign({}, base, { intent: { use: 'test' } }), { step: 'preparer', habits }).needsManual, true);
  assert.equal(X.intentState(Object.assign({}, base, { intent: { skipped: true } }), { step: 'preparer', habits }), null);
  assert.deepEqual(X.intentPending(novice).map((q) => q.id), ['use', 'speed']);
  assert.deepEqual(X.intentPending(expert).map((q) => q.id), ['pref', 'speed']);
  assert.equal(X.intentPending(ready), null);
  const cards = X.useCards('benchy');
  assert.equal(cards.suggested, 'test');
  assert.deepEqual(cards.cards.map((c) => c.id), ['flex', 'deco', 'daily', 'strong', 'test']);
  assert.equal(cards.cards.filter((c) => c.suggested).length, 1);
  assert.equal(X.useCards('pièce sans indice').suggested, 'daily', 'sans indice : la réponse la plus sûre');
  assert.deepEqual(X.intentLabels({ use: 'daily', pref: 'balanced', speed: 'fast' }), { use: 'Objet du quotidien', detail: 'Équilibrée · Vite' });
  assert.deepEqual(X.intentLabels({ use: 'test' }), { use: 'Test rapide', detail: '' });
});

const OBJ = { name: 'Bateau', height: 48, contact_mm2: 20, foot: [30, 10], needs_support: true, fits: true };
const SET = { support: false, brim_type: 'no_brim', brim_width: 0, spiral_mode: false, top_shell_layers: 4, sparse_infill_density: '15%' };
test('« Tout est prêt » : vérifications avec Retirer / Remettre et « Montre-moi », corrections faites d’office', () => {
  const data = { sliced: true, settings: SET, objects: [OBJ] };
  assert.deepEqual(X.autoFixes(data).map((f) => f.key), ['support', 'brim'], 'supports et bordure conseillés ; orienter attend ton geste');
  const before = X.readyChecks(data, { printer: 'K1C', filament: { nozzle_temp: 210, bed_temp: 60 } });
  assert.deepEqual(before.map((c) => [c.key, c.ok, c.act && c.act.label]), [['fit', true, undefined], ['support', false, 'Ajouter'], ['brim', false, 'Ajouter'], ['temp', true, 'Montre-moi']]);
  assert.equal(before[0].title, 'Elle tient sur le plateau de K1C');
  assert.equal(before[3].sub, '210 °C / 60 °C');
  assert.deepEqual(before[3].act, { label: 'Montre-moi', kind: 'show_setting', key: 'nozzle_temperature' });
  const after = X.readyChecks({ sliced: true, settings: Object.assign({}, SET, { support: true, brim_type: 'outer_only', brim_width: 5 }), objects: [OBJ] }, { added: { support: true, brim: true } });
  assert.deepEqual(after.map((c) => [c.key, c.title, c.act && c.act.label]), [['fit', 'Elle tient sur le plateau', undefined], ['support', 'J’ai ajouté des supports', 'Retirer'], ['brim', 'J’ai ajouté une bordure', 'Retirer']]);
  assert.deepEqual(after[1].act.changes, [{ id: 'support', value: false }]);
  assert.deepEqual(after[2].act.changes, [{ id: 'brim_type', value: 'no_brim' }]);
  const removed = X.readyChecks({ sliced: true, settings: SET, objects: [OBJ] }, { added: { support: true, brim: true } });
  assert.deepEqual(removed.filter((c) => c.act).map((c) => c.act.label), ['Remettre', 'Remettre'], 'retirée : « Remettre »');
  // Pièce sans risque : pas de ligne supports ni bordure ; trop grande : « Réduire » ; chevauchement : « Ranger ».
  const flat = X.readyChecks({ settings: SET, objects: [{ name: 'Plaque', height: 3, contact_mm2: 4000, foot: [80, 60], needs_support: false, fits: true }] }, {});
  assert.deepEqual(flat.map((c) => c.key), ['fit']);
  const big = X.readyChecks({ settings: SET, objects: [{ name: 'Plaque', height: 3, contact_mm2: 4000, foot: [80, 60], fits: false }], conflict: { a: 'A', b: 'B' } }, {});
  assert.deepEqual(big.map((c) => [c.key, c.ok, c.act.action]), [['conflict', false, 'arrange'], ['fit', false, 'scale_to_fit']]);
  assert.deepEqual(X.readyChecks(null, {}), []);
});

test('résultat : symptômes, phrase pour l’assistant, écran de l’étape 3 selon le projet', () => {
  assert.deepEqual(X.SYMPTOMS.map((s) => s.id), ['warp', 'strings', 'spaghetti', 'layers', 'first']);
  assert.equal(X.symptomPrompt('warp', 'Bateau'), 'Mon impression de « Bateau » est ratée : elle se décolle du plateau, les coins se soulèvent. Qu’est-ce qui cloche, et que changer pour la prochaine fois ?');
  assert.equal(X.symptomPrompt('inconnu'), '');
  const done = { part: { name: 'B' }, printer: { preset: 'K1C', name: 'K1C' }, filament: { type: 'PLA', preset: 'PLA', temps_ok: true } };
  assert.equal(X.screen(done, { intent: { mode: 'asking' } }), 'usage');
  assert.equal(X.screen(done, {}), 'preparing');
  assert.equal(X.screen(Object.assign({}, done, { step: 'print' }), {}), 'ready');
  assert.equal(X.screen(Object.assign({}, done, { step: 'print' }), { sending: true }), 'sending');
  assert.equal(X.screen(Object.assign({}, done, { step: 'print' }), { exported: true }), 'saved');
  const after = Object.assign({}, done, { step: 'after', send: { watch: 'w1' } });
  assert.equal(X.screen(after, {}), 'printing');
  assert.equal(X.screen(after, { result: true }), 'result');
  assert.equal(X.screen(after, { failed: true }), 'failed');
  assert.equal(X.screen(Object.assign({}, after, { send: { watch: 'w1', end: { verdict: 'finished' } } }), {}), 'end');
  assert.equal(X.screen(Object.assign({}, after, { send: { failed: true } }), {}), 'failed');
  assert.equal(X.screen(Object.assign({}, after, { success: true }), {}), 'success');
  assert.equal(X.screen(Object.assign({}, done, { step: 'after' }), {}), 'result', 'clé USB : pas de suivi');
  assert.equal(X.CALIB.temperature.name, 'Tour de température');
});

test('le classique utilise le module partagé (envoi, fin, intention, durée, tests guidés)', () => {
  const page = read('index.html');
  assert.match(page, /<!--plyo-include:imprimer-logic\.js-->/);
  assert.match(page, /function sendRecord\(\) \{ return PlyoImprimer\.sendRecord\(conv\.project\); \}/);
  assert.match(page, /PlyoImprimer\.noteWatched\(conv\.project, projectUI\.watchId\);/);
  assert.match(page, /function endQuestionNow\(\) \{ return PlyoImprimer\.endQuestionNow\(conv\.project\); \}/);
  assert.match(page, /function spoolAsk\(\) \{ return PlyoImprimer\.spoolAsk\(conv\.project\); \}/);
  assert.match(page, /function printSummary\(\) \{ return PlyoImprimer\.printSummary\(tourSignals\); \}/);
  assert.match(page, /return PlyoImprimer\.intentPending\(/);
  assert.match(page, /var CALIB = PlyoImprimer\.CALIB;/);
  assert.doesNotMatch(page, /function durationText/);
});
