import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const T = require('../project-thread.js');
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const at = new Date('2026-11-16T22:10:05Z');

test('fil du projet : 30 événements au plus, pas de répétition immédiate, texte borné', () => {
  const p = {};
  assert.equal(T.add(p, 'etapes', 'Étape « Pièce »', at), true);
  assert.equal(T.add(p, 'etapes', 'Étape « Pièce »', at), false, 'même texte juste après : pas répété');
  assert.equal(T.add(p, 'pirate', 'x', at), true);
  assert.equal(p.thread[1].from, 'etapes');
  for (let i = 0; i < 40; i++) T.add(p, 'discussion', 'e' + i, at);
  assert.equal(p.thread.length, 30);
  assert.equal(p.thread[29].text, 'e39');
  T.add(p, 'etapes', 'a'.repeat(500), at);
  assert.equal(p.thread[29].text.length, 200);
  assert.equal(T.add(null, 'etapes', 'x'), false);
});

test('ce que reçoit l’assistant : l’étape et le fil (heure, onglet, texte)', () => {
  const p = {};
  T.add(p, 'etapes', 'Pièce posée : « Pince ».', at);
  T.add(p, 'discussion', 'Réglages changés depuis la discussion : Buse 220 → 215.', at);
  const ai = T.forAI(p, 'preparer');
  assert.equal(ai.step, 'preparer');
  assert.deepEqual(ai.thread.map(e => e.from), ['etapes', 'discussion']);
  assert.match(ai.thread[0].at, /^\d\d:\d\d$/);
  assert.equal(T.forAI({}, 'nulle-part').step, 'machine');
  assert.equal(T.appliedText([{ id: 'nozzle_temperature', label: 'Buse', before: 220, after: 215 }], 'discussion'), 'Réglages changés depuis la discussion : Buse 220 → 215.');
  assert.equal(T.appliedText([{ label: 'Supports', before: false, after: true }], 'etapes'), 'Réglages changés : Supports non → oui.');
});

test('page : les deux onglets écrivent le fil, et il part avec chaque question', () => {
  assert.match(page, /<!--plyo-include:project-thread\.js-->/);
  assert.match(page, /projectForAI: PlyoThread\.forAI\(conv\.project, PlyoJourney\.currentStep\(conv\.project\)\),/);
  assert.match(fs.readFileSync(new URL('../ai-client.js', import.meta.url), 'utf8'), /if \(i\.projectForAI\) body\.project = i\.projectForAI;/);
  for (const what of ["threadNote\\('Étape « '", "PlyoThread\\.appliedText\\(msg\\.applied", "threadNote\\('Résultat : impression réussie\\.'\\)", "threadNote\\('Résultat : impression ratée\\.'\\)", "threadNote\\('Envoyée à l’imprimante\\.'", "threadNote\\('Découpe vérifiée : '", "threadNote\\('Pièce ' \\+ \\(p\\.retouch"])
    assert.match(page, new RegExp(what), what);
});

test('la discussion fait avancer les étapes : seulement à Imprimer et Résultat, jamais deux fois', () => {
  assert.deepEqual(T.outcomeMoves('imprimer', 'started', {}).moves, ['started']);
  assert.deepEqual(T.outcomeMoves('imprimer', 'success', {}).moves, ['started', 'success']);
  assert.deepEqual(T.outcomeMoves('resultat', 'failed', {}).moves, ['failed']);
  assert.deepEqual(T.outcomeMoves('resultat', 'success', { success: true }).moves, []);
  assert.deepEqual(T.outcomeMoves('resultat', 'failed', { failed: true }).moves, []);
  assert.deepEqual(T.outcomeMoves('preparer', 'failed', {}).moves, [], 'une impression d’un autre projet ne bouge pas l’étape');
  assert.deepEqual(T.outcomeMoves('resultat', 'none', {}).moves, []);
  assert.match(T.outcomeMoves('resultat', 'failed', {}).text, /impression ratée/);
  assert.match(page, /applyPrintOutcome\(a\.print_outcome\);/);
  assert.match(page, /move\.moves\.forEach\(function \(m\) \{ stepHandlers\[m\]\(\); \}\);/);
});

test('page : aucune fonction ne porte le nom d’une variable du même script (sinon la page plante au démarrage)', () => {
  const script = page.slice(page.indexOf('<script>'), page.lastIndexOf('</script>'));
  const fns = new Set([...script.matchAll(/^ {2}function ([A-Za-z_$][\w$]*)\(/gm)].map(m => m[1]));
  const vars = new Set();
  for (const m of script.matchAll(/^ {2}var ([^;]+);/gm))
    for (const part of m[1].split(/,(?![^(\[{]*[)\]}])/)) { const n = part.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) vars.add(n[1]); }
  const both = [...fns].filter(f => vars.has(f));
  assert.deepEqual(both, [], 'noms en double : ' + both.join(', '));
});

test('fil du projet : l’heure est l’heure locale', () => {
  const p = {}, d = new Date(2026, 10, 16, 22, 45, 7);
  T.add(p, 'etapes', 'x', d);
  assert.equal(p.thread[0].at, '2026-11-16T22:45:07');
  assert.equal(T.forAI(p, 'imprimer').thread[0].at, '22:45');
});
