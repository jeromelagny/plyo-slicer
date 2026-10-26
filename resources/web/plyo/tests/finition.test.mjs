// Tests de la finition du panneau (lot 3) : node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');

test('conversation rouverte : l’erreur seulement quand elle manque, jamais après une réouverture réussie', () => {
  const ok = { type: 'conv_loaded', id: 'a', conversation: { entries: [] } };
  const missing = { type: 'conv_loaded', id: 'a', conversation: null };
  assert.deepEqual(L.convLoaded(ok, false, false), { restore: true, followUp: false, error: false });
  assert.deepEqual(L.convLoaded(ok, true, false), { restore: true, followUp: true, error: false });
  assert.deepEqual(L.convLoaded(missing, true, false), { restore: false, followUp: false, error: true });
  assert.deepEqual(L.convLoaded(missing, false, false), { restore: false, followUp: false, error: true });
  // Réouverture automatique au lancement : un échec reste silencieux (l'accueil s'affiche).
  assert.deepEqual(L.convLoaded(missing, false, true), { restore: false, followUp: false, error: false });
});
