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
  assert.ok(!FULL_BUTTON.test(read('journey-steps.js')), 'journey-steps.js');
  assert.ok(!FULL_BUTTON.test(read('machines-view.js')), 'machines-view.js');
});

test('la visite guidée a disparu : plus de renderTour ni de carte de visite dans le panneau', () => {
  const page = read('index.html');
  assert.ok(!/function renderTour\b/.test(page), 'renderTour');
  assert.ok(!/id="tour-slot"[^>]*>\s*<\/div>\s*<div id="outcome-slot"/.test(page) || /renderSetupFlow/.test(page));
  assert.ok(/function renderSetupFlow\b/.test(page), 'renderSetupFlow');
  assert.ok(!/Passer la visite|Terminer la visite/.test(page), 'plus de « Passer la visite »');
});

test('le menu ne garde que l’essentiel', () => {
  const page = read('index.html');
  const menu = page.slice(page.indexOf('id="menu"'), page.indexOf('</div>\n  </div>', page.indexOf('id="menu"')));
  const ids = [...menu.matchAll(/id="(m-[a-z-]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids, ['m-account-sep', 'm-convs', 'm-email', 'm-help', 'm-level', 'm-login', 'm-logout', 'm-new', 'm-undo', 'm-usage']);
  for (const gone of ['m-check', 'm-parts', 'm-values', 'm-setup', 'm-limits', 'm-tour']) assert.ok(!page.includes("$('" + gone + "')"), gone + ' encore écouté');
});

test('la carte de vérification n’a pas de bouton plein : le bouton de l’étape est celui de la ligne d’action', () => {
  const page = read('index.html');
  const start = page.indexOf('function renderPreflight');
  const card = page.slice(start, page.indexOf('function onPreflight', start) > start ? page.indexOf('function onPreflight', start) : start + 9000);
  // Création d'un bouton plein (classe passée en argument) ; `classList.contains('btn')` n'en crée pas.
  assert.ok(!/,\s*['"]btn(?: sm)?['"]/.test(card), 'renderPreflight');
});

test('le champ de question est discret : une ligne, et plus de phrase d’avertissement sous lui', () => {
  const page = read('index.html');
  assert.ok(/<textarea id="note"[^>]*rows="1"/.test(page), 'rows="1"');
  assert.ok(!page.includes('class="disclaimer"'), 'avertissement retiré du composeur');
});

test('« Ma machine n’est pas dans la liste » est dans la ligne d’action fixe, plus dans la liste qui défile', () => {
  assert.ok(!read('project-card.js').includes('Ma machine n’est pas dans la liste'));
  assert.ok(read('journey-view.js').includes('extra'));
});

test('le panneau a deux onglets, et les messages d’étape vont dans le Guide', () => {
  const page = read('index.html');
  assert.ok(page.includes('id="tab-guide"') && page.includes('id="tab-chat"'), 'onglets');
  assert.ok(page.includes('id="view-guide"') && page.includes('id="view-chat"'), 'deux vues');
  assert.ok(page.includes('id="guide-notes"'), 'messages d’étape');
  assert.ok(/function noteLine\(text, tone, iconName, where\)/.test(page), 'noteLine accepte une destination');
  for (const text of ['Je pose « \' + file.name', 'Pas de risque détecté', 'Orca te demande de confirmer'])
    assert.ok(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*\'guide\'').test(page), text + ' dans le Guide');
});

test('la question de l’étape et ses choix sont dans la même carte, à l’intérieur du Guide', () => {
  const page = read('index.html');
  const guide = page.slice(page.indexOf('id="view-guide"'), page.indexOf('id="view-chat"'));
  assert.ok(guide.includes('id="journey-action"'), 'la ligne d’action est dans le Guide');
  assert.ok(guide.indexOf('id="journey-action"') < guide.indexOf('id="project-card"'), 'la question vient avant ses choix');
  const fixedZone = page.slice(page.indexOf('id="journey"'), page.indexOf('id="tabs"'));
  assert.ok(!fixedZone.includes('journey-action'), 'plus de ligne d’action dans la zone fixe, au-dessus des onglets');
  assert.ok(!/journey-fold|toggleFold/.test(read('journey-view.js') + page), 'plus de flèche de repli');
});

test('une machine qui ne répond pas : on peut revérifier, et on ne promet pas un envoi différé qui n’existe pas', () => {
  const steps = read('journey-steps.js');
  assert.ok(/Vérifier à nouveau/.test(steps), 'lien « Vérifier à nouveau »');
  assert.ok(!/partira|quand elle sera prête/.test(steps), 'pas de promesse d’envoi différé');
});
