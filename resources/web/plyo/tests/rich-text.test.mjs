// Tests du texte enrichi des réponses : node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseRich } = require('../rich-text.js');

test('paragraphes séparés par une ligne vide', () => {
  assert.deepEqual(parseRich('Bonjour.\n\nDeuxième.'), [
    { type: 'p', lines: [[{ t: 'text', v: 'Bonjour.' }]] },
    { type: 'p', lines: [[{ t: 'text', v: 'Deuxième.' }]] },
  ]);
});

test('retour à la ligne simple gardé dans le paragraphe', () => {
  assert.deepEqual(parseRich('a\nb'), [{ type: 'p', lines: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] }]);
});

test('liste à puces et étapes numérotées', () => {
  const blocks = parseRich('Fais ceci :\n1. Chauffe la buse\n2. Retire le filament\n\n- PLA\n- PETG');
  assert.equal(blocks[0].type, 'p');
  assert.deepEqual(blocks[1], { type: 'ol', items: [[{ t: 'text', v: 'Chauffe la buse' }], [{ t: 'text', v: 'Retire le filament' }]] });
  assert.deepEqual(blocks[2], { type: 'ul', items: [[{ t: 'text', v: 'PLA' }], [{ t: 'text', v: 'PETG' }]] });
});

test('gras et libellés de l’interface', () => {
  assert.deepEqual(parseRich('Clique sur `Découper la plaque`, **puis attends**.'), [
    { type: 'p', lines: [[
      { t: 'text', v: 'Clique sur ' }, { t: 'ui', v: 'Découper la plaque' }, { t: 'text', v: ', ' }, { t: 'bold', v: 'puis attends' }, { t: 'text', v: '.' },
    ]] },
  ]);
});

test('le HTML reste du texte', () => {
  assert.deepEqual(parseRich('<img src=x onerror=alert(1)> **<b>**'), [
    { type: 'p', lines: [[{ t: 'text', v: '<img src=x onerror=alert(1)> ' }, { t: 'bold', v: '<b>' }]] },
  ]);
});

test('marqueurs non fermés laissés tels quels', () => {
  assert.deepEqual(parseRich('un **seul et `un'), [{ type: 'p', lines: [[{ t: 'text', v: 'un **seul et `un' }]] }]);
});

test('texte vide', () => {
  assert.deepEqual(parseRich(''), []);
  assert.deepEqual(parseRich(null), []);
});
