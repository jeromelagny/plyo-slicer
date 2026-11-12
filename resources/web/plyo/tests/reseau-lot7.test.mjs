// Lot 7 de l'audit (réseau et jauge) : identifiant de demande, délais, taille de la demande, erreurs et actions,
// question restée sans réponse, projet changé pendant une réponse, téléphone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (name) => fs.readFileSync(path.join(here, '..', name), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('ROB-02 : identifiant de demande au format attendu par le service, avec ses replis', () => {
  assert.equal(L.newRequestId({ randomUUID: () => 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' }), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  // randomUUID absent ou qui échoue : getRandomValues ; sinon Math.random. Toujours un UUID v4.
  const viaBytes = L.newRequestId({ getRandomValues: (a) => { a.fill(255); return a; } });
  assert.match(viaBytes, UUID);
  assert.match(L.newRequestId({ randomUUID: () => { throw new Error('non'); }, getRandomValues: (a) => a }), UUID);
  assert.match(L.newRequestId(null, () => 0.5), UUID);
  assert.match(L.newRequestId(undefined), UUID);
  assert.notEqual(L.newRequestId(undefined), L.newRequestId(undefined));
  assert.equal(L.formatUuid(new Array(16).fill(0)), '00000000-0000-4000-8000-000000000000');
  // Même regex que plyo-api (schema.ts, REQUEST_ID).
  assert.match(L.newRequestId(globalThis.crypto), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test('ROB-02 : la même question renvoyée telle quelle garde son identifiant, une question modifiée en change', () => {
  const p1 = { data: 'AAA', preview: 'x' }, p2 = { data: 'BBB', preview: 'y' };
  assert.equal(L.sameQuestion({ note: 'Des fils', photos: [p1] }, { note: ' Des fils ', photos: [{ data: 'AAA' }] }), true);
  assert.equal(L.sameQuestion({ note: 'Des fils', photos: [p1] }, { note: 'Des fils partout', photos: [p1] }), false);
  assert.equal(L.sameQuestion({ note: 'Des fils', photos: [p1] }, { note: 'Des fils', photos: [p1, p2] }), false);
  assert.equal(L.sameQuestion({ note: 'Des fils', photos: [p1] }, { note: 'Des fils', photos: [] }), false);
  assert.equal(L.sameQuestion(null, { note: 'x', photos: [] }), false);
  // Question rouverte dont les photos d'origine sont perdues : le même texte avec des photos rejointes compte.
  assert.equal(L.sameQuestion({ note: 'Des fils', photos: null }, { note: 'Des fils', photos: [p2] }), true);
  assert.equal(L.sameQuestion({ note: 'Des fils', photos: null }, { note: 'Des fils', photos: [] }), false);
});

test('ROB-13 : renvoyer une question restée sans réponse : même identifiant pendant 10 minutes, nouveau ensuite', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const now = new Date('2026-11-12T12:00:00Z');
  assert.equal(L.resendRequestId({ id, at: '2026-11-12T11:55:00Z' }, now, 'neuf'), id);
  assert.equal(L.resendRequestId({ id, at: '2026-11-12T11:49:00Z' }, now, 'neuf'), 'neuf');
  assert.equal(L.resendRequestId({ id: 'pas-un-uuid', at: '2026-11-12T11:59:00Z' }, now, 'neuf'), 'neuf');
  assert.equal(L.resendRequestId({ id }, now, 'neuf'), 'neuf');
  assert.equal(L.resendRequestId({ id, at: '2026-11-12T12:05:00Z' }, now, 'neuf'), 'neuf', 'horloge en arrière : prudence');
  assert.equal(L.resendRequestId(null, now, 'neuf'), 'neuf');
  const v = L.unansweredView({ id, photos: 0 });
  assert.equal(v.text, 'Je n’ai pas pu te répondre : l’application a été fermée pendant que je cherchais.');
  assert.equal(L.unansweredView({ id, photos: 1 }).text, v.text + ' Ta question avait une photo : je n’en garde que la vignette, rejoins-la avant de la renvoyer.');
  assert.equal(L.unansweredView({ id, photos: 3 }).text, v.text + ' Ta question avait 3 photos : je n’en garde que les vignettes, rejoins-les avant de la renvoyer.');
});

test('ROB-02 : 409 (même demande en cours) : quelques essais espacés, bornés', () => {
  const delays = [];
  for (let i = 0; L.inProgressDelay(i); i++) delays.push(L.inProgressDelay(i));
  assert.ok(delays.length >= 3 && delays.length <= 10, 'quelques essais');
  assert.ok(delays.every((d, i) => i === 0 || d >= delays[i - 1]), 'espacés de plus en plus');
  const total = delays.reduce((a, b) => a + b, 0);
  assert.ok(total >= 60000 && total <= 150000, 'deux minutes environ : ' + total);
  assert.equal(L.inProgressDelay(99), 0);
});

test('ROB-01 : le texte d’attente rassure pendant une longue réponse, sans jargon', () => {
  assert.equal(L.waitingText(0, false), 'Je réfléchis…');
  assert.equal(L.waitingText(5000, true), 'Je regarde ta photo…');
  assert.equal(L.waitingText(30000, false), 'Je cherche encore…');
  assert.match(L.waitingText(90000, true), /^Je cherche encore/);
  assert.match(L.waitingText(200000, false), /Tu peux annuler/);
  assert.match(L.waitingText(1000, false, 'retry'), /déjà en route/);
  for (const ms of [0, 30000, 90000, 200000]) assert.ok(!/wait|serveur|service|stream|timeout|409/i.test(L.waitingText(ms, false)));
  const page = read('index.html');
  assert.match(page, /var ANSWER_MAX_MS = 285000;/, 'plafond du panneau au-dessus de l’échéance du service (270 s)');
  assert.match(page, /var IDLE_TIMEOUT_MS = 60000;/);
  // Les lignes « wait » ne s'affichent pas : seules partial, final et error sont lues ; chaque lecture relance le délai.
  const ask = page.slice(page.indexOf('function ask(note, photos, req)'), page.indexOf('// Une réponse sur une pièce du plateau'));
  assert.match(ask, /return reader\.read\(\)\.then\(function \(r\) \{\s*touch\(\);/);
  assert.ok(!/ev\.type === 'wait'/.test(ask));
  assert.match(ask, /body\.request_id = req\.id;/);
});

test('ROB-03 : taille de la demande mesurée en octets UTF-8, photos réduites par paliers, puis refus clair', () => {
  assert.equal(L.utf8Bytes('abc'), 3);
  assert.equal(L.utf8Bytes('é'), 2);
  assert.equal(L.utf8Bytes('’'), 3);
  assert.equal(L.utf8Bytes('😀'), 4);
  assert.equal(L.utf8Bytes(JSON.stringify({ note: 'Température ’ok’' })), Buffer.byteLength(JSON.stringify({ note: 'Température ’ok’' })));
  assert.ok(L.MAX_SEND_BYTES < 4000000 && L.MAX_SEND_BYTES >= 3500000, 'marge sous la limite du service');
  assert.deepEqual(L.sizePlan(1000, 0, true), { send: true });
  assert.deepEqual(L.sizePlan(L.MAX_SEND_BYTES, 0, true), { send: true });
  assert.deepEqual(L.sizePlan(L.MAX_SEND_BYTES + 1, 0, true), { shrink: L.SHRINK_STEPS[0], step: 1 });
  assert.deepEqual(L.sizePlan(5e6, 1, true), { shrink: L.SHRINK_STEPS[1], step: 2 });
  assert.deepEqual(L.sizePlan(5e6, L.SHRINK_STEPS.length, true), { tooBig: true });
  assert.deepEqual(L.sizePlan(5e6, 0, false), { tooBig: true }, 'sans photo, rien à réduire');
  // Paliers de plus en plus petits, sous les 1 600 px des photos jointes.
  L.SHRINK_STEPS.forEach((s, i) => { assert.ok(s.side < 1600 && s.quality < 0.85); if (i) assert.ok(s.side < L.SHRINK_STEPS[i - 1].side && s.quality <= L.SHRINK_STEPS[i - 1].quality); });
  // 413 du service : sa limite, avec une marge.
  assert.equal(L.limitFrom413({ error: 'payload_too_large', max_bytes: 4000000 }), 3800000);
  assert.equal(L.limitFrom413({ max_bytes: 2000000 }), 1900000);
  assert.equal(L.limitFrom413({}), L.MAX_SEND_BYTES);
  assert.deepEqual(L.sizePlan(3000000, 0, true, L.limitFrom413({ max_bytes: 2000000 })), { shrink: L.SHRINK_STEPS[0], step: 1 });
});

test('UX-29 : chaque erreur a un texte vrai et une action qui lui correspond', () => {
  const expect = {
    insufficient_credits: 'credits', unauthorized: 'login', network: 'retry', stream_cut: 'retry', timeout: 'retry', upstream_error: 'retry',
    assistant_unavailable: 'edit', incomplete_answer: 'retry', invalid_request: 'edit', payload_too_large: 'edit', auth_unavailable: 'retry',
    config_missing: 'retry', internal: 'retry', request_in_progress: 'retry', invalid_image: 'photo', rate_limited: 'retry'
  };
  for (const [code, action] of Object.entries(expect)) {
    const v = L.errorView(code, {});
    assert.equal(v.action, action, code);
    assert.ok(v.text && !/npm|plyo-api|vous|votre|Réessayez|crédit|token|409|413|500/.test(v.text + (v.more || '')), code + ' : ' + v.text);
    // Un message qui dit de reformuler ou d'alléger ne propose jamais de renvoyer la même chose.
    if (/formuler|enlève|Modifie/.test(v.text)) assert.equal(v.action, 'edit', code);
  }
  assert.equal(L.errorView('payload_too_large').text, 'Tes photos sont trop lourdes ensemble : enlève-en une, puis renvoie.');
  assert.match(L.errorView('stream_cut').text, /sans la payer une seconde fois/);
  assert.match(L.errorView('stream_cut').text, /peut compter sur ta jauge/);
  // UX-25 : ce qui reste gratuit, dit après la date de recharge.
  assert.equal(L.errorView('insufficient_credits').more, 'En attendant, les étapes, les explications des réglages (le « ? ») et « Montre-moi où il est » restent gratuits.');
  const page = read('index.html');
  assert.match(page, /view\.action === 'edit' && edit\) acts\.appendChild\(button\('Modifier ma demande'/);
  // Ce qui est dit gratuit l'est vraiment dans l'aide du panneau.
  assert.match(page, /Gratuit, sans compte', 'Le parcours en étapes, les explications des réglages \(le « \? » à côté d’un réglage/);
});

test('ROB-10 : projet changé pendant une réponse : retenu, rien ne s’applique, la réponse reste dans l’ancienne conversation', () => {
  assert.equal(L.projectSwitchText(true, true), 'Tu as ouvert un autre projet pendant que je répondais : je n’ai pas exécuté les ordres prévus pour l’ancien. Ma réponse est gardée avec l’ancien projet, dans « Mes projets ».');
  assert.equal(L.projectSwitchText(false, true), 'Tu as ouvert un autre projet pendant que je répondais. Ma réponse est gardée avec l’ancien projet, dans « Mes projets ».');
  assert.match(L.projectSwitchText(false, false), /remise dans le champ/);
  const page = read('index.html');
  assert.match(page, /if \(!busy\) \{ closeDrawer\(\); newConversation\(\); \}\s*else projectSwitched = true;/);
  assert.match(page, /\(m\.type === 'apply' \|\| m\.type === 'commands'\) && busy && projectSwitched\) \{ refuseStale\(m\); return; \}/);
  // La réponse est enregistrée dans sa conversation puis le panneau repart : renderAnswer (qui exécute les ordres) n'est pas appelé.
  const ask = page.slice(page.indexOf('function done(a) {'), page.indexOf('// Une réponse sur une pièce du plateau'));
  assert.ok(ask.indexOf("if (switched) { switchedNote(Logic.projectSwitchText(") > 0 && ask.indexOf("if (switched) { switchedNote(Logic.projectSwitchText(") < ask.indexOf('renderAnswer(entry, false)'));
});

test('UX-24 : fenêtre du téléphone : consigne selon l’adresse du service, icône dessinée, but du lien', () => {
  const phone = read('phone.html');
  assert.ok(!/📷/.test(phone), 'plus d’emoji');
  assert.match(phone, /Ton téléphone a juste besoin d’Internet \(Wi-Fi ou données mobiles\)\./);
  assert.match(phone, /\/\^https:\\\/\\\/\/i\.test\(/);
  const page = read('index.html');
  assert.match(page, /body: JSON\.stringify\(\{ purpose: purpose \}\)/);
  assert.match(page, /'\/purpose', \{ method: 'PUT'/);
  assert.match(page, /function phonePurpose\(\) \{ return calibCard && calibCard\.awaiting \? 'calibration' : 'defect'; \}/);
});
