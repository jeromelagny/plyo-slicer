// Dictée vocale : le bouton micro lance la dictée du système ; Plyo n'ouvre pas le micro lui-même.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('aide si la dictée ne démarre pas : comment la lancer soi-même, selon le système', () => {
  assert.match(L.dictationFailText('mac'), /Réglages Système › Clavier › Dictée/);
  assert.match(L.dictationFailText('mac'), /deux fois sur la touche Fn/);
  assert.match(L.dictationFailText('windows'), /touches Windows et H/);
  assert.match(L.dictationFailText('other'), /écris ta demande au clavier/);
  assert.equal(L.dictationFailText(undefined), L.dictationFailText('other'));
});

test('pendant la dictée : dire où le texte arrive et comment arrêter', () => {
  assert.match(L.DICTATION_LISTENING, /ton texte s’écrit ici/);
  assert.match(L.DICTATION_LISTENING, /Clique à nouveau sur le micro pour arrêter/);
});

test('un appui lance la dictée, un second l’arrête : le libellé du bouton le dit', () => {
  assert.equal(L.dictationLabel(false), 'Dicter ta demande à la voix');
  assert.equal(L.dictationLabel(true), 'Arrêter la dictée');
  assert.equal(L.DICTATION_SILENCE_MS, 30000);
});

test('le second appui demande l’arrêt au slicer, sans retirer le curseur du champ', () => {
  const page = read('../index.html');
  assert.match(page, /type: 'dictation_stop'/);
  assert.match(page, /\$\('btn-mic'\)\.addEventListener\('mousedown', function \(e\) \{ e\.preventDefault\(\); \}\)/);
  assert.match(page, /noteInput\.addEventListener\('blur', stopDictation\)/);
});

test('le bouton micro est caché tant que le slicer n’a pas dit que le système sait dicter', () => {
  const page = read('../index.html');
  const button = page.match(/<button[^>]*id="btn-mic"[^>]*>/);
  assert.ok(button, 'bouton micro présent dans le champ de saisie');
  assert.match(button[0], /class="icon-btn hidden"/);
  assert.ok(button[0].includes(L.DICTATION_LABEL), 'libellé du bouton');
});

test('le panneau n’ouvre jamais le micro lui-même : aucune capture ni reconnaissance vocale dans la page', () => {
  const page = read('../index.html');
  for (const api of ['getUserMedia', 'MediaRecorder', 'SpeechRecognition']) assert.equal(page.includes(api), false, api);
});
