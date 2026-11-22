// Refonte du parcours débutant (brief du 22/11) : environ 5 décisions avant la première impression au lieu de 20.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.PlyoProject = require('../project-logic.js');
globalThis.PlyoJourney = require('../journey-logic.js');
globalThis.PlyoSpools = require('../spools-logic.js');
const J = globalThis.PlyoJourney, S = globalThis.PlyoSpools, Card = require('../project-card.js');
const here = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(here + f, 'utf8');

// Un DOM minimal pour les rendus.
function fakeUi() {
  const make = (tag, className, text) => {
    const node = { tag, className: className || '', children: [], attrs: {}, on: {}, dataset: {}, style: {},
      appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.unshift(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(t, f) { this.on[t] = f; }, contains() { return false; } };
    Object.defineProperty(node, 'childNodes', { get() { return this.children; } });
    Object.defineProperty(node, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.children = []; } });
    node.textContent = text || '';
    return node;
  };
  return { el: make, icon: () => make('svg'), button: (label, onClick, className) => { const b = make('button', className, label); b.on.click = onClick; return b; } };
}
const all = (n) => [n, ...n.children.flatMap(all)];
const buttons = (n) => all(n).filter((x) => x.tag === 'button');
const labels = (n) => buttons(n).map((b) => b.textContent);
const textOf = (n) => (n.textContent || '') + n.children.map(textOf).join('');

// ---------- Lot 2 : bobine en un clic ----------

test('lot 2 · nom automatique : la matière et le jour, sans « / », unique parmi les bobines de la machine', () => {
  assert.equal(S.autoName('PLA', '22 novembre', []), 'PLA du 22 novembre');
  assert.equal(S.autoName('PLA', '22 novembre', ['PLA du 22 novembre', 'Sunlu PLA']), 'PLA du 22 novembre (2)');
  assert.equal(S.autoName('PLA', '22 novembre', ['pla du 22 novembre', 'PLA du 22 novembre (2)']), 'PLA du 22 novembre (3)');
  assert.equal(S.autoName('PETG', '1er décembre', null), 'PETG du 1er décembre');
  assert.equal(S.nameError(S.autoName('PLA', '', [])), '', 'même sans date, un nom accepté par le slicer');
  assert.doesNotMatch(S.autoName('PLA', '22 novembre', []), /\//);
});

test('lot 2 · « Oui, du PLA » est le bouton plein de l’étape Filament, aussi en « changer » le filament', () => {
  assert.deepEqual(J.primaryAction('filament', { quickSpool: 'PLA' }), { label: 'Oui, du PLA', kind: 'quickSpool', enabled: true });
  assert.equal(J.primaryAction('preparer', { quickSpool: 'PLA', editing: true }).kind, 'quickSpool');
  assert.equal(J.prompt('filament', { quickSpool: 'PLA' }), 'Ta bobine est en PLA ?');
  // Bobine déjà connue sur cette machine : inchangé.
  assert.equal(J.primaryAction('filament', { proposal: { name: 'Sunlu PLA+ noir' } }).label, 'Oui, Sunlu PLA+ noir');
  assert.equal(J.prompt('filament', { proposal: { name: 'Sunlu PLA+ noir' } }), 'Sunlu PLA+ noir, comme la dernière fois ?');
  // Le plateau passe d'abord (débutant), les emplacements et les températures gardent leur action.
  assert.equal(J.primaryAction('filament', { bedFirst: true }).kind, 'none');
  assert.equal(J.primaryAction('filament', { temps: { nozzle: 220, bed: 60 } }).kind, 'keepTemps');
});

const PROJECT = { printer: { preset: 'Ma K1C', name: 'K1C' }, part: { name: 'bateau.stl' }, filament: null };
function renderFilament(extra) {
  const slot = fakeUi().el('div'), calls = [];
  const handlers = new Proxy({}, { get: (_, k) => (...a) => calls.push([k, ...a]) });
  Card.renderChoices(slot, fakeUi(), Object.assign({ project: PROJECT, spools: [], newSpool: { open: false }, quickSpool: true, beginner: true, handlers }, extra));
  return { slot, calls };
}

test('lot 2 · nouvelle bobine : PETG et « Autres matières » en secondaire, marque, nom et températures derrière « Préciser »', () => {
  const { slot, calls } = renderFilament();
  assert.deepEqual(labels(slot), ['PETG', 'Autres matières', 'Préciser ma bobine (marque, nom, températures)']);
  assert.ok(!all(slot).some((n) => n.tag === 'input'), 'pas de champ du nom');
  assert.doesNotMatch(textOf(slot), /De quelle marque/);
  assert.match(textOf(slot), /C’est presque toujours du PLA/);
  buttons(slot).find((b) => b.textContent === 'PETG').on.click();
  assert.deepEqual(calls.pop(), ['quickSpool', 'PETG'], 'une autre matière se choisit aussi d’un clic');
  // « Autres matières » : ABS, ASA, TPU s'ajoutent, toujours d'un clic.
  const more = renderFilament({ newSpool: { open: false, allMaterials: true } });
  assert.deepEqual(labels(more.slot), ['PETG', 'ABS', 'ASA', 'TPU', 'Préciser ma bobine (marque, nom, températures)']);
});

test('lot 2 · « Préciser ma bobine » rouvre le parcours détaillé (matière, marque, puis nom)', () => {
  const { slot } = renderFilament({ quickSpool: false, newSpool: { open: true, precise: true, material: 'PLA', brands: [], picker: {} } });
  assert.match(textOf(slot), /✓ Matière : PLA/);
  assert.match(textOf(slot), /De quelle marque est ta bobine \?/);
  assert.ok(labels(slot).includes('Je ne sais pas'));
  const page = read('index.html');
  assert.match(page, /preciseSpool: function \(\) \{ projectUI\.newSpool\.precise = true; projectHandlers\.pickMaterial\('PLA'\); \}/);
});

test('lot 2 · bobines connues : la liste d’abord, la nouvelle bobine se choisit d’un clic une fois ouverte', () => {
  const rows = S.choiceRows([{ id: 'a', name: 'Sunlu PLA+ noir', material: 'PLA', last_ok_at: '2026-11-10' }]);
  const closed = renderFilament({ spools: rows });
  assert.deepEqual(labels(closed.slot), ['Sunlu PLA+ noir · ✓ réussie le 10/11', 'Une nouvelle bobine']);
  const open = renderFilament({ spools: rows, newSpool: { open: true } });
  assert.ok(labels(open.slot).includes('PETG') && labels(open.slot).includes('Annuler'));
});

test('lot 2 · page : nom du jour, températures du profil gardées sans question, condition de la ligne d’action', () => {
  const page = read('index.html');
  assert.match(page, /chooseSpool\(PlyoSpools\.autoName\(material, dayOf\(new Date\(\)\.toISOString\(\)\), rows\.map/);
  assert.match(page, /if \(!pend\.fresh \|\| pend\.quick\) conv\.project\.filament\.temps_ok = true;/);
  assert.match(page, /quick: !!pend\.quick \};/);
  assert.match(page, /else if \(kind === 'quickSpool'\) projectHandlers\.quickSpool\(journeyCtx\(\)\.quickSpool\);/);
  const fn = page.slice(page.indexOf('function quickSpoolMaterial'), page.indexOf('function quickSpoolMaterial') + 900);
  for (const cond of ['ns.precise', 'ctx.canvas', 'ctx.temps', 'ctx.bedFirst', 'pr.proposed', '!projectUI.showKinds', 'ns.open || !PlyoSpools.choiceRows(items).length'])
    assert.ok(fn.includes(cond), cond);
});

// ---------- Lot 3 : étape Machine, le cas normal d'abord ----------

const K1 = { preset: 'Ma K1C', name: 'Ma K1C', linked: true }, K2 = { preset: 'Ma K2', name: 'Ma K2', linked: true };
const USB = (n) => ({ preset: 'Ender ' + n, name: 'Ender ' + n, linked: false });

test('lot 3 · cartes : machines reliées puis clé USB, au-delà de trois sans liaison repliées', () => {
  assert.deepEqual(J.machineCards([K1, USB(1)], false).cards.map((c) => c.label), ['K1C', 'Ender 1']);
  const many = J.machineCards([K1, USB(1), USB(2), USB(3), USB(4)], false);
  assert.deepEqual([many.cards.length, many.folded], [1, 4]);
  assert.equal(J.machineCards([K1, USB(1), USB(2), USB(3), USB(4)], true).cards.length, 5);
  assert.equal(J.machineStatus({ linked: true }, true), '● connectée');
  assert.equal(J.machineStatus({ linked: true }, undefined), 'reliée');
  assert.equal(J.machineStatus({ linked: false }, true), 'clé USB');
});

test('lot 3 · une seule machine : « Imprimer sur … ? » et « Oui, c’est elle » ; aucune : « Ajouter mon imprimante » en plein', () => {
  assert.equal(J.prompt('machine', { onlyMachine: { name: 'K1C' } }), 'Imprimer sur K1C ?');
  assert.deepEqual(J.primaryAction('machine', { onlyMachine: { name: 'K1C' } }), { label: 'Oui, c’est elle', kind: 'pickOnly', enabled: true });
  assert.equal(J.prompt('machine', { noMachine: true }), 'Ajoute ton imprimante');
  assert.deepEqual(J.primaryAction('machine', { noMachine: true }), { label: 'Ajouter mon imprimante', kind: 'setupPrinter', enabled: true });
  assert.equal(J.primaryAction('machine', {}).kind, 'none', 'plusieurs machines : on clique sur sa carte');
  assert.equal(J.primaryAction('machine', { proposal: { name: 'K1C' } }).label, 'Oui, sur K1C', 'machine proposée : inchangé');
});

function renderMachine(printers, extra) {
  const slot = fakeUi().el('div'), calls = [];
  const handlers = new Proxy({}, { get: (_, k) => (...a) => calls.push([k, ...a]) });
  Card.renderChoices(slot, fakeUi(), Object.assign({ project: { printer: null, part: { name: 'a.stl' }, filament: null }, printers, reachable: { 'Ma K1C': true }, handlers }, extra));
  return { slot, calls };
}

test('lot 3 · liste : les cartes d’abord (nom, état), « Ajouter mon imprimante » dessous ; liste vide sans renvoi « au-dessus »', () => {
  const { slot, calls } = renderMachine([K1, K2, USB(1)]);
  const cards = buttons(slot).filter((b) => b.className === 'machine-card');
  assert.deepEqual(cards.map(textOf), ['K1C● connectée', 'K2reliée', 'Ender 1clé USB']);
  assert.equal(labels(slot).at(-1), 'Ajouter mon imprimante');
  cards[1].on.click();
  assert.deepEqual(calls.pop(), ['pickPrinter', 'Ma K2', 'K2']);
  const empty = renderMachine([]);
  assert.deepEqual(labels(empty.slot), [], 'le bouton plein est dans la ligne d’action');
  assert.match(textOf(empty.slot), /Ajoute la tienne : je la cherche sur ton Wi-Fi/);
  assert.doesNotMatch(textOf(empty.slot), /au-dessus/);
});

test('lot 3 · débutant : buse 0,4 mm et plateau du profil sans question, « changer » dans la fiche ; confirmé inchangé', () => {
  const M = require('../machines-logic.js');
  assert.equal(M.noviceNozzle(['0.2', '0.4', '0.6']), '0.4');
  assert.equal(M.noviceNozzle([0.4, 0.6]), '0.4');
  assert.equal(M.noviceNozzle(['0.6', '0.8']), '', 'sans 0,4 mm, la question reste');
  const page = read('index.html');
  assert.match(page, /var novice = fsState\.level !== 'expert' && !choice\.auto \? PlyoMachines\.noviceNozzle\(match\.nozzles\) : '';/);
  assert.match(page, /else if \(novice\) installModel\(novice\);\s*else setupPhase\('nozzle'\);/);
  assert.match(page, /if \(fsState\.level !== 'expert' && !bedUI\.editing\) return null;/);
  // La fiche garde le plateau avec « changer » (bedUI.editing rouvre la question) et « Changer de buse ».
  assert.match(page, /changeBed: function \(\) \{ bedUI\.editing = true;/);
  assert.match(read('project-card.js'), /ui\.button\('Changer de buse', h\.changeNozzle, 'link'\)/);
});

// ---------- Lot 4 : une seule question avant la découpe ----------

const I = require('../intent-logic.js');
globalThis.PlyoIntent = I;
const Steps = require('../journey-steps.js');

test('lot 4 · débutant : l’usage seul, préférence et vitesse à leur valeur sûre', () => {
  assert.deepEqual(I.noviceAnswers({ use: 'daily' }), { use: 'daily', pref: 'balanced', speed: 'normal' });
  assert.deepEqual(I.noviceAnswers({ use: 'deco' }), { use: 'deco', pref: 'all', speed: 'normal' });
  assert.deepEqual(I.noviceAnswers({ use: 'strong' }), { use: 'strong', pref: 'heavy', speed: 'normal' });
  assert.deepEqual(I.noviceAnswers({ use: 'flex' }), { use: 'flex', pref: 'balanced', speed: 'normal' });
  assert.deepEqual(I.noviceAnswers({ use: 'test' }), { use: 'test' });
  assert.deepEqual(I.noviceAnswers({ use: 'daily', pref: 'sturdy', speed: 'fine' }), { use: 'daily', pref: 'sturdy', speed: 'fine' }, 'une réponse donnée reste');
  for (const use of ['deco', 'daily', 'strong', 'flex', 'test']) assert.equal(I.nextQuestion(I.noviceAnswers({ use })), null, use + ' : plus de question');
  assert.equal(I.doneText({ use: 'daily', pref: 'balanced', speed: 'normal' }), 'Réglages choisis pour un objet du quotidien, équilibrée, sans te presser.');
  assert.equal(I.doneText({ use: 'test' }), 'Réglages choisis pour un test rapide.');
});

test('lot 4 · ligne d’action : « Une question sur ta pièce », puis l’attente pendant que la réponse s’applique', () => {
  assert.equal(J.prompt('preparer', { intent: 'asking', intentOne: true }), 'Une question sur ta pièce');
  assert.equal(J.prompt('preparer', { intent: 'asking' }), 'Quelques questions sur ta pièce', 'confirmé, ou après « Ajuster »');
  assert.equal(J.prompt('preparer', { intent: 'auto' }), 'Je prépare ta pièce…');
  assert.deepEqual(J.primaryAction('preparer', { intent: 'auto' }), { label: 'Je prépare ta pièce…', kind: 'applyIntent', enabled: false });
  assert.equal(J.primaryAction('preparer', { intent: 'ready' }).label, 'Appliquer et préparer', 'confirmé : inchangé');
});

test('lot 4 · rendu : pas de compteur pour une seule question ; résumé sans bouton pendant l’application ; « Ajuster » après coup', () => {
  const ui = fakeUi(), h = new Proxy({}, { get: () => () => {} });
  const one = ui.el('div');
  Steps.render(one, ui, { step: 'preparer', ctx: {}, intent: { mode: 'asking', question: I.QUESTIONS.use, answers: {}, total: 1, guess: 'daily' }, handlers: h });
  assert.doesNotMatch(textOf(one), /Question 1 sur/);
  assert.match(textOf(one), /Ta réponse me sert à choisir/);
  assert.ok(labels(one).includes('Je ne sais pas'), '« Je ne sais pas » reste');
  const three = ui.el('div');
  Steps.render(three, ui, { step: 'preparer', ctx: {}, intent: { mode: 'asking', question: I.QUESTIONS.use, answers: {}, total: 3 }, handlers: h });
  assert.match(textOf(three), /Question 1 sur 3/);
  const auto = ui.el('div');
  Steps.render(auto, ui, { step: 'preparer', ctx: {}, intent: { mode: 'auto', summary: I.summary({ use: 'daily', pref: 'balanced', speed: 'normal' }, 'PLA'), changes: [], kept: [] }, handlers: h });
  assert.match(textOf(auto), /Pour un objet du quotidien/);
  assert.deepEqual(labels(auto), [], 'rien à cliquer : la découpe suit');
  const after = ui.el('div');
  let adjusted = 0;
  Steps.render(after, ui, { step: 'imprimer', ctx: { sliced: true, linked: true }, intentDone: 'Réglages choisis pour un test rapide.', handlers: Object.assign({}, { adjustIntent: () => adjusted++, exportFile() {}, started() {} }) });
  assert.match(textOf(after), /Réglages choisis pour un test rapide\./);
  buttons(after).find((b) => b.textContent === 'Ajuster').on.click();
  assert.equal(adjusted, 1);
});

test('lot 4 · page : la réponse du débutant applique et découpe ; « Ajuster » garde l’usage ; confirmé inchangé', () => {
  const page = read('index.html');
  assert.match(page, /if \(!p\.intent\.adjust\) Object\.assign\(p\.intent, PlyoIntent\.noviceAnswers\(intentAnswers\(p\)\)\);/);
  assert.match(page, /if \(!PlyoIntent\.nextQuestion\(intentAnswers\(p\)\)\) applyIntent\(false\);/);
  assert.match(page, /var one = noviceIntent\(\) && !i\.adjust;/);
  assert.match(page, /mode: noviceIntent\(\) && intentUI\.applying \? 'auto' : 'ready'/);
  assert.match(page, /st\.mode !== 'ready' && st\.mode !== 'auto'/);
  assert.match(page, /else p\.intent = \{ use: use, adjust: true, reask: !!\(tourSignals && tourSignals\.sliced\) \};/);
  assert.match(page, /delete p\.intent\.adjust;/);
  // Le confirmé garde « Comme la dernière fois » et ses trois questions.
  assert.match(page, /PlyoIntent\.offersRepeat\(fsState\.level, habits\.last_intent, answers\)/);
  assert.equal(I.offersRepeat('beginner', { use: 'daily', pref: 'balanced', speed: 'normal' }, {}), false);
});

// ---------- Lot 5 : un seul fil au lieu de deux onglets ----------

test('lot 5 · un seul fil : l’étape, ses retours en tête de carte, puis les échanges ; pas de doublon de la pièce posée', () => {
  const page = read('index.html');
  const card = page.slice(page.indexOf('<section class="step-card">'), page.indexOf('</section>', page.indexOf('<section class="step-card">')));
  assert.ok(card.indexOf('id="step-recap"') >= 0 && card.indexOf('id="step-recap"') < card.indexOf('id="journey-action"'), 'récapitulatif en tête de la carte');
  assert.ok(page.indexOf('id="guide-notes"') < page.indexOf('id="preflight-slot"'), 'les retours de l’étape juste sous sa carte');
  assert.match(page, /if \(journeyUI\.lastStep && order\.indexOf\(step\) > order\.indexOf\(journeyUI\.lastStep\)\) \{ journeyUI\.leftStep = journeyUI\.lastStep; setTimeout/);
  assert.match(page, /\$\('step-recap'\)\.appendChild\(node\);/);
  assert.match(page, /var inStep = msg\.fits !== false && firstPose && !FS\.modelAddedText\(msg\)\.warn;\s*if \(!inStep\) renderModel\(entry, false\);/);
  // applyTab ne cache plus rien : il fait seulement défiler vers ce qu'on regarde.
  const fn = page.slice(page.indexOf('function applyTab'), page.indexOf('var answerBox'));
  assert.doesNotMatch(fn, /classList\.toggle\('hidden'/);
  assert.match(fn, /viewUI\.unread = false;/);
});

// ---------- Lot 6 : parcours en 3 étapes, la pièce d'abord ----------

test('lot 6 · projets enregistrés avec l’ancien ordre : rouverts à la bonne étape', () => {
  const printer = { preset: 'Ma K1C', name: 'K1C' }, part = { name: 'a.stl' };
  const filament = { type: 'PLA', preset: 'Generic PLA', temps_ok: true, spool: { id: 's1', name: 'Sunlu PLA' } };
  const bar = (p) => J.steps(p).find((s) => s.state === 'current').key;
  // Ancien format : machine choisie, pas encore de pièce (l'ancienne étape 2) → étape 1, la pièce.
  assert.equal(J.currentStep({ printer, part: null, filament: null }), 'piece');
  assert.equal(bar({ printer, part: null, filament: null }), 'piece');
  // Machine et pièce, pas de bobine → étape 2.
  assert.equal(J.currentStep({ printer, part, filament: null }), 'filament');
  assert.equal(bar({ printer, part, filament: null }), 'materiel');
  // Températures pas encore vérifiées (ancien parcours détaillé) → toujours l'étape 2.
  assert.equal(bar({ printer, part, filament: Object.assign({}, filament, { temps_ok: false }) }), 'materiel');
  // project.step d'avant : slice, print, after (et « done » des toutes premières versions) → étape 3.
  for (const step of [undefined, 'done', 'slice', 'print', 'after']) assert.equal(bar({ printer, part, filament, step }), 'imprimer', String(step));
  assert.equal(J.currentStep({ printer, part, filament, step: 'after' }), 'resultat', 'le Résultat reste l’écran de fin');
  // Projet du deuxième lancement (machine et bobine proposées, sans pièce) → la pièce d'abord.
  assert.equal(bar(P.proposeFrom({ printer, part, filament })), 'piece');
});

const P = require('../project-logic.js');

test('lot 6 · deuxième projet : machine et bobine d’avant sur une ligne, confirmées d’un toucher', () => {
  const ctx = { proposal: { name: 'K1C' }, spoolProposal: { name: 'PLA blanc' } };
  assert.equal(J.prompt('machine', ctx), 'Sur K1C, avec PLA blanc ?');
  assert.deepEqual(J.primaryAction('machine', ctx), { label: 'Oui, on continue', kind: 'confirmBoth', enabled: true });
  const page = read('index.html');
  assert.match(page, /else if \(kind === 'confirmBoth'\) \{ projectUI\.confirmSpool = conv; projectHandlers\.keepProposed\(\); \}/);
  assert.match(page, /if \(projectUI\.confirmSpool === conv\) \{ projectUI\.confirmSpool = null; var fp = conv\.project\.filament; if \(fp && fp\.proposed && fp\.spool\) projectHandlers\.confirmFilament\(\); \}/);
  assert.match(page, /extra: onMachine \? \{ label: 'Sur ' \+ onMachine \+ ' · changer'/);
});

test('lot 6 · étape 1 : zone de dépôt, mes fichiers, galerie (si elle existe), créer avec l’IA, bateau de test', () => {
  const slot = fakeUi().el('div'), calls = [];
  const handlers = new Proxy({}, { get: (_, k) => k === 'galleryOpen' ? undefined : (...a) => calls.push([k, ...a]) });
  Card.renderChoices(slot, fakeUi(), { project: { printer: null, part: null, filament: null }, handlers });
  assert.deepEqual(labels(slot), ['Dépose ta pièce ici', 'Mes fichiers', 'Créer avec l’IA', 'Essaie avec le bateau de test'], 'galerie masquée tant qu’elle n’existe pas');
  buttons(slot)[0].on.click();
  assert.deepEqual(calls.pop(), ['importPart']);
  const withGallery = fakeUi().el('div');
  Card.renderChoices(withGallery, fakeUi(), { project: { printer: null, part: null, filament: null }, handlers: new Proxy({}, { get: () => () => {} }) });
  assert.ok(labels(withGallery).includes('Galerie'));
});

test('lot 6 · sans machine : pièce posée tout de suite, installation à l’étape 2, accueil réduit à la recherche Wi-Fi', () => {
  const page = read('index.html');
  assert.match(page, /if \(msg\.fits === false && !PlyoProject\.hasPrinter\(conv\.project\)\) msg = Object\.assign\(\{\}, msg, \{ fits: true \}\);/);
  assert.match(page, /if \(!conv \|\| PlyoJourney\.currentStep\(conv\.project\) !== 'machine'\) return;\s*startSetup\(\);/);
  assert.match(page, /if \(step === 'machine'\) setTimeout\(function \(\) \{ maybeStartSetup\(\); renderSetupFlow\(\); \}, 0\);/);
  assert.match(read('welcome.html'), /if \(withSetup\) show\('setup'\);/);
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoFirstSteps.cpp', import.meta.url), 'utf8');
  assert.match(cpp, /if \(PrinterSetup::needs_printer\(\)\)\s*show_welcome\(wxGetApp\(\)\.mainframe, true\);\s*else\s*skip_welcome\(\);/);
  // « Je connais déjà » : une ligne de l'accueil du panneau, et une offre quand le vocabulaire le montre.
  assert.equal(J.WELCOME.expertLink, 'Je connais déjà : moins de questions');
  assert.match(page, /button\(w\.expertLink, function \(\) \{ setJourneyLevel\('expert'\); renderWelcome\(\); \}, 'link'\)/);
  assert.match(page, /var pro = button\('Passer en mode confirmé', function \(\) \{ pro\.remove\(\); setJourneyLevel\('expert'\); \}, 'link'\);/);
});

// ---------- Lot 7 : galerie de modèles ----------

test('lot 7 · galerie : modèles livrés avec Orca, mêmes clés côté panneau et côté slicer, posés comme le bateau de test', () => {
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoModelImport.cpp', import.meta.url), 'utf8');
  for (const g of J.GALLERY) {
    assert.match(cpp, new RegExp('\\{"' + g.sample + '", "[a-z0-9_]+", "'), g.sample + ' connu du slicer');
    assert.ok(['utile', 'jouet', 'déco', 'test'].includes(g.category), g.sample);
    assert.ok(g.name && g.what, g.sample);
  }
  const slot = fakeUi().el('div'), picked = [];
  Card.renderChoices(slot, fakeUi(), { project: { printer: null, part: null, filament: null }, gallery: J.GALLERY,
    handlers: new Proxy({}, { get: (_, k) => k === 'pickSample' ? (s) => picked.push(s) : () => {} }) });
  assert.deepEqual(labels(slot), [...J.GALLERY.map((g) => g.name), 'Retour']);
  buttons(slot)[1].on.click();
  assert.deepEqual(picked, ['cali_cat']);
  const page = read('index.html');
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'model_add', sample: sample, project: conv\.project, conv: conv\.id,/);
  assert.match(page, /pickSample: function \(sample\) \{ projectUI\.gallery = false; importSample\(sample\); \}/);
});

test('depuis la discussion, corriger sa bobine n’attend pas de pièce : machine et bobine d’abord', () => {
  const printer = { preset: 'Ma K1C', name: 'K1C' }, filament = { type: 'PLA', preset: 'Generic PLA', temps_ok: true };
  assert.equal(P.nextStep({ part_later: true }), 'printer');
  assert.equal(P.nextStep({ part_later: true, printer }), 'filament');
  assert.equal(P.nextStep({ part_later: true, printer, filament }), 'part');
  assert.equal(P.nextStep({ part_later: true, printer, filament, part: { name: 'a.stl' } }), 'ready');
  assert.equal(J.currentStep({ part_later: true }), 'machine');
  assert.deepEqual(J.steps({ part_later: true, printer }).map((s) => s.state), ['todo', 'current', 'todo'], 'la pièce n’est pas cochée sans pièce');
  const page = read('index.html');
  assert.match(page, /if \(missing\.indexOf\('part'\) < 0 && !\(conv\.project\.part && conv\.project\.part\.name\)\) \{ conv\.project\.part_later = true;/);
  assert.match(page, /delete conv\.project\.part_later;/);
});

// ---------- Lot 8 : mode Simple ----------

test('lot 8 · mode Simple : menu à coche, appliqué par le slicer avec les fonctions publiques d’Orca, sans toucher Orca', () => {
  const page = read('index.html');
  assert.match(page, /id="m-layout" role="menuitemcheckbox"[^>]*>Disposition simple</);
  assert.match(page, /\$\('m-layout'\)\.setAttribute\('aria-checked', String\(fsState\.layout === 'simple'\)\);/);
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'firststeps_set', patch: \{ layout: layout \} \}\);/);
  assert.match(page, /fsState\.layout = 'advanced'; patch\.layout = 'advanced';/, '« Je connais déjà » rend l’écran d’Orca');
  const cpp = (f) => fs.readFileSync(new URL('../../../../src/plyo/' + f, import.meta.url), 'utf8');
  const a = cpp('PlyoAssistant.cpp');
  assert.match(a, /if \(simple \|\| changed\)\s*plater->collapse_sidebar\(simple\);/);
  assert.match(a, /const int width = s_panel->FromDIP\(simple \? 480 : 380\);/);
  assert.match(a, /if \(patch\.contains\("layout"\)\)[^\n]*\n\s*apply_layout\(true\);/);
  assert.match(a, /apply_layout\(false\); \/\/ mode Simple/);
  assert.match(a, /layout_simple\(\) && plater->is_sidebar_collapsed\(\)\)\s*plater->collapse_sidebar\(false\);/, 'panneau fermé : la barre revient');
  // Les fonctions d'Orca utilisées existent (sentinelle : une mise à jour d'Orca qui les renomme se voit ici).
  const plater = fs.readFileSync(new URL('../../../../src/slic3r/GUI/Plater.hpp', import.meta.url), 'utf8');
  assert.match(plater, /bool is_sidebar_collapsed\(\) const;/);
  assert.match(plater, /void collapse_sidebar\(bool collapse\);/);
  // Nouvelle installation : Simple (sauf « Je connais déjà ») ; qui utilise déjà Plyo garde l'écran d'Orca (défaut « advanced »).
  const first = cpp('PlyoFirstSteps.cpp');
  assert.match(first, /s\["layout"\] = dialog\.choice\(\) == "expert" \? "advanced" : "simple";/);
  assert.match(first, /s\["layout"\]      = "simple";/);
  assert.match(cpp('PlyoSanitize.cpp'), /\{"layout", "advanced"\}/);
});

test('lot 7 · galerie remplie à la main : modèles vérifiés par le slicer d’abord, vignette et attribution, puis ceux d’Orca', () => {
  assert.deepEqual(J.galleryList(null), J.GALLERY);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const list = J.galleryList([
    { id: 'crochet-mural', name: 'Crochet mural', category: 'utile', what: 'Se visse au mur.', author: 'Alice', license: 'CC BY 4.0', image: png },
    { id: 'vase', name: 'Vase', category: 'déco', author: 'Bob', license: 'CC0', image: 'javascript:alert(1)' },
    { id: 'MAUVAIS', name: 'x', category: 'utile' }, { id: 'sans-categorie', name: 'x', category: 'figurine' }, null]);
  assert.deepEqual(list.slice(0, 2).map((g) => [g.sample, g.credit, g.image]), [['crochet-mural', 'par Alice · CC BY 4.0', png], ['vase', 'par Bob · CC0', '']]);
  assert.equal(list.length, 2 + J.GALLERY.length);
  const slot = fakeUi().el('div');
  Card.renderChoices(slot, fakeUi(), { project: { printer: null, part: null, filament: null }, gallery: list, handlers: new Proxy({}, { get: () => () => {} }) });
  const first = buttons(slot)[0];
  assert.equal(first.className, 'gallery-card with-image');
  assert.ok(all(first).some((n) => n.tag === 'img' && n.src === png));
  assert.match(textOf(first), /par Alice · CC BY 4\.0/);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../../../plyo/galerie/galerie.json', import.meta.url), 'utf8')).length, 0, 'galerie vide livrée');
  const page = read('index.html');
  assert.match(page, /if \(!projectUI\.galleryItems\) window\.orca\.postMessage\(\{ type: 'gallery_get' \}\);/);
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoAssistant.cpp', import.meta.url), 'utf8');
  assert.match(cpp, /send\(\{\{"type", "gallery"\}, \{"items", ModelImport::gallery\(\)\}\}\);/);
});
