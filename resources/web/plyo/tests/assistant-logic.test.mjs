// Tests de la logique pure du panneau : node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');

test('titre d’une conversation : la première demande, raccourcie', () => {
  assert.equal(L.conversationTitle('Plein de fils entre les tours', 0, '2026-10-24'), 'Plein de fils entre les tours');
  assert.equal(L.conversationTitle('a'.repeat(80), 0, '2026-10-24'), 'a'.repeat(47) + '…');
  assert.equal(L.conversationTitle('', 2, '2026-10-24'), 'Photos du 24/10');
  assert.equal(L.conversationTitle('  ', 1, '2026-10-24'), 'Photo du 24/10');
  assert.equal(L.conversationTitle('', 0, '2026-10-24'), 'Conversation du 24/10');
});

test('réponses aux questions de l’IA envoyées ensemble', () => {
  const qs = [{ text: 'À quoi va servir la pièce ?' }, { text: 'Elle sera dehors ?' }];
  assert.equal(L.allAnswered(qs, { 0: 'Support mural' }), false);
  assert.equal(L.allAnswered(qs, { 0: 'Support mural', 1: 'Non' }), true);
  assert.equal(L.combineAnswers(qs, { 0: 'Support mural', 1: 'Non' }), 'À quoi va servir la pièce ? → Support mural\nElle sera dehors ? → Non');
});

test('jauge du mois : texte court, état et date de renouvellement', () => {
  const g = { plan: 'gratuit', used_pct: 35, resets_at: '2026-11-01T00:00:00.000Z', reserve: 0, state: 'ok' };
  assert.deepEqual(L.gaugeView(g), { pct: 35, label: '35 %', state: 'ok', plan: 'Gratuit', resets: 'le 1er novembre' });
  assert.equal(L.gaugeView({ ...g, used_pct: 84, state: 'low', plan: 'plus' }).plan, 'Plyo+');
  assert.equal(L.gaugeView({ ...g, resets_at: '2027-01-01T00:00:00.000Z' }).resets, 'le 1er janvier');
  assert.equal(L.gaugeView(null), null);
  assert.equal(L.gaugeView({ ...g, used_pct: 140 }).pct, 100);
  assert.equal(L.gaugeView({ ...g, state: 'bizarre' }).state, 'ok');
});

test('alerte douce de la jauge : une fois par mois, à partir de 80 %', () => {
  const g = { used_pct: 82, resets_at: '2026-11-01T00:00:00.000Z', state: 'low' };
  assert.equal(L.gaugeNotice(g, null), 'low');
  assert.equal(L.gaugeNotice(g, 'low:2026-11-01T00:00:00.000Z'), null);
  assert.equal(L.gaugeNotice({ ...g, used_pct: 40, state: 'ok' }, null), null);
  assert.equal(L.gaugeNotice({ ...g, used_pct: 100, state: 'empty' }, 'low:2026-11-01T00:00:00.000Z'), 'empty');
  assert.equal(L.noticeKey('low', g), 'low:2026-11-01T00:00:00.000Z');
});

test('erreurs : message clair et action suivante', () => {
  assert.deepEqual(L.errorView('insufficient_credits').action, 'credits');
  assert.deepEqual(L.errorView('upstream_error').action, 'retry');
  assert.deepEqual(L.errorView('network').action, 'retry');
  assert.deepEqual(L.errorView('timeout').action, 'retry');
  assert.deepEqual(L.errorView('unauthorized').action, 'login');
  assert.equal(L.errorView('quelque_chose').action, 'retry');
  for (const code of ['config_missing', 'assistant_unavailable', 'incomplete_answer', 'upstream_error', 'invalid_request', 'insufficient_credits', 'auth_unavailable', 'internal', 'network', 'timeout', 'unauthorized']) {
    const text = L.errorView(code).text;
    assert.ok(text && !/npm|plyo-api|vous|votre|Réessayez|crédit|token/.test(text), code + ' : ' + text);
  }
});

test('lecture d’un flux NDJSON par morceaux', () => {
  const reader = L.ndjsonReader();
  assert.deepEqual(reader.push('{"type":"partial","message":"A"}\n{"type":'), [{ type: 'partial', message: 'A' }]);
  assert.deepEqual(reader.push('"final","ok":1}\n'), [{ type: 'final', ok: 1 }]);
  assert.deepEqual(reader.push('pas du json\n'), []);
  assert.deepEqual(reader.end(), []);
});

test('le dernier morceau sans retour à la ligne est lu à la fin', () => {
  const reader = L.ndjsonReader();
  assert.deepEqual(reader.push('{"type":"final"}'), []);
  assert.deepEqual(reader.end(), [{ type: 'final' }]);
});

test('réponses groupées : jamais plus de 500 caractères (limite du service)', () => {
  const qs = [{ text: 'q'.repeat(300) }, { text: 'r'.repeat(300) }, { text: 's'.repeat(300) }];
  const text = L.combineAnswers(qs, { 0: 'a', 1: 'b', 2: 'c' });
  assert.ok(text.length <= 500, String(text.length));
  assert.match(text, /→ a/);
  assert.match(text, /→ b/);
  assert.match(text, /→ c/);
});

test('Entrée envoie, sauf avec Maj ou pendant une saisie composée', () => {
  assert.equal(L.isSendKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }), true);
  assert.equal(L.isSendKey({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 }), false);
  assert.equal(L.isSendKey({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 }), false);
  assert.equal(L.isSendKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 }), false);
  assert.equal(L.isSendKey({ key: 'a', shiftKey: false, isComposing: false, keyCode: 65 }), false);
});

// ---------- « Ça a marché ? » ----------
const pendingItem = {
  machine: 'Bambu Lab A1 0.4 nozzle | Bambu PLA Basic', at: '2026-10-25T10:00:00', date: '2026-10-25', why: 'Fils d’araignée',
  defect: 'stringing', conv: 'abc-123', changes: [{ id: 'retraction', before: 0.8, after: 1.2 }, { id: 'nozzle_temp', before: 220, after: 210 }]
};

test('outcomeDue : on demande au plus tôt 30 minutes après l’application', () => {
  assert.equal(L.outcomeDue(pendingItem, new Date('2026-10-25T10:20:00')), false);
  assert.equal(L.outcomeDue(pendingItem, new Date('2026-10-25T10:31:00')), true);
  assert.equal(L.outcomeDue(null, new Date()), false);
  assert.equal(L.outcomeDue({ ...pendingItem, at: 'abîmé' }, new Date()), false);
});

test('outcomeQuestion : rappelle le problème et les réglages changés, avec leurs libellés', () => {
  const label = (id) => ({ retraction: { label: 'Longueur de rétraction', unit: 'mm' }, nozzle_temp: { label: 'Température de buse', unit: '°C' } })[id];
  const q = L.outcomeQuestion(pendingItem, label);
  assert.equal(q.title, 'Ça a marché ?');
  assert.equal(q.text, 'Le 25/10, on a changé des réglages pour « Fils d’araignée ». Ta dernière impression avec ces réglages, ça a marché ?');
  assert.deepEqual(q.changes, ['Longueur de rétraction : 0,8 → 1,2 mm', 'Température de buse : 220 → 210 °C']);
});

test('outcomePayload : seulement le défaut, les changements, les profils et le résultat', () => {
  assert.deepEqual(L.outcomePayload(pendingItem, 'ok'), {
    defect: 'stringing', changes: pendingItem.changes, printer: 'Bambu Lab A1 0.4 nozzle', filament: 'Bambu PLA Basic', outcome: 'ok'
  });
  assert.equal(L.outcomePayload({ ...pendingItem, defect: '' }, 'ok').defect, 'unknown');
});

// ---------- Journal des pièces ----------
const ev = (o) => ({ at: '2026-10-20T10:00:00', conv: 'c1', parts: ['Support_casque.stl'], printer: 'A1', filament: 'PLA', problem: 'Fils', defect: 'stringing', changes: [], outcome: '', ...o });

test('journalGroups : une fiche par pièce, la plus récente d’abord, ses événements du plus récent au plus ancien', () => {
  const groups = L.journalGroups([
    ev({ at: '2026-10-20T10:00:00' }),
    ev({ at: '2026-10-22T10:00:00', parts: ['Boule.stl'], conv: 'c2' }),
    ev({ at: '2026-10-21T10:00:00', conv: 'c3', problem: 'Coin décollé' }),
  ]);
  assert.deepEqual(groups.map((g) => g.part), ['Boule.stl', 'Support_casque.stl']);
  assert.deepEqual(groups[1].events.map((e) => e.problem), ['Coin décollé', 'Fils']);
  assert.equal(groups[1].updated, '2026-10-21T10:00:00');
});

test('journalGroups : plusieurs pièces sur la plaque forment une seule fiche « A + B »', () => {
  const [g] = L.journalGroups([ev({ parts: ['A.stl', 'B.stl'] })]);
  assert.equal(g.part, 'A.stl + B.stl');
});

test('journalOutcome : libellé du résultat', () => {
  assert.equal(L.journalOutcome(ev({ changes: [{ id: 'retraction', before: 0.8, after: 1.2 }], outcome: 'ok' })), 'A marché');
  assert.equal(L.journalOutcome(ev({ changes: [{ id: 'x', before: 1, after: 2 }], outcome: 'bad' })), 'N’a pas réglé le problème');
  assert.equal(L.journalOutcome(ev({ changes: [{ id: 'x', before: 1, after: 2 }], outcome: 'pending' })), 'Résultat pas encore donné');
  assert.equal(L.journalOutcome(ev({ changes: [] })), 'Aucun réglage appliqué');
});

test('reapplyChanges : valeurs d’après, seulement sur la même imprimante et le même filament', () => {
  const e = ev({ changes: [{ id: 'retraction', before: 0.8, after: 1.2 }], outcome: 'ok' });
  assert.deepEqual(L.reapplyChanges(e, { printer: 'A1', filament: 'PLA' }), [{ id: 'retraction', value: 1.2 }]);
  assert.equal(L.reapplyChanges(e, { printer: 'X1C', filament: 'PLA' }), null);
  assert.equal(L.reapplyChanges(ev({}), { printer: 'A1', filament: 'PLA' }), null);
});

test('reapplyChanges : jamais pour des réglages qui n’ont pas réglé le problème', () => {
  const e = ev({ changes: [{ id: 'retraction', before: 0.8, after: 1.2 }], outcome: 'bad' });
  assert.equal(L.reapplyChanges(e, { printer: 'A1', filament: 'PLA' }), null);
});

// ---------- Corrections de la relecture ----------
test('firstDueOutcome : la plus récente des entrées en attente qui est due, pas seulement la toute dernière', () => {
  const now = new Date('2026-10-25T12:00:00');
  const fresh = { ...pendingItem, at: '2026-10-25T11:50:00' };
  const old = { ...pendingItem, at: '2026-10-24T09:00:00' };
  assert.equal(L.firstDueOutcome([fresh, old], now), old);
  assert.equal(L.firstDueOutcome([fresh], now), null);
  assert.equal(L.firstDueOutcome(null, now), null);
});

test('newSlice : un nouveau découpage se reconnaît à son résultat, même sans passage par « non découpé »', () => {
  let r = L.newSlice(null, { sliced: true, time_s: 100, weight_g: 5, objects: 1 });
  assert.equal(r.fire, false); // premier signal : simple point de départ
  r = L.newSlice(r.sig, { sliced: true, time_s: 100, weight_g: 5, objects: 1 });
  assert.equal(r.fire, false);
  r = L.newSlice(r.sig, { sliced: true, time_s: 140, weight_g: 6, objects: 1 });
  assert.equal(r.fire, true);
  r = L.newSlice(r.sig, { sliced: false, time_s: 0, weight_g: 0, objects: 1 });
  assert.equal(r.fire, false);
  r = L.newSlice(r.sig, { sliced: true, time_s: 140, weight_g: 6, objects: 1 });
  assert.equal(r.fire, true); // re-découpé après une modification
});

test('outcomePayload : imprimante et filament séparés quand le slicer les donne', () => {
  const p = L.outcomePayload({ ...pendingItem, machine: 'A | B | C', printer: 'A | B', filament: 'C' }, 'bad');
  assert.equal(p.printer, 'A | B');
  assert.equal(p.filament, 'C');
});

test('outcomePayload : le mot de l’utilisateur ne part jamais dans le partage anonyme', () => {
  const p = L.outcomePayload({ ...pendingItem, note: 'mon garage est froid' }, 'bad');
  assert.equal(JSON.stringify(p).includes('garage'), false);
  assert.equal('note' in p, false);
});

test('commandTool : l’outil d’Orca qui fait la même chose que le premier ordre', () => {
  assert.equal(L.commandTool([{ op: 'rotate' }, { op: 'center' }]), 'rotate');
  assert.equal(L.commandTool([{ op: 'lay_flat' }]), 'lay_flat');
  assert.equal(L.commandTool([{ op: 'scale_to_size' }]), 'scale');
  assert.equal(L.commandTool([{ op: 'cut_height' }]), 'cut');
  assert.equal(L.commandTool([{ op: 'set_copies' }]), null);
  assert.equal(L.commandTool([]), null);
});

test('commandsForHistory : l’IA sait ce qui a été fait, ou que rien n’a pu l’être', () => {
  const a = { commands: [{ summary: 'J’ai penché la pièce de 20°.' }, { summary: 'J’ai centré la pièce.' }] };
  assert.equal(L.commandsForHistory(a, { done: ['J’ai penché la pièce de 20°.'], text: 'Cette pièce n’est plus sur le plateau.' }),
    'fait : J’ai penché la pièce de 20°.\nnon fait : Cette pièce n’est plus sur le plateau.');
  assert.equal(L.commandsForHistory({ commands: [] }, null), '');
  assert.equal(L.commandsForHistory(a, null), 'demandé : J’ai penché la pièce de 20°. J’ai centré la pièce.');
});
