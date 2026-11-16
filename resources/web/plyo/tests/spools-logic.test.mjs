// Tests de « Quelle bobine ? » (spools-logic.js) : node --test resources/web/plyo/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../spools-logic.js');

test('nameError : le nom est obligatoire, 3 caractères au moins (comme SpoolsLogic::clean_name)', () => {
  assert.equal(S.nameError(''), 'vide');
  assert.equal(S.nameError('   '), 'vide');
  assert.equal(S.nameError(null), 'vide');
  assert.equal(S.nameError('ab'), 'court');
  assert.equal(S.nameError('  a  '), 'court');
  assert.equal(S.nameError('//'), 'vide', 'les caractères interdits deviennent des espaces');
  assert.equal(S.nameError('éèà'), '', 'des lettres accentuées comptent pour une');
  assert.equal(S.nameError('Sunlu PLA+ noir'), '');
});

test('le nom est toujours accompagné d’une aide : où regarder, et un exemple', () => {
  assert.equal(S.NAME_HELP, 'Regarde l’étiquette de ta bobine : écris la marque et le type, par exemple « Sunlu PLA+ noir » ou « eSun PETG blanc ».');
  for (const code of ['vide', 'court']) assert.ok(S.nameErrorText(code).length > 10, code);
  assert.equal(S.nameErrorText(''), '');
});

test('choiceRows : nom, et dernier résultat sur cette machine (date JJ/MM)', () => {
  const rows = S.choiceRows([
    { id: 'b1', name: 'Sunlu PLA+ noir', material: 'PLA', has_preset: true, last_outcome: 'ok', last_ok_at: '2026-11-11' },
    { id: 'b2', name: 'eSun PETG blanc', material: 'PETG', has_preset: false, last_outcome: '', last_ok_at: '' },
    { id: 'b3', name: 'Bobine rouge', material: 'PLA', has_preset: true, last_outcome: 'bad', last_ok_at: '2026-10-02' }
  ]);
  assert.deepEqual(rows.map(r => r.detail), ['✓ réussie le 11/11', 'à essayer', 'dernière impression ratée']);
  assert.deepEqual(rows[0], { id: 'b1', label: 'Sunlu PLA+ noir', detail: '✓ réussie le 11/11', name: 'Sunlu PLA+ noir', material: 'PLA' });
  assert.deepEqual(S.choiceRows(null), []);
  assert.deepEqual(S.choiceRows([{ id: '', name: 'x' }, null]), [], 'lignes illisibles écartées');
});

test('resumeText : la phrase de reprise dit la vérité sur ce qui est repris', () => {
  assert.equal(S.resumeText('Sunlu PLA+ noir', { available: false, date: '', differs: false, summary: '' }), '');
  assert.equal(S.resumeText('Sunlu PLA+ noir', null), '');
  assert.equal(S.resumeText('Sunlu PLA+ noir', { available: true, date: '2026-11-11', differs: false, summary: '' }),
    'Je reprends tes réglages de la dernière impression réussie avec Sunlu PLA+ noir.');
  // Le préréglage a changé depuis : on ne prétend pas reprendre la version réussie, on la cite et on propose d'y revenir.
  const t = S.resumeText('Sunlu PLA+ noir', { available: true, date: '2026-11-11', differs: true, summary: 'débit 0,88' });
  assert.match(t, /débit 0,88/);
  assert.match(t, /11\/11/);
  assert.ok(!/Je reprends tes réglages de la dernière impression réussie/.test(t));
  assert.equal(S.restoreLabel('2026-11-11'), 'Revenir aux réglages réussis du 11/11');
  assert.ok(!/fiable/.test(t + S.restoreLabel('2026-11-11')), 'plus de « version fiable » pour une bobine');
});

test('réussite retenue : la phrase cite la bobine', () => {
  assert.equal(S.doneText('Sunlu PLA+ noir'), 'C’est noté : je reprendrai ces réglages pour Sunlu PLA+ noir.');
  // Avec la date de l’envoi : l’utilisateur voit quelle impression a été retenue.
  assert.equal(S.doneText('Sunlu PLA+ noir', '2026-11-12'), 'C’est noté : je reprendrai les réglages de ton impression du 12/11 pour Sunlu PLA+ noir.');
});

test('préréglage de l’utilisateur : proposé une fois, plus jamais après un non', () => {
  assert.equal(S.adoptQuestion('Mon PLA à moi'), 'Faire de « Mon PLA à moi » une bobine que je retiens ?');
  const h = S.declineAdopt({ machines: {}, hidden: [] }, 'Mon PLA à moi');
  assert.deepEqual(h.spool_declined, ['Mon PLA à moi']);
  assert.equal(S.offersAdopt(h, 'Mon PLA à moi'), false);
  assert.equal(S.offersAdopt(h, 'Autre'), true);
  assert.equal(S.offersAdopt({}, 'Autre'), true);
  assert.equal(S.offersAdopt({}, ''), false);
  assert.deepEqual(S.declineAdopt(h, 'Mon PLA à moi').spool_declined, ['Mon PLA à moi'], 'pas de doublon');
});

test('needsSpool : machine choisie, filament 1 sans bobine (les emplacements gardent leur choix)', () => {
  const printer = { preset: 'CR-10 SE', name: 'CR-10 SE' };
  assert.equal(S.needsSpool({ printer: null }), false);
  assert.equal(S.needsSpool({ printer: Object.assign({ proposed: true }, printer) }), false);
  assert.equal(S.needsSpool({ printer: printer, filament: null }), true);
  assert.equal(S.needsSpool({ printer: printer, filament: { type: 'PLA', preset: 'Generic PLA' } }), true);
  assert.equal(S.needsSpool({ printer: printer, filament: { type: 'PLA', preset: 'P', spool: { id: 'b1', name: 'Sunlu' } } }), false);
  assert.equal(S.needsSpool({ printer: printer, filament: { type: 'PLA', preset: 'P' }, canvas: [{ t: 0 }] }), false);
});

test('isFilamentQuestion : une question de l’assistant sur la matière renvoie au choix de la bobine', () => {
  assert.equal(S.isFilamentQuestion({ text: 'Quel filament utilises-tu ?', choices: ['PLA', 'PETG'] }), true);
  assert.equal(S.isFilamentQuestion({ text: 'Quelle matière ?', choices: ['Je ne sais pas'] }), true);
  assert.equal(S.isFilamentQuestion({ text: 'C’est quoi ?', choices: ['PLA', 'PETG', 'ABS'] }), true);
  assert.equal(S.isFilamentQuestion({ text: 'Quelle buse ?', choices: ['0,4', '0,6'] }), false);
  assert.equal(S.isFilamentQuestion(null), false);
});

test('réglages d’impression réussis remis au choix de la bobine : dits avec leur date et leurs valeurs', () => {
  assert.equal(S.printRestoredText('Filforme blanc', { ok: true, count: 3, date: '2026-11-16', summary: 'débit de la première couche 1,05, surface supérieure 175' }),
    'J’ai remis les 3 réglages d’impression qui avaient marché avec Filforme blanc le 16/11 : débit de la première couche 1,05, surface supérieure 175.');
  assert.equal(S.printRestoredText('Filforme blanc', { ok: true, count: 1, date: '2026-11-16', summary: 'débit de la première couche 1,05' }),
    'J’ai remis le réglage d’impression qui avait marché avec Filforme blanc le 16/11 : débit de la première couche 1,05.');
  // Rien remis, refus (dit à part), ou pas de réponse : rien à dire.
  assert.equal(S.printRestoredText('X', { ok: true, count: 0 }), '');
  assert.equal(S.printRestoredText('X', { ok: false, text: 'Non' }), '');
  assert.equal(S.printRestoredText('X', null), '');
});
