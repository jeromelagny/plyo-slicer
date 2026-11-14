// Lot 20 : carte « Couleurs » à l'étape Filament (colours-logic.js, colours-view.js, journey-logic.js, index.html) : une ligne par
// pièce, sa bobine, « changer » qui part tout de suite sur un clic, « Annuler », la pièce sélectionnée mise en évidence, la ligne
// « Couleurs » de la fiche. Jamais un numéro de filament à l'écran ; colour_set n'est envoyé que par le clic de la carte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const C = require('../canvas-logic.js');
const P = require('../colours-logic.js');
const V = require('../colours-view.js');
const J = require('../journey-logic.js');

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// Emplacements saisis à la main (PlyoCanvas.trays d'un état « manual ») : bleu, blanc, noir en PLA, et du PETG.
const STATE = { ok: true, system: 'manual', source: 'manual', canvases: [{ canvas_id: 0, connected: true, trays: [
  { tray_id: 0, label: '1', type: 'PLA', color: '#2060D0', status: 2 }, { tray_id: 1, label: '2', type: 'PLA', color: '#F5F5F5', status: 2 },
  { tray_id: 2, label: '3', type: 'PLA', color: '#1A1A1A', status: 2 }, { tray_id: 3, label: '4', type: 'PETG', color: '#D02020', status: 2 }] }] };
const TRAYS = C.trays(STATE);
const piece = (ref, name, t, extra) => Object.assign({ ref, name, selected: false, t, mixed: false, parts: [], painted: [], splittable: false }, extra || {});
const TWO = { ok: true, pieces: [piece('7', 'Coque', 0), piece('9', 'Couvercle', 0, { selected: true })], colours: [{ t: 0, color: '#2060D0', type: 'PLA' }], count: 1 };
const CANVAS = [{ t: 0, canvas_id: 0, tray_id: 0 }];

test('wanted : une pièce d’une couleur → la carte d’aujourd’hui ; deux pièces → la carte Couleurs ; une seule bobine → rien', () => {
  const one = { ok: true, pieces: [piece('7', 'Coque', 0)], colours: [{ t: 0 }] };
  assert.equal(P.wanted(one, TRAYS), false);
  assert.equal(P.wanted(TWO, TRAYS), true);
  assert.equal(P.wanted(TWO, TRAYS.slice(0, 1)), false, 'une seule bobine : pas de carte');
  assert.equal(P.wanted({ ok: true, pieces: [piece('7', 'Coque', 0, { parts: [{ ref: '1', name: 'A', t: 0 }, { ref: '2', name: 'B', t: 0 }] })], colours: [{ t: 0 }] }, TRAYS), true, 'une pièce en parties');
  assert.equal(P.wanted({ ok: true, pieces: [piece('7', 'Coque', 0), piece('9', 'Couvercle', 1)], colours: [{ t: 0 }, { t: 1 }] }, TRAYS), true, 'plusieurs couleurs');
  // Une couleur portée seulement par des zones peintes : la carte d'une bobine par couleur reste (elle seule la règle, lot 2 ensuite).
  assert.equal(P.wanted({ ok: true, pieces: [piece('7', 'Coque', 0, { painted: [1] })], colours: [{ t: 0 }, { t: 1 }] }, TRAYS), false, 'peinte seulement');
  assert.equal(P.wanted({ ok: true, pieces: [piece('7', 'Coque', 0, { painted: [1] }), piece('9', 'Couvercle', 0)], colours: [{ t: 0 }, { t: 1 }] }, TRAYS), false);
  assert.equal(P.wanted({ ok: true, pieces: [piece('7', 'Coque', 0, { painted: [0] }), piece('9', 'Couvercle', 0)], colours: [{ t: 0 }] }, TRAYS), true, 'peinte de sa propre couleur');
  assert.equal(P.wanted(null, TRAYS), false);
  assert.equal(P.wanted({ ok: false }, TRAYS), false);
});

test('pieceRows : la bobine de chaque pièce en toutes lettres, la pièce sélectionnée, une pièce mélangée sans « changer », les zones peintes', () => {
  const state = { ok: true, colours: [{ t: 0 }, { t: 1 }], pieces: [
    piece('7', 'Coque', 0, { painted: [1] }),
    piece('9', 'Couvercle', 1, { selected: true }),
    piece('11', 'Boîte', -1, { mixed: true, parts: [{ ref: '21', name: 'Haut', t: 0 }, { ref: '22', name: 'Bas', t: 1 }] }),
    piece('13', 'Socle', 2)] };
  const rows = P.pieceRows(state, TRAYS, [{ t: 0, canvas_id: 0, tray_id: 0 }, { t: 1, canvas_id: 0, tray_id: 1 }]);
  assert.equal(rows[0].text, 'PLA bleu · 1');
  assert.equal(rows[0].painted, true);
  assert.equal(rows[0].paintedText, 'Elle a des zones peintes : changer sa couleur garde sa peinture.');
  assert.equal(rows[1].selected, true);
  assert.equal(rows[1].text, 'PLA blanc · 2');
  assert.ok(rows[1].canChange);
  assert.equal(rows[2].mixed, true);
  assert.equal(rows[2].canChange, false, 'pièce mélangée : on change chaque partie');
  assert.equal(rows[2].text, 'plusieurs couleurs');
  assert.deepEqual(rows[2].parts.map((q) => [q.name, q.text, q.canChange]), [['Haut', 'PLA bleu · 1', true], ['Bas', 'PLA blanc · 2', true]]);
  assert.equal(rows[3].text, 'pas encore de bobine', 'couleur sans bobine associée');
  assert.equal(rows[3].tray, null);
  // Une seule bobine : rien à changer.
  assert.ok(P.pieceRows(state, TRAYS.slice(0, 1), CANVAS).every((r) => !r.canChange));
});

test('textes exacts de la carte', () => {
  assert.equal(P.changedText('Couvercle', 'PLA blanc · 1A'), 'Couvercle : maintenant en PLA blanc · 1A');
  assert.equal(P.otherMaterialNote(TRAYS[0], TRAYS[3]), 'Cette bobine est en PETG, et l’autre en PLA : deux matières différentes collent mal entre elles. Choisis-la seulement si c’est voulu.');
  assert.equal(P.otherMaterialNote(TRAYS[0], TRAYS[1]), '', 'même matière : rien');
  assert.equal(P.otherMaterialNote(null, TRAYS[1]), '');
  assert.equal(P.missingText('bleu'), 'Aucune bobine bleue : charge-la dans un emplacement libre, règle-la sur l’écran de l’imprimante, puis touche « Vérifier à nouveau ».');
  assert.equal(P.missingText('noir'), 'Aucune bobine noire : charge-la dans un emplacement libre, règle-la sur l’écran de l’imprimante, puis touche « Vérifier à nouveau ».');
  assert.equal(P.missingText('rouge'), 'Aucune bobine rouge : charge-la dans un emplacement libre, règle-la sur l’écran de l’imprimante, puis touche « Vérifier à nouveau ».');
  assert.equal(P.missingText(''), 'Ta couleur n’est pas là ? Charge-la dans un emplacement libre, règle-la sur l’écran de l’imprimante, puis touche « Vérifier à nouveau ».');
  assert.equal(P.INTRO, 'Touche une pièce pour la voir dans la vue 3D, puis « changer » pour choisir la bobine qui l’imprime.');
  assert.equal(J.prompt('filament', { canvas: { mode: 'colours' } }), 'Couleurs de ta plaque');
});

test('ligne d’action : « Utiliser ces bobines » quand chaque couleur a sa bobine ; « C’est bon » pour la carte rouverte ; rien pendant un changement', () => {
  assert.deepEqual(J.primaryAction('filament', { canvas: { mode: 'colours', complete: true } }), { label: 'Utiliser ces bobines', kind: 'confirmCanvas', enabled: true });
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'colours', complete: false } }).enabled, false);
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'colours', complete: true, busy: true } }).enabled, false);
  assert.deepEqual(J.primaryAction('filament', { canvas: { mode: 'colours', reopened: true } }), { label: 'C’est bon', kind: 'closeColours', enabled: true });
  assert.equal(P.complete([{ t: 0 }, { t: 1 }], [{ t: 0, canvas_id: 0, tray_id: 0 }], TRAYS), false);
  assert.equal(P.complete([{ t: 0 }, { t: 1 }], [{ t: 0, canvas_id: 0, tray_id: 0 }, { t: 1, canvas_id: 0, tray_id: 2 }], TRAYS), true);
  assert.equal(P.complete([], CANVAS, TRAYS), false);
});

test('association rendue par le slicer, fiche du projet', () => {
  assert.deepEqual(P.mappingFrom([{ t: 0, canvas_id: 0, tray_id: 0 }, { t: 1, canvas_id: 0, tray_id: 1 }, 'x'], TRAYS),
    [{ t: 0, color: '#2060D0', canvas_id: 0, tray_id: 0 }, { t: 1, color: '#F5F5F5', canvas_id: 0, tray_id: 1 }]);
  const canvas = [{ t: 0, canvas_id: 0, tray_id: 0, type: 'PLA', color: '#2060D0', label: '1' }, { t: 1, canvas_id: 0, tray_id: 1, type: 'PLA', color: '#F5F5F5', label: '2' }];
  const state = { ok: true, colours: [{ t: 0 }, { t: 1 }], pieces: [piece('7', 'Coque', 0), piece('9', 'Couvercle', 1)] };
  assert.equal(P.ficheText(state, P.traysFromCanvas(canvas), canvas), 'Couleurs : Coque en PLA bleu · 1, Couvercle en PLA blanc · 2');
  assert.equal(P.ficheText(state, TRAYS, []), '', 'bobines pas encore choisies');
  assert.equal(P.ficheText({ ok: true, colours: [{ t: 0 }], pieces: [piece('7', 'Coque', 0)] }, TRAYS, canvas), '', 'une pièce d’une couleur : pas de ligne');
  const many = { ok: true, colours: [{ t: 0 }], pieces: ['1', '2', '3', '4'].map((r) => piece(r, 'P' + r, 0)) };
  assert.equal(P.ficheText(many, TRAYS, canvas), 'Couleurs : 4 pièces');
});

// Faux DOM minimal pour la vue.
function fakeUi() {
  const node = (tag, cls, text) => ({ tag, cls: cls || '', text: text || '', children: [], style: {}, attrs: {}, disabled: false,
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.unshift(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; },
    set textContent(v) { this.children = []; this.text = v; }, get textContent() { return this.text; } });
  return { el: node, button: (label, fn, cls) => Object.assign(node('button', cls, label), { onClick: fn }) };
}
function all(n, out = []) { out.push(n); (n.children || []).forEach((c) => all(c, out)); return out; }
const texts = (slot) => all(slot).map((n) => n.text).filter(Boolean);
const buttons = (slot) => all(slot).filter((n) => n.tag === 'button');

test('vue : une ligne par pièce, « changer », la sélection, la peinture, les refus qui proposent « Vérifier à nouveau »', () => {
  const ui = fakeUi(), slot = ui.el('div');
  const calls = [];
  const h = { select: (r) => calls.push(['select', r]), open: (r, p, n) => calls.push(['open', r, p, n]), pick: () => {}, confirm: () => {}, cancel: () => {}, missing: () => {}, recheck: () => calls.push(['recheck']), useList: () => {}, openManual: () => {} };
  const state = { ok: true, colours: [{ t: 0 }], pieces: [piece('7', 'Coque', 0, { painted: [0] }), piece('9', 'Couvercle', 0, { selected: true })] };
  V.render(slot, ui, { rows: P.pieceRows(state, TRAYS, CANVAS), trays: TRAYS, system: 'manual', handlers: h });
  const t = texts(slot);
  assert.ok(t.includes(P.INTRO));
  assert.ok(t.includes('Coque') && t.includes('Couvercle') && t.filter((x) => x === 'PLA bleu · 1').length === 2);
  assert.ok(t.includes('sélectionnée'), 'la pièce sélectionnée dans la vue 3D est dite');
  assert.ok(all(slot).some((n) => /colour-row/.test(n.cls) && / on/.test(n.cls)), 'et mise en évidence');
  assert.ok(t.includes(P.PAINTED));
  assert.ok(t.some((x) => /^Tes bobines : PLA bleu · 1, PLA blanc · 2, PLA noir · 3, PETG rouge · 4$/.test(x)), t.join(' | '));
  buttons(slot).filter((b) => b.text === 'Coque')[0].onClick();
  buttons(slot).filter((b) => b.text === 'changer')[1].onClick();
  assert.deepEqual(calls, [['select', '7'], ['open', '9', '', 'Couvercle']]);
  for (const s of t) {
    assert.ok(!/orca/i.test(s), 'parle d’Orca : ' + s);
    assert.ok(!/\bvous\b|\bvotre\b/i.test(s), 'vouvoiement : ' + s);
    assert.ok(!/filament (n°|numéro|\d)|couleur \d/i.test(s), 'numéro de filament à l’écran : ' + s);
  }
  // Refus du slicer (bobine changée sur l'imprimante) : le texte, et « Vérifier à nouveau ».
  V.render(slot, ui, { rows: P.pieceRows(state, TRAYS, CANVAS), trays: TRAYS, system: 'cfs', error: 'La bobine 1A a changé de couleur sur l’imprimante', recheck: true, handlers: h });
  assert.ok(texts(slot).includes('La bobine 1A a changé de couleur sur l’imprimante'));
  buttons(slot).filter((b) => b.text === 'Vérifier à nouveau')[0].onClick();
  assert.deepEqual(calls.slice(-1), [['recheck']]);
  // Pendant un changement : plus de « changer ».
  V.render(slot, ui, { rows: P.pieceRows(state, TRAYS, CANVAS), trays: TRAYS, pending: true, handlers: h });
  assert.ok(!buttons(slot).some((b) => b.text === 'changer'));
  assert.ok(texts(slot).includes('Je change la couleur…'));
});

test('vue : le choix parmi les bobines, l’autre matière demande confirmation, « Ma couleur n’est pas là »', () => {
  const ui = fakeUi(), slot = ui.el('div');
  const picked = [];
  const h = { select() {}, open() {}, pick: (t) => picked.push(['pick', t.slot]), confirm: (t) => picked.push(['confirm', t.slot]), cancel() {}, missing() {}, recheck() {}, useList() {}, openManual() {} };
  const state = { ok: true, colours: [{ t: 0 }], pieces: [piece('7', 'Coque', 0), piece('9', 'Couvercle', 0)] };
  const rows = P.pieceRows(state, TRAYS, CANVAS);
  V.render(slot, ui, { rows, trays: TRAYS, system: 'manual', picker: { ref: '9', part: '', name: 'Couvercle', current: TRAYS[0], confirm: null, missing: false }, handlers: h });
  assert.ok(texts(slot).includes('Quelle bobine pour « Couvercle » ?'));
  const choices = buttons(slot).filter((b) => /^P(LA|ETG) /.test(b.text));
  assert.deepEqual(choices.map((b) => b.text), ['PLA bleu · 1', 'PLA blanc · 2', 'PLA noir · 3', 'PETG rouge · 4']);
  assert.ok(/ on/.test(choices[0].cls), 'la bobine d’aujourd’hui est marquée');
  choices[1].onClick();
  assert.deepEqual(picked, [['pick', '2']]);
  V.render(slot, ui, { rows, trays: TRAYS, system: 'manual', picker: { ref: '9', part: '', name: 'Couvercle', current: TRAYS[0], confirm: TRAYS[3], missing: false }, handlers: h });
  assert.ok(texts(slot).includes(P.otherMaterialNote(TRAYS[0], TRAYS[3])));
  buttons(slot).filter((b) => b.text === 'Oui, cette bobine')[0].onClick();
  assert.deepEqual(picked.slice(-1), [['confirm', '4']]);
  V.render(slot, ui, { rows, trays: TRAYS, system: 'manual', picker: { ref: '9', part: '', name: 'Couvercle', current: TRAYS[0], confirm: null, missing: true }, handlers: h });
  assert.ok(texts(slot).includes(P.missingText('')));
  assert.ok(buttons(slot).some((b) => b.text === 'Vérifier à nouveau'));
});

test('garde de source : colour_set n’est envoyé que par le clic de la carte, jamais par l’IA', () => {
  const html = read('index.html');
  assert.equal((html.match(/type: 'colour_set'/g) || []).length, 1, 'un seul endroit envoie le message');
  const fn = html.slice(html.indexOf('function setPieceColour('), html.indexOf('function onColourSet('));
  assert.match(fn, /window\.orca\.postMessage\(\{ type: 'colour_set'/);
  // setPieceColour : définie, puis appelée par « pick » et « confirm » de la carte, et rien d'autre.
  assert.equal((html.match(/setPieceColour\(/g) || []).length, 3, 'définition, pick, confirm');
  const handlers = html.slice(html.indexOf('var coloursHandlers = {'), html.indexOf('function setPieceColour('));
  assert.equal((handlers.match(/setPieceColour\(/g) || []).length, 2);
  for (const f of ['assistant-logic.js', 'intent-logic.js', 'journey-logic.js', 'preflight.js']) assert.ok(!/colour_set/.test(read(f)), f + ' n’y mène pas');
  const cmds = fs.readFileSync(new URL('../../../../src/plyo/PlyoCommands.cpp', import.meta.url), 'utf8');
  assert.ok(!/Colours::|colour_set|set_extruder/.test(cmds), 'les ordres de l’IA n’y mènent pas (lot 4 seulement)');
  // « Annuler » passe par l'annulation des ordres du plateau, et son refus est montré tel quel (le plateau a changé depuis).
  const undo = html.slice(html.indexOf('function undoPieceColour('), html.indexOf('function coloursFiche('));
  assert.match(undo, /plateAction\('undo'/);
  assert.match(undo, /noteLine\(msg && msg\.text/);
  // Les scripts : la logique avant la vue, après celle des emplacements dont elle se sert.
  assert.ok(html.indexOf('<!--plyo-include:canvas-logic.js-->') < html.indexOf('<!--plyo-include:colours-logic.js-->'));
  assert.ok(html.indexOf('<!--plyo-include:colours-logic.js-->') < html.indexOf('<!--plyo-include:colours-view.js-->'));
});

test('côté slicer : un seul gestionnaire de colour_set, qui ne part pas au service', () => {
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoAssistant.cpp', import.meta.url), 'utf8');
  assert.equal((cpp.match(/type == "colour_set"/g) || []).length, 1);
  assert.match(cpp, /Colours::set_colour\(data/);
  const colours = fs.readFileSync(new URL('../../../../src/plyo/PlyoColours.cpp', import.meta.url), 'utf8');
  assert.ok(!/http|Http|curl|PLYO_API/.test(colours), 'aucun appel réseau ajouté (la bobine est relue par Canvas::read)');
  assert.match(colours, /TakeSnapshot snapshot\(plater, "Plyo assistant"\)/, 'un seul point d’annulation, comme les ordres du plateau');
});
