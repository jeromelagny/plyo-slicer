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

const NNBSP = '\u202F', NBSP = '\u00A0';
test('typographie française : espaces insécables avant ? ! ; : et dans « »', () => {
  assert.equal(L.fr('Ça a marché ?'), 'Ça a marché' + NNBSP + '?');
  assert.equal(L.fr('Super !'), 'Super' + NNBSP + '!');
  assert.equal(L.fr('Oui ; non'), 'Oui' + NNBSP + '; non');
  assert.equal(L.fr('Valeur : 0,8 mm'), 'Valeur' + NBSP + ': 0,8 mm');
  assert.equal(L.fr('« Tour »'), '«' + NBSP + 'Tour' + NBSP + '»');
  // Ponctuation collée (texte de l'IA) : l'espace manquante est ajoutée.
  assert.equal(L.fr('Prêt?'), 'Prêt' + NNBSP + '?');
  assert.equal(L.fr('Note: oui'), 'Note' + NBSP + ': oui');
  assert.equal(L.fr('«Tour»'), '«' + NBSP + 'Tour' + NBSP + '»');
});

test('typographie française : heures, adresses et doubles passages intacts', () => {
  assert.equal(L.fr('à 18:00'), 'à 18:00');
  assert.equal(L.fr('https://makerworld.com/a?b=1'), 'https://makerworld.com/a?b=1');
  assert.equal(L.fr(L.fr('Ça a marché ?')), L.fr('Ça a marché ?'));
  assert.equal(L.fr(''), '');
  assert.equal(L.fr(null), '');
  assert.equal(L.fr('Quoi ?!'), 'Quoi' + NNBSP + '?!');
});

test('typographie française : apostrophe droite remplacée par l’apostrophe typographique', () => {
  assert.equal(L.fr("l'ordinateur d'Orca"), 'l’ordinateur d’Orca');
  assert.equal(L.fr("aujourd'hui"), 'aujourd’hui');
});
