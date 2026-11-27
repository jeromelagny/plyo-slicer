// Modules partagés par le panneau classique et la v2 : ai-client.js (session, corps de /api/diagnose, envoi et flux) et
// conversation-logic.js (conversation enregistrée, échange gardé pour l'IA).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { response } from './v2-dom.mjs';

const require = createRequire(import.meta.url);
const C = require('../ai-client.js');
const Conv = require('../conversation-logic.js');
const L = require('../assistant-logic.js');

test('apiFetch : jeton de la session ; sur un 401, un seul renouvellement gardé puis une nouvelle tentative', async () => {
  let session = { access_token: 'vieux', refresh_token: 'r1' };
  const saved = [], seen = [];
  const fetch = async (url, init) => {
    seen.push([url, init.headers && init.headers.Authorization]);
    if (url.endsWith('/api/auth/refresh')) return response(200, { access_token: 'neuf', refresh_token: 'r2' });
    return init.headers.Authorization === 'Bearer neuf' ? response(200, { ok: true }) : response(401, {});
  };
  const api = C.createApi({ url: 'https://s', fetch, session: () => session, saveSession: (s) => { session = s; saved.push(s); } });
  const r = await api.apiFetch('/api/me', { method: 'GET' });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.map((s) => s[0]), ['https://s/api/me', 'https://s/api/auth/refresh', 'https://s/api/me']);
  assert.deepEqual(saved, [{ access_token: 'neuf', refresh_token: 'r2' }]);
  // Renouvellement refusé : le 401 d'origine (qui déconnecte) ; panne du renouvellement : sa réponse, session gardée.
  for (const [status, expect] of [[401, 401], [503, 503]]) {
    session = { access_token: 'vieux', refresh_token: 'r1' };
    const api2 = C.createApi({ url: 'https://s', session: () => session, saveSession: () => assert.fail('rien à garder'),
      fetch: async (url) => (url.endsWith('/refresh') ? response(status, {}) : response(401, {})) });
    assert.equal((await api2.apiFetch('/api/me', { method: 'GET' })).status, expect);
  }
});

test('diagnoseBody : réglages, contexte, historique, bobine du projet, capacités et identifiant de la demande', () => {
  const values = { locale: 'fr', params: [{ id: 'a', key: 'k', value: 1, unit: '' }], context: { printer: 'K1C' } };
  const ctx = { context: {}, plate: { objects: [] }, memory: [{ x: 1 }], limits: { nozzle: [200, 230] }, snapshot: { s: 1 } };
  const project = { filament: { spool: { name: 'x'.repeat(80) } }, design: { part: {} } };
  const b = C.diagnoseBody({ values, ctx, history: [{ role: 'user', text: 'q' }], project, projectForAI: { step: 'piece', thread: [] }, note: 'Ma question',
    calibrations: [{ t: 1 }], level: 'short', intentQuestions: [{ id: 'q' }], requestId: 'id-1' });
  assert.deepEqual(b.settings, { params: [{ id: 'a', key: 'k', value: 1, unit: '' }] });
  assert.equal(b.context.printer, 'K1C');
  assert.equal(b.context.spool.length, 60);
  assert.deepEqual(b.history, [{ role: 'user', text: 'q' }]);
  assert.equal(b.note, 'Ma question');
  assert.deepEqual(b.plate, { objects: [] });
  assert.deepEqual(b.filament_limits, { nozzle: [200, 230] });
  assert.equal(b.explanation_level, 'short');
  assert.deepEqual(b.project, { step: 'piece', thread: [] });
  assert.deepEqual(b.capabilities, L.CAPABILITIES.concat(['redesign']));
  assert.equal(b.request_id, 'id-1');
  // Une page qui ne sait exécuter aucune action le dit ; sans note ni calibration, rien n'est envoyé pour elles.
  const v2 = C.diagnoseBody({ values, ctx: null, history: [], project: {}, requestId: 'id-2', capabilities: [] });
  assert.deepEqual(v2.capabilities, []);
  assert.ok(!('note' in v2) && !('calibrations' in v2) && !('plate' in v2));
});

const ndjson = (lines) => response(200, null, { lines });

test('diagnose : flux NDJSON lu jusqu’au bout, brouillon montré, lignes « wait » ignorées, chaque lecture relance le délai', async () => {
  const partials = [];
  let touched = 0;
  const final = { type: 'final', status: 'ok', message: 'ok' };
  const r = await C.diagnose({ apiFetch: async () => ndjson([{ type: 'partial', message: 'o' }, { type: 'wait' }, final]), body: {}, photos: [],
    touch: () => { touched++; }, onPartial: (ev) => partials.push(ev) });
  assert.deepEqual(r, { final });
  assert.equal(partials.length, 1);
  assert.ok(touched >= 4, 'un signe de vie par lecture');
  // Flux fini sans réponse : coupée en route ; erreur dans le flux : son code.
  assert.deepEqual(await C.diagnose({ apiFetch: async () => ndjson([{ type: 'partial' }]), body: {}, photos: [] }), { error: 'incomplete_answer' });
  const e = await C.diagnose({ apiFetch: async () => ndjson([{ type: 'error', error: 'upstream_error' }]), body: {}, photos: [] });
  assert.equal(e.error, 'upstream_error');
});

test('diagnose : erreurs HTTP, session expirée, coupure, annulation et délai', async () => {
  const run = (apiFetch, signal) => C.diagnose({ apiFetch, body: {}, photos: [], signal });
  assert.deepEqual(await run(async () => response(401, {})), { error: 'unauthorized' });
  const limited = await run(async () => response(429, {}, { headers: { 'Retry-After': '7' } }));
  assert.equal(limited.error, 'rate_limited');
  assert.equal(limited.data.retry_after, 7);
  const credits = await run(async () => response(402, { error: 'insufficient_credits', gauge: { used_pct: 100 } }));
  assert.deepEqual([credits.error, credits.gauge.used_pct], ['insufficient_credits', 100]);
  assert.equal((await run(async () => response(403, { error: 'plan_required' }))).error, 'plan_required');
  assert.deepEqual(await run(async () => response(200, { status: 'ok' })), { final: { status: 'ok' } }, 'réponse sans flux');
  assert.deepEqual(await run(async () => { throw new Error('réseau'); }), { error: 'network' });
  // Coupure pendant le flux : avant la réponse complète, « stream_cut » ; après, la réponse est gardée (elle est payée).
  const cut = (lines) => async () => ({ ...ndjson(lines), body: { getReader() { const l = lines.slice(); return { read: async () => { if (!l.length) throw new Error('coupé'); return { done: false, value: new TextEncoder().encode(JSON.stringify(l.shift()) + '\n') }; } }; } } });
  assert.deepEqual(await run(cut([{ type: 'partial' }])), { error: 'stream_cut' });
  assert.deepEqual(await run(cut([{ type: 'final', message: 'm' }])), { final: { type: 'final', message: 'm' } });
  for (const reason of ['cancel', 'timeout']) {
    const c = new AbortController();
    const p = run((path, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('stop')))), c.signal);
    c.abort(reason);
    assert.deepEqual(await p, { error: reason });
  }
});

test('diagnose : 409 d’une autre demande rendu tel quel ; 413 avec photos : limite du service, photos réduites par paliers, puis refus clair', async () => {
  assert.equal((await C.diagnose({ apiFetch: async () => response(409, { error: 'other' }), body: {}, photos: [] })).error, 'other');
  const photo = { media_type: 'image/jpeg', data: 'A'.repeat(5000), preview: 'p' };
  const bodies = [], steps = [];
  const r = await C.diagnose({ body: { note: 'x' }, photos: [photo],
    apiFetch: async (path, init) => { bodies.push(JSON.parse(init.body)); return response(413, { error: 'payload_too_large', max_bytes: 1000 }); },
    shrink: async (step) => { steps.push(step); return [{ media_type: 'image/jpeg', data: 'B'.repeat(4000), preview: 'p' }]; } });
  assert.deepEqual(r, { error: 'payload_too_large' });
  assert.equal(bodies.length, 1, 'un seul envoi : ensuite la taille est vérifiée avant');
  assert.deepEqual(bodies[0].images, [{ media_type: 'image/jpeg', data: photo.data }]);
  assert.deepEqual(steps, L.SHRINK_STEPS, 'chaque palier essayé, dans l’ordre');
});

test('conversation-logic : création, reprise, ce qui est enregistré et l’échange gardé pour l’IA', () => {
  const c = Conv.create('c1', null, '2026-11-23T10:00:00Z');
  assert.deepEqual(c, { id: 'c1', title: '', updated: '2026-11-23T10:00:00Z', entries: [], history: [], project: { printer: null, filament: null, part: null } });
  assert.equal(Conv.worthSaving(c), false, 'un simple lancement n’enregistre rien');
  c.project.part = { name: 'crochet.stl' };
  assert.equal(Conv.worthSaving(c), true);
  assert.equal(Conv.savePayload(c).title, 'crochet.stl', 'le nom de la pièce sert de titre');
  assert.match(Conv.newId(), /^[a-z0-9]+-[a-z0-9]{1,4}$/);
  // Ancienne conversation prête : jamais réadaptée.
  const ready = Conv.fromSaved('c2', { entries: [], project: { printer: { preset: 'p' }, filament: { preset: 'f' }, part: { name: 'a.3mf' } } });
  assert.equal(ready.project.adapted, 'a.3mf');
  assert.deepEqual(Conv.fromSaved('c3', { entries: [] }).history, []);
  // L'échange : la question (photos comptées), la réponse résumée, « proposed » quand il y a des réglages ; 10 messages au plus.
  const a = Conv.normalizeAnswer({ message: 'Fais ça', questions: [{ text: 'Q', choices: ['a', 'b'] }], suggestions: [{ id: 's', value: 2, delta: null }] }, { process: 'p' });
  assert.deepEqual(a.names, { process: 'p' });
  const conv = Conv.create('c4', null, 'x');
  for (let i = 0; i < 6; i++) Conv.exchange(conv, 'q' + i, i === 5 ? 2 : 0, a, 10);
  assert.equal(conv.history.length, 10);
  assert.equal(conv.history.at(-2).text, '(2 photo(s) envoyée(s)) q5');
  assert.deepEqual(conv.history.at(-1), { role: 'assistant', text: 'Fais ça\nQ (a / b)\nsuggestion: s = 2', cards: 'proposed' });
  assert.deepEqual(Conv.answerEntry(a, 1, 'q', 'd'), { kind: 'answer', data: a, photoCount: 1, question: 'q', date: 'd', applied: false });
  assert.deepEqual(Conv.meEntry('t', undefined), { kind: 'me', text: 't', thumbs: [], fromPhone: false });
});
