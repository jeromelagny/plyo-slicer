// Lot 12 de l'audit (sécurité et petites robustesses) : ce que la page doit respecter pour sa politique de sécurité du contenu
// (CSP, construite par src/plyo/PlyoPageLogic.cpp), la liste des scripts tenue par la page seule (ARCH-11), la garde de
// navigation, et les messages d'enregistrement (ROB-16, ROB-17).
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');
const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const cpp = name => fs.readFileSync(new URL('../../../../src/plyo/' + name, import.meta.url), 'utf8');
const page = read('index.html');
const MARKER = /<!--plyo-include:([^>]*?)-->/g;
const modules = () => [...page.matchAll(MARKER)].map(m => m[1]);

test('ARCH-11 : chaque marqueur de la page désigne un fichier du panneau, au nom accepté par le C++', () => {
  const names = modules();
  assert.ok(names.length >= 17);
  for (const name of names) {
    assert.match(name, /^[a-z0-9-]+\.js$/, name + ' : nom refusé par PageLogic::include_names');
    assert.ok(fs.existsSync(new URL('../' + name, import.meta.url)), name + ' : fichier absent');
  }
  assert.equal(new Set(names).size, names.length, 'aucun module inclus deux fois');
  assert.ok(!/"fiches\.js"|"retouches-logic\.js"/.test(cpp('PlyoAssistant.cpp')), 'plus de liste en dur dans PlyoAssistant.cpp');
});

test('CSP : la page n’a qu’une balise <script> à elle, et aucun attribut d’événement ni adresse javascript:', () => {
  for (const source of [page, ...modules().map(read)]) {
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(source.replace(/\/\/.*$/gm, '')), 'attribut « on…= » (bloqué par la politique)');
    assert.ok(!/javascript:/i.test(source), 'adresse javascript: (bloquée par la politique)');
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(source), 'eval ou new Function (bloqués par la politique)');
    assert.ok(!/setTimeout\(\s*['"]|setInterval\(\s*['"]/.test(source), 'minuterie sur un texte (bloquée par la politique)');
  }
  assert.equal((page.match(/<script\b/g) || []).length, 1, 'une seule balise <script> dans index.html : celle qui reçoit le jeton');
  assert.ok(page.includes('<script>'), 'balise exacte « <script> », que PageLogic::assemble reconnaît');
});

test('CSP : ce que la page charge tient dans la politique (images data:/blob:, fetch vers le service seulement)', () => {
  const all = [page, ...modules().map(read)].join('\n');
  // Toutes les requêtes passent par l'adresse du service.
  for (const m of all.matchAll(/fetch\(([^,)]*)/g)) assert.match(m[1], /^\s*PLYO_API_URL\b/, 'fetch hors du service : ' + m[1]);
  assert.ok(!/XMLHttpRequest|EventSource|WebSocket|sendBeacon|importScripts|new Worker/.test(all), 'aucune autre connexion');
  // Aucune ressource distante : ni <img src="http…">, ni <link>, ni url(…), ni police.
  assert.ok(!/<link\b|<iframe\b|<object\b|<embed\b|@import|@font-face/i.test(all) && !/(^|[^A-Za-z])url\(/.test(all), 'aucune ressource externe');
  assert.ok(!/src\s*=\s*["']https?:/i.test(all), 'aucune image distante');
});

test('CSP : construite côté C++ d’après l’adresse réelle du service, jamais écrite en dur dans la page', () => {
  assert.ok(!/Content-Security-Policy/i.test(page), 'pas de politique figée dans index.html');
  const assistant = cpp('PlyoAssistant.cpp');
  assert.match(assistant, /content_security_policy\(Config::api_url\(\), nonce, SelfTest::page_connect_sources\(\)\)/);
  const logic = cpp('PlyoPageLogic.cpp');
  assert.match(logic, /script-src 'nonce-/);
  // Seule la compilation du WebAssembly des pièces sur mesure est permise ('wasm-unsafe-eval') : jamais 'unsafe-eval'.
  assert.ok(!/'unsafe-eval'/.test(logic), 'jamais d’eval permis');
  assert.match(logic, /script-src 'nonce-" \+ nonce \+ "' 'wasm-unsafe-eval'/);
  assert.match(logic, /img-src data: blob:/);
});

test('Navigation : la vue du panneau refuse toute adresse hors de sa page', () => {
  const assistant = cpp('PlyoAssistant.cpp');
  assert.match(assistant, /wxEVT_WEBVIEW_NAVIGATING/);
  assert.match(assistant, /event\.Veto\(\)/);
  assert.match(assistant, /guard_navigation\(panel\)/);
  assert.ok(!/window\.open\(|location\.(href|assign|replace)|<a\s/i.test(page), 'le panneau n’ouvre aucun lien');
});

test('ROB-17 : un projet non enregistré dit la vraie raison, avec quoi faire', () => {
  assert.match(L.saveFailedText('too_big'), /trop long.*nouveau projet/);
  const disk = L.saveFailedText('write_failed');
  assert.match(disk, /n’arrive plus à enregistrer/);
  assert.match(disk, /libère de la place/);
  assert.ok(!/trop long/.test(disk), 'un disque plein n’est pas « trop long »');
  assert.match(L.saveFailedText('invalid'), /redémarre Plyo/);
  assert.equal(L.saveFailedText(undefined), L.saveFailedText('too_big'), 'slicer sans raison : la phrase d’avant');
  // Les raisons sont celles du C++ (Conversations::reason).
  for (const r of ['too_big', 'write_failed', 'invalid']) assert.ok(cpp('PlyoConversations.hpp').includes('"' + r + '"'), r);
  assert.match(page, /Logic\.saveFailedText\(why\)/);
});

test('ROB-16 : Plyo ouvert deux fois est dit simplement, avec quoi faire', () => {
  assert.match(L.OTHER_INSTANCE_TEXT, /ouvert deux fois/);
  assert.match(L.OTHER_INSTANCE_TEXT, /Ferme l’une des deux fenêtres/);
  assert.match(page, /msg\.type === 'other_instance'/);
  assert.match(cpp('PlyoAssistant.cpp'), /Store::other_instance\(\)/);
});
