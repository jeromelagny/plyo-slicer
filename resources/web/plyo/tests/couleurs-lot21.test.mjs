import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const C = require('../canvas-logic.js');
const P = require('../colours-logic.js');
const V = require('../colours-view.js');

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const STATE = { ok: true, system: 'manual', source: 'manual', canvases: [{ canvas_id: 0, connected: true, trays: [
  { tray_id: 0, label: '1', type: 'PLA', color: '#C01818', status: 2 }, { tray_id: 1, label: '2', type: 'PLA', color: '#F5F5F5', status: 2 },
  { tray_id: 2, label: '3', type: 'PLA', color: '#E0B030', status: 2 }, { tray_id: 3, label: '4', type: 'PETG', color: '#1A1A1A', status: 2 }] }] };
const TRAYS = C.trays(STATE);
const piece = (ref, name, t, extra) => Object.assign({ ref, name, selected: false, t, mixed: false, parts: [], painted: [], splittable: false }, extra || {});
// Le fichier de Jérôme : une pièce en trois parties, trois couleurs du fichier (bordeaux, or, blanc).
const FILE = ['#74140C', '#B7953E', '#FFFFFF'];
const CANETTE = { ok: true, colours: [{ t: 0, color: '#74140C', type: 'PLA' }, { t: 1, color: '#B7953E', type: 'PLA' }, { t: 2, color: '#FFFFFF', type: 'PLA' }],
  pieces: [piece('50', 'Ouvre-canette Nuances de Paillettes', -1, { mixed: true, parts: [
    { ref: '51', name: 'Corps bordeaux', t: 0 }, { ref: '52', name: 'Filets et main or', t: 1 }, { ref: '53', name: 'Etoiles et ongle blanc', t: 2 }] })] };
const MAP3 = [{ t: 0, canvas_id: 0, tray_id: 0 }, { t: 1, canvas_id: 0, tray_id: 2 }, { t: 2, canvas_id: 0, tray_id: 1 }];

test('fileRows : une ligne par couleur du fichier, sa teinte prévue, les parties qui la portent, la bobine associée', () => {
  const rows = P.fileRows(CANETTE, FILE, TRAYS, MAP3);
  assert.deepEqual(rows.map((r) => [r.t, r.fileColour, r.fileName, r.pieces.join('/'), r.text]), [
    [0, '#74140C', 'rouge', 'Corps bordeaux', 'PLA rouge · 1'],
    [1, '#B7953E', 'orange', 'Filets et main or', 'PLA orange · 3'],
    [2, '#FFFFFF', 'blanc', 'Etoiles et ongle blanc', 'PLA blanc · 2']]);
  assert.equal(P.fileWhere(rows[0]), 'sur Corps bordeaux');
  assert.equal(P.fileIntro(rows), 'Ce fichier prévoit 3 couleurs. Pour chacune, choisis la bobine qui l’imprime.');
  // Parties nommées par le slicer d'après la pièce : « pièce, partie N ».
  const plain = JSON.parse(JSON.stringify(CANETTE));
  plain.pieces[0].parts.forEach((q, i) => { q.name = i ? 'Ouvre-canette Nuances de Paillettes_' + (i + 1) : 'Ouvre-canette Nuances de Paillettes'; });
  assert.deepEqual(P.fileRows(plain, FILE, TRAYS, MAP3).map((r) => r.pieces[0]), ['Ouvre-canette Nuances de Paillettes, partie 1', 'Ouvre-canette Nuances de Paillettes, partie 2', 'Ouvre-canette Nuances de Paillettes, partie 3']);
});

test('fileRows : pièces entières, zones peintes, couleur sans bobine, fichier d’une couleur ou sans couleurs', () => {
  const state = { ok: true, colours: [{ t: 0 }, { t: 1 }, { t: 2 }], pieces: [piece('7', 'Coque', 0, { painted: [2] }), piece('8', 'Bouton', 0), piece('9', 'Couvercle', 1)] };
  const rows = P.fileRows(state, ['#D02020', '#FFFFFF', '#101010'], TRAYS, [{ t: 0, canvas_id: 0, tray_id: 0 }]);
  assert.deepEqual(rows.map((r) => [r.pieces.join(', '), r.painted.join(', ')]), [['Coque, Bouton', ''], ['Couvercle', ''], ['', 'Coque']]);
  assert.equal(P.fileWhere(rows[2]), 'zones peintes sur Coque');
  assert.equal(rows[1].tray, null);
  assert.equal(rows[1].text, 'pas encore de bobine');
  assert.deepEqual(P.fileRows(state, ['#D02020'], TRAYS, []), [], 'une seule couleur du fichier : la carte par pièce');
  assert.deepEqual(P.fileRows(state, undefined, TRAYS, []), []);
  assert.deepEqual(P.fileRows(state, ['rouge', '', 12], TRAYS, []), [], 'valeurs illisibles écartées');
  assert.deepEqual(P.fileRows({ ok: false }, FILE, TRAYS, []), []);
});

test('sameTrayNote : deux couleurs (ou plus) sur la même bobine sont dites ; sinon rien', () => {
  const rows = P.fileRows(CANETTE, FILE, TRAYS, MAP3);
  assert.equal(P.sameTrayNote(rows), '');
  const two = P.fileRows(CANETTE, FILE, TRAYS, [{ t: 0, canvas_id: 0, tray_id: 0 }, { t: 1, canvas_id: 0, tray_id: 0 }, { t: 2, canvas_id: 0, tray_id: 1 }]);
  assert.equal(P.sameTrayNote(two), 'Le rouge et l’orange sortiront tous les deux en PLA rouge · 1.');
  const three = P.fileRows(CANETTE, FILE, TRAYS, [{ t: 0, canvas_id: 0, tray_id: 1 }, { t: 1, canvas_id: 0, tray_id: 1 }, { t: 2, canvas_id: 0, tray_id: 1 }]);
  assert.equal(P.sameTrayNote(three), 'Le rouge, l’orange et le blanc sortiront tous en PLA blanc · 2.');
  const twins = P.fileRows({ ok: true, colours: [{ t: 0 }, { t: 1 }], pieces: [piece('7', 'A', 0), piece('8', 'B', 1)] }, ['#D02020', '#C01010'], TRAYS, [{ t: 0, canvas_id: 0, tray_id: 0 }, { t: 1, canvas_id: 0, tray_id: 0 }]);
  assert.equal(P.sameTrayNote(twins), 'Ces 2 couleurs du fichier sortiront toutes en PLA rouge · 1.');
  assert.equal(P.sameTrayNote([]), '');
});

test('noms : une pièce au nom de fichier porte un nom parlant ; les parties sont numérotées sous leur pièce', () => {
  assert.equal(P.pieceName('3DBenchy.drc', 'Petit bateau de test (3DBenchy)'), 'Petit bateau de test (3DBenchy)');
  assert.equal(P.pieceName('3DBenchy.drc', ''), '3DBenchy');
  assert.equal(P.pieceName('boite_ronde.stl', 'boite_ronde.stl'), 'Boite ronde');
  assert.equal(P.pieceName('boite.stl', 'Autre pièce'), 'Boite', 'le nom du projet ne désigne pas ce fichier');
  assert.equal(P.pieceName('Coque', 'x.stl'), 'Coque');
  assert.equal(P.pieceName('', ''), 'Pièce');
  const rows = P.pieceRows(CANETTE, TRAYS, MAP3);
  assert.deepEqual(rows[0].parts.map((q) => [q.label, q.detail, q.name, q.title]), [
    ['Partie 1', 'Corps bordeaux', 'Corps bordeaux', 'Corps bordeaux'], ['Partie 2', 'Filets et main or', 'Filets et main or', 'Filets et main or'], ['Partie 3', 'Etoiles et ongle blanc', 'Etoiles et ongle blanc', 'Etoiles et ongle blanc']]);
  const plain = { ok: true, colours: [{ t: 0 }], pieces: [piece('5', 'Ouvre', 0, { parts: [{ ref: '1', name: 'Ouvre', t: 0 }, { ref: '2', name: 'Ouvre_2', t: 0 }, { ref: '3', name: 'Ouvre_3', t: 0 }] })] };
  assert.deepEqual(P.pieceRows(plain, TRAYS, MAP3)[0].parts.map((q) => [q.label, q.detail, q.name, q.title]), [
    ['Partie 1', '', 'Ouvre, partie 1', 'Ouvre'], ['Partie 2', '', 'Ouvre, partie 2', 'Ouvre_2'], ['Partie 3', '', 'Ouvre, partie 3', 'Ouvre_3']]);
  const benchy = { ok: true, colours: [{ t: 0 }], pieces: [piece('5', '3DBenchy.drc', 0), piece('6', '3DBenchy.drc', 0)] };
  assert.deepEqual(P.pieceRows(benchy, TRAYS, MAP3, { partName: 'Petit bateau de test (3DBenchy)' }).map((r) => [r.name, r.title]), [
    ['Petit bateau de test (3DBenchy)', '3DBenchy.drc'], ['Petit bateau de test (3DBenchy)', '3DBenchy.drc']]);
  assert.equal(P.ficheText(benchy, TRAYS, MAP3, { partName: 'Petit bateau de test (3DBenchy)' }), 'Couleurs : Petit bateau de test (3DBenchy) en PLA rouge · 1, Petit bateau de test (3DBenchy) en PLA rouge · 1');
});

test('invitation : seulement pour une pièce nouvelle, des textes simples, une ligne discrète en « Je connais déjà »', () => {
  assert.deepEqual(P.newPieces(CANETTE, {}), ['50']);
  assert.deepEqual(P.newPieces(CANETTE, { 50: true }), []);
  assert.equal(P.worth(CANETTE), true);
  assert.equal(P.worth({ ok: true, colours: [{ t: 0 }], pieces: [piece('7', 'Coque', 0)] }), false, 'une pièce d’une couleur : rien à proposer');
  assert.equal(P.inviteText(CANETTE, FILE, TRAYS, {}, false), 'Ce fichier prévoit 3 couleurs, et ta machine a plusieurs bobines : choisis la bobine qui imprime chacune.');
  assert.equal(P.inviteText({ ok: true, colours: [{ t: 0 }], pieces: [piece('7', 'Coque', 0), piece('8', 'Bouton', 0)] }, null, TRAYS, {}, false),
    'Ta plaque a maintenant 2 pièces, et ta machine a plusieurs bobines : tu peux choisir la bobine qui imprime chacune.');
  assert.equal(P.inviteText({ ok: true, colours: [{ t: 0 }], pieces: [piece('7', 'boite.stl', 0, { parts: [{ ref: '1', name: 'a', t: 0 }, { ref: '2', name: 'b', t: 0 }] })] }, null, TRAYS, {}, false),
    '« Boite » est faite de 2 parties, et ta machine a plusieurs bobines : tu peux choisir la bobine de chacune.');
  assert.equal(P.inviteText({ ok: true, colours: [{ t: 0 }, { t: 1 }], pieces: [piece('7', 'Coque', 0, { painted: [1] })] }, null, TRAYS, {}, false),
    'Ta plaque a plusieurs couleurs, et ta machine a plusieurs bobines : choisis la bobine qui imprime chacune.');
  assert.equal(P.inviteText(CANETTE, FILE, TRAYS, {}, true), 'Ta plaque peut s’imprimer en plusieurs couleurs.');
  assert.equal(P.INVITE_BUTTON, 'Choisir les couleurs');
});

test('association : recalculée quand une pièce posée apporte des couleurs ; « C’est bon » seulement si rien n’a changé', () => {
  const cols = CANETTE.colours;
  assert.equal(P.covers([{ t: 0, canvas_id: 0, tray_id: 0 }], cols), false);
  assert.equal(P.covers(MAP3, cols), true);
  assert.equal(P.covers(MAP3, cols.slice(0, 2)), false, 'une couleur en trop dans l’association');
  assert.equal(P.sameAsChosen(MAP3, MAP3, cols), true);
  assert.equal(P.sameAsChosen(MAP3, [{ t: 0, canvas_id: 0, tray_id: 0 }], cols), false, 'nouvelle couleur pas encore choisie');
  assert.equal(P.sameAsChosen([{ t: 0, canvas_id: 0, tray_id: 1 }, MAP3[1], MAP3[2]], MAP3, cols), false, 'couleur du fichier réaffectée');
});

function fakeUi() {
  const node = (tag, cls, text) => ({ tag, cls: cls || '', text: text || '', children: [], style: {}, attrs: {}, disabled: false, title: '',
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.unshift(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; },
    set textContent(v) { this.children = []; this.text = v; }, get textContent() { return this.text; } });
  return { el: node, button: (label, fn, cls) => Object.assign(node('button', cls, label), { onClick: fn }) };
}
function all(n, out = []) { out.push(n); (n.children || []).forEach((c) => all(c, out)); return out; }
const texts = (slot) => all(slot).map((n) => n.text).filter(Boolean);
const buttons = (slot) => all(slot).filter((n) => n.tag === 'button');

test('vue : un 3MF en couleurs, une ligne par couleur, « changer » par couleur, les pièces dépliées sur demande, le pinceau', () => {
  const ui = fakeUi(), slot = ui.el('div'), calls = [];
  const h = { select() {}, open: (r, p, n) => calls.push(['open', r, p, n]), openFile: (t, n) => calls.push(['file', t, n]), pick() {}, confirm() {}, cancel() {}, missing() {}, recheck() {},
    useList() {}, openManual() {}, toggleOne: () => calls.push(['toggle']), paint: () => calls.push(['paint']) };
  const state = JSON.parse(JSON.stringify(CANETTE));
  state.pieces[0].painted = [2];
  const files = P.fileRows(state, FILE, TRAYS, MAP3);
  V.render(slot, ui, { rows: P.pieceRows(state, TRAYS, MAP3), fileRows: files, unfolded: false, sameTray: '', trays: TRAYS, system: 'manual', handlers: h });
  let t = texts(slot);
  assert.ok(t.includes('Ce fichier prévoit 3 couleurs. Pour chacune, choisis la bobine qui l’imprime.'));
  assert.ok(t.includes('rouge du fichier') && t.includes('orange du fichier') && t.includes('blanc du fichier'), t.join(' | '));
  assert.ok(t.includes('sur Corps bordeaux') && t.includes('sur Etoiles et ongle blanc · zones peintes sur Ouvre-canette Nuances de Paillettes'), t.join(' | '));
  assert.ok(t.includes(P.PAINTED_FILE));
  assert.ok(!t.includes('Partie 1'), 'les pièces restent pliées');
  buttons(slot).filter((b) => b.text === 'changer')[1].onClick();
  buttons(slot).filter((b) => b.text === P.ONE_PIECE)[0].onClick();
  buttons(slot).filter((b) => b.text === 'Retoucher au pinceau')[0].onClick();
  assert.deepEqual(calls, [['file', 1, 'orange du fichier'], ['toggle'], ['paint']]);
  // Deux couleurs sur la même bobine : la note ; les pièces dépliées, chaque partie numérotée avec son nom en petit.
  V.render(slot, ui, { rows: P.pieceRows(state, TRAYS, MAP3), fileRows: files, unfolded: true, sameTray: 'Le rouge et l’orange sortiront tous les deux en PLA rouge · 1.', trays: TRAYS, system: 'manual', handlers: h });
  t = texts(slot);
  assert.ok(t.includes('Le rouge et l’orange sortiront tous les deux en PLA rouge · 1.'));
  assert.ok(t.includes('Partie 1') && t.includes('Partie 3') && t.includes('Corps bordeaux'));
  assert.ok(all(slot).some((n) => /colour-part/.test(n.cls)), 'parties décalées sous leur pièce');
  assert.ok(all(slot).filter((n) => /colour-spool/.test(n.cls)).length >= 6, 'la bobine dans son propre bloc, sur une ligne');
  // Le choix d'une couleur du fichier s'ouvre sous sa ligne.
  V.render(slot, ui, { rows: P.pieceRows(state, TRAYS, MAP3), fileRows: files, trays: TRAYS, system: 'manual', picker: { fileT: 1, name: 'orange du fichier', current: TRAYS[2], confirm: null, missing: false }, handlers: h });
  assert.ok(texts(slot).includes('Quelle bobine pour « orange du fichier » ?'));
  for (const s of texts(slot)) {
    assert.ok(!/orca/i.test(s), 'parle d’Orca : ' + s);
    assert.ok(!/\bvous\b|\bvotre\b/i.test(s), 'vouvoiement : ' + s);
    assert.ok(!/filament (n°|numéro|\d)|couleur \d/i.test(s), 'numéro de filament à l’écran : ' + s);
  }
});

test('garde de source : réaffecter une couleur du fichier n’écrit rien ; seuls les clics de la carte agissent ; les couleurs du fichier sont gardées', () => {
  const html = read('index.html');
  const fn = html.slice(html.indexOf('function setFileColour('), html.indexOf('// Le seul envoi de colour_set'));
  assert.ok(fn.length > 0 && !/postMessage/.test(fn), 'aucun message au slicer : seulement l’association proposée');
  assert.match(fn, /canvasHandlers\.setTray\(t, PlyoColours\.trayKey\(tray\)\)/);
  assert.equal((html.match(/setFileColour\(/g) || []).length, 3, 'définition, pick, confirm');
  assert.equal((html.match(/type: 'colour_set'/g) || []).length, 1, 'toujours un seul envoi de colour_set');
  assert.match(html, /conv\.project\.file_colours = msg\.file_colours\.slice\(0, 16\)/, 'gardées dans la fiche du projet de la conversation');
  assert.match(html, /tool: 'paint_color'/, '« Retoucher au pinceau » ouvre l’outil du slicer');
  for (const f of ['assistant-logic.js', 'intent-logic.js', 'journey-logic.js', 'preflight.js']) assert.ok(!/file_colours|colour_set/.test(read(f)), f + ' n’y touche pas');
  // L'invitation ne déclenche rien d'elle-même : son bouton rouvre la carte.
  const inv = html.slice(html.indexOf('function maybeInviteColours('), html.indexOf('function coloursPicker('));
  assert.ok(!/colour_set|canvas_apply/.test(inv), 'l’invitation n’écrit rien');
  assert.match(inv, /projectHandlers\.changeColours\(\)/);
  assert.match(inv, /fsState\.level === 'expert'/);
});
