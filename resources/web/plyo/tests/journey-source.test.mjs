// Règles de construction du panneau lues dans les sources : un seul bouton plein par étape, menu réduit.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
// Un bouton plein : classe « btn » ou « btn sm » sans « ghost » (les autres sont discrets).
const FULL_BUTTON = /['"]btn(?: sm)?['"]/;

function withoutFunction(source, name) {
  const start = source.indexOf('function ' + name);
  if (start < 0) return source;
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(0, start) + source.slice(i + 1);
}

test('le contenu des étapes n’a aucun bouton plein : seule la ligne d’action en a un', () => {
  assert.ok(!FULL_BUTTON.test(read('project-card.js')), 'project-card.js');
  assert.ok(!FULL_BUTTON.test(withoutFunction(read('journey-view.js'), 'renderActionLine')), 'journey-view.js hors renderActionLine');
  assert.ok(FULL_BUTTON.test(read('journey-view.js')), 'la ligne d’action porte le bouton plein');
});
