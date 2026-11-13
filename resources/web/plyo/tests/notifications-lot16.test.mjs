// Lot 16 de l'audit (ERR-11) : les bulles d'Orca sur la plaque et la pièce (notifications, reconnues par leur type côté
// slicer), expliquées au débutant : ce qui se passe, ce que ça change, et toujours une issue gratuite qui existe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const PF = require('../preflight.js');
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const kinds = (v) => v.actions.map((a) => a.kind);
// Suites qui ne demandent ni compte ni crédit (« ask » passe par le service : jamais la seule issue).
const FREE = ['fix', 'plate', 'slice', 'import', 'export', 'show_me', 'show_setting', 'preview', 'dismiss', 'undo_last'];

// Codes rendus par PlyoOrcaMessagesLogic::classify_notice (KNOWN_NOTICES et types départagés par un fait).
const ERRORS = ['object_outside', 'filament_unprintable', 'extruder_unprintable', 'plugin_missing'];
const WARNINGS = ['prime_tower', 'plate_warning', 'flushing_volume_zero', 'nozzle_filament', 'pla_petg_mix', 'mixed_filament_single_nozzle',
  'mixed_filament_broken', 'mesh_errors', 'simplify_suggestion', 'unknown_font', 'project_load_warning', 'preview_only', 'repair_removed_paint'];

test('chaque bulle connue : explication Plyo en français, impact, et une issue gratuite', () => {
  for (const code of ERRORS.concat(WARNINGS)) {
    const level = ERRORS.includes(code) ? 'error' : 'warning';
    const v = PF.orcaIssueView({ source: 'notification', code, level, text: 'Some English text from Orca.', object_name: 'Cube' });
    assert.ok(v.text && !/que je ne sais pas encore expliquer/.test(v.text), code + ' : expliqué par Plyo');
    assert.ok(v.impact, code + ' : ce que ça change');
    assert.ok(v.actions.some((a) => FREE.includes(a.kind)), code + ' : une issue gratuite ' + JSON.stringify(kinds(v)));
    assert.equal(v.quote, 'Some English text from Orca.', code + ' : le texte d’Orca reste cité');
    assert.ok(!/lis-le|lis le message|regarde ses messages/i.test(v.text), code + ' : jamais renvoyé vers Orca');
    assert.ok(!/\b(you|the|please)\b/i.test(v.text), code + ' : pas d’anglais dans l’explication');
  }
});

test('erreur reconnue : « Orca refuse de découper », bloquant ; avertissement : « Orca prévient », non bloquant', () => {
  const e = PF.orcaIssueView({ source: 'notification', code: 'filament_unprintable', level: 'error', text: 'x' });
  assert.equal(e.title, 'Orca refuse de découper cette plaque');
  assert.match(e.impact, /^C’est bloquant/);
  assert.equal(e.tone, 'error');
  const w = PF.orcaIssueView({ source: 'notification', code: 'pla_petg_mix', level: 'warning', text: 'x' });
  assert.equal(w.title, 'Orca prévient');
  assert.match(w.impact, /pas bloquant/);
  assert.ok(kinds(w).includes('dismiss') && kinds(w).includes('preview'));
});

test('pièce à cheval sur le bord : ranger ou réduire, sur le plateau (jamais un réglage de l’imprimante)', () => {
  const v = PF.orcaIssueView({ source: 'validate_error', code: 'object_outside', level: 'error', text: 'An object is laid over the boundary of plate…' });
  const plate = v.actions.filter((a) => a.kind === 'plate').map((a) => a.action);
  assert.deepEqual(plate, ['arrange', 'scale_to_fit']);
  assert.match(v.text, /déborde sur un bord, ou elle est plus haute/);
  assert.ok(!v.actions.some((a) => a.kind === 'fix'), 'rien à modifier dans les réglages');
});

test('maillage abîmé : la pièce nommée et le vrai geste d’Orca (« Réparer le modèle », sur toutes les plateformes)', () => {
  const v = PF.orcaIssueView({ source: 'notification', code: 'mesh_errors', level: 'warning', object_name: 'Benchy', text: 'Use "Fix Model" to repair the mesh.' });
  assert.match(v.text, /^« Benchy » a un maillage abîmé/);
  assert.match(v.text, /clic droit sur la pièce, puis « Réparer le modèle » \(Fix Model\)/);
  // « Fix Model » passe par CGAL (MenuFactory::append_menu_item_fix_through_cgal) : présent sur macOS, pas seulement Windows.
  const menu = read('../../../../src/slic3r/GUI/GUI_Factories.cpp');
  assert.match(menu, /append_menu_item_fix_through_cgal[\s\S]{0,200}_L\("Fix Model"\)/);
  assert.ok(!/#ifdef _WIN32[^#]*fix_through_cgal/.test(menu), 'la réparation n’est pas réservée à Windows');
});

test('bulle inconnue : dit honnêtement, impact incertain, « Découper à nouveau » gratuit', () => {
  const e = PF.orcaIssueView({ source: 'notification', code: 'unknown', level: 'error', text: 'Something new.' });
  assert.equal(e.title, 'Orca a un souci');
  assert.match(e.text, /que je ne sais pas encore expliquer/);
  assert.match(e.impact, /^Je ne sais pas si ça bloque/);
  assert.ok(kinds(e).includes('slice'));
  const w = PF.orcaIssueView({ source: 'notification', code: 'unknown', level: 'warning', text: 'Something new.' });
  assert.equal(w.title, 'Orca prévient');
  assert.match(w.impact, /pas bloquant/);
  assert.ok(kinds(w).includes('dismiss'));
});

test('impacts propres : tour de purge (risque d’échec), G-code ouvert (aperçu seulement)', () => {
  assert.match(PF.impactOf({ source: 'notification', code: 'prime_tower', level: 'warning' }), /la découpe risque d’échouer/);
  assert.match(PF.impactOf({ source: 'notification', code: 'preview_only', level: 'warning' }), /seul l’aperçu est possible/);
  // Hors bulle, la tour de purge en erreur de découpe garde l'impact bloquant habituel.
  assert.match(PF.impactOf({ source: 'slicing_error', code: 'prime_tower', level: 'error' }), /^C’est bloquant/);
});

test('signal des bulles : ajoutées à demander, fermées à retirer', () => {
  assert.deepEqual(PF.noticeChange([], ['object_outside']), { added: ['object_outside'], gone: [] });
  assert.deepEqual(PF.noticeChange(['object_outside'], ['object_outside']), { added: [], gone: [] });
  assert.deepEqual(PF.noticeChange(['object_outside', 'pla_petg_mix'], ['pla_petg_mix', 'mesh_errors']), { added: ['mesh_errors'], gone: ['object_outside'] });
  assert.deepEqual(PF.noticeChange(undefined, null), { added: [], gone: [] });
  assert.deepEqual(PF.noticeChange([], ['', 3, 'x']), { added: ['x'], gone: [] }, 'valeurs invalides écartées');
  const issues = [{ source: 'validate_error', code: 'object_outside', level: 'error', text: 'a' }, { source: 'validate_warning', code: 'enable_support', level: 'warning', text: 'b' }];
  assert.deepEqual(PF.noticeIssues(issues, ['object_outside'], {}).map((i) => i.code), ['object_outside'], 'seulement les codes apparus');
  assert.deepEqual(PF.noticeIssues(issues, ['object_outside'], { [PF.issueKey(issues[0])]: true }), [], 'pas de redite');
});

test('panneau : les signaux suivent les bulles, une carte porte son code, la réponse « notices » est traitée', () => {
  const page = read('../index.html');
  assert.match(page, /watchNotices\(signals\.notices\)/);
  assert.match(page, /box\.dataset\.code = issue\.code/);
  assert.match(page, /msg\.purpose === 'notices'/);
  assert.match(page, /if \(msg\.busy\) \{ orcaUI\.notices = \[\]; return; \}/, 'Orca découpe : on redemandera au signal suivant');
});

test('slicer : codes des bulles joints aux signaux, lecture par type (jamais par texte)', () => {
  const steps = read('../../../../src/plyo/PlyoFirstSteps.cpp');
  assert.match(steps, /signals\["notices"\]\s*= OrcaMessages::notice_codes\(\);/);
  const messages = read('../../../../src/plyo/PlyoOrcaMessages.cpp');
  assert.match(messages, /manager->plyo_notices\(\)/);
  assert.match(messages, /static_assert\(std::size\(NOTICE_NAMES\) == static_cast<size_t>\(NoticeType::NotificationTypeCount\)/);
  assert.match(messages, /clean_for_panel\(OML::strip_notice_prefix/);
  assert.ok(!/compare_text|\.find\(_u8L/.test(messages), 'aucune reconnaissance par le texte');
});
