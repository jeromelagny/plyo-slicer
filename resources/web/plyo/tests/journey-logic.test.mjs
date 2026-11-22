// Tests de la logique du parcours en six étapes : node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const J = require('../journey-logic.js');

const printer = { preset: 'Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Centauri Carbon 2' };
const filament = { type: 'PLA', preset: 'Generic PLA @ECC2', nozzle_temp: 215, bed_temp: 60, temps_ok: true };
const part = { name: 'flexyring.stl' };
const full = (extra) => Object.assign({ printer: printer, filament: filament, part: part }, extra || {});

// Lot 6 : six étapes internes, la pièce d'abord ; la barre en montre trois (BAR).
test('les six étapes internes sont dans l’ordre voulu, la barre en montre trois', () => {
  assert.deepEqual(J.STEPS.map((s) => s.key), ['piece', 'machine', 'filament', 'preparer', 'imprimer', 'resultat']);
  assert.deepEqual(J.STEPS.map((s) => s.label), ['Pièce', 'Machine', 'Filament', 'Préparer', 'Imprimer', 'Résultat']);
  assert.deepEqual(J.BAR.map((s) => s.label), ['Ta pièce', 'Machine et bobine', 'Imprimer']);
  assert.deepEqual(J.STEPS.map((s) => J.barKey(s.key)), ['piece', 'materiel', 'materiel', 'imprimer', 'imprimer', 'imprimer']);
});

test('currentStep suit la fiche puis project.step', () => {
  assert.equal(J.currentStep(null), 'piece');
  assert.equal(J.currentStep({ part: part }), 'machine');
  assert.equal(J.currentStep({ printer: printer }), 'piece');
  assert.equal(J.currentStep({ printer: printer, part: part }), 'filament');
  assert.equal(J.currentStep({ printer: printer, filament: filament }), 'piece');
  assert.equal(J.currentStep(full()), 'preparer');
  assert.equal(J.currentStep(full({ step: 'slice' })), 'preparer');
  assert.equal(J.currentStep(full({ step: 'print' })), 'imprimer');
  assert.equal(J.currentStep(full({ step: 'after' })), 'resultat');
});

test('une conversation ancienne (step absent ou done) est à Préparer', () => {
  assert.equal(J.currentStep(full({ step: 'done' })), 'preparer');
  assert.equal(J.currentStep(full({ step: 'inconnu' })), 'preparer');
});

test('steps marque les étapes faites, l’étape en cours et celles à venir', () => {
  const s = J.steps(full({ step: 'print' }));
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'current']);
  assert.equal(s[2].label, 'Imprimer');
  // Le Résultat est l'écran de fin de l'étape 3, pas une étape de la barre.
  assert.deepEqual(J.steps(full({ step: 'after' })).map((x) => x.state), ['done', 'done', 'current']);
  assert.deepEqual(J.steps({ part: part }).map((x) => x.state), ['done', 'current', 'todo']);
});

test('primaryAction : un seul bouton, pas de bouton pour les trois choix', () => {
  for (const step of ['machine', 'filament', 'piece']) {
    const a = J.primaryAction(step, { sliced: false, linked: false, risks: 0 });
    assert.equal(a.kind, 'none');
    assert.equal(a.enabled, false);
  }
  assert.deepEqual(J.primaryAction('preparer', { sliced: false, linked: true, risks: 0 }), { label: 'Découper', kind: 'slice', enabled: true });
  // Des risques : un seul bouton pour corriger, celui de la carte de vérification (cases cochées) ; pas de doublon en haut.
  assert.equal(J.primaryAction('preparer', { sliced: true, linked: true, risks: 2 }).kind, 'none');
  assert.deepEqual(J.primaryAction('preparer', { sliced: true, linked: true, risks: 0 }), { label: 'Continuer', kind: 'advance', enabled: true });
  assert.deepEqual(J.primaryAction('imprimer', { sliced: true, linked: true, risks: 0 }), { label: 'Envoyer et imprimer', kind: 'send', enabled: true });
  assert.deepEqual(J.primaryAction('imprimer', { sliced: true, linked: false, risks: 0 }), { label: 'Exporter le fichier', kind: 'export', enabled: true });
  assert.deepEqual(J.primaryAction('imprimer', { sliced: false, linked: true, risks: 0 }), { label: 'Découper', kind: 'slice', enabled: true });
  // Résultat sans fin connue : pas de bouton plein (surtout pas un bouton qui dépense la jauge).
  assert.deepEqual(J.primaryAction('resultat', { sliced: true, linked: true, risks: 0 }), { label: '', kind: 'none', enabled: false });
});

test('prompt dit quoi faire à chaque étape', () => {
  for (const s of J.STEPS) assert.ok(J.prompt(s.key, { sliced: false, linked: false, risks: 0 }).length > 5, s.key);
  assert.match(J.prompt('machine', {}), /imprimante/i);
});

test('afterPreflight avance seulement sans risque', () => {
  assert.equal(J.afterPreflight(0), 'advance');
  assert.equal(J.afterPreflight(2), 'stay');
});

test('resetStepOnChange ramène à la découpe quand la machine ou le filament change', () => {
  const before = full({ step: 'print' });
  const other = full({ step: 'print', filament: Object.assign({}, filament, { preset: 'Generic PETG @ECC2' }) });
  assert.equal(J.resetStepOnChange(before, other).step, 'slice');
  assert.equal(J.resetStepOnChange(before, full({ step: 'print' })).step, 'print');
  assert.equal(J.resetStepOnChange(full({ step: 'slice' }), full({ step: 'slice', filament: other.filament })).step, 'slice');
  assert.equal(J.resetStepOnChange(null, before).step, 'print');
});

test('la barre passe en pastilles sous 340 px et la fiche se réduit sur fenêtre basse ou repliée', () => {
  assert.equal(J.barMode(320), 'pills');
  assert.equal(J.barMode(339), 'pills');
  assert.equal(J.barMode(340), 'names');
  assert.equal(J.barMode(380), 'names');
  assert.equal(J.compactFiche({ folded: false, heightPx: 500 }), true);
  assert.equal(J.compactFiche({ folded: true, heightPx: 900 }), true);
  assert.equal(J.compactFiche({ folded: false, heightPx: 759 }), true);
  // Lot UX 4 : toujours une ligne, quelle que soit la hauteur (dépliée seulement d'un clic).
  assert.equal(J.compactFiche({ folded: false, heightPx: 760 }), true);
  assert.equal(J.compactFiche({ folded: false, heightPx: 900 }), true);
});

test('ficheSummary omet les parties absentes', () => {
  assert.equal(J.ficheSummary(full()), 'Centauri Carbon 2 · flexyring.stl · PLA');
  const partial = J.ficheSummary({ printer: printer });
  assert.equal(partial, 'Centauri Carbon 2');
  assert.ok(!/undefined|null/.test(J.ficheSummary(null)));
});

test('suggestionsFor : une seule entrée gratuite pendant les choix, deux au plus ensuite, et chaque tiroir reste accessible', () => {
  for (const key of ['machine', 'filament', 'piece']) assert.deepEqual(J.suggestionsFor(key), [{ label: 'Une impression ratée ? Montre-la-moi', kind: 'open', value: 'failed' }], key);
  const opened = [];
  for (const key of ['preparer', 'imprimer', 'resultat']) {
    const list = J.suggestionsFor(key);
    assert.ok(list.length >= 1 && list.length <= 2, key);
    for (const x of list) { assert.ok(x.label && (x.kind === 'ask' || x.kind === 'open'), key); if (x.kind === 'open') opened.push(x.value); }
  }
  for (const what of ['check', 'parts', 'values', 'limits']) assert.ok(opened.includes(what), what + ' n’est plus accessible');
  assert.ok(J.suggestionsFor('preparer').some((x) => x.kind === 'open' && x.value === 'check'));
});

test('tabAfter : envoyer ouvre la Discussion, une réponse ailleurs allume le point, changer d’étape ne bouge rien', () => {
  const guide = { tab: 'guide', unread: false };
  assert.deepEqual(J.tabAfter(guide, 'send'), { tab: 'chat', unread: false });
  assert.deepEqual(J.tabAfter(guide, 'answer'), { tab: 'guide', unread: true });
  assert.deepEqual(J.tabAfter({ tab: 'chat', unread: false }, 'answer'), { tab: 'chat', unread: false });
  assert.deepEqual(J.tabAfter({ tab: 'guide', unread: true }, 'show-chat'), { tab: 'chat', unread: false });
  assert.deepEqual(J.tabAfter({ tab: 'chat', unread: true }, 'show-guide'), { tab: 'guide', unread: true });
  assert.deepEqual(J.tabAfter({ tab: 'chat', unread: true }, 'reset'), { tab: 'guide', unread: false });
  assert.deepEqual(J.tabAfter(guide, 'inconnu'), guide);
  assert.deepEqual(J.tabAfter(null, 'send'), { tab: 'chat', unread: false });
});

test('chatHello : l’accueil sous la carte d’étape invite à poser une question, jamais à choisir son imprimante', () => {
  for (const ready of [true, false]) {
    const t = J.chatHello(ready);
    assert.ok(/question/i.test(t), 'parle de question');
    assert.ok(!/choisis d’abord|ton imprimante/i.test(t), 'ne reprend pas la consigne des étapes');
  }
  // Lot 5 : un seul fil, plus de renvoi vers un onglet « Étapes ».
  assert.ok(!/Étapes|onglet/.test(J.chatHello(false)) && !/Étapes|onglet/.test(J.chatHello(true)));
});

test('confirmation en un toucher : la machine et le filament proposés deviennent le bouton de la ligne d’action', () => {
  assert.deepEqual(J.primaryAction('machine', { proposal: { name: 'Centauri Carbon 2' } }), { label: 'Oui, sur Centauri Carbon 2', kind: 'confirmMachine', enabled: true });
  assert.deepEqual(J.primaryAction('filament', { proposal: { name: 'Sunlu PLA+ noir' } }), { label: 'Oui, Sunlu PLA+ noir', kind: 'confirmFilament', enabled: true });
  assert.equal(J.primaryAction('machine', {}).kind, 'none');
  assert.equal(J.primaryAction('piece', { proposal: { name: 'x' } }).kind, 'none');
  assert.match(J.prompt('machine', { proposal: { name: 'Centauri Carbon 2' } }), /Imprimer sur Centauri Carbon 2 \?/);
  assert.match(J.prompt('filament', { proposal: { name: 'Sunlu PLA+ noir' } }), /Sunlu PLA\+ noir, comme la dernière fois \?/);
  // « Quelle bobine ? » : la question de l'étape Filament, aussi quand on change de filament.
  assert.equal(J.prompt('filament', {}), 'Quelle bobine ?');
  assert.equal(J.prompt('preparer', { editing: true }), 'Quelle bobine ?');
});

test('resetStepOnChange : changer de machine oublie l’adaptation du 3MF, changer de filament la garde', () => {
  const base = full({ step: 'print', adapted: 'flexyring.stl' });
  const otherPrinter = full({ step: 'print', adapted: 'flexyring.stl', printer: { preset: 'Autre', name: 'Autre' } });
  assert.equal(J.resetStepOnChange(base, otherPrinter).adapted, undefined);
  const otherFilament = full({ step: 'print', adapted: 'flexyring.stl', filament: Object.assign({}, filament, { preset: 'Generic PETG @ECC2' }) });
  assert.equal(J.resetStepOnChange(base, otherFilament).adapted, 'flexyring.stl');
  const early = full({ adapted: 'flexyring.stl', printer: { preset: 'Autre', name: 'Autre' } });
  assert.equal(J.resetStepOnChange(full({ adapted: 'flexyring.stl' }), early).adapted, undefined); // même avant la découpe
});

test('shouldRecheck : on revérifie une machine qui ne répondait pas, seulement à l’étape Imprimer', () => {
  assert.equal(J.shouldRecheck('imprimer', false), true);
  assert.equal(J.shouldRecheck('imprimer', true), false);
  assert.equal(J.shouldRecheck('imprimer', null), false);
  assert.equal(J.shouldRecheck('preparer', false), false);
});

test('étape Préparer avec les questions d’intention : pas de bouton pendant les questions, « Appliquer et préparer » au résumé', () => {
  assert.equal(J.primaryAction('preparer', { sliced: false, intent: 'asking' }).kind, 'none');
  assert.deepEqual(J.primaryAction('preparer', { sliced: false, intent: 'ready' }), { label: 'Appliquer et préparer', kind: 'applyIntent', enabled: true });
  assert.equal(J.primaryAction('preparer', { sliced: false, intent: 'done' }).kind, 'slice');
  assert.equal(J.primaryAction('preparer', { sliced: false }).kind, 'slice');
  assert.match(J.prompt('preparer', { sliced: false, intent: 'asking' }), /question/i);
  assert.match(J.prompt('preparer', { sliced: false, intent: 'ready' }), /propose/i);
});

test('tabLabel : la progression sur les trois étapes de la barre', () => {
  assert.equal(J.tabLabel({}), 'Étapes · 1/3');
  const ready = { printer: { preset: 'CC2' }, part: { name: 'bague' }, filament: { preset: 'PLA', temps_ok: true } };
  assert.equal(J.tabLabel(ready), 'Étapes · 3/3');
  assert.equal(J.tabLabel(Object.assign({ step: 'after' }, ready)), 'Étapes · 3/3');
  assert.equal(J.tabLabel(null), 'Étapes');
});

test('resetStepOnChange : les emplacements du Canvas suivent la machine et le filament', () => {
  const canvas = [{ t: 0, canvas_id: 0, tray_id: 3, type: 'PLA', color: '#7C4C00', preset: filament.preset }];
  const base = full({ canvas });
  // Autre machine : emplacements oubliés.
  assert.equal(J.resetStepOnChange(base, full({ canvas, printer: { preset: 'Autre', name: 'Autre' } })).canvas, undefined);
  // Filament choisi hors des emplacements (liste habituelle) : emplacements oubliés.
  const petg = Object.assign({}, filament, { preset: 'Generic PETG @ECC2' });
  assert.equal(J.resetStepOnChange(base, full({ canvas, filament: petg })).canvas, undefined);
  // Filament changé par un emplacement (la carte suit) : gardés.
  const viaSlot = [{ t: 0, canvas_id: 0, tray_id: 2, type: 'PETG', color: '#898989', preset: petg.preset }];
  assert.deepEqual(J.resetStepOnChange(base, full({ canvas: viaSlot, filament: petg })).canvas, viaSlot);
  // Rien ne change : gardés.
  assert.deepEqual(J.resetStepOnChange(base, base).canvas, canvas);
});

test('étape Filament avec le Canvas : consigne et action principale', () => {
  const single = { canvas: { mode: 'single', proposal: { label: '4 · PLA brun' } } };
  assert.deepEqual(J.primaryAction('filament', single), { label: 'Oui, l’emplacement 4 · PLA brun', kind: 'confirmCanvas', enabled: true });
  assert.equal(J.prompt('filament', single), 'Quel emplacement du Canvas pour ta pièce ?');
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'single' } }).kind, 'none'); // pas de proposition : on touche un emplacement
  assert.deepEqual(J.primaryAction('filament', { canvas: { mode: 'multi', complete: true } }), { label: 'Utiliser ces emplacements', kind: 'confirmCanvas', enabled: true });
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'multi', complete: false } }).enabled, false);
  assert.equal(J.prompt('filament', { canvas: { mode: 'multi' } }), 'Quel emplacement pour chaque couleur ?');
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'loading' } }).kind, 'none');
  assert.equal(J.prompt('filament', { canvas: { mode: 'loading' } }), 'Je lis les emplacements de ta CC2…');
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'tooMany' } }).kind, 'none');
  // Le Canvas l'emporte sur « comme la dernière fois ».
  assert.equal(J.primaryAction('filament', Object.assign({ proposal: { name: 'PLA' } }, single)).kind, 'confirmCanvas');
});

test('emplacements repris depuis l’étape Imprimer : l’action principale confirme les emplacements, pas l’envoi', () => {
  const multi = { sliced: true, linked: true, canvas: { mode: 'multi', complete: true } };
  assert.equal(J.primaryAction('imprimer', multi).kind, 'confirmCanvas');
  assert.equal(J.prompt('imprimer', multi), 'Quel emplacement pour chaque couleur ?');
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: true, canvas: { mode: 'loading' } }).kind, 'none');
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: true }).kind, 'send');
});

test('Parcours débutant : textes simples aux étapes Préparer et Imprimer', () => {
  assert.equal(J.prompt('preparer', { sliced: true, risks: 2 }), 'J’ai trouvé des points à régler : coche ce que tu veux corriger ci-dessous');
  assert.equal(J.prompt('imprimer', { sliced: true }), 'Prêt à imprimer');
  const labels = ['preparer', 'imprimer', 'resultat'].flatMap((k) => J.suggestionsFor(k).map((x) => x.label));
  for (const bad of ['Voir les réglages que tu lis', 'Limites du fabricant']) assert.ok(!labels.includes(bad), bad);
  assert.ok(J.suggestionsFor('imprimer').some((x) => x.kind === 'ask'), 'une question utile avant de lancer');
});

test('lot UX 4 : la fiche tient sur une ligne à toutes les étapes, et le titre du panneau est le nom de la pièce', () => {
  for (const step of ['machine', 'piece', 'filament', 'preparer', 'imprimer', 'resultat']) assert.equal(J.compactFiche({ folded: false, heightPx: 900, step: step }), true, step);
  assert.equal(J.projectTitle({ part: { name: 'Petit bateau de test (3DBenchy)' } }), 'Petit bateau de test (3DBenchy)');
  assert.equal(J.projectTitle({}), 'Nouveau projet');
  assert.equal(J.projectTitle(null), 'Nouveau projet');
  const p = { printer: { name: 'Ender-3 Pro', preset: 'x' }, part: { name: 'bateau.stl' }, filament: { type: 'PLA' } };
  assert.equal(J.ficheSummary(p, { noPart: true }), 'Ender-3 Pro · PLA', 'la pièce est déjà dans le titre');
  assert.equal(J.ficheSummary(p), 'Ender-3 Pro · bateau.stl · PLA');
});

test('la fiche montre l’emplacement choisi sur le Canvas, avec sa couleur', () => {
  const one = full({ canvas: [{ t: 0, canvas_id: 0, tray_id: 1, type: 'PLA', color: '#FFFFFF', preset: 'Generic PLA @ECC2' }] });
  const row = J.filledRows(one).find((r) => r.line === 'filament');
  assert.ok(row.text.startsWith('PLA') && row.text.endsWith('· emplacement 2'), row.text);
  assert.equal(row.swatch, '#FFFFFF');
  assert.ok(J.ficheSummary(one).includes('n° 2'));
  const two = full({ canvas: [{ t: 0, tray_id: 1, type: 'PLA', color: '#FFFFFF' }, { t: 1, tray_id: 3, type: 'PLA', color: '#2850DF' }] });
  assert.equal(J.filledRows(two).find((r) => r.line === 'filament').text, 'PLA · 2 emplacements');
  assert.equal(J.filledRows(full()).find((r) => r.line === 'filament').text, 'PLA');
});

test('divergenceNames : deux profils de la même machine restent distinguables', () => {
  assert.deepEqual(J.divergenceNames({ preset: 'Ma Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Elegoo Centauri Carbon 2 0.4 nozzle' }, 'Elegoo Centauri Carbon 2 0.4 nozzle'),
    { from: 'Ma Elegoo Centauri Carbon 2 0.4 nozzle', to: 'Elegoo Centauri Carbon 2 0.4 nozzle' });
  assert.deepEqual(J.divergenceNames({ preset: 'Ma K2', name: 'K2' }, 'Bambu Lab A1'), { from: 'K2', to: 'Bambu Lab A1' });
});

test('pendant un envoi, le bouton de l’étape Imprimer est inactif ; il revient ensuite', () => {
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: true, sending: true }).enabled, false);
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: false, sending: true }).enabled, false);
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: true }).enabled, true);
});

test('plateau vide alors que la fiche a une pièce : on demande de la remettre, à Préparer comme à Imprimer', () => {
  for (const step of ['preparer', 'imprimer']) {
    assert.equal(J.primaryAction(step, { plateEmpty: true }).kind, 'importPart', step);
    assert.equal(J.prompt(step, { plateEmpty: true }), 'Ta pièce n’est plus sur le plateau', step);
  }
  assert.notEqual(J.primaryAction('resultat', { plateEmpty: true }).kind, 'importPart', 'à Résultat, le plateau peut être vidé');
  assert.equal(J.primaryAction('preparer', {}).kind, 'slice');
});

test('« Tout est bon » n’est dit que si la plaque a été vérifiée sans risque', () => {
  assert.ok(J.prompt('preparer', { sliced: true, risks: 0, checked: 'clean' }).includes('Tout est bon'));
  assert.ok(!J.prompt('preparer', { sliced: true, risks: 0, checked: 'ignored' }).includes('Tout est bon'));
  assert.ok(!J.prompt('preparer', { sliced: true, risks: 0, checked: '' }).includes('Tout est bon'));
});

test('découpe en cours : bouton inactif et état dit à l’écran', () => {
  const a = J.primaryAction('preparer', { slicing: true });
  assert.equal(a.enabled, false);
  assert.equal(a.label, 'Je découpe…');
  assert.equal(J.prompt('preparer', { slicing: true }), 'Je découpe ta plaque…');
  assert.equal(J.primaryAction('imprimer', { slicing: true }).enabled, false);
  assert.equal(J.primaryAction('preparer', {}).enabled, true);
});

test('Résultat : une fois réussi, la suite devient l’action principale', () => {
  assert.equal(J.primaryAction('resultat', {}).kind, 'none');
  assert.equal(J.primaryAction('resultat', { success: true }).kind, 'newPart');
  assert.ok(J.prompt('resultat', { success: true }).includes('réussi'));
});

// Parcours débutant, lot 1 : plus de « (utilise ta jauge) » dans les libellés (effet taximètre) ; la jauge reste dans l'en-tête.
test('suggestions : aucune ne répète le coût ; « changer » le filament n’offre pas de découper en même temps', () => {
  for (const key of ['imprimer', 'resultat']) for (const s of J.suggestionsFor(key)) assert.doesNotMatch(s.label, /jauge/, s.label);
  assert.equal(J.primaryAction('preparer', { editing: true }).kind, 'none');
});

test('fiche repliée : un nom très long est coupé, le filament reste', () => {
  const long = 'une-piece-avec-un-nom-de-fichier-vraiment-tres-tres-long.stl';
  const text = J.ficheSummary({ printer: { name: 'K1C', preset: 'k' }, part: { name: long }, filament: { type: 'PLA', preset: 'p' } });
  assert.ok(text.endsWith('PLA') && !text.includes(long) && text.includes('.stl'), text);
  assert.ok(text.length < 50, text);
});

test('emplacements hors CC2 : consigne selon le système, CC2 inchangée', () => {
  const at = (canvas) => J.prompt('filament', { canvas });
  assert.equal(at({ mode: 'loading' }), 'Je lis les emplacements de ta CC2…');
  assert.equal(at({ mode: 'loading', system: 'canvas' }), 'Je lis les emplacements de ta CC2…');
  assert.equal(at({ mode: 'single', system: 'canvas' }), 'Quel emplacement du Canvas pour ta pièce ?');
  assert.equal(at({ mode: 'loading', system: 'cfs' }), 'Je lis les emplacements de ton CFS…');
  assert.equal(at({ mode: 'single', system: 'cfs' }), 'Quel emplacement du CFS pour ta pièce ?');
  assert.equal(at({ mode: 'single', system: 'ifs' }), 'Quel emplacement de l’IFS pour ta pièce ?');
  assert.equal(at({ mode: 'multi', system: 'ifs' }), 'Quel emplacement pour chaque couleur ?');
  assert.equal(at({ mode: 'tooMany', system: 'cfs' }), 'Ta pièce a plus de couleurs que d’emplacements');
});

test('fiche : le numéro affiché est celui du traducteur, tray_id + 1 pour un projet ancien', () => {
  const base = { printer: { preset: 'p' }, part: { name: 'x' }, filament: { type: 'PLA', preset: 'f' } };
  const row = (canvas) => J.filledRows({ ...base, canvas }).find(r => r.line === 'filament').text;
  assert.equal(row([{ t: 0, tray_id: 1, label: '2', color: '' }]), 'PLA · emplacement 2');
  assert.equal(row([{ t: 0, tray_id: 0, label: '1A', color: '' }]), 'PLA · emplacement 1A');
  assert.equal(row([{ t: 0, tray_id: 1, color: '' }]), 'PLA · emplacement 2');
});

test('une carte d’emplacements saisie sans numéro lisible ne casse pas la fiche', () => {
  const base = { printer: { preset: 'p' }, part: { name: 'x' }, filament: { type: 'PLA', preset: 'f' } };
  assert.equal(J.ficheSummary({ ...base, canvas: [{ t: 0, tray_id: 3, label: 'Ext', color: '' }] }), 'p · x · PLA · n° Ext');
});

test('U1 : on parle de têtes', () => {
  const at = (canvas) => J.prompt('filament', { canvas });
  assert.equal(at({ mode: 'loading', system: 'u1' }), 'Je lis les têtes de ta U1…');
  assert.equal(at({ mode: 'single', system: 'u1' }), 'Quelle tête pour ta pièce ?');
  assert.equal(at({ mode: 'multi', system: 'u1' }), 'Quelle tête pour chaque couleur ?');
  assert.equal(at({ mode: 'tooMany', system: 'u1' }), 'Ta pièce a plus de couleurs que de têtes');
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'single', system: 'u1', proposal: { label: 'Tête 2 · PLA noir' } } }).label, 'Oui, la tête 2 · PLA noir');
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'multi', system: 'u1', complete: true } }).label, 'Utiliser ces têtes');
});

test('fiche : U1 : « tête 2 »', () => {
  const base = { printer: { preset: 'p' }, part: { name: 'x' }, filament: { type: 'PLA', preset: 'f' } };
  assert.equal(J.filledRows({ ...base, canvas: [{ t: 0, tray_id: 1, label: '2', color: '', system: 'u1' }] }).find(r => r.line === 'filament').text, 'PLA · tête 2');
});

test('saisie manuelle : un seul bouton plein par écran, consignes', () => {
  assert.deepEqual(J.primaryAction('filament', { canvas: { mode: 'recall', system: 'manual', recall: 'Toujours PLA noir en 1 ?' } }), { label: 'Oui', kind: 'manualYes', enabled: true });
  assert.equal(J.prompt('filament', { canvas: { mode: 'recall', system: 'manual', recall: 'Toujours PLA noir en 1 ?' } }), 'Toujours PLA noir en 1 ?');
  assert.deepEqual(J.primaryAction('filament', { canvas: { mode: 'manual', system: 'manual' } }), { label: 'Garder ces emplacements', kind: 'manualSave', enabled: true });
  assert.equal(J.prompt('filament', { canvas: { mode: 'manual', system: 'manual' } }), 'Décris tes emplacements');
  assert.equal(J.prompt('filament', { canvas: { mode: 'single', system: 'manual' } }), 'Quel emplacement pour ta pièce ?');
});

test('Filament : les températures de la bobine sont demandées avant de passer à Préparer', () => {
  const unchecked = full({ filament: { type: 'PLA', preset: 'Generic PLA @ECC2', nozzle_temp: 215, bed_temp: 60 } });
  assert.equal(J.tempsPending(unchecked), true);
  assert.equal(J.currentStep(unchecked), 'filament');
  const checked = full();
  assert.equal(J.tempsPending(checked), false);
  assert.equal(J.currentStep(checked), 'preparer');
  // Projet déjà dans le parcours (ancienne conversation) : rien n'est redemandé.
  assert.equal(J.currentStep(full({ step: 'print' })), 'imprimer');
  assert.equal(J.prompt('filament', { temps: { nozzle: 220, bed: 60 } }), 'Quelles températures indique ta bobine ?');
  assert.deepEqual(J.primaryAction('filament', { temps: { nozzle: 220, bed: 60 } }), { label: 'Garder 220 °C / 60 °C', kind: 'keepTemps', enabled: true });
});

test('watchText : ce que le panneau dit après avoir vérifié le démarrage sur l’imprimante', () => {
  const ok = J.watchText('started', 'CR-10 SE', 'cube_PLA_20m.gcode');
  assert.equal(ok.text, '✓ CR-10 SE a démarré l’impression (cube_PLA_20m.gcode).');
  assert.equal(ok.tone, 'ok');
  assert.match(J.watchText('busy', 'CR-10 SE', 'a.gcode').text, /imprimait déjà/);
  assert.match(J.watchText('error', 'CR-10 SE', '').text, /erreur/);
  const late = J.watchText('timeout', 'CR-10 SE', '');
  assert.match(late.text, /n’a pas démarré/);
  assert.match(late.text, /écran/);
  assert.equal(late.tone, 'warn');
  assert.match(J.watchText('unknown', 'CR-10 SE', '').text, /regarde son écran/);
  assert.equal(J.watchText('bizarre', 'x', ''), null);
});

test('afterSliceFollow : après une découpe demandée à l’assistant, imprimer si la machine est reliée, sinon exporter', () => {
  assert.equal(J.afterSliceFollow({ sliced: false, linked: true }), null);
  assert.deepEqual(J.afterSliceFollow({ sliced: true, linked: true }), { label: 'Envoyer et imprimer', kind: 'send' });
  assert.deepEqual(J.afterSliceFollow({ sliced: true, linked: false }), { label: 'Exporter le fichier', kind: 'export' });
});

test('fiche : la ligne filament montre le nom de la bobine quand il y en a une', () => {
  const p = { printer: { preset: 'CR-10 SE', name: 'CR-10 SE' }, part: { name: 'clip.stl' }, filament: { type: 'PLA', preset: 'P', spool: { id: 'b1', name: 'Sunlu PLA+ noir' } } };
  assert.equal(J.filledRows(p).filter(r => r.line === 'filament')[0].text, 'Sunlu PLA+ noir');
  assert.match(J.ficheSummary(p), /Sunlu PLA\+ noir$/);
  delete p.filament.spool;
  assert.equal(J.filledRows(p).filter(r => r.line === 'filament')[0].text, 'PLA');
});

test('barre : seules les étapes faites « Ta pièce » et « Machine et bobine » se rouvrent', () => {
  const at = (step) => J.steps(full({ step }));
  const open = (list) => list.filter(J.canRevisit).map((s) => s.key);
  assert.deepEqual(open(at('slice')), ['piece', 'materiel'], 'Imprimer en cours ne se rouvre pas');
  assert.deepEqual(open(at('after')), ['piece', 'materiel']);
  assert.deepEqual(open(J.steps({ part })), ['piece']);
  assert.deepEqual(open(J.steps(null)), [], 'étapes à venir et étape en cours : rien');
  assert.equal(J.revisitLabel({ label: 'Pièce' }), 'Revenir à l’étape Pièce');
});

test('fin d’impression : la question suit la façon dont elle s’est finie', () => {
  const fin = J.endQuestion('finished', 'CR-10 SE', 'cube.gcode');
  assert.equal(fin.text, 'CR-10 SE a fini d’imprimer « cube.gcode ». Ça s’est bien passé ?');
  assert.deepEqual(fin.choices.map((c) => c.label), ['Oui, c’est réussi', 'Non, c’est raté']);
  const stop = J.endQuestion('cancelled', 'CR-10 SE', 'cube.gcode');
  assert.equal(stop.text, 'L’impression de « cube.gcode » a été arrêtée sur CR-10 SE. Qu’est-ce qui s’est passé ? Je suis là pour t’aider à trouver la cause et à la régler pour la prochaine fois.');
  assert.deepEqual(stop.choices.map((c) => c.label), ['Ça se décollait du plateau', 'Le fil ne sortait plus bien', 'Ça faisait des fils ou des spaghettis', 'J’ai changé d’avis', 'Autre chose']);
  const err = J.endQuestion('error', 'CR-10 SE', 'cube.gcode');
  assert.equal(err.text, 'CR-10 SE signale une erreur et l’impression s’est arrêtée. Regarde son écran et dis-moi ce qu’il affiche : je t’aide à comprendre.');
  assert.equal(err.choices.length, 1);
  for (const v of ['unknown_end', 'lost', 'started', 'timeout', '']) assert.equal(J.endQuestion(v, 'CR-10 SE', 'cube.gcode'), null, v + ' : on ne prétend rien');
  assert.equal(J.endQuestion('finished', 'K2', '').text, 'K2 a fini d’imprimer ta pièce. Ça s’est bien passé ?', 'sans nom de fichier');
});

test('fin d’impression : chaque réponse a sa suite', () => {
  const act = (v, id) => J.endAction(v, id, 'cube.gcode');
  assert.deepEqual(act('finished', 'yes'), { mark: 'success', chat: false, prefill: '', photo: false });
  assert.deepEqual(act('finished', 'no'), { mark: 'failure', chat: true, prefill: '', photo: true });
  assert.deepEqual(act('cancelled', 'bed'), { mark: 'failure', chat: true, prefill: 'L’impression de « cube.gcode » a été arrêtée : ça se décollait du plateau. Comment l’éviter la prochaine fois ?', photo: true });
  assert.match(act('cancelled', 'flow').prefill, /: le fil ne sortait plus bien\./);
  assert.match(act('cancelled', 'spaghetti').prefill, /: ça faisait des fils ou des spaghettis\./);
  assert.deepEqual(act('cancelled', 'other'), { mark: 'failure', chat: true, prefill: '', photo: true }, '« Autre chose » : un champ vide, prêt à écrire');
  assert.deepEqual(act('cancelled', 'mind'), { mark: '', chat: false, prefill: '', photo: false }, '« J’ai changé d’avis » ne marque rien');
  assert.deepEqual(act('error', 'screen'), { mark: '', chat: true, prefill: 'Mon imprimante signale une erreur. Son écran affiche : ', photo: false }, 'une erreur n’est jamais marquée ratée d’office ; le champ attend ce que dit l’écran');
});

test('fin d’impression : pas de question deux fois pour le même envoi', () => {
  const send = { end: { verdict: 'finished', file: 'cube.gcode' } };
  assert.equal(J.endAsk(send, {}), true);
  assert.equal(J.endAsk(Object.assign({}, send, { answered: true }), {}), false, 'Résultat déjà répondu');
  assert.equal(J.endAsk(send, { success: true }), false, 'réussite déjà dite');
  assert.equal(J.endAsk({ end: { verdict: 'unknown_end' } }, {}), false);
  assert.equal(J.endAsk({}, {}), false, 'fin pas encore connue');
  assert.equal(J.endAsk(null, {}), false);
});

test('fin d’impression : watchText se tait, la question prend le relais', () => {
  for (const v of ['finished', 'cancelled', 'unknown_end', 'lost']) assert.equal(J.watchText(v, 'K2', 'a.gcode'), null, v);
});

test('fin d’impression : la consigne dit ce qui s’est passé, la question est dans l’étape', () => {
  assert.equal(J.prompt('resultat', { ended: 'finished' }), 'Impression terminée');
  assert.equal(J.prompt('resultat', { ended: 'cancelled' }), 'Impression arrêtée');
  assert.equal(J.prompt('resultat', { ended: 'error' }), 'Ta machine signale une erreur');
  assert.equal(J.prompt('resultat', {}), 'Bonne impression ! Reviens me dire comment ça s’est passé.', 'fin inconnue : pas de « ça a marché ? » au début de l’impression');
  assert.equal(J.prompt('resultat', { ended: 'finished', success: true }), 'Bravo, c’est réussi !');
  assert.equal(J.shortMachine({ preset: 'Creality CR-10 SE 0.4 nozzle', name: 'Creality CR-10 SE 0.4 nozzle' }), 'Creality CR-10 SE');
  assert.equal(J.shortMachine({ name: 'Ma K2 Plus' }), 'K2 Plus');
});

test('Résultat : en cours tant qu’aucune fin n’est connue, puis le bouton plein suit la fin lue ou dite', () => {
  assert.equal(J.resultState({}), 'printing');
  assert.equal(J.resultState({ ended: 'finished' }), 'finished');
  assert.equal(J.resultState({ ended: 'cancelled' }), 'stopped');
  assert.equal(J.resultState({ ended: 'error' }), 'stopped');
  assert.equal(J.resultState({ failed: true, ended: 'finished' }), 'failed');
  assert.equal(J.resultState({ success: true, failed: true }), 'success');
  // En cours : rien de plein, et la consigne ne demande pas encore si c'est réussi.
  assert.equal(J.primaryAction('resultat', {}).kind, 'none');
  assert.doesNotMatch(J.prompt('resultat', {}), /marché/);
  // Fin lue « terminée » : « Oui, c'est réussi » est le bouton plein (gratuit).
  assert.deepEqual(J.primaryAction('resultat', { ended: 'finished', endAsk: true }), { label: 'Oui, c’est réussi', kind: 'success', enabled: true });
  // Arrêt ou erreur : la carte pose sa question ; une fois répondue, « Nouvelle pièce ».
  assert.equal(J.primaryAction('resultat', { ended: 'cancelled', endAsk: true }).kind, 'none');
  assert.equal(J.primaryAction('resultat', { ended: 'error' }).kind, 'newPart');
  // « Raté » dit : la photo du téléphone (repère « ai-action » au rendu, journey-view.js), sans le coût dans le libellé.
  const failed = J.primaryAction('resultat', { failed: true });
  assert.equal(failed.kind, 'photo');
  assert.equal(failed.label, 'Photo avec mon téléphone');
  assert.equal(J.prompt('resultat', { failed: true }), 'Dommage. Montre-moi ta pièce en photo');
  // Le seul bouton plein de Résultat qui dépense est la photo : le rendu lui donne le repère des actions de l'assistant.
  for (const c of [{}, { ended: 'finished', endAsk: true }, { ended: 'error', endAsk: true }, { ended: 'cancelled' }, { failed: true }, { success: true }]) {
    const a = J.primaryAction('resultat', c);
    if (a.kind === 'photo') assert.doesNotMatch(a.label, /jauge/);
  }
  assert.match(fs.readFileSync(new URL('../journey-view.js', import.meta.url), 'utf8'), /action\.kind === 'photo' \? 'btn sm ai-action' : 'btn sm'/);
});

test('photos : deux libellés uniques, avec leur coût', () => {
  assert.equal(J.PHOTO_PHONE, 'Photo avec mon téléphone');
  assert.equal(J.PHOTO_COMPUTER, 'Photo depuis l’ordinateur');
});

test('défaut d’une pièce : montré gratuitement en photo, plus de demande payée pour se faire réclamer une photo', () => {
  const r = J.suggestionsFor('resultat');
  assert.ok(r.some((x) => x.kind === 'open' && x.value === 'defect' && x.label === 'Montrer le défaut en photo'));
  assert.ok(!r.some((x) => x.kind === 'ask'), 'aucune suggestion payante à Résultat');
});

test('fiche incomplète : le bouton dit ce qu’il reste à choisir, et la photo prévient de ce qu’il faudra', () => {
  assert.equal(J.completeLabel(['printer', 'filament']), 'Choisir ma machine et ma bobine');
  assert.equal(J.completeLabel(['printer', 'part', 'filament']), 'Choisir ma machine et ma bobine');
  assert.equal(J.completeLabel(['printer']), 'Choisir ma machine');
  assert.equal(J.completeLabel(['filament']), 'Choisir ma bobine');
  assert.equal(J.completeLabel(['part']), 'Choisir ma pièce');
  assert.equal(J.completeLabel([]), '');
  assert.equal(J.completeLabel(undefined), '');
  assert.equal(J.fixNeeds({}), 'Pour que j’applique une correction, il me faudra ta machine et ta bobine.');
  assert.equal(J.fixNeeds({ printer: { preset: 'K2' } }), 'Pour que j’applique une correction, il me faudra ta bobine.');
  assert.equal(J.fixNeeds({ printer: { preset: 'K2', proposed: true }, filament: { preset: 'PLA' } }), 'Pour que j’applique une correction, il me faudra ta machine.');
  assert.equal(J.fixNeeds({ printer: { preset: 'K2' }, filament: { preset: 'PLA', proposed: true } }), 'Pour que j’applique une correction, il me faudra ta bobine.');
  assert.equal(J.fixNeeds({ printer: { preset: 'K2' }, filament: { preset: 'PLA' } }), '', 'la pièce n’est pas exigée pour un réglage du filament');
});
