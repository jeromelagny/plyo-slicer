// Assistant v2, lot 0 : bascule entre le panneau classique et la v2, par la clé « ui » des premiers pas.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadV2, sleep } from './v2-dom.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const cppSrc = (name) => fs.readFileSync(path.join(dir, '..', '..', '..', 'src', 'plyo', name), 'utf8');

test('le menu du panneau classique propose « Essayer le nouvel assistant », qui enregistre ui = v2 après l’enregistrement en attente', () => {
  const page = read('index.html');
  assert.match(page, /id="m-ui"[^>]*>Essayer le nouvel assistant</);
  const handler = page.slice(page.indexOf("$('m-ui').addEventListener"), page.indexOf('var LAYOUT_NOTES'));
  assert.ok(handler.indexOf('flushSave()') > 0 && handler.indexOf('flushSave()') < handler.indexOf('firststeps_set'), 'flushSave avant la bascule');
  assert.match(handler, /blockedWhileBusy\(\)/, 'pas de bascule pendant une découpe ou un envoi');
  assert.match(handler, /type: 'firststeps_set', patch: \{ ui: 'v2' \}/);
});

test('la page v2 : en-tête « Assistant Plyo » et retour à l’ancien assistant par le menu, après l’enregistrement en attente', async () => {
  const page = read(path.join('v2', 'index.html'));
  assert.match(page, /<strong>Assistant Plyo<\/strong>/);
  assert.match(page, /id="m-ui"[^>]*>Revenir à l’ancien assistant</);
  assert.ok(page.includes('<!--plyo-config-->'), 'adresse du service insérée comme dans la page classique');
  assert.ok(page.includes('var(--orca-bg'), 'thème d’Orca (clair ou sombre)');

  const p = loadV2({ bridge: (m, emit) => { if (m.type === 'ready') emit({ type: 'values', locale: 'fr', params: [], context: {} }); } });
  try {
    await sleep(20);
    const menu = p.$('menu');
    p.$('btn-more').click();
    assert.equal(menu.classList.contains('hidden'), false, 'le menu s’ouvre');
    p.$('m-ui').click();
    assert.deepEqual(p.posted.at(-1), { type: 'firststeps_set', patch: { ui: 'classique' } });
    assert.equal(menu.classList.contains('hidden'), true, 'le menu se referme');
    // Une conversation à enregistrer part avant la bascule (même stockage que le classique).
    p.ctx.PlyoV2.panel.conv().entries.push({ kind: 'note', text: 'x' });
    p.ctx.PlyoV2.panel.scheduleSave();
    p.$('btn-more').click();
    p.$('m-ui').click();
    assert.deepEqual(p.posted.slice(-2).map((m) => m.type), ['conv_save', 'firststeps_set']);
    // « Ouvrir l’ancien assistant » dans une carte encore minimale fait la même bascule.
    p.$('stepcard').querySelector('.link').click();
    assert.deepEqual(p.posted.at(-1), { type: 'firststeps_set', patch: { ui: 'classique' } });
  } finally { p.stop(); }
});

test('le slicer : la clé « ui » vaut « classique » par défaut, choisit la page à l’ouverture et rouvre le panneau à la bascule', () => {
  const sanitize = cppSrc('PlyoSanitize.cpp');
  assert.match(sanitize, /\{"ui", "classique"\}/);
  const assistant = cppSrc('PlyoAssistant.cpp');
  const load = assistant.slice(assistant.indexOf('std::string load_page()'), assistant.indexOf('bool allowed_navigation'));
  assert.match(load, /PageLogic::page_for_ui\(Json::str\(FirstSteps::state\(\), "ui", 20\)\)/);
  assert.match(load, /page = read_resource\("index\.html"\)/, 'page v2 absente : la page classique');
  const set = assistant.slice(assistant.indexOf('type == "firststeps_set"'), assistant.indexOf('type == "tour_signals"'));
  assert.match(set, /patch\.contains\("ui"\)\) \{[^}]*reopen_panel\(\);/);
  // Réouverture après la destruction de l'ancien panneau, jamais pendant la fermeture d'Orca.
  assert.match(assistant, /if \(s_reopen\) \{\s*s_reopen = false;\s*if \(!Slic3r::GUI::wxGetApp\(\)\.is_closing\(\)\)/);
});
