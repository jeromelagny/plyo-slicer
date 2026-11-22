// Non-régression des bugs trouvés en simulation dans le vrai slicer (novembre 2026).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, '..', name), 'utf8');
const cpp = (name) => fs.readFileSync(path.join(here, '..', '..', '..', '..', 'src', 'plyo', name), 'utf8');
const require = createRequire(import.meta.url);
const P = require('../project-logic.js');
const J = require('../journey-logic.js');
const PF = require('../preflight.js');

const settings = { brim_type: 'no_brim', brim_width: 0, support: false };
const cube = (name) => ({ name, height: 20, foot: [20, 20], contact_mm2: 400, needs_support: false, fits: true });

test('B1 : choisir un fichier remplace seulement une pièce restée du projet précédent', () => {
  const old = { label: 'porte-cles.stl', name: 'porte-cles.stl', objects: 1 };
  assert.equal(P.replacesPlate({ part: null }, old, false), true);
  assert.equal(P.replacesPlate({ part: null }, null, true), true, 'fichier déposé avant le choix de la machine');
  assert.equal(P.replacesPlate({ part: null }, null, false), false, 'plateau sans ancienne pièce connue');
  assert.equal(P.replacesPlate({ part: { name: 'crochet.stl' } }, null, false), false, 'reprise : la pièce du projet est reposée, rien n’est retiré');
  assert.equal(P.replacesPlate({ part: { name: 'crochet.stl' } }, old, true), false, 'une pièce déjà dans la fiche n’est jamais remplacée en silence');
});

test('B1 : le message dit quelle pièce est partie, et la phrase de l’étape Pièce le dit avant', () => {
  assert.match(P.replacedText('porte-cles.stl', 1), /« porte-cles\.stl » retirée du plateau/);
  assert.match(P.replacedText('x', 3), /Les 3 pièces/);
  assert.match(read('project-card.js'), /Si tu choisis un fichier, elle sera retirée, et tu pourras annuler/);
  assert.match(read('project-card.js'), /Garder cette pièce/, '« Garder cette pièce » reste un choix explicite');
  assert.ok(!/supprime-la avant de découper/.test(read('index.html')), 'plus de consigne de suppression à la main');
});

test('B1 : un conflit de trajets est un risque, en tête, avec une correction', () => {
  const data = { settings, objects: [cube('a.stl'), cube('b.stl')], sliced: true, conflict: { a: 'a.stl', b: 'b.stl', height: 0.2 } };
  const risks = PF.preflightRisks(data);
  assert.equal(risks[0].kind, 'conflict');
  assert.match(risks[0].text, /« a\.stl » et « b\.stl » se chevauchent/);
  assert.equal(risks[0].fixes[0].action, 'arrange');
  const plan = PF.preflightPlan(data);
  assert.equal(plan.count, 2);
  assert.deepEqual(plan.fixes.map((f) => f.key), ['arrange']);
  assert.equal(plan.fixes[0].checked, true);
  assert.deepEqual(PF.preflightRisks({ settings, objects: [cube('a.stl')], sliced: true }), [], 'sans conflit : aucun risque');
  assert.equal(PF.preflightRisks({ settings, objects: [], conflict: { a: '', b: '' } })[0].objects[0], 'Ta plaque');
});

test('B1 : jamais « Pas de risque détecté » quand un risque existe, même déjà ignoré', () => {
  assert.match(J.advanceNote(0).text, /Pas de risque détecté/);
  assert.ok(!/Pas de risque/.test(J.advanceNote(1).text));
  assert.equal(J.advanceNote(1).tone, 'warn');
  const page = read('index.html');
  assert.equal(page.split('Pas de risque détecté').length, 1, 'le texte vit dans advanceNote, pas en dur dans la page');
  assert.match(page, /advanceNote\(risks\.length\)/, 'calculé sur tous les risques, ignorés compris');
});

test('B1 : la vérification C++ lit le conflit, le remplacement est une seule étape annulable', () => {
  assert.match(cpp('PlyoPreflight.cpp'), /conflict_result/);
  const imp = cpp('PlyoModelImport.cpp');
  assert.match(imp, /TakeSnapshot snapshot\(plater/);
  assert.ok(imp.indexOf('TakeSnapshot snapshot') < imp.indexOf('delete_all_objects_from_model'));
  assert.match(imp, /plater->undo\(\); \/\/ le fichier ne s'ouvre pas/);
});

const L = require('../assistant-logic.js');
const M = require('../machines-logic.js');

test('B2 : la découpe est refusée avant d’être postée, et le panneau arrête d’attendre', () => {
  const c = cpp('PlyoPlateActions.cpp');
  const slice = c.slice(c.indexOf('if (kind == "slice")'));
  assert.ok(slice.indexOf('slice_refusal') < slice.indexOf('wxPostEvent'), 'vérifié avant de poster');
  assert.match(c, /"reason", "too_big"/);
  const page = read('index.html');
  assert.match(page, /if \(msg\.kind === 'slice'\) \{ if \(!msg\.ok\) stopSlicing\(\);/);
  assert.match(page, /msg\.reason === 'too_big'[\s\S]{0,160}showTooBig\(\{ msg: msg, reduced: false \}, true\)/);
});

test('B2 : « J’ai réduit » seulement si la taille mesurée a changé', () => {
  const c = cpp('PlyoPlateActions.cpp');
  assert.match(c, /same_sizes\(sizes_before, sizes_after\)/);
  const scale = c.slice(c.indexOf('if (kind == "scale_to_fit")'), c.indexOf('if (kind == "slice")'));
  assert.ok(scale.indexOf('same_sizes') < scale.indexOf('done(before'), 'la mesure passe avant le succès');
  assert.ok(scale.indexOf('all_fit(sizes_before') < scale.indexOf('scale_selection_to_fit_print_volume'), 'une pièce qui tient n’est jamais agrandie');
});

test('B2 : relances automatiques bornées', () => {
  assert.equal(L.plateRetryDelay({ ok: true, kind: 'slice' }, 0), 0);
  assert.equal(L.plateRetryDelay({ ok: false, kind: 'slice', reason: 'too_big' }, 0), 0);
  assert.equal(L.plateRetryDelay({ ok: false, kind: 'slice', reason: 'busy' }, 0), 500);
  assert.equal(L.plateRetryDelay({ ok: false, kind: 'slice', reason: 'busy' }, 20), 0);
  assert.equal(L.plateRetryDelay({ ok: false, kind: 'undo', reason: 'busy' }, 0), 0);
  assert.equal(L.plateRetryDelay({ ok: false, kind: 'scale_to_fit', reason: 'no_effect' }, 0), 600);
  assert.equal(L.plateRetryDelay({ ok: false, kind: 'scale_to_fit', reason: 'no_effect' }, 1), 0);
});

test('B2 : la découpe repart une fois la réduction faite', () => {
  const page = read('index.html');
  assert.match(page, /projectUI\.sliceRefused === conv\) \{ projectUI\.sliceRefused = null; plateAction\('slice'\); \}/);
  assert.match(page, /msg\.kind === 'scale_to_fit' && msg\.ok\) stopSlicing\(\)/, 'plus de découpe ignorée à cause d’une attente périmée');
  assert.match(page, /refused \? 'Fermer' : 'Garder cette taille'/);
});

test('B2 : une pièce trop haute ne « tient » pas sur l’autre machine proposée', () => {
  const a = { preset: 'a', linked: true, bed_mm: [220, 220, 220] }, b = { preset: 'b', linked: true, bed_mm: [256, 256, 250] }, c = { preset: 'c', linked: true, bed_mm: [256, 256, 320] };
  assert.equal(M.machineThatFits([a, b], 'a', [40, 40, 300]), null);
  assert.equal(M.machineThatFits([a, b, c], 'a', [40, 40, 300]).preset, 'c');
  assert.equal(M.machineThatFits([{ preset: 'a', linked: true, bed_mm: [100, 100] }, { preset: 'b', linked: true, bed_mm: [256, 256] }], 'a', [200, 40, 300]).preset, 'b', 'hauteur inconnue : on ne bloque pas');
});

test('G1 : l’export ne répond qu’à sa fin réelle ; annulé, rien ne bouge', () => {
  const c = cpp('PlyoFirstSteps.cpp');
  assert.ok(!/EVT_GLTOOLBAR_EXPORT_GCODE/.test(c), 'plus de réponse immédiate après un événement posté');
  assert.match(c, /plater->export_gcode\(false\)[\s\S]{0,260}is_export_gcode_scheduled\(\)[\s\S]{0,160}"cancelled", true/);
  const orca = fs.readFileSync(path.join(here, '..', '..', '..', '..', 'src', 'slic3r', 'GUI', 'Plater.cpp'), 'utf8');
  assert.match(orca, /Plyo::FirstSteps::on_process_completed\(evt, this->background_process\.is_export_scheduled\(\), last_output_path\); \/\/ PLYO:/);
  assert.match(cpp('PlyoFirstSteps.cpp'), /if \(export_scheduled\)\n\s+on_export_done\(evt\.success\(\), evt\.error\(\) \? evt\.format_error_message\(\)\.first : std::string\(\), output_path\);/);
  const page = read('index.html');
  const done = page.slice(page.indexOf('function onExportDone'), page.indexOf('function repaintPanel'));
  assert.ok(done.indexOf('msg.cancelled) return') < done.indexOf('projectUI.sentConv = conv'), 'annulé : pas de « L’impression a démarré »');
  assert.ok(done.indexOf('msg.cancelled) return') < done.indexOf('rememberHabit'), 'annulé : l’habitude n’est pas retenue');
  assert.ok(!/Choisis où enregistrer/.test(page));
});

test('F10 : message final complet, dans l’étape, avec le chemin écrit', () => {
  const t = L.exportedText({ ok: true, folder: '/Users/moi/Desktop', file: 'crochet_PLA_1h.gcode' }, '');
  assert.match(t, /« crochet_PLA_1h\.gcode » est enregistré dans \/Users\/moi\/Desktop\./);
  assert.match(t, /Copie-le sur ta clé USB ou ta carte SD, puis lance-le depuis l’écran de ton imprimante\.$/);
  assert.match(L.exportedText({ ok: true, folder: '/x', file: '' }, 'Note.'), /^Le fichier est enregistré dans \/x\..*Note\.$/);
  assert.match(read('journey-steps.js'), /opts\.exported/);
  assert.match(read('index.html'), /\.printer-step\.exported \{ overflow-wrap: anywhere; \}/);
});

test('F9 : dossier proposé : le dernier choisi, sinon le Bureau, jamais plyo/modeles', () => {
  const c = cpp('PlyoFirstSteps.cpp');
  const fn = c.slice(c.indexOf('void prefer_user_folder'), c.indexOf('void export_file'));
  assert.match(fn, /get_last_output_dir\(std::string\(\), false\)/);
  assert.match(fn, /Dir_Desktop/);
  assert.match(fn, /rfind\(inner, 0\) != 0\)\n\s+return;/, 'un dossier choisi hors de plyo/ est gardé');
});

test('G2 : rendu forcé au retour de la fenêtre native', () => {
  const page = read('index.html');
  assert.match(page, /function onPrintStarted\(msg\) \{\n\s+repaintPanel\(\);/);
  assert.match(page, /window\.addEventListener\('focus', repaintPanel\)/);
});

test('G5 : une pièce réussie ou exportée entre dans « Mes pièces », sans écraser un défaut déjà noté', () => {
  const page = read('index.html');
  assert.match(page, /success: function \(\) \{ conv\.project\.success = true; journalPart\('ok'\);/);
  assert.match(page, /started: function \(\) \{ rememberHabit\(\); journalPart\(''\);/);
  const done = page.slice(page.indexOf('function onExportDone'), page.indexOf('function repaintPanel'));
  assert.ok(done.indexOf('msg.cancelled) return') < done.indexOf("journalPart('')"), 'annulé : rien dans le journal');
  assert.match(cpp('PlyoJournal.cpp'), /if \(!defect\.empty\(\) \|\| !e->contains\("defect"\)\)/);
  assert.deepEqual(L.journalStatus({ changes: [], outcome: 'ok' }), { label: 'Réussi', tone: 'ok' });
  assert.deepEqual(L.journalStatus({ changes: [] }), { label: 'Sans réglage', tone: '' });
  assert.equal(L.journalProblem({ problem: 'Fils', defect: 'stringing' }), 'Fils');
  assert.equal(L.journalProblem({ problem: '', defect: 'stringing' }), 'Question à l’assistant');
  assert.equal(L.journalProblem({ problem: '', defect: '', outcome: 'ok' }), 'Imprimée, réussie');
  assert.equal(L.journalProblem({ problem: '', defect: '' }), 'Fichier préparé pour l’impression');
});

test('G5 : le suffixe « (Plyo) » ne fait pas croire à une autre imprimante ou un autre filament', () => {
  const e = { printer: 'Bambu Lab A1 0.4 nozzle', filament: 'Generic PLA @BBL A1', changes: [{ id: 'x', after: 1 }], outcome: 'ok' };
  assert.deepEqual(L.reapplyChanges(e, { printer: 'Bambu Lab A1 0.4 nozzle', filament: 'Generic PLA @BBL A1 (Plyo)' }), [{ id: 'x', value: 1 }]);
  assert.equal(L.reapplyChanges(e, { printer: 'Bambu Lab A1 0.4 nozzle', filament: 'Generic PETG @BBL A1' }), null);
  assert.equal(L.reapplyChanges(e, { printer: 'Autre', filament: 'Generic PLA @BBL A1' }), null);
});

test('G6 : une seule machine installée et non masquée : elle est prise, reliée ou non', () => {
  const ender = { preset: 'Creality Ender-3 Pro 0.4 nozzle', name: 'Creality Ender-3 Pro 0.4 nozzle', linked: false };
  const q = M.machineQuestion([ender], { orcaPreset: '', lastPreset: '', hidden: [] });
  assert.equal(q.mode, 'auto');
  assert.equal(q.machine.preset, ender.preset);
  assert.equal(M.machineQuestion([ender], { orcaPreset: '', lastPreset: '', hidden: [ender.preset] }).mode, 'setup', 'masquée : jamais prise');
  const a1 = { preset: 'Bambu Lab A1 0.4 nozzle', name: 'Bambu Lab A1 0.4 nozzle', linked: false };
  assert.equal(M.machineQuestion([ender, a1], { hidden: [] }).mode, 'setup', 'deux non reliées : on demande');
  assert.equal(M.machineQuestion([ender, a1], { hidden: [a1.preset] }).machine.preset, ender.preset, 'l’autre est masquée : une seule reste');
  const linked = { preset: 'Ma K2', name: 'Ma K2', linked: true };
  assert.equal(M.machineQuestion([ender, linked], { hidden: [] }).machine.preset, 'Ma K2', 'une reliée reste prioritaire');
  assert.match(read('index.html'), /p\.printer\.proposed\) && !projectUI\.showList\)/, '« changer » ne se fait pas rattraper par le choix automatique');
  assert.match(read('project-card.js'), /row\.line !== 'part'\) r\.appendChild\(ui\.button\('changer'/, '`changer` dans la fiche');
});

test('G10 : les boutons de connexion restent dans la fenêtre après une erreur', () => {
  const page = read('login.html');
  assert.match(page, /main \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
  assert.match(page, /footer \{ flex: none;/);
  assert.match(cpp('PlyoLoginDialog.cpp'), /wxSize\(460, 500\)/);
});

test('F1 : pas de correction automatique sur le nom de l’imprimante', () => {
  const page = read('index.html');
  assert.match(page, /setAttribute\('autocorrect', 'off'\)/);
  assert.match(page, /setAttribute\('spellcheck', 'false'\)/);
});

test('F2 : les textes citent les boutons du panneau, les mêmes sur toutes les marques', () => {
  const page = read('index.html');
  assert.ok(!/Exporter le fichier G-code/.test(page), 'ce libellé n’existe pas sur les machines Bambu');
  assert.ok(!/`Imprimer la plaque`/.test(page), 'le panneau cite son propre bouton');
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: false }).label, 'Exporter le fichier');
  assert.equal(J.primaryAction('imprimer', { sliced: true, linked: true }).label, 'Envoyer et imprimer');
  assert.match(page, /`Exporter le fichier`, puis copie-le/);
  assert.match(page, /`Envoyer et imprimer` lui enverra/);
});

test('F5 : on dit quand le choix de la matière change le profil de filament', () => {
  assert.match(J.profileChangeNote('Bambu PLA Basic @BBL A1', 'Generic PLA @BBL A1'), /« Bambu PLA Basic @BBL A1 » devient « Generic PLA @BBL A1 »/);
  assert.equal(J.profileChangeNote('Generic PLA @BBL A1 (Plyo)', 'Generic PLA @BBL A1'), '', 'même profil, simple copie');
  assert.equal(J.profileChangeNote('', 'Generic PLA'), '');
  assert.match(read('index.html'), /profileBefore: lastValues && lastValues\.context/);
});

test('F6 et M7 : la fiche repliée parle simplement et tient sur une ligne', () => {
  const base = { printer: { name: 'Bambu Lab A1 0.4 nozzle', preset: 'a' }, part: { name: 'support.stl' }, filament: { type: 'PLA', preset: 'f', nozzle_temp: 220, bed_temp: 65 } };
  assert.equal(J.ficheSummary(base), 'Bambu Lab A1 · support.stl · PLA');
  assert.ok(!/220|65/.test(J.ficheSummary(base)));
  const slot = J.ficheSummary({ ...base, canvas: [{ t: 0, tray_id: 0, label: '1', color: '' }] });
  assert.ok(!/emplacement/.test(slot), slot);
  assert.match(J.ficheSummary({ ...base, canvas: [{ t: 0, tray_id: 0 }, { t: 1, tray_id: 1 }] }), /PLA · 2 bobines$/);
  assert.match(J.ficheSummary({ ...base, canvas: [{ t: 0, tray_id: 0, system: 'u1' }, { t: 1, tray_id: 1, system: 'u1' }] }), /PLA · 2 têtes$/);
});

test('F8 : l’icône Wi-Fi seulement pour une machine reliée', () => {
  assert.match(read('project-card.js'), /printer: ctx\.linked \? 'wifi' : 'printer'/);
  assert.match(read('journey-steps.js'), /c\.linked \? 'wifi' : 'printer'/);
  const page = read('index.html');
  assert.match(page, /\n\s+printer: '<path/, 'l’icône existe');
  assert.ok(!/Ma machine n’est pas dans la liste', icon: 'wifi'/.test(page));
});

test('M1 : la liste des carrés dit qu’un carré retiré ne compte pas', () => {
  assert.match(read('index.html'), /msg\.test === 'flow'\) sheet\.appendChild\(el\('p', 'muted small', 'Si tu as retiré un carré/);
});

test('M2 : les carrés de calibration sont rangés par valeur', () => {
  const c = cpp('PlyoCalibration.cpp');
  const flow = c.slice(c.indexOf('nlohmann::json flow_test'), c.indexOf('nlohmann::json retraction_test'));
  assert.ok(flow.indexOf('std::sort(squares') < flow.indexOf('sections.push_back'), 'triés avant d’être numérotés');
});

test('M3 : « Remettre ma pièce » reste visible après un choix', () => {
  assert.match(read('index.html'), /back\.scrollIntoView\(\{ block: 'nearest' \}\)/);
});

test('M4 : la carte de connexion part avec « Oui, c’est réussi » et au nouveau projet', () => {
  const page = read('index.html');
  assert.match(page, /success: function \(\) \{[^\n]*dropLoginCard\(\); afterLogin = null;/);
  assert.match(page, /function startConversation\(project\) \{[\s\S]{0,160}dropLoginCard\(\);/);
});

test('M5 : service coupé : on ne dit plus que c’est Internet', () => {
  assert.ok(!/connexion à Internet/.test(read('login.html')));
  assert.ok(!/connexion à Internet/.test(read('assistant-logic.js')));
  assert.match(read('login.html'), /Le service Plyo ne répond pas\. Vérifie ta connexion ou réessaie plus tard\./);
  assert.equal(L.errorView('network').text, 'Le service Plyo ne répond pas. Vérifie ta connexion ou réessaie plus tard.');
});

test('M6 : « Garder ces emplacements » est grisé tant qu’une matière manque', () => {
  const C = require('../canvas-logic.js');
  const draft = [{ type: 'PLA', color: '' }, { type: '', color: '' }, { type: '', color: '' }];
  assert.equal(C.manualComplete(draft, 2), false);
  assert.equal(C.manualComplete(draft, 1), true, 'les lignes au-delà du nombre choisi ne comptent pas');
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'manual', complete: false } }).enabled, false);
  assert.equal(J.primaryAction('filament', { canvas: { mode: 'manual', complete: true } }).enabled, true);
  assert.match(read('index.html'), /manualComplete\(m\.draft, m\.count\)\) return;/);
});

test('M8 : compteur de caractères près de la limite du champ', () => {
  assert.equal(L.noteHint(10, 500), 'Entrée pour envoyer');
  assert.equal(L.noteHint(449, 500), 'Entrée pour envoyer');
  assert.equal(L.noteHint(450, 500), '450 / 500 caractères');
  assert.equal(L.noteHint(500, 500), '500 / 500 caractères');
  assert.match(read('index.html'), /noteInput\.addEventListener\('input', growNote\)/);
});

test('M9 : « J’ai réappliqué tes choix » remplace la ligne précédente', () => {
  assert.match(read('index.html'), /if \(intentUI\.doneLine\) intentUI\.doneLine\.remove\(\);\n\s+intentUI\.doneLine = noteLine\(again/);
});
