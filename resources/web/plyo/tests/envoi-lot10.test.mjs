// Lot 10 : envoi à l'imprimante et fenêtres d'Orca (UX-03, ERR-10, ERR-09, ERR-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PF = require('../preflight.js');
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(dir, '..', name), 'utf8');
const cpp = (name) => fs.readFileSync(path.join(dir, '..', '..', '..', '..', 'src', 'plyo', name), 'utf8');
const kinds = (view) => view.actions.map((a) => a.kind);

test('échec d’envoi : chaque famille a sa phrase, son titre et ses suites, jamais « démarré »', () => {
  const cases = {
    unreachable: [/Je n’arrive pas à joindre K1C : elle est peut-être éteinte/, ['retry', 'link', 'export', 'ask']],
    auth: [/^K1C refuse la connexion : le code d’accès \(ou la clé d’API\)/, ['link', 'retry', 'export', 'ask']],
    no_space: [/sa mémoire ou sa carte est sans doute pleine/, ['export', 'retry', 'ask']],
    file_refused: [/a refusé le fichier : elle n’accepte peut-être pas/, ['export', 'retry', 'ask']],
    not_printer: [/ce n’est pas K1C qui répond/, ['link', 'export', 'ask']],
    server_error: [/a répondu par une erreur/, ['retry', 'export', 'ask']],
    interrupted: [/s’est coupée pendant l’envoi : le fichier n’est pas arrivé en entier/, ['retry', 'link', 'export', 'ask']]
  };
  for (const [code, [text, acts]] of Object.entries(cases)) {
    const v = PF.uploadFailureView({ code, text: 'HTTP 500: x' }, 'K1C');
    assert.equal(v.title, 'L’envoi à K1C n’a pas abouti', code);
    assert.match(v.text, text, code);
    assert.deepEqual(kinds(v), acts, code);
    assert.doesNotMatch(v.text + v.title, /a démarré|impression démarre/, code);
  }
  const labels = PF.uploadFailureView({ code: 'unreachable' }, 'K1C').actions.map((a) => a.label);
  assert.deepEqual(labels, ['Réessayer l’envoi', 'Vérifier la liaison de mon imprimante', 'Exporter le fichier pour une carte SD ou une clé USB', 'Demander à l’assistant (utilise ta jauge)']);
});

test('échec inconnu ou refus avant l’envoi : le texte d’Orca est cité en premier, et part (nettoyé) dans la question', () => {
  const v = PF.uploadFailureView({ code: 'quelque_chose', text: 'Unable to log in to the Flashforge printer.' }, 'AD5X');
  assert.match(v.text, /je ne reconnais pas la raison\. Voici ce qu’il dit :$/);
  assert.equal(v.quoteMain, true);
  assert.equal(v.quote, 'Unable to log in to the Flashforge printer.');
  const ask = v.actions.find((a) => a.kind === 'ask');
  assert.match(ask.prompt, /Orca dit : « Unable to log in to the Flashforge printer\. »/);
  assert.doesNotMatch(ask.prompt, /AD5X/, 'le nom de l’imprimante ne part pas dans la question');
  const before = PF.uploadFailureView({ code: 'before_send', text: '' }, 'AD5X');
  assert.equal(before.text, 'Orca a refusé de lancer l’envoi.');
  assert.equal(PF.uploadFailureView({}, '').title, 'L’envoi à ton imprimante n’a pas abouti');
});

test('vérifier la liaison : une suite pour chaque résultat, sans jamais tester une adresse d’internet', () => {
  assert.deepEqual(kinds(PF.linkRecheckView({ code: 'ok' }, 'K1C')), ['retry']);
  assert.match(PF.linkRecheckView({ code: 'auth' }, 'K1C').text, /refuse le code d’accès/);
  assert.deepEqual(kinds(PF.linkRecheckView({ code: 'auth' }, 'K1C')), ['connexion', 'retry']);
  assert.deepEqual(kinds(PF.linkRecheckView({ code: 'unreachable' }, 'K1C')), ['retest', 'search']);
  assert.match(PF.linkRecheckView({ code: 'not_local' }, 'K1C').text, /pas sur ton réseau local/);
  assert.equal(PF.linkRecheckView({ code: 'error', text: 'HTTP 418: théière' }, 'K1C').quote, 'HTTP 418: théière');
  assert.equal(PF.linkRecheckView({ code: 'ok', text: 'x' }, 'K1C').quote, '');
});

test('fenêtres d’Orca : ligne d’attente, carte seulement pour une erreur fermée et non expliquée ailleurs', () => {
  assert.equal(PF.dialogWaitText({ kind: 'question', during: 'model_add' }), 'Orca te demande comment ouvrir ce fichier : réponds dans sa fenêtre.');
  assert.equal(PF.dialogWaitText({ kind: 'error', during: '' }), 'Orca attend ta réponse dans sa fenêtre.');
  assert.ok(PF.dialogCardWanted({ phase: 'closed', kind: 'error', covered: '' }));
  assert.ok(!PF.dialogCardWanted({ phase: 'open', kind: 'error', covered: '' }));
  assert.ok(!PF.dialogCardWanted({ phase: 'closed', kind: 'error', covered: 'upload_error' }), 'envoi : déjà dans la carte d’échec');
  assert.ok(!PF.dialogCardWanted({ phase: 'closed', kind: 'error', covered: 'slice_result' }), 'découpe : déjà dans la carte d’Orca');
  assert.ok(!PF.dialogCardWanted({ phase: 'closed', kind: 'question', covered: '' }));
  const v = PF.dialogView({ kind: 'error', text: 'Loading of a model file failed.', during: 'model_add' });
  assert.equal(v.title, 'Orca n’a pas pu ajouter ta pièce');
  assert.equal(v.quote, 'Loading of a model file failed.');
  assert.deepEqual(kinds(v), ['import', 'ask']);
  assert.match(v.actions[1].prompt, /« Loading of a model file failed\. »/);
  assert.deepEqual(kinds(PF.dialogView({ kind: 'error', text: '' })), ['ask']);
});

test('panneau : « parti » seulement quand Orca a pris l’envoi, jamais « démarré » sur la foi de l’envoi', () => {
  const page = read('index.html');
  const started = page.slice(page.indexOf('function onPrintStarted(msg)'), page.indexOf('// ---------- Envoi suivi dans la file'));
  assert.match(started, /if \(msg\.cancelled\) \{ noteLine\(S\.closed/, 'fenêtre fermée : « rien n’est parti »');
  assert.ok(started.indexOf('noteSpoolSent()') > started.indexOf('if (!msg.ok)'), 'la bobine n’est notée qu’après un envoi pris');
  assert.match(started, /rememberIssues\(msg\.issues\);\s*if \(showOrcaIssues\(msg\.issues, \{\}\)\)/, 'not_ready dit pourquoi (cartes d’Orca)');
  assert.match(started, /startUpload\(''\);/);
  const upload = page.slice(page.indexOf('function onPrintUpload(msg)'), page.indexOf('function declareSent()'));
  assert.match(upload, /msg\.phase === 'arrived'[\s\S]*projectUI\.sentConv = conv;[\s\S]*S\.arrived/, '« L’impression a démarré » n’apparaît qu’à l’arrivée');
  assert.doesNotMatch(upload.replace(/\/\/[^\n]*/g, ''), /démarr/, 'aucune ligne « démarré » dans le suivi de l’envoi');
  assert.match(page, /msg\.type === 'print_upload'\) \{\s*onPrintUpload\(msg\);/);
  assert.match(page, /msg\.type === 'orca_dialog'\) \{\s*onOrcaDialog\(msg\);/);
  assert.match(page, /declareSent\(\); setTourStep\('after'\)/, 'Bambu Lab : bobine notée à la déclaration');
  assert.match(page, /window\.orca\.postMessage\(\{ type: 'print_declared' \}\)/);
  assert.equal(PF.SEND_TEXTS.closed, 'Tu as fermé la fenêtre d’envoi : rien n’est parti.');
  assert.equal(PF.SEND_TEXTS.arrived('K1C'), 'Le fichier est arrivé sur K1C.');
  assert.equal(PF.SEND_TEXTS.sending('K1C'), 'J’envoie le fichier à K1C…');
});

test('slicer : bobine et suivi seulement pour un envoi pris, texte d’Orca nettoyé, Orca garde son traitement', () => {
  const assistant = cpp('PlyoAssistant.cpp');
  assert.match(assistant, /const bool taken = Json::boolean\(r, "ok", false\) && Json::str\(r, "route"\) == "host";\s*if \(taken\)\s*Profiles::note_sent\(\);/);
  assert.match(assistant, /type == "print_declared"\) \{[\s\S]{0,200}Profiles::note_sent\(\);/);
  const send = cpp('PlyoSend.cpp');
  assert.equal((send.match(/evt\.Skip\(\);/g) || []).length, 3, 'Orca garde son traitement des trois événements');
  assert.match(send, /OrcaMessages::clean_for_panel\(status\)/, 'texte sans adresse ni chemin');
  assert.match(send, /PrinterStatus::stop\(\);[^\n]*\n[\s\S]*"failed"/, 'le suivi du démarrage s’arrête après un échec');
  assert.ok(!/status\.find|text\.find|message\.find/.test(send), 'aucune décision par le texte d’Orca');
  const windows = cpp('PlyoOrcaWindows.cpp');
  assert.ok(!/\.find\("/.test(windows.replace(/FindWindow/g, '')), 'aucune décision par le texte d’une fenêtre');
  const link = cpp('PlyoPrinterLink.cpp');
  assert.match(link, /if \(!SendLogic::local_host\(host\)\) \{ \/\/ jamais d'appel vers internet/);
});

test('ajout de pièce refusé (ERR-14) : messages d’Orca cités, question sans nom de fichier', () => {
  assert.ok(PF.modelDialogQuoted({ phase: 'closed', during: 'model_add', kind: 'error', text: 'x' }));
  assert.ok(PF.modelDialogQuoted({ phase: 'closed', during: 'model_add', kind: 'info', text: 'Le fichier ne contient pas de données géométriques.' }));
  assert.ok(!PF.modelDialogQuoted({ phase: 'closed', during: 'model_add', kind: 'question', text: 'Charger en un seul objet ?' }), 'une question n’est pas une raison');
  assert.ok(!PF.modelDialogQuoted({ phase: 'open', during: 'model_add', kind: 'error', text: 'x' }));
  assert.ok(!PF.modelDialogQuoted({ phase: 'closed', during: 'send', kind: 'error', text: 'x' }));
  assert.equal(PF.modelFailPrompt(['A.', 'B.']), 'Orca n’a pas pu ouvrir mon fichier 3D. Il m’a affiché : « A. » « B. ». Explique-moi simplement pourquoi et comment obtenir un fichier qui marche.');
  assert.equal(PF.modelFailPrompt([]), 'Orca n’a pas pu ouvrir mon fichier 3D. Explique-moi simplement pourquoi et comment obtenir un fichier qui marche.');
  const page = read('index.html');
  assert.match(page, /seen\.forEach\(function \(d\) \{ quoteUnderModelFail\(d\.text\); \}\);/, 'messages vus avant la réponse : cités sous l’échec');
  assert.match(page, /if \(PF\.modelDialogQuoted\(msg\)\) \{/);
  const cppImport = cpp('PlyoModelImport.cpp');
  assert.match(cppImport, /OrcaWindows::Scope windows\("model_add"\);/);
  assert.match(cppImport, /OrcaWindows::expect\("model_add", 3000\);/);
});
