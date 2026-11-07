// Règles de construction du panneau lues dans les sources : un seul bouton plein par étape, menu réduit.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
  for (const text of ['Je pose « \' + file.name', 'advance.text', 'Orca te demande de confirmer'])
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
  // Le nom du bouton est cité par les messages de refus du C++ (PlyoCC2.cpp, PlyoCC2Logic.cpp) : à changer ensemble.
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

// C++ seulement : la retouche d'Orca pour l'envoi armé (T10) et les clés d'Orca qu'elle reprend. Une fusion d'Orca qui les renomme casse ce test.
const root = path.join(dir, '..', '..', '..');
const readRoot = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('envoi armé : la retouche de send_gcode_legacy est en place et marquée', () => {
  const plater = readRoot('src/slic3r/GUI/Plater.cpp');
  const start = plater.indexOf('void Plater::send_gcode_legacy(');
  assert.ok(start >= 0);
  const end = plater.indexOf('int Plater::send_gcode(', start);
  const body = plater.slice(start, end);
  const armed = body.indexOf('Plyo::Canvas::take_armed_send()');
  assert.ok(armed >= 0, 'take_armed_send dans send_gcode_legacy');
  assert.ok(body.lastIndexOf('// PLYO:', armed) >= 0, 'marque PLYO: avant le bloc');
  // Le bloc passe avant la création de la fenêtre, et la fenêtre reste dans la branche « else ».
  const dialog = body.indexOf('pDlg->ShowModal()');
  assert.ok(armed < dialog, 'avant la fenêtre');
  assert.ok(/\}\s*else\s*\{\s*auto\s+preset_bundle\s*=/.test(body.slice(armed, dialog)), 'la fenêtre reste dans le else');
  assert.ok(/plateindex/.test(body.slice(armed, dialog)), 'plateindex sur le chemin armé (use_3mf)');
  const list = readRoot('docs/plyo/FICHIERS-MODIFIES.md');
  assert.ok(list.includes('take_armed_send'), 'listée dans FICHIERS-MODIFIES.md');
});

test("envoi armé : les clés et paramètres repris d'Orca existent encore", () => {
  const dialogs = readRoot('src/slic3r/GUI/PrintHostDialogs.hpp');
  for (const key of ['crealityprint_enable_self_test', 'flashforge_leveling_before_print', 'flashforge_timelapse_video'])
    assert.ok(dialogs.includes(key), key);
  const canvas = readRoot('src/plyo/PlyoCanvas.cpp');
  for (const key of ['crealityprint_enable_self_test', 'flashforge_leveling_before_print', 'flashforge_timelapse_video'])
    assert.ok(canvas.includes(key), key + ' lue par le pont');
  const creality = readRoot('src/slic3r/Utils/CrealityPrint.cpp');
  assert.ok(creality.includes('"colorMatch_"'), 'colorMatch_ dans CrealityPrint');
  assert.ok(creality.includes('enableSelfTest'));
  const flashforge = readRoot('src/slic3r/Utils/Flashforge.cpp');
  for (const key of ['materialMappings', 'useMatlStation', 'gcodeToolCnt', 'levelingBeforePrint', 'timeLapseVideo'])
    assert.ok(flashforge.includes(key), key + ' dans Flashforge');
  assert.ok(!canvas.includes('base64'), "materialMappings : du JSON, l'hôte fait le base64");
});

test('envoi armé : un plan CFS/IFS passe toujours par plan_allowed (jamais de saisie manuelle envoyée)', () => {
  const canvas = readRoot('src/plyo/PlyoCanvas.cpp');
  const start = canvas.indexOf('void plan(const std::string& printer_preset');
  const body = canvas.slice(start, canvas.indexOf('bool orca_state(', start));
  assert.ok(body.includes('SlotsLogic::plan_allowed('));
  const assign = body.indexOf('g_send_plan = {');
  assert.ok(assign > body.indexOf('SlotsLogic::plan_allowed('), 'le plan est rangé après la vérification');
});

test('saisie manuelle : ne touche jamais au plan ni à la dernière lecture de la machine', () => {
  const slots = readRoot('src/plyo/PlyoSlots.cpp');
  assert.ok(!/Canvas::|set_plan|send_planned|g_last_read/.test(slots), 'PlyoSlots ne connaît ni le plan ni la lecture');
  const canvas = readRoot('src/plyo/PlyoCanvas.cpp');
  assert.ok(!canvas.includes('manual_state') && !canvas.includes('PlyoSlots.hpp'), 'le pont du plan ne lit pas la saisie manuelle');
  const assistant = readRoot('src/plyo/PlyoAssistant.cpp');
  const start = assistant.indexOf('type == "slots_manual_get"');
  const body = assistant.slice(start, assistant.indexOf('type == "canvas_send"', start));
  assert.ok(start >= 0 && !/Canvas::plan|send_planned|http|Http/.test(body), 'les messages de saisie ne planifient rien et ne sortent pas');
});

test('un message s’affiche dans l’onglet ouvert : aucune écriture directe dans le fil caché', () => {
  const page = read('index.html');
  const place = page.slice(page.indexOf('function placeInOpenTab'), page.indexOf('function noteLine'));
  assert.ok(/viewUI\.tab === 'guide'/.test(place), 'l’onglet ouvert décide');
  assert.ok(/classList\.add\('ghost'\)/.test(place), 'dans Étapes, les boutons d’un message restent secondaires');
  assert.ok(/where === 'chat' \? placeInThread\(line\) : placeInOpenTab\(line\)/.test(page), 'noteLine suit l’onglet ouvert');
  assert.ok(/noteLine\(entry\.text, entry\.tone, entry\.icon, 'chat'\)/.test(page), 'seule une conversation rouverte force le fil');
  const login = page.slice(page.indexOf('function requireLogin'), page.indexOf('// ---------- Volets'));
  assert.ok(login.includes('placeInOpenTab(loginCard)') && !login.includes('thread.appendChild'), 'la demande de connexion est visible à l’endroit du clic');
  assert.ok(login.includes('dropLoginCard()'), 'une seule carte de connexion');
  assert.ok(/function onExplain\(msg\) \{ applyTab\('show-chat'\)/.test(page), 'l’explication d’un réglage s’affiche');
});

test('pièce trop grande : la carte et « Réduire » sont dans l’étape, sans bouton plein, et survivent au passage d’étape', () => {
  const page = read('index.html');
  const card = page.slice(page.indexOf('function showTooBig'), page.indexOf('function renderModel'));
  assert.ok(card.includes("$('project-alert').appendChild(box)"), 'pas dans les messages d’étape, effacés au changement d’étape');
  assert.ok(card.includes('Réduire pour qu’il tienne') && card.includes('Garder cette taille'));
  assert.ok(!/,\s*['"]btn(?: sm)?['"]/.test(card), 'pas de bouton plein dans la carte');
});

test('import raté : « Je pose… » est retiré à la réponse', () => {
  const page = read('index.html');
  assert.ok(/function onModelAdded\(msg\) \{\s*dropPlacing\(\);/.test(page));
});

test('« L’impression a démarré » suit l’acceptation d’Orca, et un refus libère l’envoi', () => {
  const page = read('index.html');
  const run = page.slice(page.indexOf('function runAction'), page.indexOf("window.addEventListener('resize', function () { if (conv)"));
  assert.ok(!run.includes('sentConv = conv'), 'cliquer ne suffit plus');
  const started = page.slice(page.indexOf('function onPrintStarted'), page.indexOf('function runAction'));
  assert.ok(/if \(!msg\.ok\) \{\s*unlockSend\(\);/.test(started), 'refus : verrou levé tout de suite');
  assert.ok(started.indexOf('sentConv = conv') > started.indexOf('!msg.ok'), 'sentConv seulement après un succès');
  assert.ok(/sentConv = conv[\s\S]*renderProject\(\)/.test(started), 'et le bouton s’affiche sans attendre');
  assert.ok(/kind === 'send'[\s\S]{0,60}lockSend\('print'\)/.test(run) && /lockSend\('export'\)/.test(run), 'double-clic : un seul départ');
});

test('Résultat n’est pas une impasse : on peut réimprimer, et « démarré » ne survit pas à l’étape', () => {
  assert.ok(read('journey-steps.js').includes('Réimprimer cette pièce'));
  const page = read('index.html');
  assert.ok(/reprint: function \(\) \{[^}]*setTourStep\(/.test(page));
  assert.ok(/if \(step !== 'imprimer'\) \{ projectUI\.sentConv = null;/.test(page));
  assert.ok(page.includes('retourne à l’onglet « Étapes »') && page.includes('id="tab-guide"'), 'le renvoi vise un onglet qui existe');
});

test('reprise d’un projet : le même fichier est reposé sans proposer un nouveau projet', () => {
  const page = read('index.html');
  const send = page.slice(page.indexOf('function sendModel'), page.indexOf('function offerNewProject'));
  assert.ok(/part && file\.name !== part\) \{ offerNewProject/.test(send), 'seul un autre nom ouvre un autre projet');
  assert.ok(send.includes('déjà sur le plateau'), 'pas de doublon si la pièce est encore là');
  assert.ok(/kind === 'importPart'\) pickFiles\(\)/.test(page), 'le bouton de l’étape ouvre le choix de fichier');
});

test('un fichier déposé est prioritaire : le plateau ne le remplace pas, et il est posé dès la machine choisie', () => {
  const page = read('index.html');
  assert.ok(/projectUI\.waitingFile \? null : PlyoProject\.partFromPlate\(/.test(page));
  assert.ok(/if \(adopted\) conv\.project\.part = null/.test(page), 'une pièce seulement vue sur le plateau cède la place');
  assert.ok(read('project-card.js').includes('Garder cette pièce'), 'l’ancienne pièce reste récupérable, et le panneau le dit');
});

test('« Aucun risque détecté » distingue vérifié, ignoré et pas vérifié, et une réouverture revérifie', () => {
  const steps = read('journey-steps.js');
  assert.ok(/checked === 'clean'\) return 'Aucun risque détecté'/.test(steps));
  assert.ok(steps.includes('Points ignorés'));
  const page = read('index.html');
  assert.ok(/openRisks = 0; plateChecked = 'ignored'/.test(page), 'croix et « En parler » : ignoré');
  const restore = page.slice(page.indexOf('function restoreConversation'), page.indexOf('function renderEntry'));
  assert.ok(/tourSignals\.sliced\) window\.orca\.postMessage\(\{ type: 'preflight' \}\)/.test(restore));
});

test('formulaire de la bobine : pas de redessin pendant la saisie, et succès annoncé seulement après la réponse d’Orca', () => {
  const card = read('project-card.js');
  const editor = card.slice(card.indexOf('function renderSpoolEditor'), card.indexOf('function renderChoices'));
  assert.ok(/wasOpen && slot\.spoolKey === key\) return/.test(editor), 'formulaire gardé');
  assert.ok(/if \(!wasOpen\) setTimeout/.test(editor), 'le curseur n’est placé qu’à l’ouverture');
  const page = read('index.html');
  const range = page.slice(page.indexOf('setSpoolRange: function'), page.indexOf('importPart: function'));
  assert.ok(range.indexOf('function (ok, text)') < range.indexOf('limits_set') && range.indexOf('function (ok, text)') < range.indexOf('enregistrées'), 'limits_set et le message viennent après la réponse');
  assert.ok(/if \(!ok\) \{ sp\.error = text/.test(range), 'refus dit dans le formulaire');
});

test('la suggestion « Températures de ma bobine » ouvre le formulaire de la fiche : plus de volet « Limites du fabricant »', () => {
  const page = read('index.html');
  assert.ok(/what === 'limits'\) \{ if \(!projectUI\.spool\.open\) projectHandlers\.toggleSpool\(\)/.test(page));
  assert.ok(!page.includes('openLimits') && !page.includes('limitsView'), 'volet retiré');
  assert.ok(!page.includes('Limites du fabricant'), 'aucun texte ne le cite');
});

test('une conversation rouverte montre son échange', () => {
  const page = read('index.html');
  const restore = page.slice(page.indexOf('function restoreConversation'), page.indexOf('function renderEntry'));
  assert.ok(/entry\.kind === 'me'[\s\S]{0,120}applyTab\('show-chat'\)/.test(restore));
});

test('« Mes conversations » : le nom de la pièce sert de titre, et un simple lancement n’enregistre rien', () => {
  const page = read('index.html');
  assert.ok(/function worthSaving\(c\) \{ return !!c && \(c\.entries\.length > 0 \|\| !!partName\(c\)\); \}/.test(page));
  assert.ok(/title: c\.title \|\| partName\(c\)/.test(page));
});

test('« Appliquer et préparer » : un seul lot au double-clic, et un refus laisse réessayer', () => {
  const page = read('index.html');
  assert.ok(/function applyIntent\(again\) \{\s*if \(intentUI\.applying\) return;/.test(page));
  assert.ok(/if \(!ok\) \{ releaseIntent\(\); noteLine\(text/.test(page), 'le refus libère le verrou');
});

test('« Reposer les questions » fonctionne aussi après la découpe', () => {
  const page = read('index.html');
  assert.ok(/\{ reask: true \}/.test(page) && /function plateSliced\(\)/.test(page));
  assert.ok(/ctx = \{ sliced: plateSliced\(\)/.test(page), 'la ligne d’action suit');
  assert.ok(/delete p\.intent\.reask/.test(page), 'levé une fois les réponses appliquées');
});

test('Canvas, trop de couleurs : « puis reviens ici » a un bouton qui relit', () => {
  assert.ok(/Vérifier à nouveau', h\.recheck/.test(read('canvas-view.js')));
  assert.ok(/recheck: function \(\) \{ canvasUI\.preset = null/.test(read('index.html')));
});

test('la carte « Avant d’imprimer » est amenée dans la zone visible', () => {
  const page = read('index.html');
  const on = page.slice(page.indexOf('function onPreflight'), page.indexOf('function resultCard'));
  assert.ok(/scrollToAnswerTop\(\$\('preflight-slot'\)\.firstChild\)/.test(on));
});

test('le panneau dit quand il change la machine d’Orca, sans supprimer ce changement', () => {
  const page = read('index.html');
  assert.ok(/orca !== q\.machine\.preset\) projectUI\.switchedFrom = orca/.test(page));
  assert.ok(page.includes('Orca était sur « ') && page.includes('Choisir une autre machine'));
  const q = page.slice(page.indexOf('function applyMachineQuestion'), page.indexOf('function proposeFilamentFromHabit'));
  assert.ok(q.includes('pickPrinter(q.machine.preset'), 'le changement reste');
});

test('Résultat répond à sa question : « Oui, c’est réussi » et « Nouvelle pièce », sans bouton plein de plus', () => {
  const steps = read('journey-steps.js');
  assert.ok(steps.includes('Oui, c’est réussi') && steps.includes('Nouvelle pièce'));
  assert.ok(/kind === 'newPart'\) newConversation\(\)/.test(read('index.html')));
});

test('téléphone, service coupé : l’erreur s’affiche là où on a cliqué', () => {
  const page = read('index.html');
  assert.ok(/if \(!valid\) \{ if \(session\) showError\('network', openPhone, null, true\); return; \}/.test(page));
  assert.ok(/if \(here\) \{ hereError = placeInOpenTab\(box\); return; \}/.test(page));
});

test('l’accueil ne promet pas de bouton qui n’existe pas dans les étapes', () => {
  const welcome = read('welcome.html');
  assert.ok(!/Montre-moi/.test(welcome), '« Montre-moi » n’est proposé que par l’IA');
  assert.ok(!/passer une étape/.test(welcome), 'aucune étape n’a de bouton « Passer »');
  for (const name of ['journey-steps.js', 'project-card.js', 'journey-view.js']) assert.ok(!/Montre-moi|Passer l/.test(read(name)), name);
});

test('« Plus tard » n’éteint pas l’alerte de changement de machine', () => {
  assert.ok(/if \(!setup\.preset\) projectUI\.adopt = false/.test(read('index.html')));
});

test('textes : pas d’accents graves bruts à l’installation, pas de numéro d’étape', () => {
  const page = read('index.html');
  assert.ok(/box\.appendChild\(rich\(setup\.found \?/.test(page), 'libellés Orca en surbrillance');
  assert.ok(!page.includes('(étape 3)'));
  assert.ok(!page.includes('Ta session a expiré.\''), 'phrase complète');
  assert.ok(read('project-card.js').includes('Je ne lis pas ton Canvas'));
});

test('comportements : brouillon gardé, demande remise si la jauge est pleine, message de passage visible, carte refermée', () => {
  const page = read('index.html');
  assert.ok(/function clearNoteIfSent\(note\) \{ if \(noteInput\.value\.trim\(\) === note\)/.test(page));
  assert.ok(/code === 'insufficient_credits' && !noteInput\.value/.test(page));
  assert.ok(page.indexOf("setTourStep('print'); // d'abord") < page.indexOf('PlyoJourney.advanceNote(risks.length)'), 'message après le changement d’étape');
  assert.ok(/skip: function \(\) \{ \$\('preflight-slot'\)\.textContent = ''/.test(page));
  assert.ok(read('project-card.js').includes('Garder ce filament'));
});

test('réglages lus : pas de nom technique pour un débutant ; ligne décochée lisible', () => {
  const page = read('index.html');
  assert.ok(/fsState\.level === 'expert' \? p\.key : ''/.test(page));
  assert.ok(!/\.row\.off \{ opacity/.test(page) && /\.row\.off input \{ opacity/.test(page));
});

test('emplacements : canvasWanted lit le traducteur (known.slots), et la CC2 garde ses textes', () => {
  const page = read('index.html');
  assert.ok(/known && known\.slots && known\.linked/.test(page), 'canvasWanted : known.slots');
  assert.ok(!/known\.cc2/.test(page), 'plus de lecture de known.cc2');
  // Textes CC2 fixés (consigne : la CC2 ne change ni de comportement ni de texte).
  assert.ok(page.includes('Je n’arrive pas à relire les emplacements de ta CC2 : rien n’est envoyé. Vérifie qu’elle est allumée, puis réessaie.'));
  assert.ok(read('project-card.js').includes('Je ne lis pas ton Canvas pour l’instant : choisis la matière ici, l’imprimante choisira l’emplacement.'));
  // Le plan de la CC2 ne reçoit rien de nouveau : label, imposable, source et system ne sont posés que hors CC2.
  assert.ok(/st\.system && st\.system !== 'canvas'\) \{ entry\.label/.test(page));
});

test('emplacements : le numéro affiché vient du traducteur partout (aucun tray_id + 1 hors repli)', () => {
  for (const name of ['canvas-view.js', 'project-card.js', 'journey-steps.js', 'index.html'])
    assert.ok(!/tray_id \+ 1/.test(read(name)), name);
  assert.equal((read('canvas-logic.js').match(/tray_id \+ 1/g) || []).length, 2, 'canvas-logic.js : le commentaire de tête et slotName');
});

const readCpp = (rel) => fs.readFileSync(new URL('../../../../' + rel, import.meta.url), 'utf8');

test('envoi CFS/IFS : canvas_send, jamais « démarré » dans les textes de cet envoi', () => {
  const page = read('index.html');
  assert.ok(/route === 'armed'[\s\S]{0,200}type: 'canvas_send'/.test(page), 'canvas_send seulement sur la route armée');
  const finish = readCpp('src/plyo/PlyoCanvas.cpp');
  const body = finish.slice(finish.indexOf('nlohmann::json finish_send'), finish.indexOf('void send_planned'));
  assert.ok(body.includes("J'envoie le fichier"), 'le C++ dit « J’envoie »');
  assert.ok(!/démarr/i.test(body), 'finish_send ne dit jamais « démarré »');
  const handler = page.slice(page.indexOf('function onCanvasSent'), page.indexOf('function onCanvasState'));
  assert.ok(handler.length > 0 && !/démarr/i.test(handler), 'onCanvasSent ne dit jamais « démarré »');
  // Le geste de l'utilisateur après cet envoi dit ce qu'il voit, pas un fait que Plyo saurait.
  assert.ok(read('journey-steps.js').includes('Oui, elle imprime'));
});

test('refus hors CC2 : « Relire les emplacements », et « Démarrer sans carte » seulement si offerPlain', () => {
  const steps = read('journey-steps.js');
  assert.ok(/offerPlain === false[\s\S]{0,120}Relire les emplacements/.test(steps));
  assert.ok(/canvas_refused[\s\S]{0,200}refusedPlain/.test(read('index.html')), 'seul le refus de la CC2 ouvre la relance sans carte');
  assert.ok(/refusedPlain = false/.test(read('index.html')));
});

test('U1 : le réordonnancement (T18 à T21) n’existe pas dans le panneau, et aucun texte ne le propose', () => {
  for (const name of ['index.html', 'canvas-logic.js', 'canvas-view.js', 'journey-logic.js', 'journey-steps.js', 'project-card.js']) {
    const src = read(name);
    assert.ok(!/canvas_reorder|Ranger les couleurs|J’ai rangé|réordonn/i.test(src), name);
  }
  const view = read('canvas-view.js');
  const u1 = view.slice(view.indexOf("system === 'u1'"), view.indexOf("system === 'u1'") + 300);
  assert.ok(u1.includes('Ces couleurs sont sur tes têtes') && !/impos/i.test(u1), 'texte U1 sans « imposé »');
});

test('une bobine : pas de question, remarque seulement ; liaison incomplète : proposer de relier à nouveau', () => {
  const page = read('index.html'), card = read('project-card.js');
  assert.ok(/PlyoCanvas\.askSlots\(/.test(page), 'canvasMode passe par askSlots');
  assert.ok(/PlyoCanvas\.typeMismatch\(/.test(page) && card.includes('ctx.slotRemark') && read('journey-steps.js').includes('opts.slotRemark'), 'la remarque est affichée aux deux étapes');
  assert.ok(/slots_reason === 'link_incomplete'/.test(page), 'link_incomplete lu dans la liste des machines');
  assert.ok(/Relier à nouveau', ctx\.handlers\.setupPrinter/.test(card), 'relier à nouveau lance la recherche d’abord (la série n’est connue que là)');
});

test('saisie manuelle : messages du C++, vue sans bouton plein, jamais de plan ni de canvas_send', () => {
  const page = read('index.html'), view = read('canvas-view.js');
  assert.ok(page.includes("type: 'slots_manual_get'") && page.includes("type: 'slots_manual_save'"));
  assert.ok(page.includes("msg.type === 'slots_manual_state'") && page.includes("msg.type === 'slots_manual_saved'"));
  assert.ok(!FULL_BUTTON.test(view));
  assert.ok(/Ma machine a plusieurs bobines/.test(read('project-card.js')));
  assert.ok(view.includes('J’ai changé'));
  // Le C++ refuse aussi : Canvas::plan ne reçoit qu'une répartition isImposed (voir SlotsLogic::plan_allowed).
  assert.ok(/PlyoCanvas\.isImposed\(p\.canvas\)/.test(page), 'le plan passe par isImposed');
  assert.ok(/PlyoCanvas\.needsReread\(/.test(page), 'pas de relecture pour une saisie');
});

test('saisie manuelle : la CC2 ne reçoit ni le lien ni la saisie', () => {
  const page = read('index.html');
  assert.ok(/known\.slots === 'canvas'\) return false/.test(page), 'manualWanted écarte la CC2');
});

test('saisie manuelle : les matières proposées existent toutes dans Orca (sinon le C++ les efface)', () => {
  const names = [...readCpp('src/libslic3r/MaterialType.cpp').matchAll(/\{"([^"]+)",\s*\d/g)].map(m => m[1]);
  assert.ok(names.length > 50);
  const C = createRequire(import.meta.url)('../canvas-logic.js');
  C.MANUAL_TYPES.forEach(t => assert.ok(names.includes(t), t));
});

test('annulation ou délai dépassé : la jauge est relue, une fois la facturation passée côté service', () => {
  const page = read('index.html');
  const fail = page.slice(page.indexOf('function fail(code, data)'), page.indexOf('// Profils au moment de la question'));
  assert.ok(/code === 'cancel'[\s\S]{0,120}Logic\.CANCEL_TEXT/.test(fail), 'le texte vient de la logique');
  assert.ok(/refreshGaugeSoon\(\)/.test(fail), 'relecture après annulation');
  assert.ok(/code === 'timeout'[\s\S]{0,80}refreshGaugeSoon\(\)/.test(fail), 'relecture après délai dépassé');
  assert.ok(/Logic\.offTopicCostNote\(a\)/.test(page), 'le hors-sujet facturé est dit');
  assert.ok(!page.includes("noteLine('Demande annulée.'"), 'plus le texte seul');
});

test('saisie manuelle : une machine avec traducteur mais non reliée y a droit aussi', () => {
  assert.ok(/!known\.slots \|\| !known\.linked\) return true/.test(read('index.html')));
});
