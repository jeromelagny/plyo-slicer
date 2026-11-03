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
  assert.deepEqual(ids, ['m-account-sep', 'm-convs', 'm-email', 'm-help', 'm-intent', 'm-level', 'm-login', 'm-logout', 'm-new', 'm-undo', 'm-usage']);
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

test('la barre des étapes est seulement dans l’onglet Étapes, la fiche reste au-dessus des deux onglets', () => {
  const page = read('index.html');
  const guide = page.slice(page.indexOf('id="view-guide"'), page.indexOf('id="view-chat"'));
  const fixedZone = page.slice(page.indexOf('id="journey"'), page.indexOf('id="tabs"'));
  assert.ok(guide.includes('id="journey-bar"'), 'la barre est dans l’onglet Étapes');
  assert.ok(guide.indexOf('id="journey-bar"') < guide.indexOf('class="step-card"'), 'la barre vient avant la carte de l’étape');
  assert.ok(!fixedZone.includes('journey-bar'), 'plus de barre au-dessus des onglets');
  assert.ok(fixedZone.includes('id="journey-fiche"'), 'la fiche reste au-dessus des onglets');
  assert.ok(page.includes('PlyoJourney.tabLabel('), 'le nom de l’onglet porte la progression');
});

test('une machine qui ne répond pas : on peut revérifier, et on ne promet pas un envoi différé qui n’existe pas', () => {
  const steps = read('journey-steps.js');
  assert.ok(/Vérifier à nouveau/.test(steps), 'lien « Vérifier à nouveau »');
  assert.ok(!/partira|quand elle sera prête/.test(steps), 'pas de promesse d’envoi différé');
});

test('« Passer outre » et « Je règle moi-même » sont deux gestes distincts', () => {
  const page = read('index.html');
  const start = page.indexOf('var stepHandlers = {');
  const block = page.slice(start, page.indexOf('\n  };', start));
  assert.equal((block.match(/\bskip:/g) || []).length, 1, 'une seule clé skip');
  assert.ok(/intentSkip:/.test(block), 'intentSkip existe');
  assert.ok(/h\.intentSkip/.test(read('journey-steps.js')), 'renderIntent appelle intentSkip');
});

test('Canvas : vues sans bouton plein, fichiers inclus, rappel et relance à l’étape Imprimer', () => {
  assert.ok(!FULL_BUTTON.test(read('canvas-view.js')), 'canvas-view.js : l’action principale est dans la ligne d’action');
  const page = read('index.html');
  assert.ok(page.includes('<!--plyo-include:canvas-logic.js-->') && page.includes('<!--plyo-include:canvas-view.js-->'));
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoAssistant.cpp', import.meta.url), 'utf8');
  assert.ok(cpp.includes('"canvas-logic.js", "canvas-view.js"'), 'chargés par PlyoAssistant.cpp');
  const steps = read('journey-steps.js');
  assert.ok(steps.includes('Changer les emplacements') && steps.includes('Démarrer sans carte'));
  // L'envoi relit les emplacements avant de partir quand le projet en a.
  assert.ok(/kind === 'send'[\s\S]{0,200}sendWithCanvasCheck\(\)/.test(page));
});

test('Canvas : lectures numérotées, plan envoyé au premier affichage, refus oublié au prochain envoi', () => {
  const page = read('index.html');
  assert.ok(/planKey: null/.test(page), 'le premier affichage envoie le plan (ou l’efface) : rien ne reste d’un panneau rechargé');
  assert.ok(/msg\.id !== canvasUI\.readId/.test(page), 'une réponse ancienne est ignorée');
  assert.ok(/readId: 0/.test(page));
  assert.ok(/kind === 'send'[\s\S]{0,120}canvasUI\.refused = ''/.test(page), 'un nouvel envoi oublie le refus précédent');
  assert.ok(/type: e\.type, preset: e\.preset/.test(page), 'le plan porte le type et le profil de chaque couleur');
});

test('les températures de la bobine se saisissent là où le texte le dit', () => {
  const card = read('project-card.js');
  assert.ok(!card.includes('Change-les dans la fiche'), 'plus de renvoi vers des champs masqués aux débutants');
  assert.ok(card.includes('Ma bobine indique d’autres températures') && card.includes('renderSpoolEditor'), 'lien et formulaire de la plage');
  const page = read('index.html');
  assert.ok(page.includes('id="spool-slot"') && page.includes('setSpoolRange:'), 'formulaire branché dans le corps du Guide');
  assert.ok(!/visite guidée|« Explique-moi »/.test(page), 'aucun texte ne cite un élément supprimé');
});
