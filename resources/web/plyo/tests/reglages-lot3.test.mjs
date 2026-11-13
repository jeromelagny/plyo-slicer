// Lot 3 de l'audit : réglages appliqués, état vrai et annulation. node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const read = name => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', name), 'utf8');

test('valeurs montrées : oui/non, virgule, « 15 % », °C pour une température', () => {
  assert.equal(L.valueText(true), 'oui');
  assert.equal(L.valueText(false), 'non');
  assert.equal(L.valueText(0.2, 'layer_height'), '0,2');
  assert.equal(L.valueText(215, 'nozzle_temperature'), '215 °C');
  assert.equal(L.valueText(55, 'hot_plate_temp_initial_layer'), '55 °C');
  assert.equal(L.valueText('15%', 'sparse_infill_density'), '15 %');
  assert.equal(L.valueText('arachne', 'wall_generator'), 'Arachné', 'valeur à choix : libellé français du catalogue (N5)');
  assert.equal(L.valueText('inconnue', 'wall_generator'), 'inconnue');
  assert.equal(L.valueText(null), '—');
});

test('ROB-04 : « Orca a aussi réglé » et les réglages ajoutés pour que ça tienne', () => {
  assert.equal(L.alsoChangedText([]), '');
  assert.equal(L.alsoChangedText(undefined), '');
  assert.equal(L.alsoChangedText([{ key: 'detect_overhang_wall', label: 'Détection des surplombs', before: false, after: true }]),
    'Plyo Slicer a aussi réglé : Détection des surplombs (non → oui). « Annuler » les remet aussi.');
  assert.equal(L.alsoChangedText([{ key: 'wall_loops', label: 'Parois', before: 3, after: 1 }, { key: 'sparse_infill_density', label: 'Remplissage', before: '15%', after: '0%' }]),
    'Plyo Slicer a aussi réglé : Parois (3 → 1) et Remplissage (15 % → 0 %). « Annuler » les remet aussi.');
  const applied = [{ id: 'spiral_mode', label: 'Vase spirale', after: true }, { id: 'wall_loops', label: 'Parois', after: 1, added: 'le mode vase l’exige' }];
  assert.equal(L.addedText(applied), 'J’ai aussi réglé, pour que ça tienne : Parois → 1 (le mode vase l’exige).');
  assert.equal(L.addedText([{ id: 'x', after: 1 }]), '');
});

test('ROB-08 : l’annulation dit quels réglages retouchés à la main elle a laissés', () => {
  assert.equal(L.keptText([]), '');
  assert.equal(L.keptText([{ key: 'nozzle_temperature', label: 'Température de buse', value: 210 }]),
    'J’ai laissé tels quels les réglages que tu as retouchés depuis : Température de buse (210 °C).');
});

test('UX-27 : « Remettre … à … », un lot confirmé par le clic sur ce bouton', () => {
  const r = { key: 'nozzle_temperature', scope: 'filament', label: 'Température de buse', value: 215 };
  assert.equal(L.restoreLabel(r), 'Remettre Température de buse à 215 °C');
  assert.deepEqual(L.restoreChanges([r, null, { label: 'sans clé' }]), [{ key: 'nozzle_temperature', value: 215, label: 'Température de buse', confirmed: true }]);
});

test('ROB-09 : une ligne de l’IA n’est confirmée que cochée à la main (ou confirmée après un refus)', () => {
  const plain = { id: 'wall_loops', value: 3, label: 'Parois', catalog: true };
  const sensitive = { id: 'spiral_mode', value: true, label: 'Vase', catalog: true, confirm: true };
  const beyond = { id: 'nozzle_temperature', value: 250, label: 'Buse', catalog: true, beyond: true };
  // Cochée d'office : pas de confirmation.
  assert.deepEqual(L.sheetChange(plain), { key: 'wall_loops', value: 3, label: 'Parois', confirmed_outside_range: false, confirmed: false });
  // Décochée d'office (sensible, hors plage) : si elle part, c'est que l'utilisateur l'a cochée lui-même.
  assert.equal(L.sheetChange(sensitive).confirmed, true);
  assert.deepEqual(L.sheetChange(beyond), { key: 'nozzle_temperature', value: 250, label: 'Buse', confirmed_outside_range: true, confirmed: true });
  // « Je confirme, applique quand même » après un refus pour grand écart.
  assert.equal(L.sheetChange(plain, ['wall_loops']).confirmed, true);
  // Liste d'origine : inchangé.
  assert.deepEqual(L.sheetChange({ id: 'nozzle_temp', delta: -5, value: null }), { id: 'nozzle_temp', delta: -5 });
  assert.deepEqual(L.sheetChange({ id: 'support', delta: null, value: true }), { id: 'support', value: true });
});

test('ROB-09 : lots annoncés par un bouton (intention, carte d’Orca) confirmés, sans toucher la liste d’origine', () => {
  assert.deepEqual(L.confirmedChanges([{ key: 'layer_height', value: 0.2, label: 'Hauteur' }, { id: 'support', value: true }]),
    [{ key: 'layer_height', value: 0.2, label: 'Hauteur', confirmed: true }, { id: 'support', value: true }]);
  const page = read('index.html');
  const intent = page.slice(page.indexOf('function applyIntentNow'), page.indexOf('function intentUndoButton'));
  assert.match(intent, /postRequest\(\{ type: 'apply', changes: Logic\.confirmedChanges\(st\.changes\.map/);
  const sheet = page.slice(page.indexOf('function renderSheet'), page.indexOf('function renderQuestions'));
  assert.match(sheet, /var changes = picked\.map\(function \(r\) \{ return Logic\.sheetChange\(r\.s, confirmedKeys\); \}\);/);
});

test('issues d’un lot refusé : confirmer, réessayer, montrer le réglage', () => {
  assert.deepEqual(L.refusalActions({ ok: false, code: 'needs_confirmation', key: 'outer_wall_speed' }).map(a => a.kind), ['confirm', 'show']);
  assert.deepEqual(L.refusalActions({ ok: false, code: 'orca_refused', key: 'spiral_mode' }).map(a => a.kind), ['retry', 'show']);
  assert.deepEqual(L.refusalActions({ ok: false, code: 'orca_dialog' }).map(a => a.kind), ['retry']);
  assert.deepEqual(L.refusalActions({ ok: false, text: 'Complète la fiche' }), []);
});

test('ROB-05 : enregistrement évité pour un écart de températures, dit clairement', () => {
  assert.match(L.savedText({ save_error: 'temperatures' }), /^Appliqué\. Je n’ai pas enregistré le filament : .*Rapproche ces deux températures/);
  assert.match(L.savedText({ save_error: 'Plyo Slicer a refusé l’enregistrement' }), /^Appliqué, mais je n’ai pas pu le garder dans ton profil de filament/);
});

test('ROB-11 : chaque demande qui attend un « result » porte un identifiant, l’erreur générale a son propre type', () => {
  const page = read('index.html');
  // Plus aucun envoi direct d'apply, undo (sauf le menu, sans fiche) ni calib_* : tous passent par postRequest.
  assert.equal((page.match(/window\.orca\.postMessage\(\{ type: '(apply|calib_start|calib_save|calib_restore)'/g) || []).length, 0);
  assert.equal((page.match(/window\.orca\.postMessage\(\{ type: 'undo'/g) || []).length, 1);
  assert.match(page, /function postRequest\(message\) \{[\s\S]{0,300}message\.request = nextRequest\+\+;[\s\S]{0,120}pendingResults\[message\.request\] = waiting;/);
  // Une réponse va à la demande qui porte son identifiant, et à elle seule.
  assert.match(page, /var waiting = msg\.request && pendingResults\[msg\.request\];\n\s+if \(waiting\) \{ delete pendingResults\[msg\.request\]; waiting\.onResult\(msg\.ok, msg\.text, msg\); \}/);
  assert.match(page, /msg\.type === 'error'\) \{[\s\S]{0,200}var failed = msg\.request && pendingResults\[msg\.request\];/);
  assert.doesNotMatch(page, /if \(pendingSheet\) \{ var p = pendingSheet;/);
  // Calibration lancée : sa demande est soldée par son identifiant.
  assert.match(page, /function onCalibStarted\(msg\) \{\n\s+delete pendingResults\[msg\.request\];/);
  // Le slicer renvoie l'identifiant, et l'erreur générale part en « error ».
  const cpp = read('../../../src/plyo/PlyoAssistant.cpp');
  assert.match(cpp, /message\["request"\]\s+= Json::integer\(data, "request", 0\);/);
  assert.match(cpp, /send\(\{\{"type", "error"\}, \{"request", Json::integer\(data, "request", 0\)\}/);
  assert.doesNotMatch(cpp, /send_result\(\{\{"ok", false\}, \{"text", std::string\("Erreur interne : "\)/);
  // Après l'écriture, mémoire et journal ne peuvent plus faire passer le lot pour un échec.
  assert.match(cpp, /L'écriture fait foi[\s\S]{0,400}try \{[\s\S]{0,200}Profiles::save_applied\(\)/);
});

test('UX-27 : annulation refusée, les valeurs d’avant proposées d’un clic, même sans fiche (menu)', () => {
  const page = read('index.html');
  assert.match(page, /else if \(msg\.restore && msg\.restore\.length\) restoreOffer\(msg\.restore\);/);
  const offer = page.slice(page.indexOf('function restoreOffer'), page.indexOf('function refusalButtons'));
  assert.match(offer, /postRequest\(\{ type: 'apply', revert: true, changes: Logic\.restoreChanges\(group\)/);
  assert.match(offer, /'Tout remettre comme avant'/);
  assert.match(offer, /'Montre-moi où il est'/);
  assert.match(offer, /undoButton\('Annuler'/);
  assert.doesNotMatch(read('../../../src/plyo/PlyoSettingsBridge.cpp'), /remets la valeur à la main/i);
});
