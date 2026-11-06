// Non-régression des bugs trouvés en simulation dans le vrai slicer (novembre 2026).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, '..', name), 'utf8');
const cpp = (name) => fs.readFileSync(path.join(here, '..', '..', '..', '..', 'src', 'plyo', name), 'utf8');
const require = createRequire(import.meta.url);
const P = require('../project-logic.js');
const J = require('../journey-logic.js');
const PF = require('../preflight.js');

const settings = { brim_type: 'no_brim', brim_width: 0, support: false };
const cube = (name) => ({ name, height: 20, foot: [20, 20], contact_mm2: 400, needs_support: false, fits: true });

test('B1 : choisir un fichier remplace seulement une pièce restée du projet précédent', () => {
  const old = { label: 'porte-cles.stl', name: 'porte-cles.stl', objects: 1 };
  assert.equal(P.replacesPlate({ part: null }, old, false), true);
  assert.equal(P.replacesPlate({ part: null }, null, true), true, 'fichier déposé avant le choix de la machine');
  assert.equal(P.replacesPlate({ part: null }, null, false), false, 'plateau sans ancienne pièce connue');
  assert.equal(P.replacesPlate({ part: { name: 'crochet.stl' } }, null, false), false, 'reprise : la pièce du projet est reposée, rien n’est retiré');
  assert.equal(P.replacesPlate({ part: { name: 'crochet.stl' } }, old, true), false, 'une pièce déjà dans la fiche n’est jamais remplacée en silence');
});

test('B1 : le message dit quelle pièce est partie, et la phrase de l’étape Pièce le dit avant', () => {
  assert.match(P.replacedText('porte-cles.stl', 1), /« porte-cles\.stl » retirée du plateau/);
  assert.match(P.replacedText('x', 3), /Les 3 pièces/);
  assert.match(read('project-card.js'), /Si tu choisis un fichier, elle sera retirée, et tu pourras annuler/);
  assert.match(read('project-card.js'), /Garder cette pièce/, '« Garder cette pièce » reste un choix explicite');
  assert.ok(!/supprime-la avant de découper/.test(read('index.html')), 'plus de consigne de suppression à la main');
});

test('B1 : un conflit de trajets est un risque, en tête, avec une correction', () => {
  const data = { settings, objects: [cube('a.stl'), cube('b.stl')], sliced: true, conflict: { a: 'a.stl', b: 'b.stl', height: 0.2 } };
  const risks = PF.preflightRisks(data);
  assert.equal(risks[0].kind, 'conflict');
  assert.match(risks[0].text, /« a\.stl » et « b\.stl » se chevauchent/);
  assert.equal(risks[0].fixes[0].action, 'arrange');
  const plan = PF.preflightPlan(data);
  assert.equal(plan.count, 2);
  assert.deepEqual(plan.fixes.map((f) => f.key), ['arrange']);
  assert.equal(plan.fixes[0].checked, true);
  assert.deepEqual(PF.preflightRisks({ settings, objects: [cube('a.stl')], sliced: true }), [], 'sans conflit : aucun risque');
  assert.equal(PF.preflightRisks({ settings, objects: [], conflict: { a: '', b: '' } })[0].objects[0], 'Ta plaque');
});

test('B1 : jamais « Pas de risque détecté » quand un risque existe, même déjà ignoré', () => {
  assert.match(J.advanceNote(0).text, /Pas de risque détecté/);
  assert.ok(!/Pas de risque/.test(J.advanceNote(1).text));
  assert.equal(J.advanceNote(1).tone, 'warn');
  const page = read('index.html');
  assert.equal(page.split('Pas de risque détecté').length, 1, 'le texte vit dans advanceNote, pas en dur dans la page');
  assert.match(page, /advanceNote\(risks\.length\)/, 'calculé sur tous les risques, ignorés compris');
});

test('B1 : la vérification C++ lit le conflit, le remplacement est une seule étape annulable', () => {
  assert.match(cpp('PlyoPreflight.cpp'), /conflict_result/);
  const imp = cpp('PlyoModelImport.cpp');
  assert.match(imp, /TakeSnapshot snapshot\(plater/);
  assert.ok(imp.indexOf('TakeSnapshot snapshot') < imp.indexOf('delete_all_objects_from_model'));
  assert.match(imp, /plater->undo\(\); \/\/ le fichier ne s'ouvre pas/);
});
