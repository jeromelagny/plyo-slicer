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
const cppSrc = (name) => fs.readFileSync(path.join(dir, '..', '..', '..', 'src', 'plyo', name), 'utf8');
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
  // Lot 8 (UX-37) : « Mes pièces » revient dans le menu, sous « Mes projets ». Lot 11 (UX-02) : changer d'avis sur « Je connais déjà ».
  // 16/11 (un écran, peu de choix) : « Mes machines » quitte l'étape Machine pour le menu.
  assert.deepEqual(ids, ['m-account-sep', 'm-convs', 'm-email', 'm-help', 'm-intent', 'm-level', 'm-login', 'm-logout', 'm-machines', 'm-new', 'm-parts', 'm-start', 'm-undo', 'm-usage']);
  for (const gone of ['m-check', 'm-values', 'm-setup', 'm-limits', 'm-tour']) assert.ok(!page.includes("$('" + gone + "')"), gone + ' encore écouté');
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
  // Lot 8 (UX-10) : la liste le nomme (« juste au-dessus ») sans en refaire un bouton.
  assert.ok(!/ui\.button\('Ma machine n’est pas dans la liste'/.test(read('project-card.js')));
  assert.ok(read('project-card.js').includes('clique sur « Ma machine n’est pas dans la liste », juste au-dessus'));
  assert.ok(read('journey-view.js').includes('extra'));
});

test('le panneau a deux onglets, et les messages d’étape vont dans le Guide', () => {
  const page = read('index.html');
  assert.ok(page.includes('id="tab-guide"') && page.includes('id="tab-chat"'), 'onglets');
  assert.ok(page.includes('id="view-guide"') && page.includes('id="view-chat"'), 'deux vues');
  assert.ok(page.includes('id="guide-notes"'), 'messages d’étape');
  assert.ok(/function noteLine\(text, tone, iconName, where\)/.test(page), 'noteLine accepte une destination');
  for (const text of ['Je pose « \' + file.name', 'advance.text', 'SEND_TEXTS.waiting']) // lot 10 : « Orca te demande de confirmer » vient de preflight.js
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
  // Lot 12 (ARCH-11) : PlyoAssistant.cpp insère tous les scripts que la page déclare, sans liste à lui.
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoAssistant.cpp', import.meta.url), 'utf8');
  assert.ok(cpp.includes('PageLogic::assemble') && !cpp.includes('"canvas-logic.js"'), 'chargés d’après les marqueurs de la page');
  const steps = read('journey-steps.js');
  // Le nom du bouton est cité par les messages de refus du C++ (PlyoCC2.cpp, PlyoCC2Logic.cpp) : à changer ensemble.
  assert.ok(steps.includes('Changer les emplacements') && steps.includes('Laisser l’imprimante choisir l’emplacement'));
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
  // Lot 8 (UX-13) : un seul lien par écran, « Entrer celles de l’étiquette » (formulaire fermé par défaut).
  assert.ok(card.includes('Entrer celles de l’étiquette') && card.includes('renderSpoolEditor'), 'lien et formulaire de la plage');
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
  // Lot 9 : une seule ligne côté Orca, le remplissage vit dans PlyoCanvas.cpp (fill_armed_upload).
  const armed = body.indexOf('if (!Plyo::Canvas::fill_armed_upload(upload_job.upload_data, default_output_file.filename().string(), use_3mf, resolved_plate_idx)) // PLYO:');
  assert.ok(armed >= 0, 'fill_armed_upload dans send_gcode_legacy, marqué PLYO: sur la même ligne');
  // Lot 10 : une seconde ligne, juste avant que l'envoi parte dans la file d'Orca (Plyo::Send::on_upload_handed).
  assert.equal(body.split('Plyo::').length - 1, 2, 'deux appels à Plyo dans send_gcode_legacy (envoi armé, envoi pris)');
  assert.ok(/\n    Plyo::Send::on_upload_handed\(\); \/\/ PLYO:[^\n]*\n    p->export_gcode\(fs::path\(\), false, std::move\(upload_job\)\);/.test(body), 'envoi pris : juste avant export_gcode, marqué PLYO:');
  // L'appel passe avant la création de la fenêtre, et la fenêtre reste dans le bloc d'Orca qui le suit.
  const dialog = body.indexOf('pDlg->ShowModal()');
  assert.ok(armed < dialog, 'avant la fenêtre');
  assert.ok(/\/\/ PLYO:[^\n]*\n\s*\{\s*auto\s+preset_bundle\s*=/.test(body.slice(armed, dialog)), 'la fenêtre reste dans le bloc d’Orca');
  const canvas = readRoot('src/plyo/PlyoCanvas.cpp');
  const fill = canvas.slice(canvas.indexOf('bool fill_armed_upload('), canvas.indexOf('namespace {', canvas.indexOf('bool fill_armed_upload(')));
  assert.ok(/take_armed_send\(\)/.test(fill) && /plateindex/.test(fill), 'plateindex sur le chemin armé (use_3mf)');
  const list = readRoot('docs/plyo/FICHIERS-MODIFIES.md');
  assert.ok(list.includes('fill_armed_upload'), 'listée dans FICHIERS-MODIFIES.md');
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
  assert.ok(/projectUI\.waitingFile \|\| resumeUI\.waiting \? null : PlyoProject\.partFromPlate\(/.test(page));
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
  assert.ok(page.includes('Plyo Slicer était sur « ') && page.includes('Choisir une autre machine'));
  const q = page.slice(page.indexOf('function applyMachineQuestion'), page.indexOf('function proposeFilamentFromHabit'));
  assert.ok(q.includes('pickPrinter(q.machine.preset'), 'le changement reste');
});

test('Résultat répond à sa question : « Oui, c’est réussi » et « Nouveau projet », sans bouton plein de plus', () => {
  const steps = read('journey-steps.js');
  assert.ok(steps.includes('Oui, c’est réussi') && steps.includes('Nouveau projet'));
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
  // ROB-12 : toute demande sans nouvel essai automatique revient dans le champ (texte et photos), jamais par-dessus un brouillon.
  assert.ok(/function restoreDraft\(note, photos\) \{\s*if \(noteInput\.value\.trim\(\) \|\| attachments\.length\) return false;/.test(page));
  assert.ok(page.indexOf("setTourStep('print'); // d'abord") < page.indexOf('PlyoJourney.advanceNote(risks.length)'), 'message après le changement d’étape');
  assert.ok(/skip: function \(\) \{ \$\('preflight-slot'\)\.textContent = ''/.test(page));
  assert.ok(read('project-card.js').includes('Garder cette bobine'));
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
  // Lot 5 : la liste de repli est celle des bobines (« Quelle bobine ? ») ; la consigne suit (plyo-verifier-renvois-ui).
  assert.ok(read('project-card.js').includes('Je ne lis pas ton Canvas pour l’instant : choisis ta bobine ici, l’imprimante choisira l’emplacement.'));
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

test('une découpe lancée depuis une réponse propose ensuite d’imprimer ou d’exporter sur cette réponse', () => {
  const html = read('index.html');
  assert.match(html, /if \(a\.kind === 'slice'\) assistSlice = \{ conv: conv, row: row \}/);
  assert.match(html, /followAssistSlice\(signals\);/);
  assert.match(html, /runAction\(a\.kind\)/);
});

// ---------- « Quelle bobine ? » (lot 5) ----------
test('Quelle bobine ? : fichier inclus par la page (PlyoAssistant.cpp suit ses marqueurs)', () => {
  assert.ok(read('index.html').includes('<!--plyo-include:spools-logic.js-->'));
  assert.ok(readCpp('src/plyo/PlyoAssistant.cpp').includes('PageLogic::assemble'), 'chargé d’après les marqueurs de la page');
  assert.ok(read('index.html').indexOf('<!--plyo-include:spools-logic.js-->') < read('index.html').indexOf('<!--plyo-include:project-card.js-->'), 'avant la fiche qui s’en sert');
});

test('Quelle bobine ? : plus de filament_choose sans nom de bobine, le nom passe par spool_choose', () => {
  const page = read('index.html'), card = read('project-card.js');
  assert.ok(!page.includes("type: 'filament_choose'"), 'le chemin « matière seule → profil générique » a disparu');
  assert.ok(!/h\.pickFilament\(/.test(card), 'les puces de matière ne choisissent plus un profil générique');
  assert.match(page, /type: 'spool_choose', name: [^,]+, material: [^,]+, printer: /);
  assert.ok(page.includes("msg.type === 'spool_chosen'") && page.includes("msg.type === 'spools'"));
  // Le nom est vérifié avant l'envoi : un nom vide ou trop court ne part jamais au slicer.
  assert.match(page, /PlyoSpools\.nameError\(/);
});

test('Quelle bobine ? : l’aide NAME_HELP est affichée sous le champ du nom, avec le bouton « C’est ma bobine »', () => {
  const card = read('project-card.js');
  const form = card.slice(card.indexOf('function renderNewSpool'), card.indexOf('function renderNewSpool') + 3500);
  assert.ok(form.length > 100, 'renderNewSpool existe');
  assert.ok(form.indexOf("ui.el('input'") >= 0 && form.indexOf('PlyoSpools.NAME_HELP') > form.indexOf("ui.el('input'"), 'aide après le champ');
  assert.ok(form.includes('C’est ma bobine'));
  assert.ok(form.includes('Une nouvelle bobine') || card.includes('Une nouvelle bobine'));
  assert.ok(/MATERIALS(\.slice\(0, 2\) : MATERIALS)?\)?\.forEach/.test(form), 'les puces de matière d’abord');
});

test('Quelle bobine ? : les textes qui renvoyaient à l’ancienne étape suivent (plyo-verifier-renvois-ui)', () => {
  const all = ['index.html', 'project-card.js', 'journey-logic.js', 'journey-steps.js', 'canvas-view.js'].map(read).join('\n');
  assert.ok(!all.includes('Dis-moi quel filament'), 'ancienne question');
  assert.ok(!all.includes('choisis la matière ici'), 'consigne de l’ancienne liste de matières');
  assert.ok(!all.includes('Autre matière'), 'ancien lien de la proposition');
  assert.ok(!all.includes('Garder ce filament'), 'ancien lien de « changer »');
  assert.ok(!all.includes('choisis ton filament dans la liste'), 'la liste est celle des bobines');
  // « Ma machine a plusieurs bobines » reste atteignable depuis la liste des bobines.
  const card = read('project-card.js');
  const filamentBranch = card.slice(card.indexOf('} else if (wantsFilament) {'), card.indexOf('} else {', card.indexOf('} else if (wantsFilament) {')));
  assert.ok(filamentBranch.includes('renderManualLink('), 'lien des emplacements gardé');
  assert.ok(filamentBranch.includes('Une nouvelle bobine'), 'la nouvelle bobine est dans la liste');
});

test('Résultat : après un envoi ou un export avec une bobine, « Oui » retient les réglages, la phrase vient du C++', () => {
  const page = read('index.html');
  assert.match(page, /type: 'spool_success'/);
  assert.match(page, /msg\.type === 'spool_success_done'/);
  assert.match(page, /PlyoSpools\.doneText\(msg\.name, msg\.date\)/);
  // Seulement après un envoi ou un export depuis le panneau (le C++ note les réglages à print_start).
  const started = page.slice(page.indexOf('function onPrintStarted'), page.indexOf('function repaintPanel'));
  assert.equal((started.match(/noteSpoolSent\(\)/g) || []).length, 2, 'envoi et export');
  // Pas une deuxième carte (lot 4, UX-22) : la question est dans l'étape Résultat ; c'est la carte « Ça a marché ? » qui se
  // tait pour les corrections de cette impression (Logic.outcomeCard), plus la question de Résultat.
  const steps = read('journey-steps.js');
  assert.match(steps, /opts\.spoolAsk/);
  assert.match(page, /spoolAsk: /);
  assert.doesNotMatch(page, /outcome-slot'\)\.childNodes\.length/);
  assert.match(page, /Logic\.outcomeCard\(/);
});

test('bobine : plus de « version fiable » à l’écran, mais « Revenir aux réglages réussis du … »', () => {
  const page = read('index.html');
  assert.match(page, /PlyoSpools\.restoreLabel\(/);
  assert.match(page, /PlyoSpools\.resumeText\(/);
  const bad = page.slice(page.indexOf('function renderOutcomeBad'), page.indexOf('// ---------- Vérification avant impression'));
  assert.match(bad, /PlyoSpools\.restoreLabel\(/, 'la carte « Ça n’a pas marché » parle de réglages réussis pour une bobine');
});

test('mode écrit : sans bobine, l’accueil et la question de filament renvoient au même choix', () => {
  const page = read('index.html');
  assert.equal((page.match(/'Choisir ma bobine'/g) || []).length, 1, 'un seul bouton, partagé');
  assert.match(page, /function chooseSpoolButton\(/);
  assert.match(page, /PlyoSpools\.needsSpool\(/);
  assert.match(page, /PlyoSpools\.isFilamentQuestion\(/);
  const fn = page.slice(page.indexOf('function chooseSpoolButton'), page.indexOf('function chooseSpoolButton') + 600);
  assert.match(fn, /applyTab\('show-guide'\)/, 'ouvre l’onglet Étapes');
});

test('préréglage de l’utilisateur : proposé une fois, oui → spool_adopt, non → habitudes', () => {
  const page = read('index.html');
  assert.match(page, /type: 'spool_adopt_check'/);
  assert.match(page, /type: 'spool_adopt', preset: /);
  assert.match(page, /PlyoSpools\.adoptQuestion\(/);
  assert.match(page, /PlyoSpools\.declineAdopt\(habits/);
  assert.match(page, /PlyoSpools\.offersAdopt\(habits/);
  const cpp = readCpp('src/plyo/PlyoAssistant.cpp');
  assert.ok(cpp.includes('"spool_adopt_check"') && cpp.includes('"spool_adopt"'));
});

test('reprise de revue : échec noté, fraîcheur venue du slicer, sortie de « changer », question tue sous la carte', () => {
  const page = read('index.html'), card = read('project-card.js');
  assert.match(page, /failed: function \(\) \{[^\n]*spoolFailure\(\)/, '« Non, c’est raté » note l’échec');
  assert.match(page, /type: 'spool_failure'/);
  assert.match(page, /msg\.type === 'spool_failure_done'/);
  assert.ok(readCpp('src/plyo/PlyoAssistant.cpp').includes('"spool_failure"'));
  assert.ok(!/hasSpoolPreset/.test(page), 'fraîcheur lue dans spool_chosen, pas dans une liste peut-être vide');
  assert.match(page, /msg\.preset_created/);
  assert.match(card, /ctx\.editing === 'filament' && !fi\) body\.appendChild\(ui\.button\('Annuler', h\.cancelEdit/);
  assert.match(card, /proposedFilament = project\.filament && project\.filament\.proposed && project\.filament\.spool/);
  const out = page.slice(page.indexOf('function renderOutcome('), page.indexOf('// « Ça n\'a pas marché »'));
  assert.match(out, /renderProject\(\)/, 'la carte posée redessine l’étape (spoolAsk se tait)');
  const done = page.slice(page.indexOf('function onSpoolSuccessDone'), page.indexOf('function onSpoolSuccessDone') + 600);
  assert.match(done, /Je n’ai pas pu retenir ces réglages/);
});

test('la demande à l’assistant porte la bobine du projet dans le contexte (≤ 60 caractères)', () => {
  const html = read('index.html');
  assert.match(html, /conv\.project\.filament\.spool\.name/);
  assert.match(html, /body\.context = Object\.assign\(\{\}, body\.context, \{ spool: spoolName\.slice\(0, 60\) \}\)/);
});

test('l’action remember_success poste spool_success, se grise au clic et disparaît des réponses archivées', () => {
  const html = read('index.html');
  const start = html.indexOf('function renderActions');
  const fn = html.slice(start, html.indexOf('// ---------- Modèle 3D joint', start));
  // Avec l’id de la bobine de la conversation : le slicer refuse un dernier envoi fait avec une autre bobine.
  assert.match(fn, /a\.kind === 'remember_success'\) \{[\s\S]*?b\.disabled = true;[\s\S]*?postMessage\(\{ type: 'spool_success', spool: \(convSpool && convSpool\.id\) \|\| '' \}\)/);
  assert.match(fn, /archived && \(PLATE_KINDS\.indexOf\(a\.kind\) >= 0 \|\| a\.kind === 'remember_success' \|\| a\.kind === 'redesign'\)/);
  assert.match(html, /msg\.type === 'spool_success_done'[\s\S]{0,80}onSpoolSuccessDone\(msg\)/);
  // « Oui » de l’étape Résultat : la bobine de l’envoi, et le changement d’avis après « Non ».
  assert.match(html, /postMessage\(\{ type: 'spool_success', spool: s\.spool\.id, change_of_mind: !!s\.failed \}\)/);
  assert.match(html, /if \(s\.spool\) window\.orca\.postMessage\(\{ type: 'spool_failure', spool: s\.spool\.id \}\)/);
  // Refus du slicer (autre bobine, envoi ancien ou raté) : son texte honnête est montré.
  assert.match(html, /noteLine\(msg\.text \|\| 'Je n’ai pas pu retenir ces réglages/);
});

test('ouverture refusée par « occupe » : le panneau redemande project_open tant que la conversation est affichée', () => {
  const html = read('index.html');
  const start = html.indexOf('function onProjectOpened');
  const fn = html.slice(start, html.indexOf('function onProjectFile', start));
  assert.match(fn, /PlyoProject\.openRetryStep\(msg\.reason/);
  assert.match(fn, /setTimeout\(function \(\) \{\s*if \(!conv \|\| conv\.id !== id\) return;[\s\S]*?postMessage\(\{ type: 'project_open', conv: id \}\)/);
  assert.match(fn, /PlyoProject\.openGiveUpText\(\)/);
});

// Un DOM minimal pour les rendus de la barre et de la question de fin.
function fakeUi() {
  const make = (tag, className, text) => {
    const node = { tag, className: className || '', textContent: text || '', children: [], attrs: {}, on: {},
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener(t, f) { this.on[t] = f; } };
    Object.defineProperty(node, 'childNodes', { get() { return this.children; } });
    Object.defineProperty(node, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.children = []; } });
    node.textContent = text || '';
    return node;
  };
  return { el: make, icon: () => make('svg'), button: (label, onClick, className) => { const b = make('button', className, label); b.on.click = onClick; return b; } };
}
const all = (n) => [n, ...n.children.flatMap(all)];
const textOf = (n) => (n.textContent || '') + n.children.map(textOf).join('');

test('barre : une étape faite se rouvre au clic, à Entrée et à Espace ; l’étape en cours et les suivantes non', () => {
  const req = createRequire(import.meta.url);
  globalThis.PlyoProject = req('../project-logic.js');
  globalThis.PlyoJourney = req('../journey-logic.js');
  const V = req('../journey-view.js');
  const slot = fakeUi().el('div');
  const project = { printer: { preset: 'K2', name: 'K2' }, filament: { type: 'PLA', preset: 'PLA', temps_ok: true }, part: { name: 'a.stl' }, step: 'after' };
  const opened = [];
  V.renderBar(slot, fakeUi(), { project, widthPx: 400, onRevisit: (k) => opened.push(k) });
  const goes = all(slot).filter((n) => n.attrs.role === 'button');
  assert.deepEqual(goes.map((n) => n.attrs['aria-label']), ['Revenir à l’étape Machine', 'Revenir à l’étape Pièce', 'Revenir à l’étape Filament', 'Revenir à l’étape Préparer']);
  assert.ok(goes.every((n) => n.attrs.tabindex === '0' && n.className === 'journey-go'));
  goes[0].on.click();
  let prevented = 0;
  goes[2].on.keydown({ key: 'Enter', preventDefault() { prevented++; } });
  goes[3].on.keydown({ key: ' ', preventDefault() { prevented++; } });
  goes[1].on.keydown({ key: 'a', preventDefault() { prevented++; } });
  assert.deepEqual(opened, ['machine', 'filament', 'preparer']);
  assert.equal(prevented, 2);
  const segs = slot.children[0].children;
  assert.equal(segs[4].children.some((c) => c.attrs && c.attrs.role === 'button'), false, 'Imprimer (fait) ne se rouvre pas');
  assert.equal(segs[5].attrs['aria-current'], 'step', 'Résultat en cours');
  assert.ok(!all(segs[5]).some((n) => n.attrs.role === 'button'));
  assert.ok(segs.every((s) => s.attrs.role === 'listitem'), 'la barre reste une liste');
});

test('barre : chaque étape rouverte reprend le geste existant de la fiche', () => {
  const page = read('index.html');
  const fn = page.slice(page.indexOf('function revisitStep'), page.indexOf('var journeyHandlers'));
  assert.match(fn, /key === 'machine'\) projectHandlers\.change\('printer'\)/);
  assert.match(fn, /key === 'filament'\) projectHandlers\.change\('filament'\)/);
  assert.match(fn, /key === 'piece'\) projectHandlers\.importPart\(\)/);
  assert.match(fn, /key === 'preparer'\) \{ delete conv\.project\.success; setTourStep\('slice'\); \}/);
  assert.match(page, /renderBar\(\$\('journey-bar'\), ui, \{[^}]*onRevisit: barBusy\(\) \? null : revisitStep/);
  assert.match(page, /\.journey-go \{[^}]*cursor: pointer/);
});

test('fin d’impression : la question s’affiche avec ses choix et chaque choix a sa suite', () => {
  const req = createRequire(import.meta.url);
  const J = req('../journey-logic.js');
  const S = req('../journey-steps.js');
  for (const v of ['finished', 'cancelled', 'error']) {
    const q = J.endQuestion(v, 'CR-10 SE', 'cube.gcode'), picked = [];
    const card = S.endCard(fakeUi(), q, (id) => picked.push(id));
    assert.ok(textOf(card).startsWith(q.text), v);
    const buttons = all(card).filter((n) => n.tag === 'button');
    assert.deepEqual(buttons.map((b) => b.textContent), q.choices.map((c) => c.label));
    assert.ok(buttons.every((b) => b.className === 'btn ghost sm'), 'aucun bouton plein');
    buttons.forEach((b) => b.on.click());
    assert.deepEqual(picked, q.choices.map((c) => c.id));
  }
  // À l'étape Résultat, la question remplace « Ça a marché ? » ; sans elle, la question d'aujourd'hui reste.
  const slot = fakeUi().el('div'), h = new Proxy({}, { get: () => () => {} });
  S.render(slot, fakeUi(), { step: 'resultat', ctx: {}, spoolAsk: 'Sunlu PLA', endAsk: J.endQuestion('finished', 'CR-10 SE', 'cube.gcode'), handlers: h });
  assert.match(textOf(slot), /CR-10 SE a fini d’imprimer « cube\.gcode »/);
  assert.doesNotMatch(textOf(slot), /Ça a marché avec/);
  const plain = fakeUi().el('div');
  S.render(plain, fakeUi(), { step: 'resultat', ctx: {}, spoolAsk: 'Sunlu PLA', endAsk: null, handlers: h });
  assert.match(textOf(plain), /je retiendrai les réglages de ta bobine « Sunlu PLA »/);
});

test('fin d’impression : le panneau la relie au suivi, aux gestes du Résultat et à la discussion', () => {
  const page = read('index.html');
  assert.match(page, /if \(msg\.phase === 'end'\) \{ onPrintEnd\(msg\); return; \}/);
  const answer = page.slice(page.indexOf('function answerEnd'), page.indexOf('function openChatAbout'));
  assert.match(answer, /a\.mark === 'success'\) stepHandlers\.success\(\)/, '« Oui » : la réussite de la bobine, comme au Résultat');
  assert.match(answer, /a\.mark === 'failure'\) stepHandlers\.failed\(\)/, 'un vrai problème : la bobine marquée ratée');
  assert.match(answer, /if \(a\.chat\) openChatAbout\(a\.prefill, a\.photo\)/);
  const chat = page.slice(page.indexOf('function openChatAbout'), page.indexOf('function onCanvasSent'));
  assert.match(chat, /applyTab\('show-chat'\)/);
  assert.match(chat, /openPhone\(\)/, 'l’invitation à la photo reprend le téléphone');
  assert.match(chat, /noteInput\.focus\(\)/);
  // Lot 4 (UX-22) : la même réponse marque aussi la mémoire des corrections de cette impression.
  assert.match(page, /success: function \(\) \{[^\n]*spoolSuccess\(\); markCorrections\('ok'\); markSendAnswered\(\);/, 'répondre au Résultat ferme la question de fin');
  assert.match(page, /failed: function \(\) \{[^\n]*spoolFailure\(\); markCorrections\('bad'\); markSendAnswered\(\);/);
  assert.equal((page.match(/noteSendWatched\(\)/g) || []).length, 3, 'définie, et notée aux deux envois suivis');
  assert.match(cppSrc('PlyoPrinterStatus.cpp'), /ended\["phase"\]\s*= "end"/);
  const status = cppSrc('PlyoPrinterStatus.cpp');
  assert.match(status, /Bind\(wxEVT_DESTROY[\s\S]*e\.GetEventObject\(\) == frame\) \{\s*stop\(\);/, 'le suivi s’arrête avec la fenêtre principale, panneau ouvert ou non');
  assert.match(status, /void watch_closing\(\)\s*\{\s*Lifetime::watch_main_frame\(\);/, 'lot 12 (ROB-15) : drapeau « on ferme » commun aux fils de Plyo');
  assert.doesNotMatch(status.slice(status.indexOf('void watch(')), /is_closing\(\)/, 'le fil ne lit jamais l’application');
  assert.match(status, /read\(kind, \*config, true, logged\);\s*if \(!alive\(\)\)\s*return;/, 'rien n’est posté après une fermeture');
  assert.equal((cppSrc('PlyoAssistant.cpp').match(/w\["id"\]\s*= id;/g) || []).length, 1, 'un seul envoi des messages de suivi');
  assert.equal((cppSrc('PlyoAssistant.cpp').match(/\]\(nlohmann::json w\) \{ send_watch\(w, id\); \}\);/g) || []).length, 2, 'les deux suivis renvoient l’id de l’envoi');
});

test('suivi Creality : le journal porte un préfixe fixe et jamais de code d’accès', () => {
  const src = cppSrc('PlyoPrinterStatus.cpp');
  assert.match(src, /BOOST_LOG_TRIVIAL\(info\) << "Plyo: état Creality : " << line/);
  assert.match(src, /pause\(END_POLL_SECONDS\)/);
  assert.doesNotMatch(src, /access_code|accessCode|printhost_apikey"\)\s*<</);
});

test('reprise 1 : la barre est inerte pendant un envoi ou une découpe', () => {
  const page = read('index.html');
  assert.match(page, /function barBusy\(\) \{ return sendLock\.on \|\| \(!!conv && slicing\.conv === conv\); \}/);
  assert.match(page, /onRevisit: barBusy\(\) \? null : revisitStep/);
  assert.match(page, /function revisitStep\(key\) \{\s*if \(!conv \|\| barBusy\(\)\) return;/);
  const answer = page.slice(page.indexOf('function answerEnd'), page.indexOf('function openChatAbout'));
  assert.match(answer, /if \(a\.mark && currentTourStep\(\) !== 'after'\) stepHandlers\.started\(\);/, 'une réponse qui juge mène au Résultat de n’importe quelle étape');
});

test('reprise 1 : une fin répondue sans jugement laisse un Résultat neutre', () => {
  const req = createRequire(import.meta.url);
  const S = req('../journey-steps.js'), J = req('../journey-logic.js'), h = new Proxy({}, { get: () => () => {} });
  for (const done of ['cancelled', 'error']) {
    const slot = fakeUi().el('div');
    S.render(slot, fakeUi(), { step: 'resultat', ctx: {}, spoolAsk: 'Sunlu PLA', endAsk: null, endDone: done, handlers: h });
    const labels = all(slot).filter((n) => n.tag === 'button').map((b) => b.textContent);
    assert.doesNotMatch(textOf(slot), /Ça a marché/, done);
    assert.ok(!labels.includes('Oui, c’est réussi'), done + ' : jamais la question de réussite');
    assert.equal(labels.includes('Non, c’est raté'), done === 'error', 'après une erreur, « Non, c’est raté » reste');
    assert.ok(labels.includes('Réimprimer cette pièce'));
    assert.equal(J.primaryAction('resultat', { ended: done }).kind, 'newPart', done + ' : « Nouveau projet » est le bouton de la ligne d’action');
  }
  const page = read('index.html');
  assert.match(page, /s\.outcome = s\.end\.verdict;\s*markSendAnswered\(\);/);
  assert.match(page, /endDone: step === 'resultat' \? endOutcome\(\) : ''/);
});

test('reprise 1 : ids d’envoi, bobine des envois avec emplacements, réussite dite dans la discussion, question unique', () => {
  const page = read('index.html');
  assert.match(page, /if \(!sent \|\| !sent\.watch \|\| msg\.id !== sent\.watch\) return;/);
  assert.equal((page.match(/type: 'print_start', export: false,[^}]*watch_id: newWatchId\(\)/g) || []).length, 2);
  assert.match(page, /type: 'print_watch_start', preset: conv\.project\.printer\.preset, id: projectUI\.watchId/);
  const sent = page.slice(page.indexOf('function onCanvasSent'), page.indexOf('function onCanvasState'));
  assert.match(sent, /noteSpoolSent\(\);/, 'M6');
  const remember = page.slice(page.indexOf("a.kind === 'remember_success') {"), page.indexOf("a.kind === 'remember_success') {") + 600);
  assert.match(remember, /markSendAnswered\(\)/, 'M7');
  const end = page.slice(page.indexOf('function onPrintEnd'), page.indexOf('function answerEnd'));
  assert.match(end, /currentStep\(conv\.project\) === 'resultat'\) \{ renderProject\(\);/, 'M8 : au Résultat, seulement l’étape');
  assert.match(page, /Cette question concerne un autre projet\./);
  assert.match(page, /projectUI\.endNoteConv !== conv\) staleEndNote\(\);/);
});

test('reprise 2 : une fenêtre principale recréée (changement de langue) ne coupe pas les suivis suivants', () => {
  const src = cppSrc('PlyoPrinterStatus.cpp');
  const fn = src.slice(src.indexOf('void watch_closing()'), src.indexOf('void watch_closing()') + 900);
  // Lot 12 (ROB-15) : le drapeau est commun (PlyoLifetime.cpp), levé à la seule vraie fermeture d'Orca.
  assert.match(cppSrc('PlyoLifetime.cpp'), /if \(Slic3r::GUI::wxGetApp\(\)\.is_closing\(\)\)\s*g_gate\.close\(\);/, 'le drapeau ne se lève qu’à la vraie fermeture d’Orca');
  assert.match(fn, /frame == g_bound_frame\)\s*return;\s*g_bound_frame = frame;/, 'liaison par fenêtre : une nouvelle fenêtre est liée');
  assert.match(fn, /if \(g_bound_frame == frame\)\s*g_bound_frame = nullptr;/, 'la fenêtre détruite libère la liaison');
  assert.doesNotMatch(src, /static bool bound/);
  assert.match(src, /void watch\(const std::string& preset[^\n]*\n\{\s*watch_closing\(\);/, 'vérifiée à chaque suivi');
});

test('lot 1 · UX-01 : sans fichier, le petit bateau de test se pose comme une pièce choisie', () => {
  const card = read('project-card.js'), page = read('index.html');
  // 16/11 : avec « crée-moi une pièce » en choix secondaire, le bateau devient un lien (un écran, peu de choix).
  assert.match(card, /ui\.button\('Pas encore de fichier \? Essaie avec le petit bateau de test', h\.samplePart, h\.designOpen \? 'link' : 'btn ghost sm'\)/);
  const fn = page.slice(page.indexOf('function importSample'), page.indexOf('// Glisser-déposer sur le panneau'));
  assert.match(fn, /postMessage\(\{ type: 'model_add', sample: 'benchy', project: conv\.project, conv: conv\.id,/, 'même chemin que model_add : plateau attaché à la conversation');
  assert.match(fn, /replace: PlyoProject\.replacesPlate\(/);
  assert.match(page, /samplePart: function \(\) \{ importSample\(\); \}/);
  // Réponse : model_added, traitée comme une pièce choisie ; s'il manque, une issue.
  const added = page.slice(page.indexOf('function onModelAdded'), page.indexOf('function dropReplaced'));
  assert.match(added, /if \(!msg\.ok && msg\.sample\) \{[\s\S]*?button\('Choisir un fichier', function \(\) \{ pickFiles\(\); \}, 'link'\)/);
  const assistant = cppSrc('PlyoAssistant.cpp');
  assert.match(assistant, /sample\.empty\(\) \? ModelImport::add\([\s\S]*?: ModelImport::add_sample\(sample, project,/);
  assert.match(assistant, /added\["sample"\] = sample;/);
  const imp = cppSrc('PlyoModelImport.cpp');
  assert.match(imp, /handy_models\(\)[\s\S]*?"3dbenchy"/, 'le fichier vient de la table des modèles d’Orca, pas d’un nom en dur');
  assert.match(imp, /return place\(path, "Petit bateau de test \(3DBenchy\)", project, replace\);/);
});

test('lot 1 · UX-06 : l’envoi est gardé dans le projet, plus en mémoire par objet', () => {
  const page = read('index.html');
  assert.doesNotMatch(page, /projectUI\.spoolSent|projectUI\.lastSend|projectUI\.spoolNo|s\.conv === conv|s\.conv !== conv/);
  assert.match(page, /function sendOf\(\) \{ return conv && conv\.project\.send && typeof conv\.project\.send === 'object' \? conv\.project\.send : null; \}/);
  const note = page.slice(page.indexOf('function noteSpoolSent'), page.indexOf('function spoolAsk'));
  assert.match(note, /delete conv\.project\.send;\s*sendRecord\(\);\s*scheduleSave\(\);/, 'un nouvel envoi remplace le précédent et s’enregistre');
  const success = page.slice(page.indexOf('function spoolSuccess'), page.indexOf('function onSpoolSuccessDone'));
  assert.match(success, /var s = sendRecord\(\);/, 'sans envoi noté : la bobine du projet, comme remember_success');
  // Sans bobine : la phrase vient après la réponse du slicer (corrections marquées ou non), mais elle est toujours dite.
  assert.match(success, /if \(!s\.spool\) \{ projectUI\.noSpoolNote = conv\.id; return; \}/);
  const result = page.slice(page.indexOf('function onOutcomeResult'), page.indexOf('function onOutcomeResult') + 2000);
  assert.match(result, /noteLine\('Je ne retiens les réglages que d’une bobine/, 'rien à retenir : on le dit');
  const record = page.slice(page.indexOf('function sendRecord'), page.indexOf('function noteSendWatched'));
  assert.match(record, /f\.spool\.id && !\(Array\.isArray\(p\.canvas\) && p\.canvas\.length\)/);
  // Réouverture : la fin lue pendant l'absence est redemandée au slicer, qui la garde par id d'envoi.
  const restore = page.slice(page.indexOf('function restoreConversation'), page.indexOf('function restoreConversation') + 3200);
  assert.match(restore, /postMessage\(\{ type: 'print_watch_replay', id: sentBefore\.watch \}\)/);
  const assistant = cppSrc('PlyoAssistant.cpp');
  assert.match(assistant, /type == "print_watch_replay"/);
  assert.match(assistant, /if \(Json::str\(w, "phase"\) == "end" && !id\.empty\(\)\)/);
  // Le slicer garde ces champs à l'enregistrement de la conversation.
  const logic = cppSrc('PlyoProjectLogic.cpp');
  assert.match(logic, /Json::field\(project, "send"\)/);
  assert.match(logic, /out\["success"\] = true;/);
});

test('lot 1 · UX-04 et UX-05 : Résultat en cours, puis « Oui, c’est réussi » en bouton plein quand la fin est lue', () => {
  const req = createRequire(import.meta.url);
  const S = req('../journey-steps.js'), J = req('../journey-logic.js'), h = new Proxy({}, { get: () => () => {} });
  const labels = (slot) => all(slot).filter((n) => n.tag === 'button').map((b) => b.textContent);
  const printing = fakeUi().el('div');
  S.render(printing, fakeUi(), { step: 'resultat', ctx: {}, spoolAsk: '', endAsk: null, handlers: h });
  assert.match(textOf(printing), /Quand elle est finie, dis-moi si c’est réussi\./);
  // Lot 4 (UX-22) : les mêmes libellés que la carte et la fin suivie.
  assert.deepEqual(labels(printing), ['Oui, c’est réussi', 'Non, c’est raté', 'Nouveau projet', 'Réimprimer cette pièce']);
  // Fin lue : le « Oui » est le bouton plein, la carte ne garde que « Non ».
  const finished = fakeUi().el('div');
  S.render(finished, fakeUi(), { step: 'resultat', ctx: {}, spoolAsk: 'Sunlu PLA', endAsk: J.endQuestion('finished', 'K2', 'a.gcode'), handlers: h });
  assert.ok(!labels(finished).includes('Oui, c’est réussi'));
  assert.ok(labels(finished).includes('Non, c’est raté'));
  assert.ok(labels(finished).includes('Photo depuis l’ordinateur'));
  // « Raté » dit : les photos, avec leur coût, et le changement d'avis.
  const failed = fakeUi().el('div');
  S.render(failed, fakeUi(), { step: 'resultat', ctx: {}, spoolAsk: 'Sunlu PLA', spoolNo: true, handlers: h });
  assert.ok(labels(failed).includes('Photo depuis l’ordinateur'));
  assert.ok(labels(failed).includes('Oui, c’est réussi'));
  assert.ok(!labels(failed).some((l) => l === 'Ajouter une photo depuis l’ordinateur' || l === 'Envoyer une photo'));
  const page = read('index.html');
  assert.match(page, /kind === 'success'\) \{ if \(endQuestionNow\(\)\) answerEnd\('yes'\); else stepHandlers\.success\(\); \}/);
  assert.match(page, /ctx\.failed = !!\(sendOf\(\) && sendOf\(\)\.failed\);/);
  assert.doesNotMatch(page, /'Envoyer une photo'|Envoyer une photo du résultat/);
  const chat = page.slice(page.indexOf('function openChatAbout'), page.indexOf('function onCanvasSent'));
  // Lot UX 5 : dans la discussion, les deux façons d'envoyer la photo sont des boutons, comme à l'étape Résultat (téléphone en plein).
  assert.match(chat, /button\(PlyoJourney\.PHOTO_PHONE, function \(\) \{ openPhone\(\); \}, 'btn sm ai'\)/);
  assert.match(chat, /button\(PlyoJourney\.PHOTO_COMPUTER, function \(\) \{ pickFiles\(\); \}, 'btn ghost sm ai'\)/);
});

test('lot 1 · UX-15 : le lot des questions d’intention a son « Annuler », qui ramène au résumé', () => {
  const page = read('index.html');
  assert.match(page, /if \(result && result\.undo_id\) intentUI\.doneLine\.appendChild\(intentUndoButton\(result\.undo_id, conv\)\);/);
  const fn = page.slice(page.indexOf('function intentUndoButton'), page.indexOf('function maybeReapplyIntent'));
  // Lot 3 · ROB-11 : la demande porte un identifiant (postRequest), renvoyé par le slicer avec sa réponse.
  assert.match(fn, /postRequest\(\{ type: 'undo', undo_id: undoId \}\)/);
  assert.match(fn, /undoneListeners\[undoId\] = function \(\) \{[\s\S]*?conv\.project\.intent\.applied = false;[\s\S]*?noteLine\('Réglages d’avant remis\.'/);
});

test('lot 1 · UX-16 : « Annuler » après « Tout corriger » défait aussi le plateau, ou dit ce qui reste', () => {
  const page = read('index.html');
  const fix = page.slice(page.indexOf("fixAll.addEventListener('click'"), page.indexOf('// Découpe demandée par le bouton d\'une réponse'));
  assert.match(fix, /plateDone\.push\(\{ kind: actions\[i\]\.action, token: msg && msg\.undo_token !== undefined \? msg\.undo_token : null \}\)/);
  assert.match(fix, /plateAction\('undo', function \(ok\) \{[^\n]*\}, \{ undo_token: last\.token \}, undefined, true\);/, 'de la dernière action à la première, sans ligne à part');
  assert.match(fix, /PF\.undoText\(settingsUndone, plateDone\.length - left\.length, left\.map/);
  assert.match(page, /if \(plateQuiet\[msg\.request\]\) \{ delete plateQuiet\[msg\.request\]; if \(after\) after\(msg\.ok, msg\); return; \}/);
});

test('lot 1 · UX-20, UX-21, UX-23, UX-28 : une issue à chaque impasse', () => {
  const page = read('index.html');
  // UX-20 et UX-23 : gratuit, la discussion s'ouvre avec l'invitation à la photo.
  assert.match(page, /what === 'failed' \|\| what === 'defect'\) showFailedPrint\(what === 'defect' \? 'Ma pièce a ce défaut : ' : ''\)/);
  const show = page.slice(page.indexOf('function showFailedPrint'), page.indexOf('var stepHandlers'));
  assert.match(show, /openChatAbout\(prefill, true\);/);
  assert.match(show, /PlyoJourney\.fixNeeds\(conv\.project\)/);
  // UX-21 : le refus pour fiche incomplète donne le bouton qui y mène ; la fiche reste applicable.
  const sheet = page.slice(page.indexOf("apply.addEventListener('click'"), page.indexOf("ignore.addEventListener('click'"));
  assert.match(sheet, /if \(!ok\) \{\s*lock\(false\); updateCount\(\);[\s\S]*?completeProjectButton\(result && result\.missing\)/);
  const assistant = cppSrc('PlyoAssistant.cpp');
  assert.match(assistant, /SettingsBridge::filament_only\(/);
  assert.match(assistant, /\{"missing", edit \? std::vector<std::string>\(\) : ProjectLogic::missing_for\(project, filament_only\)\}/);
  // UX-28 : « Découper la plaque » à côté de « Anciens réglages remis ».
  assert.match(page, /doneLabel\('Anciens réglages remis\. Découpe à nouveau la plaque pour en tenir compte\.', 'undo'\)\);\s*done\.appendChild\(button\('Découper la plaque', function \(\) \{ sliceAgain\(\); \}, 'btn ghost sm', 'wand'\)\);/);
  const again = page.slice(page.indexOf('function sliceAgain'), page.indexOf('// ---------- Vérification avant impression'));
  assert.match(again, /setTourStep\('slice'\)/);
  assert.match(again, /plateAction\('slice'\)/);
});
