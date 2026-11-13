// Nom du logiciel dans les textes du panneau : l'utilisateur lit « Plyo Slicer », jamais « Orca » ni « OrcaSlicer ».
// Les identifiants (orcaIssueView, orca_issues…) et les commentaires parlent du code d'OrcaSlicer : ils ne sont pas lus ici.
// Sentinelle sur les textes rendus par les fonctions pures, pas sur la source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PF = require('../preflight.js');
const L = require('../assistant-logic.js');
const C = require('../canvas-logic.js');
const J = require('../journey-logic.js');
const P = require('../project-logic.js');
const R = require('../retouches-logic.js');
const { FICHES } = require('../fiches.js');

const ORCA = /orca/i;

// Toutes les chaînes d'une valeur (objets et tableaux parcourus), avec leur chemin.
function strings(value, path, out) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, path + '[' + i + ']', out));
  else if (value && typeof value === 'object') for (const k of Object.keys(value)) strings(value[k], path + '.' + k, out);
  return out;
}
function clean(what, value) {
  for (const [path, s] of strings(value, what, [])) assert.ok(!ORCA.test(s), path + ' parle encore d’Orca : ' + s);
}

// Codes expliqués par preflight.js (EXPLAIN), plus un code inconnu.
const CODES = ['no_layers', 'empty_first_layer', 'nothing_to_print', 'print_empty', 'prime_tower', 'bad_alloc', 'plate_empty',
  'layer_height_over_nozzle', 'vase_several_objects', 'spiral_mode', 'object_too_tall', 'filament_bed_type', 'collision',
  'collision_by_object', 'object_outside', 'plate_refused', 'toolpath_outside', 'height_outside', 'filament_bed_surface', 'nozzle_area',
  'nozzle_height', 'not_printable', 'empty_layers', 'exclusion_area', 'filaments_temp', 'skirt_brim', 'precise_seam',
  'support_base_pattern', 'precise_outer_wall', 'adaptive_layer_height', 'enable_prime_tower', 'plate_warning', 'flushing_volume_zero',
  'nozzle_filament', 'pla_petg_mix', 'mixed_filament_single_nozzle', 'mixed_filament_broken', 'filament_unprintable',
  'extruder_unprintable', 'plugin_missing', 'mesh_errors', 'simplify_suggestion', 'unknown_font', 'project_load_warning', 'preview_only',
  'repair_removed_paint'];
const SOURCES = ['slicing_error', 'validate_error', 'validate_warning', 'step_warning', 'gcode_check', 'notification', 'other'];

test('cartes des messages du slicer : titre, explication, impact, actions et question, pour chaque code connu ou non', () => {
  for (const code of CODES) {
    const known = PF.orcaIssueView({ source: 'slicing_error', code, level: 'error', text: 'x', object_name: 'Cube' });
    assert.ok(!/que je ne sais pas encore expliquer/.test(known.text), code + ' : toujours expliqué par preflight.js');
  }
  for (const code of CODES.concat(['unknown', 'code_ajoute_plus_tard'])) {
    for (const source of SOURCES) {
      for (const level of ['error', 'warning']) {
        for (const extra of [{}, { text: 'Some text.', object_name: 'Cube', opt_key: 'layer_height', scope: 'print' },
          { text: '', opt_key: 'nozzle_diameter', scope: 'printer', level }]) {
          const issue = Object.assign({ source, code, level }, extra);
          clean(code + '/' + source + '/' + level, PF.orcaIssueView(issue, { canUndo: true }));
          clean(code + '/' + source + '/' + level + ' (sans annulation)', PF.orcaIssueView(issue, {}));
          clean('impactOf ' + code, PF.impactOf(issue));
          clean('askPrompt ' + code, PF.askPrompt(issue, ''));
        }
      }
    }
  }
});

test('envoi, liaison, fenêtres, export et découpe : aucun texte ne parle d’Orca', () => {
  clean('SEND_TEXTS', PF.SEND_TEXTS);
  for (const k of Object.keys(PF.SEND_TEXTS)) if (typeof PF.SEND_TEXTS[k] === 'function') clean('SEND_TEXTS.' + k, PF.SEND_TEXTS[k]('ta K1C', 40));
  for (const code of ['unreachable', 'auth', 'no_space', 'file_refused', 'not_printer', 'server_error', 'interrupted', 'no_confirmation',
    'before_send', 'unknown', 'code_inconnu'])
    for (const text of ['', 'HTTP 401: Unauthorized'])
      clean('uploadFailureView ' + code, PF.uploadFailureView({ code, text }, 'ta K1C'));
  for (const code of ['ok', 'auth', 'unreachable', 'not_printer', 'error', 'not_local', 'none', 'code_inconnu'])
    clean('linkRecheckView ' + code, PF.linkRecheckView({ code, text: 'detail' }, 'ta K1C'));
  for (const d of [{ kind: 'question', during: 'model_add' }, { kind: 'error', during: '' }])
    clean('dialogWaitText', PF.dialogWaitText(d));
  for (const during of ['model_add', 'slice', ''])
    for (const text of ['', 'Error.'])
      clean('dialogView ' + during, PF.dialogView({ phase: 'closed', kind: 'error', during, text }));
  clean('modelFailPrompt', [PF.modelFailPrompt([]), PF.modelFailPrompt(['A.', 'B.'])]);
  for (const kind of ['write', 'gcode_template', 'slicing', 'memory', 'other', 'inconnu'])
    for (const text of ['', 'Failed.'])
      clean('exportErrorView ' + kind, PF.exportErrorView({ kind, text }));
  clean('découpe', [PF.SLICE_SLOW, PF.SLICE_STOPPED, PF.SLICE_NOT_STARTED, PF.SLICE_NOT_STARTED_AFTER_CHANGE]);
});

test('emplacements, tests du slicer, enregistrements, projet et parcours : aucun texte ne parle d’Orca', () => {
  const imposed = { t: 0, canvas_id: 1, tray_id: 0, label: '1A', type: 'PLA', color: '#000000', imposable: true, source: 'printer', system: 'cfs' };
  const canvases = [[], [imposed], [Object.assign({}, imposed, { imposable: false })], [Object.assign({}, imposed, { source: 'manual' })],
    [Object.assign({}, imposed, { system: 'u1' })], [{ t: 0, tray_id: 0 }]];
  for (const c of canvases) clean('canvas ' + JSON.stringify(c), [C.printNote(c), C.orcaConfirm(c)]);

  for (const target of ['max_flow', 'vfa', 'tolerance']) {
    clean('rawTestText ' + target, L.rawTestText(target));
    for (const msg of [{ ok: true, target, replaced: true }, { ok: true, target, replaced: false }, { ok: true, target, arranged: true }, { ok: false, target }])
      clean('rawTestResult ' + target, L.rawTestResult(msg));
  }
  clean('savedText', [L.savedText({ saved: [{ type: 'filament', name: 'A (Plyo)', created: true, from: 'A' }] }), L.savedText({ saved: [], save_error: 'disque plein' }),
    L.savedText({ saved: [], save_error: 'temperatures' })]);
  clean('alsoChangedText', L.alsoChangedText([{ key: 'wall_loops', label: 'Parois', before: 3, after: 1 }]));
  clean('STALE_PROJECT_TEXT', L.STALE_PROJECT_TEXT);

  clean('projet', [P.filamentChoiceError({ cancelled: true }, 'PLA'), P.projectOpenedText('occupe'), P.projectOpenedText('autre'), P.openGiveUpText()]);
  clean('retouches', [R.spoolFailText('temperatures', 'Température', 'Bobine'), R.spoolFailText('write', '', ''), R.ADOPT_NONE,
    R.filamentDivergence('My eSun PLA+', { preset: 'Sunlu', spool: { id: 's1', name: 'Sunlu PLA+ noir' } })]);
  clean('profileChangeNote', J.profileChangeNote('Sunlu PLA+', 'Generic PLA', (s) => s));
  for (const step of ['machine', 'filament', 'preparer', 'imprimer'])
    for (const c of [{ sliced: true, blocked: true }, { sliced: false, sliceFailed: true }, { sliced: true }])
      clean('prompt ' + step, J.prompt(step, c));
  clean('FICHES', FICHES);
});
