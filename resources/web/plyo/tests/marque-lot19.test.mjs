// Lot 19 : « De quelle marque est ta bobine ? » (bobine seule et emplacements). Logique pure de spools-logic.js et gardes de
// source : un profil de marque ne part au slicer que sur un geste de l'utilisateur, jamais par une réponse de l'IA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const S = require('../spools-logic.js');
const C = require('../canvas-logic.js');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const readCpp = (rel) => fs.readFileSync(new URL('../../../../' + rel, import.meta.url), 'utf8');

// Réponse du slicer (Brands::groups) pour une K2 et du PLA.
const K2_PLA = [
  { brand: 'Creality', printer: true, ranges: [{ preset: 'CR-PLA @K2-all', label: 'CR-PLA', short: 'CR-PLA' }, { preset: 'Ender-PLA @K2-all', label: 'Ender-PLA', short: 'Ender-PLA' },
    { preset: 'Hyper PLA @K2-all', label: 'Hyper PLA', short: 'Hyper PLA' }] },
  { brand: 'addnorth', ranges: [{ preset: 'addnorth PLA @System', label: 'addnorth PLA', short: 'PLA' }] },
  { brand: 'Aliz', ranges: [{ preset: 'Aliz PLA @System', label: 'Aliz PLA', short: 'PLA' }] },
  { brand: 'Bambu Lab', ranges: [{ preset: 'Bambu PLA Basic @System', label: 'Bambu PLA Basic', short: 'Bambu PLA Basic' }] },
  { brand: 'BETA', ranges: [{ preset: 'BETA PLA @System', label: 'BETA PLA', short: 'PLA' }] },
  { brand: 'Elegoo', ranges: [{ preset: 'Elegoo PLA @System', label: 'Elegoo PLA', short: 'PLA' }] },
  { brand: 'eSUN', ranges: [{ preset: 'eSUN PLA+ @System', label: 'eSUN PLA+', short: 'PLA+' }] },
  { brand: 'FilAr', ranges: [{ preset: 'FilAr PLA @System', label: 'FilAr PLA', short: 'PLA' }] },
  { brand: 'Polymaker', ranges: [{ preset: 'Polymaker PLA @System', label: 'Polymaker PLA', short: 'PLA' }] },
  { brand: 'SUNLU', ranges: [{ preset: 'SUNLU PLA @System', label: 'SUNLU PLA', short: 'PLA' }] }
];

test('marques : la marque de l’imprimante puis les plus répandues, les autres derrière un lien', () => {
  const v = S.brandButtons(K2_PLA, false);
  assert.equal(v.shown.length, S.BRANDS_SHOWN);
  assert.equal(v.hidden, K2_PLA.length - S.BRANDS_SHOWN);
  assert.equal(v.shown[0].brand, 'Creality');
  assert.deepEqual(v.shown.slice(1).map((g) => g.brand), ['eSUN', 'SUNLU', 'Polymaker', 'Elegoo', 'Bambu Lab']);
  assert.equal(S.brandButtons(K2_PLA, true).shown.length, K2_PLA.length, '« Voir les autres marques » : toutes, dans l’ordre du slicer');
  assert.equal(S.brandButtons(K2_PLA.slice(0, 7), false).hidden, 0, 'peu de marques : toutes visibles');
  assert.deepEqual(S.brandButtons([], false), { shown: [], hidden: 0 });
  assert.deepEqual(S.brandButtons(null, false), { shown: [], hidden: 0 });
});

test('marque : choix, nom proposé et phrase dite, pour chaque issue', () => {
  const crea = K2_PLA[0], hyper = crea.ranges[2];
  const brand = S.brandChoice(crea, hyper);
  assert.deepEqual(brand, { kind: 'brand', brand: 'Creality', range: 'Hyper PLA', short: 'Hyper PLA', preset: 'Hyper PLA @K2-all' });
  assert.equal(S.suggestedName(brand, 'PLA'), 'Creality Hyper PLA');
  assert.equal(S.brandNote(brand, 'PLA'), 'Je pars des réglages prévus par Creality pour sa gamme Hyper PLA.');
  const esun = S.brandChoice(K2_PLA[6], K2_PLA[6].ranges[0]);
  assert.equal(S.suggestedName(esun, 'PLA'), 'eSUN PLA+', 'la marque n’est pas répétée');
  // « Laquelle ? » → « Je ne sais pas » : la marque reste, le profil est le générique.
  const only = S.brandChoice(crea, null);
  assert.equal(only.kind, 'brand_only');
  assert.equal(only.preset, '');
  assert.equal(S.suggestedName(only, 'PLA'), 'Creality PLA');
  assert.match(S.brandNote(only, 'PLA'), /plupart des bobines de PLA\. Un test pourra les affiner\./);
  // « Autre marque » : écrite, gardée, générique ; le panneau le dit simplement.
  const other = S.otherChoice('  Sunlu  ');
  assert.deepEqual(other, { kind: 'other', brand: 'Sunlu', range: '', short: '', preset: '' });
  assert.equal(S.suggestedName(other, 'PETG'), 'Sunlu PETG');
  assert.equal(S.brandNote(other, 'PETG'), 'Je n’ai pas de réglages propres à Sunlu : je pars de réglages qui conviennent à la plupart des bobines de PETG. Un test pourra les affiner.');
  assert.equal(S.otherChoice('a'), null, 'une lettre ne suffit pas');
  assert.equal(S.otherChoice('a/b').brand, 'a b', 'caractères interdits remplacés, comme côté slicer');
  assert.equal(S.cleanBrand('x'.repeat(80)).length, 60);
  // « Je ne sais pas » : rien de prérempli, phrase rassurante.
  const unknown = S.unknownChoice();
  assert.equal(S.suggestedName(unknown, 'PLA'), '');
  assert.match(S.brandNote(unknown, 'PLA'), /^Pas de souci : /);
});

test('fiche : la marque de la bobine, ou des emplacements, est rappelée', () => {
  assert.equal(S.brandLine({ filament: { type: 'PLA', brand: 'Creality', range: 'Hyper PLA', brand_profile: true } }), 'Marque : Creality · Hyper PLA · réglages du fabricant');
  assert.equal(S.brandLine({ filament: { type: 'PLA', brand: 'Sunlu' } }), 'Marque : Sunlu · réglages communs');
  assert.equal(S.brandLine({ filament: { type: 'PLA', brand: 'eSUN', range: 'eSUN PLA+', brand_profile: true } }), 'Marque : eSUN · PLA+ · réglages du fabricant', 'la marque n’est pas répétée');
  assert.equal(S.brandLine({ filament: { type: 'PLA' } }), '');
  assert.equal(S.brandLine({ filament: { type: 'PLA', brand: 'Sunlu', proposed: true } }), '', 'une bobine seulement proposée n’est pas choisie');
  assert.equal(S.brandLine({ filament: { type: 'PLA' }, canvas: [{ t: 0, canvas_id: 1, tray_id: 1, label: '1B', brand: 'Creality', range: 'Hyper PLA' },
    { t: 1, canvas_id: 1, tray_id: 0, label: '1A', brand: 'eSUN', range: 'eSUN PLA+' }, { t: 2, canvas_id: 1, tray_id: 2, label: '1C' }] }),
  'Marque : 1B Creality Hyper PLA, 1A eSUN PLA+');
  assert.equal(S.brandLine({ filament: { type: 'PLA', brand: 'X' }, canvas: [{ t: 0, tray_id: 0 }] }), '', 'avec des emplacements, seules leurs marques comptent');
});

test('emplacements : une seule question pour les annonces reconnues, jamais pour une annonce inconnue ou absente', () => {
  const state = { ok: true, system: 'cfs', canvases: [{ canvas_id: 1, connected: true, trays: [
    { tray_id: 0, label: '1A', type: 'PLA', color: '#FFFFFF', brand: 'Creality', name: 'Hyper PLA', status: 2 },
    { tray_id: 1, label: '1B', type: 'PLA', color: '#000000', brand: 'Inconnue', name: 'Super PLA', status: 2 },
    { tray_id: 2, label: '1C', type: 'PLA', color: '#FF0000', brand: '', name: '', status: 2 },
    { tray_id: 3, label: '1D', type: 'PLA', color: '#00FF00', brand: 'eSUN', name: 'eSUN PLA+', status: 2 }] }] };
  const trays = C.trays(state);
  assert.equal(trays[0].brand, 'Creality', 'la lecture garde ce que l’emplacement annonce');
  assert.equal(trays[0].name, 'Hyper PLA');
  const match = { brand: 'Creality', label: 'Hyper PLA', short: 'Hyper PLA', preset: 'Hyper PLA @K2-all' };
  const items = { '1:0': { material: 'PLA', brands: K2_PLA, match }, '1:1': { material: 'PLA', brands: K2_PLA, match: {} }, '1:2': { material: 'PLA', brands: K2_PLA, match: {} },
    '1:3': { material: 'PLA', brands: K2_PLA, match: { brand: 'eSUN', label: 'eSUN PLA+', short: 'PLA+', preset: 'eSUN PLA+ @System' } } };
  const one = S.slotOffers([{ t: 0, canvas_id: 1, tray_id: 0 }], trays, items, {}, {});
  assert.equal(one.length, 1);
  assert.equal(S.slotQuestion(one, C.words('cfs')), 'Ton CFS annonce « Creality Hyper PLA » à l’emplacement 1A : c’est bien cette bobine ?');
  assert.deepEqual(S.slotOffers([{ t: 0, canvas_id: 1, tray_id: 1 }], trays, items, {}, {}), [], 'annoncée mais inconnue : pas de question');
  assert.deepEqual(S.slotOffers([{ t: 0, canvas_id: 1, tray_id: 2 }], trays, items, {}, {}), [], 'rien d’annoncé : pas de question');
  const two = S.slotOffers([{ t: 0, canvas_id: 1, tray_id: 0 }, { t: 1, canvas_id: 1, tray_id: 3 }, { t: 2, canvas_id: 1, tray_id: 1 }], trays, items, {}, {});
  assert.equal(two.length, 2);
  assert.equal(S.slotQuestion(two, C.words('cfs')), 'Ton CFS annonce ces bobines : « Creality Hyper PLA » à l’emplacement 1A, « eSUN PLA+ » à l’emplacement 1D. C’est bien elles ?');
  assert.equal(S.slotOffers([{ t: 0, canvas_id: 1, tray_id: 0 }], trays, items, { '1:0': S.unknownChoice() }, {}).length, 0, 'déjà répondu');
  assert.equal(S.slotOffers([{ t: 0, canvas_id: 1, tray_id: 0 }], trays, items, {}, { '1:0': true }).length, 0, '« Je ne sais pas » dit');
  assert.equal(S.slotOffers([{ t: 0, canvas_id: 1, tray_id: 0 }], trays, null, {}, {}).length, 0, 'slicer pas encore répondu');
  assert.equal(S.slotQuestion([{ key: 'k', slot: '2', said: 'Elegoo PLA', match }], C.words('u1')), 'Ta U1 annonce « Elegoo PLA » à la tête 2 : c’est bien cette bobine ?');
  assert.equal(S.slotBrandText(null), 'Marque : non précisée · réglages communs');
  assert.equal(S.slotBrandText(S.brandChoice(K2_PLA[0], K2_PLA[0].ranges[2])), 'Marque : Creality Hyper PLA');
  assert.equal(S.slotBrandText(S.otherChoice('Sunlu')), 'Marque : Sunlu · réglages communs');
});

test('aucun texte de la marque ne parle d’Orca', () => {
  const texts = [S.BRAND_QUESTION, S.BRAND_HELP, S.rangeHelp('Creality'), S.brandNote(S.unknownChoice(), 'PLA'), S.brandNote(S.otherChoice('Sunlu'), 'PLA'),
    S.brandNote(S.brandChoice(K2_PLA[0], K2_PLA[0].ranges[0]), 'PLA'), S.slotBrandText(null)];
  for (const t of texts) assert.ok(!/orca/i.test(t), t);
  const card = read('project-card.js'), view = read('canvas-view.js');
  for (const src of [card.slice(card.indexOf('function renderBrandPicker'), card.indexOf('function renderNewSpool')), view.slice(0, view.indexOf('function render(slot'))])
    for (const m of src.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)) assert.ok(!/orca/i.test(m[1]), m[1]);
});

test('garde : le profil de marque ne part au slicer que sur un geste dans le panneau', () => {
  const page = read('index.html');
  // Seuls chooseSpool (avec le choix de la question) et applyCanvas portent un profil de marque.
  assert.equal((page.match(/brand_preset/g) || []).length, 1, 'brand_preset : seulement dans chooseSpool');
  assert.match(page, /chooseSpool\(PlyoSpools\.cleanName\(ns\.name\), ns\.material, ns\.choice\)/);
  assert.match(page, /if \(choice && choice\.kind === 'brand' && choice\.preset\) sent\.preset = choice\.preset;/);
  // Les réponses de l'IA (commands, apply) n'appellent ni chooseSpool ni applyCanvas.
  const ai = page.slice(page.indexOf('function onCommands'), page.indexOf('function onCommands') + 4000);
  if (page.includes('function onCommands')) assert.ok(!/chooseSpool|applyCanvas|brands_get/.test(ai));
  // Côté slicer : seuls spool_choose et canvas_apply mènent à un profil de marque, toujours vérifié par Brands::check.
  const assistant = readCpp('src/plyo/PlyoAssistant.cpp');
  assert.match(assistant, /Json::str\(data, "brand_preset", 200\)/);
  assert.ok(!/Brands::keep_visible|select_filament/.test(assistant), 'le pont ne choisit aucun profil lui-même');
  const spools = readCpp('src/plyo/PlyoSpools.cpp'), canvas = readCpp('src/plyo/PlyoCanvas.cpp');
  assert.match(spools, /if \(Brands::check\(material_kept, brand_preset\)\.empty\(\)\)/);
  assert.match(canvas, /if \(Brands::check\(Json::str\(slot, "material"\), brand_preset\)\.empty\(\)\)/);
  for (const f of ['src/plyo/PlyoCommands.cpp', 'src/plyo/PlyoSettingsBridge.cpp', 'src/plyo/PlyoCatalog.cpp'])
    assert.ok(!/Brands::|brand_preset/.test(readCpp(f)), f + ' ne touche pas aux marques');
});

test('garde : rien de ce qu’annonce l’imprimante ne part au service', () => {
  const page = read('index.html');
  // slot_brands_get va au slicer (window.orca), jamais dans le corps envoyé au service.
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'slot_brands_get'/);
  const body = page.slice(page.indexOf('body = {'), page.indexOf('body = {') + 2500);
  assert.ok(!/brand|canvasUI\.brands|slotBrand/.test(body), 'le contexte de l’IA ne reçoit pas les marques lues');
});

test('la question de la marque ne reste jamais sur « Je cherche les marques… » : sans réponse du slicer, champ libre et « Je ne sais pas »', async () => {
  const fs = await import('node:fs');
  const { createRequire } = await import('node:module');
  const S = createRequire(import.meta.url)('../spools-logic.js');
  assert.ok(S.BRANDS_WAIT_MS >= 2000 && S.BRANDS_WAIT_MS <= 6000);
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /ns\.brandsTimer = setTimeout\(function \(\) \{[\s\S]{0,200}ns\.brands = \[\];[\s\S]{0,60}\}, PlyoSpools\.BRANDS_WAIT_MS\)/);
  assert.match(page, /function onBrands\(msg\) \{[\s\S]{0,260}clearTimeout\(ns\.brandsTimer\)/);
});

test('« Laquelle ? » : huit gammes au plus, puis « Voir les autres gammes (n) »', () => {
  const many = Array.from({ length: 46 }, (_, i) => ({ label: 'Gamme ' + i, short: 'Gamme ' + i, preset: 'P' + i }));
  assert.deepEqual(S.rangeButtons(many, false).shown.map(r => r.preset), many.slice(0, 8).map(r => r.preset));
  assert.equal(S.rangeButtons(many, false).hidden, 38);
  assert.equal(S.rangeButtons(many, true).shown.length, 46);
  assert.equal(S.rangeButtons(many, true).hidden, 0);
  // Neuf gammes : toutes montrées, plutôt qu'un lien pour une seule de plus.
  assert.equal(S.rangeButtons(many.slice(0, 9), false).shown.length, 9);
  assert.equal(S.rangeButtons(many.slice(0, 3), false).hidden, 0);
  assert.deepEqual(S.rangeButtons(null, false), { shown: [], hidden: 0 });
  const card = fs.readFileSync(new URL('../project-card.js', import.meta.url), 'utf8');
  assert.match(card, /Voir les autres gammes \(/);
});
