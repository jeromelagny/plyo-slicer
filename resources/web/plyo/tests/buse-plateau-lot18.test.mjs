// Lot 18 : taille de buse et type de plateau demandés à l'étape Machine (machines-logic.js, journey-logic.js).
// La buse : toujours montrée quand le modèle en a plusieurs, 0,4 mm d'abord. Le plateau : une question par imprimante, retenue,
// rappelée dans la fiche ; jamais pour une imprimante à un seul type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const M = require('../machines-logic.js');
const J = require('../journey-logic.js');

const ORCA = /orca/i;
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

const BED = { types: [{ value: 'Cool Plate', label: 'Smooth Cool Plate' }, { value: 'Textured PEI Plate', label: 'Textured PEI Plate' }], current: 'Textured PEI Plate' };

test('buse : une seule taille, installée sans question', () => {
  assert.deepEqual(M.nozzleChoice(['0.4']), { auto: '0.4' });
  assert.deepEqual(M.nozzleChoice(['0.6']), { auto: '0.6' });
  assert.deepEqual(M.nozzleChoice(['0.4', '0.4']), { auto: '0.4' });
});

test('buse : plusieurs tailles, la question, 0,4 mm d’abord et marquée comme la plus courante', () => {
  const q = M.nozzleChoice(['0.8', '0.2', '0.6', '0.4']);
  assert.equal(q.auto, undefined, 'jamais installée d’office');
  assert.deepEqual(q.choices.map((c) => c.value), ['0.4', '0.2', '0.6', '0.8']);
  assert.equal(q.choices[0].label, '0,4 mm (la plus courante)');
  assert.ok(q.choices[0].common && !q.choices[1].common);
  assert.equal(q.choices[2].label, '0,6 mm');
  assert.match(q.text, /Si tu n’as jamais changé la buse de ton imprimante, garde 0,4 mm/);
  assert.match(q.text, /petite pièce en métal/, 'ce qu’est une buse, en mots simples');
  assert.match(q.help, /gravée sur la buse/, 'de quoi répondre quand on ne sait pas');
});

test('buse : sans 0,4 mm, de la plus fine à la plus grosse, et le conseil de la notice', () => {
  const q = M.nozzleChoice(['0.5', '0.25']);
  assert.deepEqual(q.choices.map((c) => c.label), ['0,25 mm', '0,5 mm']);
  assert.match(q.text, /notice/);
});

test('buse : changement, la buse d’aujourd’hui signalée', () => {
  const q = M.nozzleChoice(['0.4', '0.6'], '0.6');
  assert.equal(q.title, 'Quelle buse est montée sur ton imprimante ?');
  assert.equal(q.choices[1].label, '0,6 mm · en place aujourd’hui');
  assert.ok(q.choices[1].current && !q.choices[0].current);
  assert.match(q.help, /refait la préparation/);
});

test('buse : texte des tailles', () => {
  assert.equal(M.nozzleText(0.4), '0,4 mm');
  assert.equal(M.nozzleText('0.25'), '0,25 mm');
  assert.equal(M.nozzleText(''), '');
  assert.equal(M.nozzleText(null), '');
  assert.equal(M.nozzleText(-1), '');
});

test('buse : « Changer de buse » seulement pour un profil fourni, à plusieurs tailles, sur la machine du projet', () => {
  const machine = { vendor: 'Creality', model: 'Creality Ender-3 V3', nozzles: ['0.4', '0.6'], nozzle: '0.4', system: true };
  const p = 'Creality Ender-3 V3 0.4 nozzle';
  assert.deepEqual(M.nozzleChangeOffer(machine, p, p), { vendor: 'Creality', model: 'Creality Ender-3 V3', nozzles: ['0.4', '0.6'], current: '0.4' });
  assert.equal(M.nozzleChangeOffer(Object.assign({}, machine, { system: false }), p, p), null, 'profil à soi (« Ma … ») : non');
  assert.equal(M.nozzleChangeOffer(Object.assign({}, machine, { nozzles: ['0.4'] }), p, p), null, 'une seule taille : rien à changer');
  assert.equal(M.nozzleChangeOffer(machine, p, 'Ma K1C'), null, 'le slicer est sur une autre machine');
  assert.equal(M.nozzleChangeOffer(null, p, p), null);
  assert.equal(M.nozzleChangeOffer(machine, '', ''), null);
});

test('fiche : la buse que lit le slicer, jamais une supposition', () => {
  const project = { printer: { preset: 'Creality Ender-3 Pro 0.4 nozzle', name: 'Creality Ender-3 Pro 0.4 nozzle' }, part: { name: 'bateau.stl' }, filament: { type: 'PLA', preset: 'x' } };
  assert.equal(J.filledRows(project, { nozzleMm: 0.6 })[0].text, 'Creality Ender-3 Pro · buse 0,6 mm');
  assert.equal(J.filledRows(project)[0].text, 'Creality Ender-3 Pro 0.4 nozzle', 'buse inconnue : le nom du profil, comme avant');
  assert.equal(J.ficheSummary(project, { nozzleMm: 0.4 }), 'Creality Ender-3 Pro · buse 0,4 mm · bateau.stl · PLA');
  assert.equal(J.ficheSummary(project), 'Creality Ender-3 Pro · bateau.stl · PLA', 'sans buse lue : le nom sans la mention anglaise');
  assert.equal(J.machineText({ preset: 'Ma K1C' }, 0.4), 'Ma K1C · buse 0,4 mm');
  assert.equal(J.machineText({ preset: 'Ma K1C' }, null), 'Ma K1C');
});

test('plateau : rien à demander ni à montrer pour une imprimante à un seul type', () => {
  const one = { types: [{ value: 'Textured PEI Plate', label: 'Textured PEI Plate' }], current: 'Textured PEI Plate' };
  for (const bed of [one, { types: [], current: 'Cool Plate' }, null, undefined, {}]) {
    assert.deepEqual(M.bedTypes(bed), []);
    assert.equal(M.bedAsks(bed, { preset: 'p', orcaPrinter: 'p', habits: {} }), false);
    assert.equal(M.bedRow(bed), null);
  }
});

test('plateau : la question, une fois par imprimante, sur la machine du projet', () => {
  const ctx = { preset: 'p', orcaPrinter: 'p', habits: M.emptyHabits() };
  assert.equal(M.bedAsks(BED, ctx), true);
  assert.equal(M.bedAsks(BED, Object.assign({}, ctx, { orcaPrinter: 'autre' })), false, 'le slicer est sur une autre machine');
  assert.equal(M.bedAsks(BED, Object.assign({}, ctx, { preset: '' })), false, 'machine pas encore choisie');
  const answered = M.rememberBed(ctx.habits, 'p', 'Cool Plate');
  assert.equal(M.bedAsks(BED, Object.assign({}, ctx, { habits: answered })), false, 'réponse retenue : plus de question');
  assert.equal(M.bedAsks(BED, Object.assign({}, ctx, { habits: answered, preset: 'q', orcaPrinter: 'q' })), true, 'une autre imprimante : sa propre question');
  assert.equal(M.bedAsks(BED, Object.assign({}, ctx, { habits: answered, editing: true })), true, '« changer » de la fiche');
  assert.equal(M.bedAsks(BED, Object.assign({}, ctx, { habits: M.rememberBed(ctx.habits, 'p', 'unknown') })), false, '« Je ne sais pas » compte comme une réponse');
  assert.equal(M.bedAsks(BED, Object.assign({}, ctx, { habits: answered, shown: true })), true, 'montrée pendant la session : elle reste');
});

test('plateau : noms simples, de quoi reconnaître, le type d’aujourd’hui signalé, « Je ne sais pas »', () => {
  const q = M.bedQuestion(BED);
  assert.equal(q.title, 'Quel plateau est posé sur ton imprimante ?');
  assert.deepEqual(q.choices.map((c) => c.name), ['Plaque lisse basse température (Cool Plate)', 'Plaque PEI texturée']);
  assert.match(q.choices[1].look, /Rugueuse au toucher/);
  assert.match(q.choices[0].look, /Lisse au toucher/);
  assert.ok(q.choices[1].current && !q.choices[0].current);
  assert.equal(q.unknown, 'Je ne sais pas');
  assert.match(q.help, /écrit dessus/);
  assert.match(M.bedUnknownText(BED), /je garde « Plaque PEI texturée »/);
  assert.match(M.bedUnknownText(BED), /Pour vérifier/);
  // Chaque valeur d'Orca a son nom et sa description ; une valeur inconnue garde le libellé du slicer.
  for (const v of ['Cool Plate', 'Engineering Plate', 'High Temp Plate', 'Textured PEI Plate', 'Textured Cool Plate', 'Supertack Plate']) {
    assert.ok(M.BEDS[v] && M.BEDS[v].name && M.BEDS[v].look, v);
  }
  assert.equal(M.bedName('Nouvelle Plate', 'New Plate'), 'New Plate');
});

test('plateau : la réponse retenue par imprimante, sans effacer les autres habitudes', () => {
  let h = M.rememberFilament(M.emptyHabits(), 'p', { type: 'PLA', nozzle_temp: 210, bed_temp: 60 });
  h.last_intent = { use: 'deco' };
  h.spool_declined = ['x'];
  h = M.rememberBed(h, 'p', 'Textured PEI Plate');
  h = M.rememberFilament(h, 'p', { type: 'PETG', nozzle_temp: 240, bed_temp: 80 });
  h = M.chooseLevel(h, 'short');
  assert.equal(M.bedAnswer(h, 'p'), 'Textured PEI Plate', 'gardée après une autre habitude');
  assert.deepEqual(h.last_intent, { use: 'deco' });
  assert.deepEqual(h.spool_declined, ['x']);
  assert.equal(M.bedAnswer(h, 'q'), '');
  assert.equal(M.bedAnswer(M.rememberBed(h, 'p', 'n’importe quoi'), 'p'), 'Textured PEI Plate', 'valeur inconnue refusée');
  assert.equal(M.bedAnswer(M.rememberBed(h, '', 'Cool Plate'), ''), '');
});

test('plateau : fiche, changement et retour en arrière', () => {
  assert.deepEqual(M.bedRow(BED), { text: 'Plateau : Plaque PEI texturée' });
  assert.match(M.bedRow(Object.assign({}, BED, { plate: 'Cool Plate' })).note, /Cette plaque a son propre type de plateau/);
  assert.equal(M.bedRow(Object.assign({}, BED, { plate: 'Textured PEI Plate' })).note, undefined);
  assert.match(M.bedChosenText('Cool Plate', 'Textured PEI Plate', true), /Je l’ai réglé dans Plyo Slicer/);
  assert.match(M.bedChosenText('Cool Plate', 'Cool Plate', false), /C’était déjà le réglage/);
  assert.equal(M.bedRevertLabel('Textured PEI Plate'), 'Remettre « Plaque PEI texturée »');
});

test('textes du lot : jamais « Orca », tutoiement', () => {
  const all = strings([M.nozzleChoice(['0.4', '0.6']), M.nozzleChoice(['0.25', '0.5']), M.nozzleChoice(['0.4', '0.6'], '0.4'), M.BEDS, M.bedQuestion(BED),
    M.bedUnknownText(BED), M.bedChosenText('Cool Plate', 'x', true), M.bedChosenText('Cool Plate', 'x', false), M.bedRow(Object.assign({}, BED, { plate: 'Cool Plate' })),
    M.bedRevertLabel('Cool Plate')]);
  for (const s of all) {
    assert.ok(!ORCA.test(s), 'parle d’Orca : ' + s);
    assert.ok(!/\bvous\b|\bvotre\b/i.test(s), 'vouvoiement : ' + s);
  }
});

test('le type de plateau ne change que sur un clic : un seul envoi de bed_type_set, depuis chooseBed', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/type: 'bed_type_set'/g) || []).length, 1, 'un seul endroit envoie le message');
  const fn = html.slice(html.indexOf('function chooseBed('), html.indexOf('var bedHandlers'));
  assert.match(fn, /postMessage\(\{ type: 'bed_type_set', value: value, printer: preset, token: bedUI\.token \}\)/);
  // chooseBed n'est appelée que par les boutons de la carte (pickBed) et « Remettre … » d'une réponse.
  assert.equal((html.match(/chooseBed\(/g) || []).length, 3, 'définition, pickBed, Remettre');
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoCommands.cpp', import.meta.url), 'utf8');
  assert.ok(!/bed_type|set_bed_type/.test(cpp), 'les ordres de l’IA n’y mènent pas');
});
