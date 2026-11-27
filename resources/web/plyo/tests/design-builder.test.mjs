import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const D = require('../design-builder.js');
const here = new URL('..', import.meta.url).pathname;
const fixture = name => JSON.parse(fs.readFileSync(here + 'tests/fixtures/designs/' + name + '.json', 'utf8'));
const Module = (await import('../vendor/manifold/manifold.js')).default;
const wasm = await Module(); wasm.setup();
const M = { Manifold: wasm.Manifold, CrossSection: wasm.CrossSection };
const near = (a, b, eps = 0.05) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('les 5 pièces types se construisent en solides fermés, aux bonnes dimensions, posés sur le plateau', () => {
  const expected = { 'entretoise-m4': [9, 9, 12], 'boite-couvercle': [60, 90, 30], 'plaque-percee': [100, 60, 3], 'crochet-mural': [35, 70, 15] };
  for (const name of ['entretoise-m4', 'boite-couvercle', 'support-angle', 'crochet-mural', 'plaque-percee']) {
    const r = D.build(M, fixture(name));
    assert.equal(r.ok, true, name + ' : ' + r.error);
    assert.ok(r.volume > 0 && r.triangles > 10, name);
    if (expected[name]) assert.ok(near(r.size, expected[name]), name + ' ' + JSON.stringify(r.size));
    const zs = []; for (let i = 2; i < r.mesh.positions.length; i += 3) zs.push(r.mesh.positions[i]);
    assert.ok(Math.abs(Math.min(...zs)) < 1e-4, name + ' posée sur z = 0');
  }
});

test('les trous enlèvent bien de la matière (soustraction, grille)', () => {
  const plate = D.build(M, fixture('plaque-percee'));
  const full = D.build(M, { ...fixture('plaque-percee'), root: 'plaque' });
  const hole = Math.PI * 2.2 * 2.2 * 3;
  assert.ok(Math.abs(full.volume - plate.volume - 4 * hole) < 3, full.volume + ' − ' + plate.volume);
  const spacer = D.build(M, fixture('entretoise-m4'));
  assert.ok(Math.abs(spacer.volume - Math.PI * (4.5 * 4.5 - 2.2 * 2.2) * 12) < 6, String(spacer.volume));
});

test('une description invalide n’est pas construite, et dit pourquoi', () => {
  const bad = fixture('entretoise-m4');
  bad.nodes[1].radius = 900;
  const r = D.build(M, bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /cylindre/);
  assert.equal(D.check({ nodes: [], root: 'x' }).ok, false);
  const loop = { root: 'a', nodes: [
    { id: 'a', kind: 'union', size: [], radius: null, radius_top: null, height: null, rounding: null, points: [], vector: [], count: [], spacing: [], children: ['b'] },
    { id: 'b', kind: 'translate', size: [], radius: null, radius_top: null, height: null, rounding: null, points: [], vector: [0, 0, 0], count: [], spacing: [], children: ['a'] }] };
  assert.deepEqual(D.check(loop), { ok: false, error: 'boucle entre les formes' });
});

test('STL binaire : en-tête, nombre de triangles, taille exacte', () => {
  const r = D.build(M, fixture('entretoise-m4'));
  const stl = D.toSTL(r.mesh, 'Entretoise');
  const n = new DataView(stl.buffer).getUint32(80, true);
  assert.equal(n, r.triangles);
  assert.equal(stl.length, 84 + 50 * n);
  assert.equal(String.fromCharCode(...stl.slice(0, 10)), 'Entretoise');
  assert.equal(D.sizeText([9, 9, 12.25]), '9 × 9 × 12,3 mm');
});
