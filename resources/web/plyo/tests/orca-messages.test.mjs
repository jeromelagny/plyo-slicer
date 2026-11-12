// Lot 2 de l'audit : ce qu'Orca dit de la plaque (erreurs de découpe, refus de validation, contrôles du G-code, export),
// expliqué au débutant avec une suite, jamais « lis le message d'Orca ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const PF = require('../preflight.js');
const J = require('../journey-logic.js');
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const kinds = (v) => v.actions.map((a) => a.kind);
const ASK = 'Demander à l’assistant (utilise ta jauge)';

test('cas fréquents : une explication Plyo par code, la pièce nommée, et toujours une suite', () => {
  const codes = ['no_layers', 'empty_first_layer', 'nothing_to_print', 'print_empty', 'plate_empty', 'layer_height_over_nozzle', 'vase_several_objects',
    'object_too_tall', 'filament_bed_type', 'filament_bed_surface', 'toolpath_outside', 'height_outside', 'empty_layers', 'object_outside', 'PlaceholderParserError'];
  for (const code of codes) {
    const v = PF.orcaIssueView({ source: 'slicing_error', code, level: 'error', text: 'Some English text from Orca.', object_name: 'Cube' });
    assert.ok(v.text && !v.quoteMain, code + ' : expliqué par Plyo');
    assert.ok(v.actions.length > 0, code + ' : une suite');
    assert.ok(!/lis-le|lis le message|regarde ses messages/i.test(v.text), code + ' : jamais renvoyé vers Orca');
  }
  const v = PF.orcaIssueView({ source: 'slicing_error', code: 'no_layers', level: 'error', text: 'No layers were detected.', object_name: 'Clé' });
  assert.equal(v.title, 'Orca n’a pas pu préparer ta pièce');
  assert.match(v.text, /« Clé »/);
  assert.match(v.text, /trop petite ou trop fine/);
  assert.equal(v.quote, 'No layers were detected.', 'le texte d’Orca reste visible en détail');
  assert.deepEqual(kinds(v), ['ask']);
  assert.equal(v.actions[0].label, ASK);
  assert.match(v.actions[0].prompt, /« No layers were detected\. »/);
  assert.match(v.actions[0].prompt, /pour « Clé »/);
});

test('hauteur de couche plus grande que la buse : la correction sûre en un clic, sur le réglage du catalogue', () => {
  const v = PF.orcaIssueView({ source: 'validate_error', code: 'layer_height_over_nozzle', level: 'error', text: 'Layer height cannot exceed nozzle diameter.',
    opt_key: 'layer_height', scope: 'print', object_name: 'Cube', fix: { key: 'layer_height', value: 0.2 } });
  assert.equal(v.title, 'Orca refuse de découper cette plaque');
  const fix = v.actions.find((a) => a.kind === 'fix');
  assert.equal(fix.label, 'Mettre la hauteur de couche à 0,2 mm');
  assert.deepEqual(fix.changes, [{ key: 'layer_height', value: 0.2, label: 'Hauteur de couche' }]);
  assert.ok(!kinds(v).includes('show_setting'), 'la correction suffit : pas de « Montre-moi » en plus');
  // Sans correction proposée par le slicer (la pièce a sa propre hauteur) : on montre le réglage.
  const shown = PF.orcaIssueView({ source: 'validate_error', code: 'layer_height_over_nozzle', level: 'error', text: 'x', opt_key: 'layer_height', scope: 'print' });
  assert.deepEqual(kinds(shown), ['show_setting', 'ask']);
});

test('mode vase et plusieurs pièces : « Désactiver le mode vase » seulement dans le périmètre de l’assistant', () => {
  const v = PF.orcaIssueView({ source: 'validate_error', code: 'vase_several_objects', level: 'error', text: 'x', opt_key: 'spiral_mode', scope: 'print', fix: { key: 'spiral_mode', value: false } });
  assert.equal(v.actions[0].label, 'Désactiver le mode vase');
  assert.deepEqual(v.actions[0].changes, [{ key: 'spiral_mode', value: false, label: 'Mode vase' }]);
  const outside = PF.orcaIssueView({ source: 'validate_error', code: 'vase_several_objects', level: 'error', text: 'x', opt_key: 'spiral_mode', scope: 'printer', fix: { key: 'spiral_mode', value: false } });
  assert.ok(!kinds(outside).includes('fix'), 'hors du périmètre : rien à modifier');
});

test('réglage de l’imprimante ou G-code : expliqué et montré, jamais modifié', () => {
  const v = PF.orcaIssueView({ source: 'validate_error', code: 'nozzle_diameter', level: 'error', text: 'Printing with multiple extruders of differing nozzle diameters.', opt_key: 'nozzle_diameter', scope: 'printer' });
  assert.ok(!kinds(v).includes('fix'));
  assert.deepEqual(kinds(v), ['show_setting', 'ask']);
  assert.match(v.note, /profil de l’imprimante : je ne le modifie pas/);
  assert.ok(v.quoteMain, 'pas d’explication Plyo : le texte d’Orca est montré comme tel');
  const g = PF.orcaIssueView({ source: 'slicing_error', code: 'PlaceholderParserError', level: 'error', text: 'Parsing error at line 3' });
  assert.ok(!kinds(g).includes('fix'));
  assert.match(g.text, /Je ne modifie jamais ces commandes/);
  assert.deepEqual(g.actions[0], { kind: 'show_me', target: 'printer', label: 'Montre-moi l’imprimante' });
});

test('problème inconnu : le texte d’Orca entre guillemets, présenté comme tel, et « Demander à l’assistant »', () => {
  const v = PF.orcaIssueView({ source: 'slicing_error', code: 'RuntimeError', level: 'error', text: 'Wipe tower generation failed.', object_name: 'Tour' });
  assert.ok(v.quoteMain);
  assert.equal(v.quote, 'Wipe tower generation failed.');
  assert.match(v.text, /^Orca dit à propos de « Tour » :$/);
  assert.deepEqual(kinds(v), ['ask']);
  assert.equal(v.actions[0].prompt, 'Orca m’affiche ce message pour « Tour » : « Wipe tower generation failed. ». Explique-moi simplement ce qui se passe et comment le corriger.');
  const w = PF.orcaIssueView({ source: 'validate_warning', code: 'support_base_pattern', level: 'warning', text: 'Rectilinear will be used instead.', opt_key: 'support_base_pattern', scope: 'print' });
  assert.equal(w.tone, 'warn');
  assert.equal(w.title, 'Orca prévient');
  assert.deepEqual(kinds(w), ['show_setting', 'ask']);
  const blank = PF.orcaIssueView({ source: 'validate_error', code: 'unknown', level: 'error', text: '' });
  assert.match(blank.text, /sans me donner de détail/);
  assert.match(blank.actions[0].prompt, /^Orca signale un problème sur ma plaque\./);
});

test('cartes : erreurs d’abord, trois au plus, « pièce flottante » laissée à la vérification avant impression', () => {
  const issues = [
    { source: 'validate_warning', code: 'a', level: 'warning', text: 'w' },
    { source: 'step_warning', code: 'need_support', level: 'warning', text: 'flotte' },
    { source: 'gcode_check', code: 'toolpath_outside', level: 'error', text: '' },
    { source: 'step_warning', code: 'empty_layers', level: 'warning', text: 'vide' },
    { source: 'validate_warning', code: 'b', level: 'warning', text: 'w2' }];
  assert.deepEqual(PF.orcaCards(issues, {}).map((i) => i.code), ['toolpath_outside']);
  assert.deepEqual(PF.orcaCards(issues, { warnings: true }).map((i) => i.code), ['toolpath_outside', 'a', 'empty_layers']);
  assert.deepEqual(PF.orcaCards(null, {}), []);
  assert.equal(PF.issueKey({ source: 's', code: 'c', text: 't' }), 's|c||t');
});

test('export en échec : la phrase vient du type d’erreur, avec « Choisir un autre dossier »', () => {
  const w = PF.exportErrorView({ kind: 'write', text: 'Copying of the temporary G-code to the output G-code failed.' });
  assert.match(w.text, /disque est peut-être plein, le dossier protégé, ou un fichier du même nom est ouvert/);
  assert.deepEqual(w.actions[0], { kind: 'export', label: 'Choisir un autre dossier' });
  assert.equal(w.actions[1].label, ASK);
  assert.equal(w.quote, 'Copying of the temporary G-code to the output G-code failed.');
  assert.deepEqual(kinds(PF.exportErrorView({ kind: 'gcode_template' })), ['show_me', 'ask']);
  assert.deepEqual(kinds(PF.exportErrorView({ kind: 'slicing' })), ['slice']);
  assert.deepEqual(kinds(PF.exportErrorView({ kind: 'mystère', text: 'x' })), ['export', 'ask']);
  assert.match(PF.exportErrorView({}).text, /aucun fichier n’a été écrit/);
});

test('filet de sécurité de la découpe : relancer ou demander, jamais « lis le message d’Orca »', () => {
  assert.ok(!/message|lis-le/.test(PF.SLICE_SLOW.text));
  assert.deepEqual(kinds(PF.SLICE_SLOW), ['slice', 'ask']);
  assert.deepEqual(kinds(PF.SLICE_STOPPED), ['slice']);
  const page = read('../index.html');
  assert.ok(!/lis-le/.test(page), 'plus aucun renvoi vers le message d’Orca');
  assert.match(page, /orcaNote\(window\.PlyoPreflight\.SLICE_SLOW, 'warn'\)/);
});

test('parcours : plaque découpée mais non imprimable, pas de « Continuer » ni d’« Imprimer »', () => {
  assert.equal(J.primaryAction('preparer', { sliced: true, blocked: true }).kind, 'none');
  assert.equal(J.primaryAction('imprimer', { sliced: true, blocked: true, linked: true }).kind, 'none');
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: true }).kind, 'send');
  assert.equal(J.afterSliceFollow({ sliced: true, blocked: true, linked: true }), null);
  assert.match(J.prompt('preparer', { sliced: true, blocked: true }), /Orca bloque l’impression/);
  assert.match(J.prompt('imprimer', { sliced: true, blocked: true }), /Orca bloque l’impression/);
  assert.equal(J.prompt('imprimer', { sliced: true }), 'Prêt à imprimer');
  // Découpe refusée ou en erreur : plus de « Je découpe… », l'explication est annoncée, « Découper » reste possible.
  assert.match(J.prompt('preparer', { sliceFailed: true }), /Orca n’a pas pu découper ta plaque/);
  assert.equal(J.primaryAction('preparer', { sliceFailed: true }).kind, 'slice');
  assert.equal(J.primaryAction('preparer', { sliceFailed: true }).enabled, true);
});

test('panneau : fin de découpe, refus, relecture après un lot et contexte de l’IA branchés', () => {
  const page = read('../index.html');
  assert.match(page, /msg\.type === 'slice_result'\) \{\n\s+onSliceResult\(msg\);/);
  assert.match(page, /msg\.type === 'orca_issues'\) \{\n\s+onOrcaIssues\(msg\);/);
  assert.match(page, /msg\.reason === 'orca_refused'\) \{[\s\S]{0,80}orcaFailed\(msg\.issues, 'refused'\)/);
  assert.match(page, /if \(msg\.ok && msg\.undo_id && conv\) \{[\s\S]{0,200}askOrca\('after_apply'\)/);
  assert.match(page, /if \(ctx && ctx\.plate\) body\.plate = ctx\.plate;/, 'plate.issues part tel quel vers le service');
  // Une correction passe par le chemin d'application habituel (validation du slicer, « Annuler »).
  const fix = page.slice(page.indexOf('function applyOrcaFix'), page.indexOf('function orcaNote'));
  // Le clic sur le bouton qui annonce la valeur confirme la correction (dernière barrière du slicer, lot 3).
  assert.match(fix, /type: 'apply', changes: Logic\.confirmedChanges\(a\.changes\), print_name: names\.process/);
  assert.match(fix, /undoButton\('Annuler'/);
});

test('slicer : une seule ligne dans Orca, à côté du crochet d’export, et aucun texte traduit comparé', () => {
  const orca = read('../../../../src/slic3r/GUI/Plater.cpp');
  assert.match(orca, /set_slicing_progress_export_possible\(\);\n\s+Plyo::OrcaMessages::on_slicing_done\(evt\); \/\/ PLYO: [^\n]+\n\n\s+\/\/ PLYO: le panneau Assistant attend la fin réelle de l'export/);
  assert.equal(orca.split('Plyo::OrcaMessages::').length - 1, 1);
  assert.match(orca, /#include "plyo\/PlyoOrcaMessages\.hpp" \/\/ PLYO:/);
  const cpp = read('../../../../src/plyo/PlyoOrcaMessages.cpp');
  assert.match(cpp, /catch \(const Slic3r::SlicingError&\)/, 'classé par type d’exception');
  assert.ok(!/\.find\("[A-Z][a-z]+ /.test(cpp) && !/string\.find|message\.find|text\.find/.test(cpp), 'aucune recherche dans un texte d’Orca');
  assert.match(cpp, /print\.validate\(&warnings\)/);
  assert.match(cpp, /is_background_process_slicing\(\)/, 'pas de lecture pendant une découpe');
  const actions = read('../../../../src/plyo/PlyoPlateActions.cpp');
  assert.ok(!/dépasse sans doute du plateau/.test(actions), 'plus de cause devinée');
  assert.match(actions, /\{"issues", OrcaMessages::report\(\)\["issues"\]\}/);
  const docs = read('../../../../docs/plyo/FICHIERS-MODIFIES.md');
  assert.match(docs, /Plyo::OrcaMessages::on_slicing_done\(evt\)/);
});
