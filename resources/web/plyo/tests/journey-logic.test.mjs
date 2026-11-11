// Tests de la logique du parcours en six étapes : node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const J = require('../journey-logic.js');

const printer = { preset: 'Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Centauri Carbon 2' };
const filament = { type: 'PLA', preset: 'Generic PLA @ECC2', nozzle_temp: 215, bed_temp: 60, temps_ok: true };
const part = { name: 'flexyring.stl' };
const full = (extra) => Object.assign({ printer: printer, filament: filament, part: part }, extra || {});

test('les six étapes sont dans l’ordre voulu', () => {
  assert.deepEqual(J.STEPS.map((s) => s.key), ['machine', 'piece', 'filament', 'preparer', 'imprimer', 'resultat']);
  assert.deepEqual(J.STEPS.map((s) => s.label), ['Machine', 'Pièce', 'Filament', 'Préparer', 'Imprimer', 'Résultat']);
});

test('currentStep suit la fiche puis project.step', () => {
  assert.equal(J.currentStep(null), 'machine');
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
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'done', 'done', 'current', 'todo']);
  assert.equal(s[4].label, 'Imprimer');
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
  assert.deepEqual(J.primaryAction('resultat', { sliced: true, linked: true, risks: 0 }), { label: 'Envoyer une photo', kind: 'photo', enabled: true });
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
  assert.equal(J.compactFiche({ folded: false, heightPx: 760 }), false);
  assert.equal(J.compactFiche({ folded: false, heightPx: 900 }), false);
});

test('ficheSummary omet les parties absentes', () => {
  assert.equal(J.ficheSummary(full()), 'Centauri Carbon 2 · flexyring.stl · PLA');
  const partial = J.ficheSummary({ printer: printer });
  assert.equal(partial, 'Centauri Carbon 2');
  assert.ok(!/undefined|null/.test(J.ficheSummary(null)));
});

test('suggestionsFor : aucune pendant les choix, deux au plus ensuite, et chaque tiroir reste accessible', () => {
  for (const key of ['machine', 'filament', 'piece']) assert.deepEqual(J.suggestionsFor(key), [], key);
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

test('chatHello : l’accueil de « Poser une question » invite à poser une question, jamais à choisir son imprimante', () => {
  for (const ready of [true, false]) {
    const t = J.chatHello(ready);
    assert.ok(/question/i.test(t), 'parle de question');
    assert.ok(!/choisis d’abord|ton imprimante/i.test(t), 'ne reprend pas la consigne des étapes');
  }
  assert.match(J.chatHello(false), /Étapes/);
  assert.ok(!/Étapes/.test(J.chatHello(true)));
});

test('confirmation en un toucher : la machine et le filament proposés deviennent le bouton de la ligne d’action', () => {
  assert.deepEqual(J.primaryAction('machine', { proposal: { name: 'Centauri Carbon 2' } }), { label: 'Oui, sur Centauri Carbon 2', kind: 'confirmMachine', enabled: true });
  assert.deepEqual(J.primaryAction('filament', { proposal: { name: 'PLA' } }), { label: 'Oui, du PLA', kind: 'confirmFilament', enabled: true });
  assert.equal(J.primaryAction('machine', {}).kind, 'none');
  assert.equal(J.primaryAction('piece', { proposal: { name: 'x' } }).kind, 'none');
  assert.match(J.prompt('machine', { proposal: { name: 'Centauri Carbon 2' } }), /Imprimer sur Centauri Carbon 2 \?/);
  assert.match(J.prompt('filament', { proposal: { name: 'PLA' } }), /PLA, comme la dernière fois \?/);
  assert.match(J.prompt('filament', {}), /filament/i);
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

test('tabLabel : l’onglet Étapes porte la progression', () => {
  assert.equal(J.tabLabel({}), 'Étapes · 1/6');
  const ready = { printer: { preset: 'CC2' }, part: { name: 'bague' }, filament: { preset: 'PLA', temps_ok: true } };
  assert.equal(J.tabLabel(ready), 'Étapes · 4/6');
  assert.equal(J.tabLabel(Object.assign({ step: 'after' }, ready)), 'Étapes · 6/6');
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

test('la fiche se replie dès l’étape Préparer : l’étape en cours garde la place', () => {
  for (const step of ['machine', 'piece', 'filament']) assert.equal(J.compactFiche({ folded: false, heightPx: 900, step: step }), false, step);
  for (const step of ['preparer', 'imprimer', 'resultat']) assert.equal(J.compactFiche({ folded: false, heightPx: 900, step: step }), true, step);
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
  assert.equal(J.primaryAction('resultat', { plateEmpty: true }).kind, 'photo', 'à Résultat, le plateau peut être vidé');
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
  assert.equal(J.primaryAction('resultat', {}).kind, 'photo');
  assert.equal(J.primaryAction('resultat', { success: true }).kind, 'newPart');
  assert.ok(J.prompt('resultat', { success: true }).includes('réussi'));
});

test('suggestions : celles qui partent à l’IA le disent ; « changer » le filament n’offre pas de découper en même temps', () => {
  for (const key of ['imprimer', 'resultat']) for (const s of J.suggestionsFor(key)) if (s.kind === 'ask') assert.ok(/jauge/.test(s.label), s.label);
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
