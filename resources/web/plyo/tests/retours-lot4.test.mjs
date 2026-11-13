// Lot 4 de l'audit : retours arrière (mode catalogue), réglages réussis, une seule question « ça a marché ? » par impression.
// node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const J = require('../journey-logic.js');
const S = require('../spools-logic.js');
const read = name => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', name), 'utf8');

// Réglages lus de l'ancienne liste (message « values »), comme le slicer les envoie.
const PARAMS = [
  { id: 'nozzle_temp', key: 'nozzle_temperature', label: 'Température de buse', unit: '°C', value: 215 },
  { id: 'retraction', key: 'filament_retraction_length', label: 'Longueur de rétraction', unit: 'mm', value: 0.8 },
  { id: 'brim_type', key: 'brim_type', label: 'Type de bordure', unit: '', value: 'outer_only', values: ['auto_brim', 'outer_only', 'no_brim'] },
  { id: 'sparse_infill_density', key: 'sparse_infill_density', label: 'Taux de remplissage', unit: '%', value: 20 },
  { id: 'wall_loops', key: 'wall_loops', label: 'Nombre de parois', unit: '', value: 3 }
];
// Lot du catalogue noté par le lot 4 (clé, libellé, unité) : température, pourcentage en texte, booléen, énumération.
const CATALOG = {
  at: '2026-11-12T10:00:00', why: 'Fils d’araignée', conv: 'c1', changes: [
    { id: 'nozzle_temperature', key: 'nozzle_temperature', label: 'Température de buse', unit: '°C', before: 220, after: 210 },
    { id: 'sparse_infill_density', key: 'sparse_infill_density', label: 'Taux de remplissage', unit: '%', before: '15%', after: '20%' },
    { id: 'enable_support', key: 'enable_support', label: 'Supports activés', before: false, after: true },
    { id: 'brim_type', key: 'brim_type', label: 'Type de bordure', before: 'no_brim', after: 'outer_only' }
  ] };
const SNAP = { nozzle_temperature: 210, sparse_infill_density: '20%', enable_support: true, brim_type: 'outer_only', wall_loops: 3 };

test('ROB-06 : un lot du catalogue est remis par clé, avec son libellé, et confirmé par le bouton qui l’annonce', () => {
  const plan = L.revertPlan(CATALOG, PARAMS, SNAP);
  assert.deepEqual(plan.changes, [
    { key: 'nozzle_temperature', value: 220, label: 'Température de buse', confirmed: true },
    { key: 'sparse_infill_density', value: '15%', label: 'Taux de remplissage', confirmed: true },
    { key: 'enable_support', value: false, label: 'Supports activés', confirmed: true },
    { key: 'brim_type', value: 'no_brim', label: 'Type de bordure', confirmed: true }]);
  assert.deepEqual(plan.changed, []);
  assert.equal(L.revertText(plan), 'C’est noté, je ne te reproposerai pas ces réglages. Ils sont encore appliqués : tu peux remettre ceux d’avant, puis on cherche une autre piste.');
  // Un seul mode par lot pour le slicer : tout part en un lot du catalogue.
  assert.equal(L.batchesOf(plan.changes).length, 1);
});

test('ROB-06 : une retouche manuelle n’est pas écrasée, et elle est nommée', () => {
  const plan = L.revertPlan(CATALOG, PARAMS, { ...SNAP, nozzle_temperature: 215, sparse_infill_density: '25%' });
  assert.deepEqual(plan.changes.map((c) => c.key), ['enable_support', 'brim_type']);
  assert.deepEqual(plan.changed, [{ key: 'nozzle_temperature', label: 'Température de buse', value: 215 }, { key: 'sparse_infill_density', label: 'Taux de remplissage', value: '25%' }]);
  assert.equal(L.revertText(plan), 'C’est noté, je ne te reproposerai pas ces réglages. Tu as retouché depuis : Température de buse (215 °C) et Taux de remplissage (25 %). Je n’y touche pas ; je peux remettre les autres comme avant.');
});

test('ROB-06 : « Tes réglages ont déjà changé depuis » seulement si c’est vrai, en nommant lesquels', () => {
  const all = L.revertPlan(CATALOG, PARAMS, { nozzle_temperature: 225, sparse_infill_density: '15%', enable_support: false, brim_type: 'auto_brim' });
  assert.equal(all.changes.length, 0);
  assert.match(L.revertText(all), /Tes réglages ont déjà changé depuis : Température de buse \(225 °C\), Taux de remplissage \(15 %\), Supports activés \(non\) et Type de bordure \(Auto\)\. On peut chercher une autre piste\./);
  // Relevé illisible : on ne prétend rien, on ne remet rien sans vérifier.
  const unread = L.revertPlan(CATALOG, PARAMS, null);
  assert.equal(unread.changes.length, 0);
  assert.equal(unread.unread.length, 4);
  assert.equal(L.revertText(unread), 'C’est noté, je ne te reproposerai pas ces réglages. Je n’arrive pas à relire tes réglages actuels : je ne remets rien sans vérifier.');
  assert.equal(L.revertText({ changes: [], changed: [], unread: [] }), 'C’est noté, je ne te reproposerai pas ces réglages. On peut chercher une autre piste.');
});

test('ROB-06 : comparaison tolérante (« 20% » et 20, 0,2 et 0,2000001), stricte pour oui/non et le texte', () => {
  assert.ok(L.sameSetting('20%', '20%'));
  assert.ok(L.sameSetting('20%', 20));
  assert.ok(L.sameSetting(0.2, '0.2000000001'));
  assert.ok(!L.sameSetting('20%', '20'));
  assert.ok(!L.sameSetting(true, 1));
  assert.ok(L.sameSetting(false, false));
  assert.ok(L.sameSetting('outer_only', 'outer_only'));
  assert.ok(!L.sameSetting('outer_only', 'no_brim'));
  assert.ok(!L.sameSetting(null, null));
});

test('ROB-06 : un lot du catalogue noté avant le lot 4 (sans clé, valeurs typées) est reconnu par le relevé', () => {
  const old = { changes: [
    { id: 'nozzle_temperature', before: 220, after: 210, label: 'Température de buse' }, // libellé ajouté à la lecture par le C++
    { id: 'sparse_infill_density', before: '15%', after: '20%' },                         // aussi un identifiant de l'ancienne liste
    { id: 'seam_position', before: 'aligned', after: 'back' }] };
  const plan = L.revertPlan(old, PARAMS, { nozzle_temperature: 210, sparse_infill_density: '20%', seam_position: 'back' });
  assert.deepEqual(plan.changes.map((c) => c.key), ['nozzle_temperature', 'sparse_infill_density', 'seam_position']);
  assert.ok(plan.changes.every((c) => c.confirmed && !c.id));
  // Valeur d'avant inconnue (« nil ») : rien à remettre pour ce réglage, sans le compter comme retouché.
  const nil = L.revertPlan({ changes: [{ key: 'filament_retraction_length', before: null, after: 1.2 }] }, PARAMS, { filament_retraction_length: 1.2 });
  assert.deepEqual(nil, { changes: [], changed: [], unread: [] });
});

test('ROB-06 : un lot de l’ancienne liste déjà enregistré continue de marcher', () => {
  const item = { changes: [{ id: 'retraction', before: 0.8, after: 1.2 }, { id: 'nozzle_temp', before: 220, after: 215 }, { id: 'brim_type', before: 'no_brim', after: 'outer_only' }] };
  const plan = L.revertPlan(item, PARAMS, SNAP);
  // La rétraction a été changée à la main depuis (0,8 lu) : laissée et nommée.
  assert.deepEqual(plan.changes, [{ id: 'nozzle_temp', value: 220 }, { id: 'brim_type', value: 'no_brim' }]);
  assert.deepEqual(plan.changed, [{ key: 'retraction', label: 'Longueur de rétraction', value: 0.8 }]);
  assert.equal(L.batchesOf(plan.changes).length, 1);
  // L'ancienne signature reste celle d'avant (sans relevé).
  assert.deepEqual(L.revertChanges(item, PARAMS), [{ id: 'nozzle_temp', value: 220 }, { id: 'brim_type', value: 'no_brim' }]);
  assert.deepEqual(L.revertChanges(item, PARAMS, SNAP), plan.changes);
});

test('ROB-06 : lots mêlés (catalogue et ancienne liste) : deux lots, le catalogue d’abord', () => {
  const b = L.batchesOf([{ id: 'nozzle_temp', value: 220 }, { key: 'enable_support', value: false }, null]);
  assert.deepEqual(b, [[{ key: 'enable_support', value: false }], [{ id: 'nozzle_temp', value: 220 }]]);
  assert.deepEqual(L.batchesOf([]), []);
});

test('ROB-06 : « Réappliquer » envoie un lot du catalogue (clé, valeur d’après, confirmé), l’ancienne liste reste par identifiant', () => {
  const e = { printer: 'A1', filament: 'PLA', outcome: 'ok', changes: CATALOG.changes };
  assert.deepEqual(L.reapplyChanges(e, { printer: 'A1', filament: 'PLA' }, PARAMS), [
    { key: 'nozzle_temperature', value: 210, label: 'Température de buse', confirmed: true },
    { key: 'sparse_infill_density', value: '20%', label: 'Taux de remplissage', confirmed: true },
    { key: 'enable_support', value: true, label: 'Supports activés', confirmed: true },
    { key: 'brim_type', value: 'outer_only', label: 'Type de bordure', confirmed: true }]);
  // Ancien enregistrement du catalogue (sans clé) : reconnu parce que l'identifiant n'est pas de l'ancienne liste, ou par sa valeur texte.
  const old = { printer: 'A1', filament: 'PLA', outcome: 'ok', changes: [{ id: 'seam_position', before: 'aligned', after: 'back' }, { id: 'sparse_infill_density', before: '15%', after: '20%' }, { id: 'retraction', before: 0.8, after: 1.2 }] };
  assert.deepEqual(L.reapplyChanges(old, { printer: 'A1', filament: 'PLA' }, PARAMS), [
    { key: 'seam_position', value: 'back', label: 'seam_position', confirmed: true },
    { key: 'sparse_infill_density', value: '20%', label: 'sparse_infill_density', confirmed: true },
    { id: 'retraction', value: 1.2 }]);
  assert.equal(L.reapplyChanges({ ...e, outcome: 'bad' }, { printer: 'A1', filament: 'PLA' }, PARAMS), null);
  assert.equal(L.reapplyChanges(e, { printer: 'X1C', filament: 'PLA' }, PARAMS), null);
});

test('ROB-06 : « Ça a marché ? » et « Mes pièces » montrent le libellé et l’unité, jamais une clé connue brute', () => {
  const labelOf = (id) => PARAMS.find((p) => p.id === id);
  const q = L.outcomeQuestion(CATALOG, labelOf);
  assert.deepEqual(q.changes, ['Température de buse : 220 → 210 °C', 'Taux de remplissage : 15 % → 20 %', 'Supports activés : non → oui', 'Type de bordure : Sans bord → Bordure extérieure uniquement']);
  // Ancien enregistrement de l'ancienne liste : les libellés lus dans le slicer, comme avant.
  assert.equal(L.changeLine({ id: 'retraction', before: 0.8, after: 1.2 }, labelOf), 'Longueur de rétraction : 0,8 → 1,2 mm');
  // Température du catalogue sans unité notée : « °C » d'après la clé.
  assert.equal(L.changeLine({ id: 'nozzle_temperature', label: 'Température de buse', before: 220, after: 210 }, () => undefined), 'Température de buse : 220 → 210 °C');
});

test('ROB-07 : réglages réussis, ce qui va changer est dit avant (les températures d’abord)', () => {
  const info = { available: true, date: '2026-11-11', count: 5, changes: [
    { key: 'filament_cooling_moves', label: 'Mouvements de refroidissement', before: 4, after: 2 },
    { key: 'nozzle_temperature', label: 'Température de buse', before: 215, after: 205 },
    { key: 'filament_flow_ratio', label: 'Ratio de débit', before: 0.98, after: 0.95 },
    { key: 'slow_down_layer_time', label: 'Temps de couche', before: 4, after: 6 },
    { key: 'filament_retraction_length', label: 'Rétraction', before: 0.8, after: 0.6 }] };
  assert.equal(L.reliablePreview(info), 'Ça remet 5 réglages du filament comme lors de ta dernière impression réussie : Température de buse (215 °C → 205 °C), Ratio de débit (0,98 → 0,95), Rétraction (0,8 → 0,6) et 2 autres.');
  assert.equal(L.reliablePreview({ available: true, count: 0, changes: [] }), 'Tes réglages du filament sont déjà ceux de ta dernière impression réussie.');
  assert.equal(L.reliablePreview({ available: true, count: 1, changes: [{ key: 'nozzle_temperature', label: 'Buse', before: 215, after: 205 }] }), 'Ça remet 1 réglage du filament comme lors de ta dernière impression réussie : Buse (215 °C → 205 °C).');
  // Un seul vocabulaire : « réglages réussis », plus de « version fiable » à l'écran.
  assert.match(S.restoreLabel('2026-11-11'), /^Revenir aux réglages réussis du /);
});

test('UX-22 : une seule question par impression (carte de mémoire et étape Résultat)', () => {
  const now = new Date('2026-11-12T12:00:00');
  const printed = { at: '2026-11-12T10:00:00', conv: 'c1', printed: '2026-11-12T10:30:00', changes: [] };
  const fromOrca = { at: '2026-11-12T09:00:00', conv: 'c1', changes: [] };
  // Projet ouvert dont l'étape Résultat pose la question : la carte se tait pour cette impression.
  assert.deepEqual(L.outcomeCard([printed], now, 'c1', true), null);
  // Projet fermé : la carte invite à l'ouvrir (la question reste celle du projet).
  assert.deepEqual(L.outcomeCard([printed], now, 'c2', false), { item: printed, open: true });
  assert.deepEqual(L.outcomeCard([printed], now, null, false), { item: printed, open: true });
  // Projet ouvert, mais son étape ne pose plus la question (repassé à Imprimer, impression relancée depuis Orca) : la carte demande.
  assert.deepEqual(L.outcomeCard([printed], now, 'c1', false), { item: printed, open: false });
  // Correction jamais rattachée à une impression du panneau (lancée depuis Orca, ou pas encore) : la carte demande, avec « Pas encore imprimé ».
  assert.deepEqual(L.outcomeCard([printed, fromOrca], now, 'c1', true), { item: fromOrca, open: false });
  // Trop tôt : rien.
  assert.equal(L.outcomeCard([{ ...fromOrca, at: '2026-11-12T11:45:00' }], now, null, false), null);
});

test('UX-22 : plusieurs corrections pour la même impression : une seule remise, de la valeur la plus ancienne', () => {
  const newer = { at: 'T2', conv: 'c1', why: 'Fils encore', machine: 'K2 | PLA', changes: [
    { id: 'nozzle_temperature', key: 'nozzle_temperature', label: 'Buse', before: 210, after: 205 },
    { id: 'filament_retraction_length', key: 'filament_retraction_length', label: 'Rétraction', before: 0.8, after: 1.2 }] };
  const older = { at: 'T1', conv: 'c1', why: 'Fils', machine: 'K2 | PLA', changes: [{ id: 'nozzle_temperature', key: 'nozzle_temperature', label: 'Buse', before: 220, after: 210 }] };
  const m = L.mergeCorrections([newer, older]);
  assert.equal(m.why, 'Fils encore');
  assert.equal(m.conv, 'c1');
  assert.deepEqual(m.changes.map((c) => [c.key, c.before, c.after]), [['nozzle_temperature', 220, 205], ['filament_retraction_length', 0.8, 1.2]]);
  // Une correction défaite par la suivante (retour à la même valeur) : rien à remettre pour elle.
  const back = L.mergeCorrections([{ at: 'T2', changes: [{ key: 'wall_loops', before: 4, after: 3 }] }, { at: 'T1', changes: [{ key: 'wall_loops', before: 3, after: 4 }] }]);
  assert.deepEqual(back.changes, []);
  assert.equal(L.mergeCorrections([]), null);
});

test('UX-22 : mêmes libellés partout — « Oui, c’est réussi », « Non, c’est raté », « Pas encore imprimé »', () => {
  assert.deepEqual(J.endQuestion('finished', 'K2', '').choices.map((c) => c.label), ['Oui, c’est réussi', 'Non, c’est raté']);
  const steps = read('journey-steps.js');
  assert.doesNotMatch(steps, /C’est fini : réussi|C’est fini : raté/);
  const page = read('index.html');
  assert.match(page, /var OUTCOME_YES = 'Oui, c’est réussi', OUTCOME_NO = 'Non, c’est raté', OUTCOME_LATER = 'Pas encore imprimé';/);
  assert.doesNotMatch(page, /redemande-moi plus tard'|button\('Oui', function \(\) \{ answer|button\('Non', function \(\) \{ answer/);
  // Plus de « version fiable » dans les textes visibles (le panneau et les textes du slicer).
  const visible = page.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(visible, /version fiable/);
  const cpp = ['PlyoSettingsBridge.cpp', 'PlyoProfiles.cpp'].map((f) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../../../src/plyo', f), 'utf8')).join('\n');
  assert.doesNotMatch(cpp.replace(/\/\/[^\n]*/g, ''), /"[^"\n]*version fiable[^"\n]*"/);
});

test('ROB-06 et ROB-07 : le panneau remet par le chemin validé et annulable, sans « ask », avec « Annuler »', () => {
  const page = read('index.html');
  const bad = page.slice(page.indexOf('function renderOutcomeBad'), page.indexOf('// Réglages remis à la main'));
  assert.match(bad, /aiContext\(\)\.then/, 'relit le relevé du catalogue');
  assert.match(bad, /Logic\.revertPlan\(item, lastValues && lastValues\.params, ctx && ctx\.snapshot \? ctx\.snapshot : null\)/);
  assert.match(bad, /postBatches\(Logic\.batchesOf\(plan\.changes\), why, \{ revert: true \}/);
  assert.doesNotMatch(bad, /ask:/, 'un retour arrière ne repose pas la question');
  assert.match(bad, /undoBatches\(ids,/);
  assert.match(bad, /PlyoSpools\.restoreLabel\(info\.date\)/);
  assert.match(bad, /Logic\.reliablePreview\(info\)/);
  assert.match(bad, /reliableDone\(res, status\)/);
  assert.match(bad, /PlyoJourney\.PHOTO_PHONE/);
  assert.match(bad, /PlyoJourney\.PHOTO_COMPUTER/);
  assert.match(bad, /'Chercher une autre piste'/);
  const post = page.slice(page.indexOf('function postBatches'), page.indexOf('function undoBatches'));
  assert.match(post, /print_name: names\.process, filament_name: names\.filament, printer_name: names\.printer/, 'les noms du moment : le slicer refuse un lot du catalogue sans eux');
  const done = page.slice(page.indexOf('function reliableDone'), page.indexOf('function renderOutcomeBad'));
  assert.match(done, /postRequest\(\{ type: 'undo', undo_id: res\.undo_id \}\)/);
  const journal = page.slice(page.indexOf('function fillJournal'), page.indexOf('function openUsage'));
  assert.match(journal, /Logic\.reapplyChanges\(e, here, lastValues && lastValues\.params\)/);
  assert.match(journal, /postBatches\(Logic\.batchesOf\(again\)/);
});

test('UX-22 : Résultat rattache les corrections à l’impression, et sa réponse les marque (journal, réglages réussis)', () => {
  const page = read('index.html');
  assert.match(page, /started: function \(\) \{[^\n]*window\.orca\.postMessage\(\{ type: 'outcome_printed', conv: conv\.id \}\);/);
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'outcome_result', conv: conv\.id, outcome: outcome, ats: ats \}\)/);
  assert.match(page, /msg\.type === 'outcome_result_done'/);
  const res = page.slice(page.indexOf('function onOutcomeResult'), page.indexOf('function onOutcomeResult') + 2000);
  assert.match(res, /renderOutcomeBad\(Logic\.mergeCorrections\(items\), ''\)/, '« Non, c’est raté » : remettre, réglages réussis, autre piste, photo');
  const cpp = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../../../src/plyo/PlyoAssistant.cpp'), 'utf8');
  assert.match(cpp, /type == "outcome_printed"/);
  assert.match(cpp, /Memory::set_result\(conv, outcome, ats\)/);
  assert.match(cpp, /Journal::set_outcome\(conv, outcome\)/);
  assert.match(cpp, /Profiles::mark_reliable\(Json::str\(e, "at"\)\)/);
});
