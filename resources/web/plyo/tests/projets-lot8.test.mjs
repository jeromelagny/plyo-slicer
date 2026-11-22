// Lot 8 de l'audit (projets, mots et libellés) : reprise d'un projet à l'ouverture, « Mes projets » (titre, étape,
// suppression confirmée, rangement dit), notes d'étape qui survivent, un seul mot côté utilisateur, jauge annoncée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (name) => fs.readFileSync(path.join(here, '..', name), 'utf8');

const BOAT = 'Petit bateau de test (3DBenchy)';
const local = (y, m, d, h) => new Date(y, m - 1, d, h).toISOString();
const proj = (extra) => Object.assign({ printer: { preset: 'K1C', name: 'K1C' }, filament: { preset: 'f', type: 'PLA', temps_ok: true, spool: { id: 'b', name: 'Sunlu' } }, part: { name: BOAT } }, extra);

test('UX-12 (point 12) : le titre d’un projet est le nom de la pièce, puis la date et l’étape atteinte', () => {
  const at = local(2026, 11, 12, 15);
  assert.deepEqual(L.projectEntry({ title: 'Mes fils, que faire ?', updated: at, project: proj({ step: 'print' }) }),
    { title: BOAT, detail: '12 novembre · prêt à imprimer', hasPart: true });
  assert.equal(L.projectEntry({ updated: at, project: proj({ step: 'after', success: true }) }).detail, 'Imprimé le 12 novembre, réussi');
  assert.equal(L.projectEntry({ updated: at, project: proj({ step: 'after', send: { failed: true } }) }).detail, 'Imprimé le 12 novembre, raté');
  assert.equal(L.projectEntry({ updated: at, project: proj({ step: 'after' }) }).detail, 'Imprimé le 12 novembre');
  assert.equal(L.projectEntry({ updated: at, project: proj({}) }).detail, '12 novembre · à préparer');
  assert.equal(L.projectEntry({ updated: at, project: { printer: { preset: 'K1C' }, filament: null, part: { name: 'crochet.stl' } } }).detail, '12 novembre · à compléter');
  // Sans pièce : la première question reste le titre (ancienne conversation, ou simple question).
  assert.deepEqual(L.projectEntry({ title: 'Mes fils, que faire ?', updated: at, project: { printer: null, filament: null, part: null } }),
    { title: 'Mes fils, que faire ?', detail: 'Question du 12 novembre', hasPart: false });
  // Données anciennes ou abîmées : jamais d'exception, toujours un titre.
  assert.equal(L.projectEntry({}).title, 'Projet sans nom');
  assert.equal(L.projectEntry({ title: 'x', project: 'abîmé' }).title, 'x');
  assert.equal(L.projectEntry(null).title, 'Projet sans nom');
});

test('UX-07 : le projet proposé à la reprise est le plus récent qui a une pièce, s’il a moins de 48 h', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const items = [
    { id: 'q', updated: '2026-11-12T11:00:00Z', project: { part: null } },
    { id: 'a', updated: '2026-11-11T09:00:00Z', project: proj({}) },
    { id: 'b', updated: '2026-11-10T09:00:00Z', project: proj({}) }
  ];
  assert.equal(L.resumeCandidate(items, now).id, 'a', 'une simple question ne se propose pas à la reprise');
  assert.equal(L.resumeCandidate([items[2]], now), null, 'plus de 48 h : rien n’est proposé');
  assert.equal(L.resumeCandidate([], now), null);
  assert.equal(L.resumeCandidate(undefined, now), null);
  assert.equal(L.resumeCandidate([{ id: 'z', updated: 'pas une date', project: proj({}) }], now), null);
  assert.equal(L.RESUME_MS, 48 * 3600 * 1000);
});

test('UX-08 : la suppression est demandée avec le nom, et un projet rangé pour faire de la place est dit', () => {
  assert.equal(L.deleteQuestion({ title: BOAT, hasPart: true }), 'Supprimer « ' + BOAT + ' » et son plateau ?');
  assert.equal(L.deleteQuestion({ title: 'Mes fils ?', hasPart: false }), 'Supprimer « Mes fils ? » ?');
  assert.match(L.prunedText('crochet.stl'), /^J’ai rangé ton projet le plus ancien, « crochet\.stl », pour faire de la place/);
  const page = read('index.html');
  // Jamais en un clic : la croix ouvre la question dans la ligne, « Garder » la remet.
  assert.ok(/del\.addEventListener\('click', function \(\) \{ confirmDelete\(row, it, entry\); \}\)/.test(page));
  assert.ok(/button\('Supprimer', function \(\) \{[\s\S]{0,160}conv_delete/.test(page) && page.includes("button('Garder'"));
  assert.ok(page.includes("msg.type === 'conv_pruned'"), 'le rangement est écouté');
  // Le bouton de « Mes pièces » n'existe que pour un projet encore gardé.
  assert.ok(/projects\.indexOf\(e\.conv\) >= 0/.test(page) && page.includes('Son projet a été supprimé'));
  assert.ok(!page.includes('Cette conversation n’a pas pu être ouverte.'), 'plus d’erreur sans issue');
});

test('UX-07 : à l’ouverture, le plateau attaché rouvre sa conversation, sinon détachement et offre de reprise', () => {
  const page = read('index.html');
  const boot = page.slice(page.lastIndexOf('startConversation();'));
  assert.ok(boot.includes("type: 'project_resume_get'"), 'le panneau demande la reprise au slicer');
  assert.ok(!/^\s*detachPlate\(\);/m.test(boot), 'plus de détachement d’office avant la réponse');
  assert.ok(/restoreConversation\(msg\.attached, msg\.conversation, true\)/.test(page));
  assert.ok(/if \(attached\) \{\s*attachPlate\(\);/.test(page), 'le plateau attaché n’est pas rechargé');
  // L'offre n'apparaît jamais sur une pièce déjà posée (elle serait remplacée).
  assert.ok(/tourSignals && tourSignals\.objects > 0\)\) return;/.test(page));
  assert.ok(page.includes("button('Reprendre'") && page.includes("button('Nouveau projet', function () { resumeUI.offer = null; resumeUI.declined = true;"));
  const cpp = fs.readFileSync(new URL('../../../../src/plyo/PlyoAssistant.cpp', import.meta.url), 'utf8');
  assert.ok(cpp.includes('type == "project_resume_get"') && cpp.includes('{"type", "conv_pruned"}'));
});

test('notes d’étape : une note qui porte une action ou une erreur survit au changement d’étape, trois au plus', () => {
  const page = read('index.html');
  assert.ok(/if \(step !== journeyUI\.lastStep\) \{ clearStepNotes\(\);/.test(page));
  const fn = page.slice(page.indexOf('function clearStepNotes'), page.indexOf('function renderProject'));
  assert.ok(fn.includes('!b.disabled') && fn.includes("classList.contains('error')") && fn.includes('slice(-KEPT_NOTES)'));
  assert.ok(/var KEPT_NOTES = 3;/.test(page));
});

test('UX-09 : un seul mot côté utilisateur, « projet » (les noms internes ne changent pas)', () => {
  const files = ['index.html', 'assistant-logic.js', 'project-logic.js', 'journey-logic.js', 'journey-steps.js', 'project-card.js', 'machines-view.js', 'preflight.js', 'welcome.html', 'login.html', 'phone.html'];
  for (const f of files) {
    // Textes entre guillemets seulement (les commentaires et les identifiants gardent « conversation »).
    const strings = [...read(f).replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '').matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).filter((s) => /\s/.test(s));
    const bad = strings.filter((s) => /[Cc]onversation|Nouvelle pièce|Mes explications|Dernier filament/.test(s));
    assert.deepEqual(bad, [], f);
  }
  const page = read('index.html');
  assert.ok(page.includes('>Nouveau projet</button>') && page.includes('>Mes projets</button>') && page.includes('>Mes pièces</button>'));
  // Lot UX 4 : préférence à coche, qui dit l'état en cours (le clic bascule toujours d'un niveau à l'autre).
  assert.ok(page.includes('id="m-level" role="menuitemcheckbox"') && page.includes(">Réponses courtes</button>"), 'UX-18 : la préférence et son état');
  assert.ok(page.includes("$('m-level').setAttribute('aria-checked', String(PlyoMachines.levelOf(habits) === 'short'));"));
});

test('UX-14 : plus jamais « enregistre le préréglage » dans les textes visibles', () => {
  const sources = ['index.html', 'assistant-logic.js', 'project-logic.js'].map(read).join('\n');
  assert.doesNotMatch(sources, /enregistre-le|Enregistre-le toi-même|Enregistre ou abandonne/);
  const cpp = ['PlyoCanvas.cpp', 'PlyoSpools.cpp', 'PlyoCalibration.cpp'].map((f) => fs.readFileSync(new URL('../../../../src/plyo/' + f, import.meta.url), 'utf8')).join('\n');
  // Messages montrés (refus, textes) : « profil », jamais « préréglage » (les journaux techniques gardent leurs mots).
  assert.doesNotMatch(cpp, /Enregistre ou abandonne|refuse\("[^"\n]*préréglage|\{"text", "[^"\n]*préréglage/);
  // Le changement d'emplacements garde d'abord les réglages en cours dans la bobine.
  assert.ok(/AutoSave::flush_spool\(\) == SpoolsLogic::Flush::Refuse/.test(cpp));
});

// Parcours débutant, lot 1 (22/11) : la mention répétée « (utilise ta jauge) » donnait l'impression de payer chaque réponse
// (effet taximètre). Les boutons gardent leur libellé seul ; la jauge reste dans l'en-tête, et les actions lourdes (photo lue,
// pièce dessinée) portent une petite étincelle « Action de l'assistant IA ».
test('UX-26 (révisé) : plus de « (utilise ta jauge) » sur les boutons, les actions IA lourdes ont leur repère', () => {
  const page = read('index.html');
  const sources = [page, ...['assistant-logic.js', 'journey-logic.js', 'preflight.js', 'journey-steps.js', 'project-card.js', 'design-flow.js'].map(read)].join('\n');
  assert.doesNotMatch(sources, /\(utilise ta jauge\)/);
  for (const label of ['Conseille-moi des réglages pour cette pièce', 'Et dans mon cas, je mets combien ?', 'En parler à l’assistant', 'Envoyer mes réponses', 'Renvoyer ma question'])
    assert.ok(page.includes("button('" + label + "'"), label);
  assert.ok(page.includes('Ou choisis un objectif</p>'));
  assert.equal(L.noteHint(0, 500), 'Entrée pour envoyer');
  // Repère des actions lourdes : la classe « ai » ajoute l'étincelle et la bulle d'aide.
  assert.ok(page.includes("if (!b.title) b.title = fr('Action de l’assistant IA');"));
  assert.ok(read('project-card.js').includes("crée-moi une pièce', h.designOpen, 'btn ghost sm ai', 'wand')"));
  assert.ok(page.includes("button(PlyoJourney.PHOTO_PHONE, function () { openPhone(); }, 'btn sm ai')"));
  // « Chercher une autre piste » ne fait que préremplir le champ : gratuit, sans mention.
  assert.ok(page.includes("button('Chercher une autre piste', function"));
});

test('UX-30 : la connexion dit qu’un compte se crée avec le code', () => {
  assert.ok(read('login.html').includes('Connecte-toi pour que l’IA te réponde. Pas de mot de passe&nbsp;: tu reçois un code par e-mail. Pas encore de compte&nbsp;? Ce code le crée.'));
});
