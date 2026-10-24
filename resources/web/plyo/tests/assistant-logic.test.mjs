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

test('état des crédits', () => {
  assert.equal(L.creditState(48.7), 'ok');
  assert.equal(L.creditState(4.9), 'low');
  assert.equal(L.creditState(0.4), 'empty');
  assert.equal(L.creditState(null), 'ok');
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
    assert.ok(text && !/npm|plyo-api|vous|votre|Réessayez/.test(text), code + ' : ' + text);
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
