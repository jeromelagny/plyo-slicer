// Refonte du parcours débutant (brief du 22/11) : environ 5 décisions avant la première impression au lieu de 20.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.PlyoProject = require('../project-logic.js');
globalThis.PlyoJourney = require('../journey-logic.js');
globalThis.PlyoSpools = require('../spools-logic.js');
const J = globalThis.PlyoJourney, S = globalThis.PlyoSpools, Card = require('../project-card.js');
const here = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(here + f, 'utf8');

// Un DOM minimal pour les rendus.
function fakeUi() {
  const make = (tag, className, text) => {
    const node = { tag, className: className || '', children: [], attrs: {}, on: {}, dataset: {}, style: {},
      appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.unshift(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(t, f) { this.on[t] = f; }, contains() { return false; } };
    Object.defineProperty(node, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.children = []; } });
    node.textContent = text || '';
    return node;
  };
  return { el: make, icon: () => make('svg'), button: (label, onClick, className) => { const b = make('button', className, label); b.on.click = onClick; return b; } };
}
const all = (n) => [n, ...n.children.flatMap(all)];
const buttons = (n) => all(n).filter((x) => x.tag === 'button');
const labels = (n) => buttons(n).map((b) => b.textContent);
const textOf = (n) => (n.textContent || '') + n.children.map(textOf).join('');

// ---------- Lot 2 : bobine en un clic ----------

test('lot 2 · nom automatique : la matière et le jour, sans « / », unique parmi les bobines de la machine', () => {
  assert.equal(S.autoName('PLA', '22 novembre', []), 'PLA du 22 novembre');
  assert.equal(S.autoName('PLA', '22 novembre', ['PLA du 22 novembre', 'Sunlu PLA']), 'PLA du 22 novembre (2)');
  assert.equal(S.autoName('PLA', '22 novembre', ['pla du 22 novembre', 'PLA du 22 novembre (2)']), 'PLA du 22 novembre (3)');
  assert.equal(S.autoName('PETG', '1er décembre', null), 'PETG du 1er décembre');
  assert.equal(S.nameError(S.autoName('PLA', '', [])), '', 'même sans date, un nom accepté par le slicer');
  assert.doesNotMatch(S.autoName('PLA', '22 novembre', []), /\//);
});

test('lot 2 · « Oui, du PLA » est le bouton plein de l’étape Filament, aussi en « changer » le filament', () => {
  assert.deepEqual(J.primaryAction('filament', { quickSpool: 'PLA' }), { label: 'Oui, du PLA', kind: 'quickSpool', enabled: true });
  assert.equal(J.primaryAction('preparer', { quickSpool: 'PLA', editing: true }).kind, 'quickSpool');
  assert.equal(J.prompt('filament', { quickSpool: 'PLA' }), 'Ta bobine est en PLA ?');
  // Bobine déjà connue sur cette machine : inchangé.
  assert.equal(J.primaryAction('filament', { proposal: { name: 'Sunlu PLA+ noir' } }).label, 'Oui, Sunlu PLA+ noir');
  assert.equal(J.prompt('filament', { proposal: { name: 'Sunlu PLA+ noir' } }), 'Sunlu PLA+ noir, comme la dernière fois ?');
  // Le plateau passe d'abord (débutant), les emplacements et les températures gardent leur action.
  assert.equal(J.primaryAction('filament', { bedFirst: true }).kind, 'none');
  assert.equal(J.primaryAction('filament', { temps: { nozzle: 220, bed: 60 } }).kind, 'keepTemps');
});

const PROJECT = { printer: { preset: 'Ma K1C', name: 'K1C' }, part: { name: 'bateau.stl' }, filament: null };
function renderFilament(extra) {
  const slot = fakeUi().el('div'), calls = [];
  const handlers = new Proxy({}, { get: (_, k) => (...a) => calls.push([k, ...a]) });
  Card.renderChoices(slot, fakeUi(), Object.assign({ project: PROJECT, spools: [], newSpool: { open: false }, quickSpool: true, beginner: true, handlers }, extra));
  return { slot, calls };
}

test('lot 2 · nouvelle bobine : PETG et « Autres matières » en secondaire, marque, nom et températures derrière « Préciser »', () => {
  const { slot, calls } = renderFilament();
  assert.deepEqual(labels(slot), ['PETG', 'Autres matières', 'Préciser ma bobine (marque, nom, températures)']);
  assert.ok(!all(slot).some((n) => n.tag === 'input'), 'pas de champ du nom');
  assert.doesNotMatch(textOf(slot), /De quelle marque/);
  assert.match(textOf(slot), /C’est presque toujours du PLA/);
  buttons(slot).find((b) => b.textContent === 'PETG').on.click();
  assert.deepEqual(calls.pop(), ['quickSpool', 'PETG'], 'une autre matière se choisit aussi d’un clic');
  // « Autres matières » : ABS, ASA, TPU s'ajoutent, toujours d'un clic.
  const more = renderFilament({ newSpool: { open: false, allMaterials: true } });
  assert.deepEqual(labels(more.slot), ['PETG', 'ABS', 'ASA', 'TPU', 'Préciser ma bobine (marque, nom, températures)']);
});

test('lot 2 · « Préciser ma bobine » rouvre le parcours détaillé (matière, marque, puis nom)', () => {
  const { slot } = renderFilament({ quickSpool: false, newSpool: { open: true, precise: true, material: 'PLA', brands: [], picker: {} } });
  assert.match(textOf(slot), /✓ Matière : PLA/);
  assert.match(textOf(slot), /De quelle marque est ta bobine \?/);
  assert.ok(labels(slot).includes('Je ne sais pas'));
  const page = read('index.html');
  assert.match(page, /preciseSpool: function \(\) \{ projectUI\.newSpool\.precise = true; projectHandlers\.pickMaterial\('PLA'\); \}/);
});

test('lot 2 · bobines connues : la liste d’abord, la nouvelle bobine se choisit d’un clic une fois ouverte', () => {
  const rows = S.choiceRows([{ id: 'a', name: 'Sunlu PLA+ noir', material: 'PLA', last_ok_at: '2026-11-10' }]);
  const closed = renderFilament({ spools: rows });
  assert.deepEqual(labels(closed.slot), ['Sunlu PLA+ noir · ✓ réussie le 10/11', 'Une nouvelle bobine']);
  const open = renderFilament({ spools: rows, newSpool: { open: true } });
  assert.ok(labels(open.slot).includes('PETG') && labels(open.slot).includes('Annuler'));
});

test('lot 2 · page : nom du jour, températures du profil gardées sans question, condition de la ligne d’action', () => {
  const page = read('index.html');
  assert.match(page, /chooseSpool\(PlyoSpools\.autoName\(material, dayOf\(new Date\(\)\.toISOString\(\)\), rows\.map/);
  assert.match(page, /if \(!pend\.fresh \|\| pend\.quick\) conv\.project\.filament\.temps_ok = true;/);
  assert.match(page, /quick: !!pend\.quick \};/);
  assert.match(page, /else if \(kind === 'quickSpool'\) projectHandlers\.quickSpool\(journeyCtx\(\)\.quickSpool\);/);
  const fn = page.slice(page.indexOf('function quickSpoolMaterial'), page.indexOf('function quickSpoolMaterial') + 900);
  for (const cond of ['ns.precise', 'ctx.canvas', 'ctx.temps', 'ctx.bedFirst', 'pr.proposed', '!projectUI.showKinds', 'ns.open || !PlyoSpools.choiceRows(items).length'])
    assert.ok(fn.includes(cond), cond);
});

// ---------- Lot 3 : étape Machine, le cas normal d'abord ----------

const K1 = { preset: 'Ma K1C', name: 'Ma K1C', linked: true }, K2 = { preset: 'Ma K2', name: 'Ma K2', linked: true };
const USB = (n) => ({ preset: 'Ender ' + n, name: 'Ender ' + n, linked: false });

test('lot 3 · cartes : machines reliées puis clé USB, au-delà de trois sans liaison repliées', () => {
  assert.deepEqual(J.machineCards([K1, USB(1)], false).cards.map((c) => c.label), ['K1C', 'Ender 1']);
  const many = J.machineCards([K1, USB(1), USB(2), USB(3), USB(4)], false);
  assert.deepEqual([many.cards.length, many.folded], [1, 4]);
  assert.equal(J.machineCards([K1, USB(1), USB(2), USB(3), USB(4)], true).cards.length, 5);
  assert.equal(J.machineStatus({ linked: true }, true), '● connectée');
  assert.equal(J.machineStatus({ linked: true }, undefined), 'reliée');
  assert.equal(J.machineStatus({ linked: false }, true), 'clé USB');
});

test('lot 3 · une seule machine : « Imprimer sur … ? » et « Oui, c’est elle » ; aucune : « Ajouter mon imprimante » en plein', () => {
  assert.equal(J.prompt('machine', { onlyMachine: { name: 'K1C' } }), 'Imprimer sur K1C ?');
  assert.deepEqual(J.primaryAction('machine', { onlyMachine: { name: 'K1C' } }), { label: 'Oui, c’est elle', kind: 'pickOnly', enabled: true });
  assert.equal(J.prompt('machine', { noMachine: true }), 'Ajoute ton imprimante');
  assert.deepEqual(J.primaryAction('machine', { noMachine: true }), { label: 'Ajouter mon imprimante', kind: 'setupPrinter', enabled: true });
  assert.equal(J.primaryAction('machine', {}).kind, 'none', 'plusieurs machines : on clique sur sa carte');
  assert.equal(J.primaryAction('machine', { proposal: { name: 'K1C' } }).label, 'Oui, sur K1C', 'machine proposée : inchangé');
});

function renderMachine(printers, extra) {
  const slot = fakeUi().el('div'), calls = [];
  const handlers = new Proxy({}, { get: (_, k) => (...a) => calls.push([k, ...a]) });
  Card.renderChoices(slot, fakeUi(), Object.assign({ project: { printer: null, part: null, filament: null }, printers, reachable: { 'Ma K1C': true }, handlers }, extra));
  return { slot, calls };
}

test('lot 3 · liste : les cartes d’abord (nom, état), « Ajouter mon imprimante » dessous ; liste vide sans renvoi « au-dessus »', () => {
  const { slot, calls } = renderMachine([K1, K2, USB(1)]);
  const cards = buttons(slot).filter((b) => b.className === 'machine-card');
  assert.deepEqual(cards.map(textOf), ['K1C● connectée', 'K2reliée', 'Ender 1clé USB']);
  assert.equal(labels(slot).at(-1), 'Ajouter mon imprimante');
  cards[1].on.click();
  assert.deepEqual(calls.pop(), ['pickPrinter', 'Ma K2', 'K2']);
  const empty = renderMachine([]);
  assert.deepEqual(labels(empty.slot), [], 'le bouton plein est dans la ligne d’action');
  assert.match(textOf(empty.slot), /Ajoute la tienne : je la cherche sur ton Wi-Fi/);
  assert.doesNotMatch(textOf(empty.slot), /au-dessus/);
});

test('lot 3 · débutant : buse 0,4 mm et plateau du profil sans question, « changer » dans la fiche ; confirmé inchangé', () => {
  const M = require('../machines-logic.js');
  assert.equal(M.noviceNozzle(['0.2', '0.4', '0.6']), '0.4');
  assert.equal(M.noviceNozzle([0.4, 0.6]), '0.4');
  assert.equal(M.noviceNozzle(['0.6', '0.8']), '', 'sans 0,4 mm, la question reste');
  const page = read('index.html');
  assert.match(page, /var novice = fsState\.level !== 'expert' && !choice\.auto \? PlyoMachines\.noviceNozzle\(match\.nozzles\) : '';/);
  assert.match(page, /else if \(novice\) installModel\(novice\);\s*else setupPhase\('nozzle'\);/);
  assert.match(page, /if \(fsState\.level !== 'expert' && !bedUI\.editing\) return null;/);
  // La fiche garde le plateau avec « changer » (bedUI.editing rouvre la question) et « Changer de buse ».
  assert.match(page, /changeBed: function \(\) \{ bedUI\.editing = true;/);
  assert.match(read('project-card.js'), /ui\.button\('Changer de buse', h\.changeNozzle, 'link'\)/);
});
