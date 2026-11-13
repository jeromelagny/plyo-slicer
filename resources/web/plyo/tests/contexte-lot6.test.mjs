// Lot 6 de l'audit : contexte envoyé à l'IA (IA-05 à IA-09, IA-22) et actions « aperçu » et « tests d'Orca » (IA-16).
// node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const read = name => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', name), 'utf8');

test('IA-05 : les réglages envoyés gardent key, max et values lus par le slicer', () => {
  const params = [
    { id: 'bed_temp', label: 'Température de plateau', key: 'textured_plate_temp', unit: '°C', min: 0, max: 110, note: '', value: 60 },
    { id: 'support_style', label: 'Style de support', key: 'support_style', unit: '', min: 0, max: 0, note: '', value: 'default', values: ['default', 'grid', 'snug'] },
    { id: 'layer_height', key: 'layer_height', unit: 'mm', max: Infinity, value: 0.2, values: [] },
    { id: 3 }
  ];
  assert.deepEqual(L.diagnoseParams(params), [
    { id: 'bed_temp', value: 60, unit: '°C', key: 'textured_plate_temp', max: 110 },
    { id: 'support_style', value: 'default', unit: '', key: 'support_style', max: 0, values: ['default', 'grid', 'snug'] },
    { id: 'layer_height', value: 0.2, unit: 'mm', key: 'layer_height' }
  ]);
  assert.deepEqual(L.diagnoseParams(null), []);
});

test('IA-05 à IA-07 : le contexte ajoute seulement les champs attendus et non vides, sans toucher aux noms des préréglages', () => {
  const base = { printer: 'Bambu Lab A1 0.4 nozzle', filament: 'Bobine rouge', process: '0.20mm Standard', nozzle_mm: 0.4 };
  const extras = { bed_type: 'Textured PEI Plate', bed_temp_keys: ['textured_plate_temp', 'textured_plate_temp_initial_layer'], filament_type: 'PETG',
    filament_vendor: '', printer_facts: { extruder_type: 'Direct Drive' }, chemin: '/Users/x', ip: '192.168.1.2' };
  const out = L.aiContext(base, extras);
  assert.deepEqual(out, Object.assign({}, base, { bed_type: 'Textured PEI Plate', bed_temp_keys: ['textured_plate_temp', 'textured_plate_temp_initial_layer'],
    filament_type: 'PETG', printer_facts: { extruder_type: 'Direct Drive' } }));
  assert.equal(base.bed_type, undefined, 'les valeurs lues ne sont pas modifiées');
  assert.deepEqual(L.aiContext(base, { bed_temp_keys: [], printer_facts: {}, filament_type: '  ' }), base, 'jamais de liste ni de bloc vide');
  assert.deepEqual(L.aiContext(base, null), base);
});

test('IA-22 : l’historique dit si les réglages proposés ont été appliqués, annulés ou laissés de côté', () => {
  const h = L.historyForAI([
    { role: 'user', text: 'Fils' },
    { role: 'assistant', text: 'Baisse la buse.', cards: 'proposed' },
    { role: 'assistant', text: 'Baisse la buse.', cards: 'applied' },
    { role: 'assistant', text: 'x'.repeat(2000), cards: 'undone' },
    { role: 'assistant', text: 'Réponse sans fiche' }
  ]);
  assert.deepEqual(h[0], { role: 'user', text: 'Fils' });
  assert.equal(h[1].text, 'Baisse la buse.\nréglages proposés : pas appliqués');
  assert.equal(h[2].text, 'Baisse la buse.\nréglages proposés : appliqués');
  assert.ok(h[3].text.length <= 2000 && h[3].text.endsWith('\nréglages proposés : appliqués puis annulés'));
  assert.equal(h[4].text, 'Réponse sans fiche');
  assert.ok(h.every(m => Object.keys(m).join() === 'role,text'), 'seuls role et text partent');
});

test('IA-16 : une action que le panneau ne sait pas exécuter n’a jamais de bouton', () => {
  const ok = (kind, target) => L.actionSupported({ kind, target, label: 'Bouton' });
  assert.equal(ok('show', 'preview'), true);
  assert.equal(ok('show', 'plate'), true);
  assert.equal(ok('show', 'gcode'), false);
  for (const t of ['max_flow', 'vfa', 'tolerance']) assert.equal(ok('open_calibration', t), true, t);
  assert.equal(ok('open_calibration', 'cornering'), false);
  assert.equal(ok('open_tool', 'cut'), true);
  assert.equal(ok('open_tool', 'teleport'), false);
  assert.equal(ok('show_setting', 'nozzle_temperature'), true);
  assert.equal(ok('show_setting', 'Nozzle temp'), false);
  for (const k of ['orient', 'arrange', 'scale_to_fit', 'slice', 'remember_success']) assert.equal(ok(k, ''), true, k);
  assert.equal(ok('print_now', ''), false);
  assert.equal(L.actionSupported({ kind: 'show', target: 'preview', label: ' ' }), false);
  assert.equal(L.actionSupported(null), false);
  assert.deepEqual(L.CAPABILITIES, ['show_preview', 'open_calibration']);
});

test('IA-16 : chaque test d’Orca est annoncé avant, puis expliqué (lecture, retour à la pièce)', () => {
  for (const t of ['max_flow', 'vfa']) {
    assert.match(L.rawTestText(t).before, /^Ce test ouvre une fenêtre de Plyo Slicer et remplace ta plaque par la pièce de test\./);
    const r = L.rawTestResult({ ok: true, target: t, replaced: true });
    assert.equal(r.back, true);
    assert.match(r.text, /« Mes projets »/);
  }
  assert.match(L.rawTestText('tolerance').before, /Rien n’est remplacé/);
  assert.equal(L.rawTestText('cornering'), null);
  const tol = L.rawTestResult({ ok: true, target: 'tolerance', added: 1 });
  assert.equal(tol.back, false);
  assert.match(tol.text, /Suppr/);
  assert.match(L.rawTestResult({ ok: true, target: 'tolerance', added: 1, arranged: true }).text, /j’ai organisé la plaque pour qu’elle ne touche pas ta pièce\. /);
  const closed = L.rawTestResult({ ok: true, target: 'vfa', replaced: false });
  assert.equal(closed.back, false);
  assert.match(closed.text, /ta plaque n’a pas changé/);
  assert.equal(L.rawTestResult({ ok: false, target: 'vfa', text: 'Plyo Slicer découpe en ce moment.' }).text, 'Plyo Slicer découpe en ce moment.');
  assert.match(L.previewText({ ok: true, sliced: false }), /« Découper la plaque »/);
  assert.match(L.previewText({ ok: true, sliced: true }), /« Préparer »/);
});

test('le corps de /api/diagnose : contexte, réglages complets, historique et capacités ; la confirmation précède le test', () => {
  const page = read('index.html');
  const ask = page.slice(page.indexOf('function ask(note, photos, req)'), page.indexOf('// Une réponse sur une pièce du plateau'));
  assert.match(ask, /settings: \{ params: Logic\.diagnoseParams\(lastValues\.params\) \}/);
  assert.match(ask, /context: Logic\.aiContext\(lastValues\.context, ctx && ctx\.context\)/);
  assert.match(ask, /history: Logic\.historyForAI\(conv\.history\.slice\(-MAX_HISTORY\)\)/);
  assert.match(ask, /body\.capabilities = Logic\.CAPABILITIES\.slice\(\)/);
  assert.match(ask, /if \(a\.suggestions\.length\) hist\.cards = 'proposed'/);
  assert.match(page, /if \(entry\.hist\) entry\.hist\.cards = 'applied'/);
  assert.match(page, /if \(entry\.hist\) entry\.hist\.cards = 'undone'/);
  const actions = page.slice(page.indexOf('function renderActions'), page.indexOf('// ---------- Modèle 3D joint'));
  assert.match(actions, /Logic\.actionSupported\(a\)/);
  assert.match(actions, /a\.kind === 'open_calibration'\) confirmRawTest\(/);
  const confirm = actions.slice(actions.indexOf('function confirmRawTest'));
  // Rien ne part avant « Ouvrir le test » ; « Pas maintenant » ne fait que fermer.
  assert.ok(confirm.indexOf("button('Ouvrir le test'") < confirm.indexOf("type: 'open_calibration'"));
  assert.match(confirm, /button\('Pas maintenant', function \(\) \{ box\.remove\(\); \}/);
});

test('UX-19 : le changement de niveau est dit, avec « Garde les explications détaillées »', () => {
  const page = read('index.html');
  assert.match(page, /PlyoIntent\.asksDefinition\(note\)/);
  assert.match(page, /Tu as l’air d’avoir de l’expérience : je te réponds plus court\./);
  assert.match(page, /button\('Garde les explications détaillées', function \(\) \{\s*habits = PlyoMachines\.chooseLevel\(habits, 'detailed'\);/);
});
