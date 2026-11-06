// Tests de la logique pure des emplacements du Canvas (canvas-logic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../canvas-logic.js');

// État renvoyé par canvas_read pour la CC2 de Jérôme (2026-11-03).
const STATE = { ok: true, canvases: [{ canvas_id: 0, connected: true, trays: [
  { tray_id: 0, type: 'PLA', color: '#FCEBD7', status: 0 },
  { tray_id: 1, type: 'PLA', color: '#F95D77', status: 1 },
  { tray_id: 2, type: 'ASA', color: '#898989', status: 1 },
  { tray_id: 3, type: 'PLA', color: '#7C4C00', status: 1 }] }] };

test('colourName : un nom français simple pour la couleur d’un emplacement', () => {
  assert.equal(C.colourName('#7C4C00'), 'brun');
  assert.equal(C.colourName('#F95D77'), 'rose');
  assert.equal(C.colourName('#898989'), 'gris');
  assert.equal(C.colourName('#FCEBD7'), 'crème');
  assert.equal(C.colourName('#000000'), 'noir');
  assert.equal(C.colourName('#FFFFFF'), 'blanc');
  assert.equal(C.colourName('#1E50D2'), 'bleu');
  assert.equal(C.colourName(''), '');
  assert.equal(C.colourName('rouge'), '');
});

test('trays : les emplacements des unités connectées, numérotés comme sur l’écran', () => {
  const list = C.trays(STATE);
  assert.equal(list.length, 4);
  assert.equal(list[3].label, '4 · PLA brun');
  assert.equal(list[3].tray_id, 3);
  assert.equal(list[0].empty, true);
  assert.equal(list[1].empty, false);
  const off = { ok: true, canvases: [{ canvas_id: 0, connected: false, trays: STATE.canvases[0].trays }] };
  assert.deepEqual(C.trays(off), []);
  assert.deepEqual(C.trays(null), []);
  assert.deepEqual(C.trays({ ok: false }), []);
});

test('propose : une couleur va sur un emplacement du même type, puis de la couleur la plus proche', () => {
  const trays = C.trays(STATE);
  // Pièce d'une couleur, filament du projet PLA, couleur du fichier brun foncé : emplacement 4.
  const one = C.propose([{ t: 0, color: '#6B4000', type: 'PLA' }], trays);
  assert.deepEqual(one.map(m => m.tray_id), [3]);
  // Type sans emplacement : pas d'association proposée.
  assert.equal(C.propose([{ t: 0, color: '#000000', type: 'PETG' }], trays)[0].tray_id, null);
  // Type inconnu : la couleur décide.
  assert.equal(C.propose([{ t: 0, color: '#8A8A8A' }], trays)[0].tray_id, 2);
  // Deux couleurs : jamais le même emplacement dans la proposition.
  const two = C.propose([{ t: 0, color: '#F95D77', type: 'PLA' }, { t: 1, color: '#FF6080', type: 'PLA' }], trays);
  assert.equal(two[0].tray_id, 1);
  assert.notEqual(two[1].tray_id, 1);
  assert.notEqual(two[1].tray_id, null);
  // Un emplacement vu vide reste proposé (status non fiable, voir le design du 03/11 : « ne pas en déduire qu'il est inutilisable »).
  assert.equal(C.propose([{ t: 0, color: '#FCEBD7', type: 'PLA' }], trays)[0].tray_id, 0);
  // Plus de couleurs que d'emplacements : les dernières restent sans emplacement.
  const five = C.propose([0, 1, 2, 3, 4].map(t => ({ t, color: '#808080' })), trays);
  assert.equal(five.filter(m => m.tray_id === null).length, 1);
});

test('complete et tooMany', () => {
  assert.equal(C.complete([{ t: 0, canvas_id: 0, tray_id: 3 }]), true);
  assert.equal(C.complete([{ t: 0, canvas_id: 0, tray_id: 3 }, { t: 1, canvas_id: 0, tray_id: null }]), false);
  assert.equal(C.complete([]), false);
  assert.equal(C.tooMany([0, 1, 2, 3, 4].map(t => ({ t })), C.trays(STATE)), true);
  assert.equal(C.tooMany([{ t: 0 }], C.trays(STATE)), false);
});

test('checkBeforeSend : bloque si un emplacement choisi a changé de type ou a disparu, prévient s’il semble vide', () => {
  const chosen = [{ t: 0, canvas_id: 0, tray_id: 3, type: 'PLA', color: '#7C4C00' }];
  assert.deepEqual(C.checkBeforeSend(chosen, C.trays(STATE)), { block: [], notes: [] });
  const asa = JSON.parse(JSON.stringify(STATE)); asa.canvases[0].trays[3].type = 'ASA';
  assert.equal(C.checkBeforeSend(chosen, C.trays(asa)).block.length, 1);
  assert.match(C.checkBeforeSend(chosen, C.trays(asa)).block[0], /emplacement 4/i);
  // « Vide » selon l'imprimante : seulement une remarque (la CC2 de Jérôme dit vide un emplacement chargé).
  const empty = JSON.parse(JSON.stringify(STATE)); empty.canvases[0].trays[3].status = 0;
  assert.equal(C.checkBeforeSend(chosen, C.trays(empty)).block.length, 0);
  assert.match(C.checkBeforeSend(chosen, C.trays(empty)).notes[0], /vide/);
  const gone = JSON.parse(JSON.stringify(STATE)); gone.canvases[0].trays.pop();
  assert.equal(C.checkBeforeSend(chosen, C.trays(gone)).block.length, 1);
  const recoloured = JSON.parse(JSON.stringify(STATE)); recoloured.canvases[0].trays[3].color = '#000000';
  const r = C.checkBeforeSend(chosen, C.trays(recoloured));
  assert.equal(r.block.length, 0);
  assert.equal(r.notes.length, 1);
});

test('profileTypes : le type exact, puis le type de base', () => {
  assert.deepEqual(C.profileTypes('PLA'), ['PLA']);
  assert.deepEqual(C.profileTypes('pla-cf'), ['PLA-CF', 'PLA']);
  assert.deepEqual(C.profileTypes('PETG+'), ['PETG+', 'PETG']);
  assert.deepEqual(C.profileTypes(''), []);
});

test('mapLabel : rappel de l’étape Imprimer', () => {
  assert.equal(C.mapLabel([{ t: 0, tray_id: 3, type: 'PLA', color: '#7C4C00' }]), 'Emplacement 4 · PLA brun');
  assert.equal(C.mapLabel([{ t: 0, tray_id: 3, type: 'PLA', color: '#7C4C00' }, { t: 1, tray_id: 2, type: 'ASA', color: '#898989' }]),
    'Couleur 1 → emplacement 4 · PLA brun, couleur 2 → emplacement 3 · ASA gris');
  assert.equal(C.mapLabel(null), '');
});

test('propose : un emplacement vu vide n’est pas écarté (status non fiable sur la CC2), il ne départage qu’à couleur égale', () => {
  const list = [
    { canvas_id: 0, tray_id: 0, type: 'PLA', color: '#101010', empty: false },
    { canvas_id: 0, tray_id: 1, type: 'PLA', color: '#F5F5F5', empty: true },
    { canvas_id: 0, tray_id: 2, type: 'PETG', color: '#D02020', empty: false }
  ];
  assert.equal(C.propose([{ t: 0, color: '#FFFFFF', type: 'PLA' }], list)[0].tray_id, 1, 'le PLA blanc, même vu vide');
  const two = C.propose([{ t: 0, color: '#FFFFFF', type: 'PLA' }, { t: 1, color: '#000000', type: 'PLA' }], list);
  assert.deepEqual(two.map((m) => m.tray_id), [1, 0], 'chaque couleur sur la bonne');
  const tie = [{ canvas_id: 0, tray_id: 0, type: 'PLA', color: '#FFFFFF', empty: true }, { canvas_id: 0, tray_id: 1, type: 'PLA', color: '#FFFFFF', empty: false }];
  assert.equal(C.propose([{ t: 0, color: '#FFFFFF', type: 'PLA' }], tie)[0].tray_id, 1, 'à égalité : celui vu chargé');
  assert.equal(C.propose([{ t: 0, color: '', type: '' }], tie)[0].tray_id, 1, 'couleur inconnue : celui vu chargé');
});

// États tels que les rend PlyoCanvas.cpp : logique pure testée en C++ sur les schémas d'Orca (CFS_ORCA_SCHEMA, ifs_orca_schema, U1_ORCA_SCHEMA).
const CFS = { ok: true, system: 'cfs', source: 'printer', imposable: true, empty_blocks: true, start_plain: false, validated: false, canvases: [
  { canvas_id: 0, connected: true, box_type: 1, trays: [{ tray_id: 0, label: 'Ext', type: 'PLA', color: '#112233', status: 2 }] },
  { canvas_id: 1, connected: true, box_type: 0, trays: [
    { tray_id: 0, label: '1A', type: 'PLA', color: '#AABBCC', status: 2 },
    { tray_id: 1, label: '1B', type: 'PETG', color: '#DDEEFF', status: 2 },
    { tray_id: 2, label: '1C', type: '', color: '', status: 0 }] }] };
const IFS = { ok: true, system: 'ifs', source: 'printer', imposable: true, empty_blocks: true, start_plain: false, validated: false, canvases: [{ canvas_id: 0, connected: true, trays: [
  { tray_id: 1, label: '1', type: 'PLA', color: '#AABBCC', status: 2 },
  { tray_id: 2, label: '2', type: 'PETG', color: '#DDEEFF', status: 2 },
  { tray_id: 3, label: '3', type: '', color: '', status: 0 }] }] };

test('trays : le numéro vient du traducteur, jamais de tray_id + 1 quand il y a un libellé', () => {
  const cfs = C.trays(CFS);
  assert.deepEqual(cfs.map(t => t.slot), ['Ext', '1A', '1B', '1C']);
  assert.equal(cfs[1].label, '1A · PLA gris'.replace('gris', C.colourName('#AABBCC')));
  assert.ok(!cfs.some(t => t.label.startsWith('Canvas')), 'pas de préfixe Canvas hors CC2, même avec deux unités');
  const ifs = C.trays(IFS);
  assert.equal(ifs[1].tray_id, 2);
  assert.equal(ifs[1].slot, '2', 'IFS : tray_id 2 affiché « 2 », pas « 3 »');
});

test('trays : CC2 sans libellé et projet ancien : tray_id + 1, préfixe Canvas gardé', () => {
  const two = { ok: true, canvases: [{ canvas_id: 0, connected: true, trays: [{ tray_id: 0, type: 'PLA', color: '#000000', status: 1 }] }, { canvas_id: 1, connected: true, trays: [{ tray_id: 3, type: 'PLA', color: '#000000', status: 1 }] }] };
  assert.equal(C.trays(two)[1].label, 'Canvas 2 · 4 · PLA noir');
  assert.equal(C.mapLabel([{ t: 0, tray_id: 3, type: 'PLA', color: '#000000' }]), 'Emplacement 4 · PLA noir');
});

test('checkBeforeSend : numéro du traducteur, unité nommée, CC2 inchangée', () => {
  const fresh = C.trays(CFS);
  const gone = C.checkBeforeSend([{ canvas_id: 2, tray_id: 0, label: '2A', type: 'PLA', color: '#000000' }], fresh, { system: 'cfs' });
  assert.deepEqual(gone.block, ['L’emplacement 2A n’est plus visible sur le CFS.']);
  const changed = C.checkBeforeSend([{ canvas_id: 1, tray_id: 1, label: '1B', type: 'PLA', color: '#DDEEFF' }], fresh, { system: 'cfs' });
  assert.deepEqual(changed.block, ['L’emplacement 1B contient maintenant du PETG (choisi : PLA).']);
  const cc2 = C.checkBeforeSend([{ canvas_id: 0, tray_id: 2, type: 'PLA', color: '#000000' }], [], {});
  assert.deepEqual(cc2.block, ['L’emplacement 3 n’est plus visible sur le Canvas.']);
  // Sans options : comme avant.
  assert.deepEqual(C.checkBeforeSend([{ canvas_id: 0, tray_id: 2, type: 'PLA', color: '#000000' }], []).block, ['L’emplacement 3 n’est plus visible sur le Canvas.']);
});

test('checkBeforeSend : emplacement vide : refus avec empty_blocks, simple remarque sinon (CC2)', () => {
  const chosen = [{ canvas_id: 1, tray_id: 2, label: '1C', type: '', color: '' }];
  assert.deepEqual(C.checkBeforeSend(chosen, C.trays(CFS), { system: 'cfs', empty_blocks: true }).block, ['L’emplacement 1C est vide.']);
  const r = C.checkBeforeSend(chosen, C.trays(CFS), { system: 'cfs', empty_blocks: false });
  assert.deepEqual(r.block, []);
  assert.equal(r.notes.length, 1);
});

test('mapLabel : lire sans imposer : « à sélectionner sur l’imprimante », imposé : sans cette mention', () => {
  const one = [{ t: 0, canvas_id: 1, tray_id: 0, label: '1A', type: 'PLA', color: '#000000', system: 'cfs' }];
  assert.equal(C.mapLabel(one, true), 'Emplacement 1A · PLA noir');
  assert.equal(C.mapLabel(one, false), 'Emplacement 1A · PLA noir : à sélectionner sur l’imprimante');
  const two = one.concat([{ t: 1, canvas_id: 1, tray_id: 1, label: '1B', type: 'PETG', color: '#FFFFFF', system: 'cfs' }]);
  assert.ok(C.mapLabel(two, false).endsWith('à sélectionner sur l’imprimante'));
  assert.ok(C.mapLabel(two, false).includes('couleur 2 → emplacement 1B'));
});

test('isImposed : projet ancien (CC2) oui ; lu sans imposer ou saisi à la main : non', () => {
  assert.equal(C.isImposed([{ t: 0 }]), true);
  assert.equal(C.isImposed([{ t: 0, imposable: true, source: 'printer' }]), true);
  assert.equal(C.isImposed([{ t: 0, imposable: false, source: 'printer' }]), false);
  assert.equal(C.isImposed([{ t: 0, source: 'manual' }]), false);
  assert.equal(C.isImposed([]), false);
  assert.equal(C.isImposed(undefined), false);
});

const imposedEntry = { t: 0, canvas_id: 1, tray_id: 0, label: '1A', type: 'PLA', color: '#000000', imposable: true, source: 'printer', system: 'cfs' };
const readOnlyEntry = Object.assign({}, imposedEntry, { imposable: false });

test('sendRoute : envoi armé seulement si le choix et la relecture sont imposables sur CFS ou IFS', () => {
  assert.equal(C.sendRoute([imposedEntry], { ok: true, system: 'cfs', imposable: true }), 'armed');
  assert.equal(C.sendRoute([Object.assign({}, imposedEntry, { system: 'ifs' })], { ok: true, system: 'ifs', imposable: true }), 'armed');
  // Choisi pour être imposé, plus possible à la relecture : on n'envoie pas en silence autre chose.
  assert.equal(C.sendRoute([imposedEntry], { ok: true, system: 'cfs', imposable: false }), 'refuse');
  assert.equal(C.sendRoute([imposedEntry], { ok: true, system: 'cfs' }), 'refuse');
  // Lire sans imposer : la fenêtre habituelle d'Orca, sans plan.
  assert.equal(C.sendRoute([readOnlyEntry], { ok: true, system: 'cfs', imposable: true }), 'orca');
  // CC2 : print_start comme avant, la carte part dans le fil d'envoi (PlyoCC2).
  assert.equal(C.sendRoute([{ t: 0, canvas_id: 0, tray_id: 0 }], { ok: true, system: 'canvas', imposable: true }), 'orca');
  assert.equal(C.sendRoute([], { ok: true, system: 'cfs', imposable: true }), 'orca');
});

test('printNote : la CC2 n’a rien de plus ; ailleurs le panneau ne présente rien comme essayé sur machine', () => {
  assert.equal(C.printNote([{ t: 0, tray_id: 0 }]), '');
  assert.equal(C.printNote([]), '');
  const imposed = C.printNote([imposedEntry]);
  assert.ok(imposed.includes('« Envoyer et imprimer »'), 'le bouton d’Orca ne garde pas la répartition');
  assert.ok(imposed.includes('pas encore été essayé'), 'validated faux');
  assert.ok(!/vérifié|garanti/i.test(imposed));
  const read = C.printNote([readOnlyEntry]);
  assert.ok(read.includes('fenêtre d’Orca'));
  assert.ok(!/impos[ée]+\b(?! sur)/.test(read.replace('je ne les impose pas', '')), 'aucune répartition présentée comme imposée');
  assert.ok(!C.printNote([Object.assign({}, imposedEntry, { validated: true })]).includes('pas encore été essayé'), 'une marque validée perd la mention');
});

test('orcaConfirm : CC2 et machine sans emplacements : texte d’aujourd’hui ; lire sans imposer : dit quoi vérifier', () => {
  assert.equal(C.orcaConfirm(undefined), '');
  assert.equal(C.orcaConfirm([]), '');
  assert.equal(C.orcaConfirm([{ t: 0, tray_id: 0 }]), '');
  assert.equal(C.orcaConfirm([readOnlyEntry]), 'Orca te demande de confirmer : choisis les mêmes emplacements dans sa fenêtre, puis valide.');
});
