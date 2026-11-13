// Lot 11 : utilisateur confirmé (UX-02, UX-31 à UX-36) et reliquats du lot 10 (envoi sans confirmation de démarrage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
globalThis.PlyoProject = require('../project-logic.js');
const J = require('../journey-logic.js');
const I = require('../intent-logic.js');
const R = require('../retouches-logic.js');
const PF = require('../preflight.js');
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(dir, '..', name), 'utf8');
const cpp = (name) => fs.readFileSync(path.join(dir, '..', '..', '..', '..', 'src', 'plyo', name), 'utf8');

test('UX-02 : le confirmé commence sur « Poser une question », un nouveau projet l’y laisse, « Étapes » rend le comportement habituel', () => {
  const start = J.tabAfter({ tab: 'guide', unread: false }, 'start-chat');
  assert.deepEqual(start, { tab: 'chat', unread: false, home: 'chat' });
  assert.deepEqual(J.tabAfter(start, 'reset'), { tab: 'chat', unread: false, home: 'chat' });
  assert.deepEqual(J.tabAfter(start, 'answer'), { tab: 'chat', unread: false, home: 'chat' });
  const guide = J.tabAfter(start, 'show-guide');
  assert.deepEqual(guide, { tab: 'guide', unread: false });
  assert.deepEqual(J.tabAfter(guide, 'reset'), { tab: 'guide', unread: false });
  // Le débutant : inchangé.
  assert.deepEqual(J.tabAfter({ tab: 'chat', unread: true }, 'reset'), { tab: 'guide', unread: false });
});

test('UX-02 : changer d’avis depuis le menu, et le panneau qui le dit', () => {
  assert.equal(J.startMenuLabel('expert'), 'Me guider pas à pas, panneau ouvert au lancement');
  assert.equal(J.startMenuLabel('beginner'), 'Je connais déjà : panneau fermé au lancement');
  assert.equal(J.startMenuLabel('skipped'), 'Je connais déjà : panneau fermé au lancement');
  assert.match(J.startChangeNote('expert'), /reste fermé.*un clic sur « Assistant ».*« Poser une question ».*« Étapes »/);
  assert.match(J.startChangeNote('beginner'), /s’ouvre sur le parcours en étapes/);
  const page = read('index.html');
  assert.match(page, /if \(first && state\.level === 'expert'\) applyTab\('start-chat'\)/);
  assert.match(page, /id="hello-guide"[^>]*>Me guider pas à pas \(onglet « Étapes »\)</);
  assert.match(page, /type: 'firststeps_set', patch: \{ level: level \}/);
  // Côté slicer : panneau fermé au lancement pour « expert » seulement ; l'accueil le dit.
  assert.match(cpp('PlyoFirstSteps.cpp'), /ProjectLogic::opens_panel_at_startup\(Json::str\(load_state\(\), "level"\)\)/);
  assert.match(cpp('PlyoProjectLogic.cpp'), /return level != "expert";/);
  assert.match(read('welcome.html'), /Je me débrouille : tu restes à un clic, sous « Assistant »\./);
});

test('UX-33 : « Comme la dernière fois » pour le confirmé seulement, avec des réponses valides', () => {
  const last = { use: 'daily', pref: 'balanced', speed: 'normal' };
  assert.equal(I.repeatText(last), 'Comme la dernière fois : objet du quotidien, équilibrée, normal');
  assert.equal(I.repeatText({ use: 'test' }), 'Comme la dernière fois : test rapide');
  assert.equal(I.repeatText({ use: 'daily', pref: 'top', speed: 'normal' }), '', 'préférence d’un autre usage');
  assert.equal(I.repeatText(null), '');
  assert.equal(I.offersRepeat('expert', last, {}), true);
  assert.equal(I.offersRepeat('beginner', last, {}), false, 'le débutant garde les trois questions');
  assert.equal(I.offersRepeat('skipped', last, {}), false);
  assert.equal(I.offersRepeat('expert', last, { use: 'deco' }), false, 'une réponse déjà donnée : les questions continuent');
  assert.equal(I.offersRepeat('expert', null, {}), false, 'première pièce');
  assert.deepEqual(J.primaryAction('preparer', { intent: 'repeat' }), { label: 'Préparer', kind: 'repeatIntent', enabled: true });
  assert.equal(J.prompt('preparer', { intent: 'repeat' }), 'Même usage que ta dernière pièce ?');
  const page = read('index.html');
  assert.match(page, /PlyoIntent\.offersRepeat\(fsState\.level, habits\.last_intent, answers\)/);
  assert.match(page, /if \(lastAnswers\) habits\.last_intent = lastAnswers;/);
  assert.match(page, /fsState\.level === 'expert' && PlyoMachines\.askIntent\(habits\) && !PlyoMachines\.offerStopAsking\(habits\)/);
  assert.match(cpp('PlyoProjectLogic.cpp'), /"last_intent"/);
});

test('UX-33 : la ligne « Comme la dernière fois » a « Changer » et « Je règle moi-même »', () => {
  const Steps = require('../journey-steps.js');
  const made = [];
  const node = (tag, cls, text) => { const n = { tag, cls, text: text || '', childNodes: [], appendChild(c) { this.childNodes.push(c); return c; } }; made.push(n); return n; };
  const ui = { el: node, button: (label, fn, cls) => node('button', cls, label), icon: () => node('i') };
  const slot = { textContent: '', childNodes: [], appendChild(c) { this.childNodes.push(c); return c; } };
  Steps.render(slot, ui, { step: 'preparer', ctx: { sliced: false }, intent: { mode: 'repeat', text: I.repeatText({ use: 'daily', pref: 'balanced', speed: 'normal' }) }, handlers: {} });
  const texts = made.map((n) => n.text);
  assert.ok(texts.includes('Comme la dernière fois : objet du quotidien, équilibrée, normal'));
  assert.ok(texts.includes('Changer'));
  assert.ok(texts.includes('Je règle moi-même'));
});

test('UX-31 : la question des retouches d’impression, dans le ton du panneau', () => {
  const p = { preset: '0.20mm Standard', project: 'crochet', changes: [{ key: 'outer_wall_speed', label: 'Vitesse des parois extérieures', before: 200, after: 150 }, { key: 'wall_loops', label: 'Parois', before: 2, after: 3 }] };
  assert.equal(R.printQuestion(p), 'Tu as retouché ton profil d’impression « 0.20mm Standard » (Vitesse des parois extérieures, Parois) pendant le projet « crochet ». Ces retouches restent avec ce projet. Les garder aussi dans ton profil, pour tes prochains projets ?');
  assert.equal(R.printDetail(p), 'Ce que tu as changé : vitesse des parois extérieures 200 → 150, parois 2 → 3.');
  assert.equal(R.printQuestion({ preset: 'x', changes: [] }), '');
  assert.match(R.printQuestion({ preset: 'x', changes: [{ key: 'a', label: 'A' }] }), /pendant ton projet d’avant\./);
  assert.equal(R.KEEP_LABEL, 'Les garder dans mon profil');
  assert.equal(R.ONLY_LABEL, 'Seulement pour ce projet');
  const many = Array.from({ length: 5 }, (_, i) => ({ key: 'k' + i, label: 'R' + i, before: 0.1, after: 0.2 }));
  assert.equal(R.changeList(many), 'r0 0,1 → 0,2, r1 0,1 → 0,2, r2 0,1 → 0,2, et 2 autres réglages');
  const page = read('index.html');
  for (const t of ['print_retouches', 'print_retouches_kept', 'print_retouches_undone']) assert.ok(page.includes("msg.type === '" + t + "'"), t);
  const assistant = cpp('PlyoAssistant.cpp');
  for (const t of ['retouches_get', 'retouches_keep', 'retouches_undo', 'retouches_dismiss']) assert.ok(assistant.includes('"' + t + '"'), t);
  // Capture avant chaque oubli des réglages d'impression (question d'Orca, nouveau projet du panneau, reprise d'un projet).
  assert.equal((cpp('PlyoProjectFiles.cpp').match(/Retouches::capture_print\(/g) || []).length, 3);
});

test('UX-32 : retouche du filament gardée dans la bobine, avec « Annuler » ; échec expliqué avec « Montre-moi où il est »', () => {
  assert.equal(R.spoolKeptText('Sunlu PLA+ noir', [{ key: 'filament_flow_ratio', label: 'Débit', before: 0.98, after: 0.95 }]), 'Gardé dans ta bobine « Sunlu PLA+ noir » : débit 0,98 → 0,95.');
  assert.equal(R.spoolKeptText('x', []), '');
  assert.equal(R.spoolFailText('temperatures', 'Température de la buse (première couche)', 'Sunlu PLA+ noir'),
    'Je n’ai pas pu garder ce changement dans ta bobine « Sunlu PLA+ noir » : l’écart entre la température de la première couche et celle des autres couches dépasse ce qu’Orca accepte (« Température de la buse (première couche) »). Rapproche-les dans l’onglet Filament : je la garde dès que c’est bon.');
  assert.match(R.spoolFailText('write', '', ''), /^Je n’ai pas pu garder ce changement dans ta bobine : Orca n’a pas pu écrire son fichier\./);
  const page = read('index.html');
  assert.match(page, /type: 'spool_kept_undo', token: token/);
  assert.match(page, /button\('Montre-moi où il est', function \(\) \{ showSetting\(msg\.key\); \}/);
  const autosave = cpp('PlyoAutoSave.cpp');
  assert.match(autosave, /Retouches::spool_not_saved\("temperatures"/);
  assert.match(autosave, /Retouches::spool_saved\(before\);/);
});

test('UX-34 : calibrer cette bobine, en direct ; seule la lecture de la photo utilise la jauge', () => {
  assert.deepEqual(R.CALIB_CHOICES.map((c) => c.label), ['Débit (≈ 20 min par passe)', 'Température (≈ 45 min)', 'Rétraction (≈ 40 min)']);
  assert.deepEqual(R.CALIB_CHOICES.map((c) => c.test), ['flow', 'temperature', 'retraction']);
  assert.match(R.calibIntro('Sunlu PLA+ noir'), /Lancer un test est gratuit ; seule la lecture de la photo du test par l’assistant utilise ta jauge\./);
  const page = read('index.html');
  assert.match(page, /postRequest\(\{ type: 'calib_start', test: c\.test, pass: 1 \}\)/);
  assert.match(read('project-card.js'), /'Calibrer cette bobine', h\.calibrate, 'link'/);
});

test('UX-35 : filament changé dans Orca : carte avec adoption (nom demandé) et rattachement au projet', () => {
  assert.equal(R.sameFilament('Sunlu PLA+ noir', 'Sunlu PLA+ noir'), true);
  assert.equal(R.sameFilament('Generic PLA', 'Generic PLA (Plyo)'), true);
  assert.equal(R.sameFilament('Sunlu PLA+ noir', 'My eSun PLA+'), false);
  const d = R.filamentDivergence('My eSun PLA+', { preset: 'Sunlu', spool: { id: 's1', name: 'Sunlu PLA+ noir' } });
  assert.equal(d.text, 'Orca est passé sur **My eSun PLA+**, mais ton projet utilise **Sunlu PLA+ noir**.');
  assert.equal(d.use, 'Utiliser « My eSun PLA+ » pour ce projet');
  assert.equal(d.restore, 'Remettre Sunlu PLA+ noir');
  assert.equal(R.adoptionPath({ spool: { id: 'a', name: 'b' } }), 'attach');
  assert.equal(R.adoptionPath({ spool: null, adoptable: true }), 'name');
  assert.equal(R.adoptionPath({ spool: null, adoptable: false }), 'none');
  const page = read('index.html');
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'spool_adopt', preset: preset, name: PlyoSpools\.cleanName\(input\.value\) \}\)/);
  assert.ok(!/name: msg\.preset \}\); \}, 'btn ghost sm', 'check'/.test(page), 'plus d’adoption sous le nom du profil sans le demander');
  assert.match(page, /attachSpoolToProject\(\{ id: msg\.id, name: msg\.name \}, attach\.material\)/);
  assert.match(cpp('PlyoAssistant.cpp'), /"spool_about_current"/);
});

test('UX-36 : valeurs du filament du fichier non reprises : dit, avec « Prendre ceux du fichier »', () => {
  assert.equal(R.fileFilamentText({ spool: 'Sunlu PLA+ noir', changes: [{ key: 'nozzle_temperature', label: 'Température de la buse', before: 215, after: 235 }] }),
    'Ton fichier avait ses propres réglages de filament (température de la buse 235) : j’ai gardé ceux de ta bobine « Sunlu PLA+ noir ».');
  assert.equal(R.fileFilamentText({ changes: [] }), '');
  assert.equal(R.TAKE_FILE_LABEL, 'Prendre ceux du fichier');
  assert.match(cpp('PlyoProjectFiles.cpp'), /Retouches::capture_file_filament\(\);[^\n]*\n\s*discard\(false, true, SettingsBridge::DropReason::Import\)/);
  assert.match(read('index.html'), /postRequest\(\{ type: 'undo', undo_id: undoId \}\)/);
});

test('reliquat lot 10 : erreur sans code après « 100 % » : fichier arrivé, démarrage non confirmé', () => {
  const v = PF.uploadFailureView({ code: 'no_confirmation', step: 'sent', text: '' }, 'CC2');
  assert.equal(v.text, 'Le fichier est bien arrivé sur CC2, mais elle n’a pas confirmé le démarrage de l’impression. Regarde son écran : si elle imprime, dis-le-moi ; sinon, lance le fichier depuis son écran, ou réessaie l’envoi.');
  assert.deepEqual(v.actions.map((a) => a.kind), ['printing', 'retry', 'link', 'ask']);
  assert.equal(v.actions[0].label, 'Elle imprime');
  assert.equal(v.title, 'Démarrage non confirmé sur CC2');
  assert.equal(v.tone, 'warn');
  assert.doesNotMatch(v.text, /pas arrivé en entier/);
  assert.match(cpp('PlyoSendLogic.cpp'), /return step == "sent" \? "no_confirmation" : "interrupted";/);
  assert.match(read('index.html'), /a\.kind === 'printing'\) \{ card\.box\.remove\(\); if \(conv\) stepHandlers\.started\(\); \}/);
});

test('banc : la fin ferme d’abord les fenêtres modales d’Orca, en nombre borné, puis quitte au tour suivant', () => {
  const st = cpp('PlyoSelfTest.cpp');
  assert.match(st, /OrcaWindows::answer_top_modal\("cancel"\)/);
  assert.match(st, /s_quit_closes < MAX_MODAL_CLOSES/);
  assert.match(st, /CallAfter\(\[\] \{\s*if \(Slic3r::GUI::MainFrame\* frame = Slic3r::GUI::wxGetApp\(\)\.mainframe\)\s*frame->Close\(true\);/);
});
