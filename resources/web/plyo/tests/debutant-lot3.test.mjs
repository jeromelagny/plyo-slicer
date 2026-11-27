import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const PF = require('../preflight.js');
const here = new URL('..', import.meta.url).pathname;
const read = f => fs.readFileSync(here + f, 'utf8');

test('jerk ou accélération bridés par la machine : pas de carte, pas d’alerte à côté de « Aucun risque »', () => {
  const capped = { source: 'validate_warning', code: 'motion_capped', level: 'warning', text: 'The jerk setting exceeds…', opt_key: 'default_jerk', scope: 'print' };
  const other = { source: 'validate_warning', code: 'brim_width', level: 'warning', text: 'x' };
  assert.deepEqual(PF.orcaCards([capped, other], { warnings: true }).map(i => i.code), ['brim_width']);
  const v = PF.orcaIssueView(capped);
  assert.match(v.text, /Rien à faire : ta pièce s’imprime normalement\./);
});

test('débutant : un avertissement inconnu dit d’abord qu’il n’est pas bloquant, deux suites, le texte d’Orca replié', () => {
  const i = { source: 'validate_warning', code: 'some_key', level: 'warning', text: 'Something odd', opt_key: 'some_key', scope: 'print' };
  const v = PF.orcaIssueView(i, { novice: true, canUndo: true });
  assert.doesNotMatch(v.text, /ne sais pas encore expliquer/);
  assert.match(v.text, /Ce n’est pas bloquant : tu peux continuer/);
  assert.deepEqual(v.actions.map(a => a.kind), ['dismiss', 'ask']);
  assert.equal(v.explained, true, 'texte d’Orca replié');
  // Le confirmé garde la carte complète.
  const e = PF.orcaIssueView(i, { canUndo: true });
  assert.ok(e.actions.length > 2);
});

test('débutant : la marche à suivre après l’export, et l’aperçu d’Orca annoncé', () => {
  const S = require('../journey-steps.js');
  assert.equal(S.EXPORT_STEPS.length, 4);
  assert.match(S.EXPORT_STEPS[1], /carte SD ou la clé USB/);
  assert.match(S.AFTER_SLICE_NOTE, /tu n’as rien à y faire/);
  assert.match(read('index.html'), /novice: fsState\.level !== 'expert'/);
});
