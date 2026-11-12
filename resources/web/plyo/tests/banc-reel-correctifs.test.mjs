// Correctifs trouvés par le banc dans la vraie application : découpe après un réglage, mode vase désactivé, réglages posés
// par l'assistant pris pour des modifications manuelles. node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const PF = require('../preflight.js');
const read = name => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', name), 'utf8');

// Ce que le slicer renvoie pour un mode vase désactivé (PlyoSettingsBridge::spiral_leftovers).
const LEFT = [
  { key: 'wall_loops', label: 'Nombre de parois', value: 3, now: 1 },
  { key: 'top_shell_layers', label: 'Couches pleines supérieures', value: 4, now: 0 },
  { key: 'sparse_infill_density', label: 'Densité de remplissage', value: '20%', now: '0%' },
  { key: 'detect_thin_wall', label: 'Détecter les parois fines', value: true, now: false }
];

test('carte « mode vase avec plusieurs pièces » : la correction remet aussi ce que le mode vase avait imposé', () => {
  const issue = { source: 'validate_error', code: 'vase_several_objects', level: 'error', scope: 'print', opt_key: 'spiral_mode',
    fix: { key: 'spiral_mode', value: false, also: LEFT } };
  const fix = PF.orcaIssueView(issue).actions.find(a => a.kind === 'fix');
  assert.equal(fix.label, 'Désactiver le mode vase et remettre parois, couches du dessus, remplissage et parois fines');
  assert.deepEqual(fix.changes.map(c => [c.key, c.value]), [['spiral_mode', false], ['wall_loops', 3], ['top_shell_layers', 4],
    ['sparse_infill_density', '20%'], ['detect_thin_wall', true]]);
  // Rien à remettre (le profil avait déjà ces valeurs) : le libellé d'avant, une seule ligne.
  const alone = PF.orcaIssueView({ ...issue, fix: { key: 'spiral_mode', value: false, also: [] } }).actions.find(a => a.kind === 'fix');
  assert.equal(alone.label, 'Désactiver le mode vase');
  assert.equal(alone.changes.length, 1);
  // Entrée abîmée : ignorée, jamais un changement sans valeur.
  const odd = PF.orcaIssueView({ ...issue, fix: { key: 'spiral_mode', value: false, also: [{ key: 'wall_loops' }, null, 'x'] } }).actions.find(a => a.kind === 'fix');
  assert.equal(odd.changes.length, 1);
});

const BOAT = { name: 'Petit bateau', height: 48, foot: [60, 31], contact_mm2: 900, needs_support: false, fits: true };
function data(settings) { return { sliced: true, objects: [BOAT], settings: Object.assign({ brim_type: 'auto_brim', brim_width: 5, support: false }, settings) }; }

test('vérification avant impression : une pièce sans couche pleine au-dessus hors mode vase est signalée, avec la correction du profil', () => {
  const risks = PF.preflightRisks(data({ spiral_mode: false, top_shell_layers: 0, sparse_infill_density: '0%', vase_leftovers: LEFT }));
  assert.equal(risks.length, 1);
  assert.equal(risks[0].kind, 'open_top');
  assert.match(risks[0].text, /n’aurait pas de dessus et serait vide dedans/);
  const plan = PF.preflightPlan(data({ spiral_mode: false, top_shell_layers: 0, sparse_infill_density: '0%', vase_leftovers: LEFT }));
  assert.equal(plan.fixes[0].key, 'restore');
  assert.equal(plan.fixes[0].checked, true);
  assert.equal(plan.fixes[0].label, 'Remettre parois, couches du dessus, remplissage et parois fines comme dans le profil');
  assert.match(plan.parts[0].issues[0], /Pas de dessus et vide dedans/);
  // Un seul envoi, en mode catalogue, chaque ligne confirmée.
  const batch = PF.fixBatch(plan.fixes);
  assert.equal(batch.catalog, true);
  assert.deepEqual(batch.changes.map(c => [c.key, c.value, c.confirmed]), [['wall_loops', 3, true], ['top_shell_layers', 4, true],
    ['sparse_infill_density', '20%', true], ['detect_thin_wall', true, true]]);
});

test('vérification avant impression : pas de fausse alerte', () => {
  // Mode vase actif : c'est voulu.
  assert.equal(PF.preflightRisks(data({ spiral_mode: true, top_shell_layers: 0, sparse_infill_density: '0%' })).length, 0);
  // 0 % de remplissage seul (pièce creuse fermée) : peut être voulu, pas d'alerte.
  assert.equal(PF.preflightRisks(data({ spiral_mode: false, top_shell_layers: 4, sparse_infill_density: '0%' })).length, 0);
  // Mesures d'avant (sans ces champs) : rien de nouveau.
  assert.equal(PF.preflightRisks(data({})).length, 0);
  // Dessus ouvert sans valeur du profil à remettre : signalé quand même, sans correction inventée.
  const risks = PF.preflightRisks(data({ spiral_mode: false, top_shell_layers: 0, sparse_infill_density: '15%' }));
  assert.equal(risks.length, 1);
  assert.match(risks[0].text, /n’aurait pas de dessus : aucune couche pleine/);
  assert.deepEqual(risks[0].fixes, []);
  assert.equal(PF.preflightPlan(data({ spiral_mode: false, top_shell_layers: 0 })).fixes.length, 0);
});

test('« Tout corriger » : sans réglage du catalogue, l’envoi historique ne change pas ; avec, tout part en un lot catalogue', () => {
  const brim = { key: 'brim', changes: [{ id: 'brim_type', value: 'outer_only' }, { id: 'brim_width', value: 5 }] };
  assert.deepEqual(PF.fixBatch([brim]), { catalog: false, changes: brim.changes });
  const both = PF.fixBatch([{ key: 'restore', keyChanges: [{ key: 'top_shell_layers', value: 4, label: 'Couches' }] }, brim,
    { key: 'support', changes: [{ id: 'support', value: true }] }]);
  assert.equal(both.catalog, true);
  assert.deepEqual(both.changes.map(c => [c.key, c.value]), [['top_shell_layers', 4], ['brim_type', 'outer_only'], ['brim_width', 5], ['enable_support', true]]);
  assert.ok(both.changes.every(c => c.confirmed === true));
});

test('réglages posés par l’assistant : retenus par lot, oubliés à l’annulation, jamais « tes modifications manuelles »', () => {
  let rec = L.noteWritten({}, [{ scope: 'print', key: 'wall_loops', value: '1' }, { scope: 'print', key: 'top_shell_layers', value: '0' },
    { scope: 'x', key: 'bad', value: '1' }, { scope: 'print', key: 'n', value: 3 }], 'k:1');
  assert.deepEqual(Object.keys(rec), ['print/wall_loops', 'print/top_shell_layers']);
  const items = [
    { preset: 'print', key: 'wall_loops', title: 'Nombre de parois', before: 3, after: 1, now: '1' },
    { preset: 'print', key: 'top_shell_layers', title: 'Couches pleines supérieures', before: 4, after: 2, now: '2' }, // retouché à la main
    { preset: 'print', key: 'brim_width', title: 'Largeur de la bordure', before: 0, after: 3, now: '3' }                // changé à la main
  ];
  const split = L.splitManualEdits(items, rec);
  assert.equal(split.known, true);
  assert.deepEqual(split.assistant.map(e => e.key), ['wall_loops']);
  assert.deepEqual(split.mine.map(e => e.key), ['top_shell_layers', 'brim_width']);
  assert.equal(L.manualEditsNote(items, rec), 'Tes modifications manuelles de la pièce restent en place : Couches pleines supérieures (4 → 2), Largeur de la bordure (0 → 3).');
  // Tout vient de l'assistant : rien à dire.
  assert.equal(L.manualEditsNote([items[0]], rec), '');
  // Un second lot sur la même clé, puis son annulation : la valeur du premier lot redevient celle de l'assistant.
  rec = L.noteWritten(rec, [{ scope: 'print', key: 'wall_loops', value: '3' }], 'k:2');
  assert.equal(L.splitManualEdits([{ ...items[0], now: '3' }], rec).assistant.length, 1);
  rec = L.forgetBatch(rec, 'k:2');
  assert.equal(L.splitManualEdits([items[0]], rec).assistant.length, 1);
  rec = L.forgetBatch(rec, 'k:1');
  assert.deepEqual(rec, {});
  // Sans relevé (conversation plus ancienne) : on ne sait pas qui les a faites, phrase neutre et vraie.
  assert.equal(L.manualEditsNote(items.slice(0, 1), undefined), 'Réglages de ce projet qui diffèrent du profil, gardés tels quels : Nombre de parois (3 → 1).');
  assert.equal(L.splitManualEdits(items, undefined).mine.length, 3);
  assert.equal(L.manualEditsNote([], {}), '');
});

test('relevé borné : 5 valeurs par réglage au plus', () => {
  let rec = {};
  for (let i = 0; i < 8; i++) rec = L.noteWritten(rec, [{ scope: 'print', key: 'wall_loops', value: String(i) }], 'k:' + i);
  assert.equal(rec['print/wall_loops'].length, 5);
  assert.equal(rec['print/wall_loops'][4].v, '7');
});

test('découpe qui ne repart pas juste après un réglage changé : jamais « il attend qu’un réglage change »', () => {
  assert.doesNotMatch(PF.SLICE_NOT_STARTED_AFTER_CHANGE.text, /attend qu’un réglage/);
  assert.ok(PF.SLICE_NOT_STARTED_AFTER_CHANGE.actions.some(a => a.kind === 'slice'));
  const src = read('index.html');
  // Une relance silencieuse d'abord, puis la phrase juste ; l'attente compte depuis le départ réel de la découpe.
  assert.match(src, /if \(justChanged && !slicing\.retried\) \{ slicing\.retried = true; resendSlice\(\); return; \}/);
  assert.match(src, /justChanged \? window\.PlyoPreflight\.SLICE_NOT_STARTED_AFTER_CHANGE : window\.PlyoPreflight\.SLICE_NOT_STARTED/);
  assert.match(src, /if \(msg\.ok && \(msg\.undo_id \|\| msg\.undone_id\)\) orcaUI\.changedAt = Date\.now\(\);/);
  assert.match(src, /else if \(slicing\.conv\) \{ slicing\.since = Date\.now\(\); slicing\.asked = false; \}/);
  // Le relevé des réglages de l'assistant suit chaque lot et chaque annulation, et sert à la fiche et aux questions d'intention.
  assert.match(src, /Logic\.noteWritten\(conv\.project\.assistant, msg\.written, BATCH_TAG \+ ':' \+ msg\.undo_id\)/);
  assert.match(src, /Logic\.forgetBatch\(conv\.project\.assistant, BATCH_TAG \+ ':' \+ msg\.undone_id\)/);
  assert.match(src, /Logic\.manualEditsNote\(items, conv && conv\.project\.assistant\)/);
  assert.match(src, /Logic\.splitManualEdits\(items, conv && conv\.project\.assistant\)\.mine/);
});

test('« Tout corriger » : la carte « Corrigé » dit ce qui a été fait et garde « Annuler » après la nouvelle vérification', () => {
  const src = read('index.html');
  assert.match(src, /preflightKept = \{ conv: mine, box: box, note: redo \};/);
  assert.match(src, /if \(!risks\.length\) kept\.note\.textContent = 'Plaque redécoupée et revérifiée : rien d’autre à signaler\.';/);
  assert.match(src, /fr\('Fait : ' \+ fixes\.map\(/);
  assert.match(src, /if \(preflightKept && preflightKept\.box === box\) preflightKept = null;/);
  // Après une application depuis une fiche, le compte rendu et « Annuler » sont amenés à l'écran.
  assert.match(src, /footer\.scrollIntoView\(\{ block: 'center' \}\);\n\s+updateMoreBadge\(\);/);
});
