// Lot 15 de l'audit : défauts N1 à N8 relevés par la relecture finale des parcours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const J = require('../journey-logic.js');
const R = require('../retouches-logic.js');
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('N1 : chaque ordre sur le plateau a son texte, même sans phrase de l’IA', () => {
  assert.equal(L.commandSummary({ op: 'scale', amount: 1 }), 'Pièce mise à 1 % de sa taille');
  assert.equal(L.commandSummary({ op: 'scale', amount: 50, summary: 'Réduite de moitié' }), 'Réduite de moitié');
  assert.equal(L.commandSummary({ op: 'scale', amount: 12.5, summary: '  ' }), 'Pièce mise à 12,5 % de sa taille');
  assert.equal(L.commandSummary({ op: 'rotate', amount: 20 }), 'Pièce tournée de 20°');
  assert.equal(L.commandSummary({ op: 'set_copies', amount: 3 }), '3 exemplaires sur le plateau');
  assert.equal(L.commandSummary({ op: 'inconnu' }), 'Changement fait sur le plateau');
  assert.equal(L.commandSummary(null), 'Changement fait sur le plateau');
  assert.match(L.commandsForHistory({ commands: [{ op: 'scale', amount: 1 }] }), /demandé : Pièce mise à 1 % de sa taille/);
  const page = read('../index.html');
  assert.match(page, /summary: Logic\.commandSummary\(c\)/, 'les ordres partent avec leur texte');
  assert.match(page, /commandLine\(d \|\| 'Fait sur le plateau', 'ok', 'check'\)/, 'jamais une coche vide');
  assert.match(page, /row\.scrollIntoView\(\{ block: 'center' \}\); updateMoreBadge\(\);/, 'le récapitulatif et « Annuler » amenés dans la zone visible');
});

test('N2 : un message qui demandait la bobine part quand elle est choisie ; la fiche en attente passe avant « Montre-moi ta pièce »', () => {
  const p = { printer: { preset: 'K1C' }, filament: { preset: 'PLA', type: 'PLA' } };
  assert.deepEqual(J.stillMissing(p, ['filament']), []);
  assert.deepEqual(J.stillMissing({ printer: { preset: 'K1C' } }, ['filament', 'part']), ['filament', 'part']);
  assert.deepEqual(J.stillMissing({ printer: { preset: 'K1C' }, filament: { preset: 'PLA', proposed: true } }, ['filament']), ['filament'], 'une bobine seulement proposée ne compte pas');
  assert.equal(J.completionText('C’est noté. Montre-moi ta pièce dans la discussion : je te dirai quoi corriger.', true), J.FICHE_WAITS);
  assert.match(J.completionText('C’est noté. Montre-moi ta pièce…', false), /Montre-moi ta pièce/);
  const page = read('../index.html');
  assert.match(page, /watchMissing\(result\.missing,/, 'le refus de la fiche part une fois la bobine choisie');
  assert.match(page, /watchMissing\(missing, function \(\) \{ tip\.remove\(\); \}\);/, 'l’invitation « il me faudra ta bobine » aussi');
  assert.match(page, /settleMissing\(\);/);
});

test('N3 : après un export réussi, le bouton plein est « L’impression a démarré », l’export reste en secondaire', () => {
  assert.deepEqual(J.primaryAction('imprimer', { sliced: true, exported: true }), { label: 'L’impression a démarré', kind: 'started', enabled: true });
  assert.equal(J.primaryAction('imprimer', { sliced: true }).kind, 'export');
  assert.equal(J.primaryAction('imprimer', { sliced: true, exported: true, blocked: true }).kind, 'none', 'plaque bloquée : rien');
  const steps = read('../journey-steps.js');
  assert.match(steps, /ui\.button\('Exporter à nouveau', h\.exportFile, 'btn ghost sm', 'folder'\)/);
  assert.match(steps, /if \(opts\.sent && !c\.exported\)/, 'pas deux « L’impression a démarré »');
  const page = read('../index.html');
  assert.match(page, /else if \(kind === 'started'\) \{ if \(conv\) stepHandlers\.started\(\); \}/);
  assert.match(page, /ctx\.exported = !!conv && !!projectUI\.exported && projectUI\.exported\.conv === conv/);
});

test('N4 : « Annuler » des réglages après une réussite demande confirmation en disant ce qu’il défait', () => {
  assert.match(L.UNDO_AFTER_SUCCESS, /impression réussie/);
  assert.match(L.UNDO_AFTER_SUCCESS, /il faudra découper à nouveau/);
  const page = read('../index.html');
  const fn = page.slice(page.indexOf('function intentUndoButton'), page.indexOf('// Machine ou filament changé après avoir appliqué'));
  assert.match(fn, /if \(conv === mine && conv\.project\.success\) \{ confirmIntentUndo\(b, undoNow\); return; \}/);
  assert.match(fn, /'Remettre les réglages d’avant'/);
  assert.match(fn, /'Garder ces réglages'/);
});

test('N5 : valeurs à choix par leur libellé français du catalogue ; noms de profils raccourcis à l’affichage seulement', () => {
  assert.equal(L.choiceLabel('aligned', 'seam_position'), 'Alignée');
  assert.equal(L.choiceLabel('back', 'seam_position'), 'Arrière');
  assert.equal(L.choiceLabel('auto_brim'), 'Auto', 'sans réglage : la table commune');
  assert.equal(R.changeList([{ key: 'seam_position', label: 'Position de la couture', before: 'aligned', after: 'back' }]), 'position de la couture Alignée → Arrière');
  assert.equal(R.changeList([{ key: 'wall_loops', label: 'Parois', before: 2, after: 3 }]), 'parois 2 → 3');
  assert.match(R.printQuestion({ preset: '0.20mm Standard @Creality K1C', changes: [{ key: 'wall_loops', label: 'Parois' }] }), /profil d’impression « 0\.20mm Standard »/);
  const short = (n) => L.shortName(n, false);
  assert.equal(J.profileChangeNote('Sunlu PLA+', 'Generic PLA @Ma K1C', short), 'Profil de filament changé dans Orca : « PLA+ » devient « PLA ».');
  assert.equal(J.profileChangeNote('Generic PLA @A', 'Generic PLA @B', short), 'Profil de filament changé dans Orca : « Generic PLA @A » devient « Generic PLA @B ».', 'mêmes raccourcis : noms entiers');
  assert.equal(J.shortMachine({ name: 'Creality Ender-3 V3 0.4 nozzle' }), 'Creality Ender-3 V3');
});

test('N6 et N8 : la fiche repliée finit par des points de suspension, texte entier accessible ; « Me connecter » discret', () => {
  const page = read('../index.html');
  assert.match(page, /\.project-summary \{ display: block; min-width: 0;[^}]*text-overflow: ellipsis;/);
  assert.match(read('../project-card.js'), /line\.title = sum;/);
  assert.match(page, /<button class="btn ghost sm hidden push" id="btn-login"/);
});

test('N7 : sans compte, « Demander à l’assistant » dit qu’il faut se connecter, et la question part après la connexion', () => {
  const page = read('../index.html');
  assert.match(page, /function actionLabel\(a\) \{ return a\.kind === 'ask' && !session \? window\.PlyoPreflight\.ASK_LOGIN_LABEL : a\.label; \}/);
  assert.match(page, /Ta question est gardée : elle partira dès que tu seras connecté\./);
  assert.match(page, /if \(afterLogin\) \{ var retry = afterLogin; afterLogin = null; retry\(\); \}/);
  assert.match(page, /else if \(a\.kind === 'dismiss'\) box\.remove\(\);/);
  assert.match(page, /postRequest\(\{ type: 'undo' \}\);/, 'annuler le dernier lot, comme le menu');
});
