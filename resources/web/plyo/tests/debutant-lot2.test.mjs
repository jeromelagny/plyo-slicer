import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const J = require('../journey-logic.js');
const here = new URL('..', import.meta.url).pathname;
const read = f => fs.readFileSync(here + f, 'utf8');

test('débutant : la question de la plaque passe seule, avant la pièce ou la bobine', () => {
  for (const step of ['machine', 'piece', 'filament']) {
    assert.equal(J.prompt(step, { bedFirst: true }), 'D’abord, une question sur ton imprimante');
    assert.equal(J.primaryAction(step, { bedFirst: true, proposal: { name: 'Bobine' } }).kind, 'none');
  }
  assert.equal(J.prompt('piece', {}), 'Ajoute la pièce à imprimer');
  assert.equal(J.primaryAction('filament', { proposal: { name: 'Bobine' } }).kind, 'confirmFilament');
  const page = read('index.html');
  assert.match(page, /projectUI\.bedFirst = !!bedQ && !bedUI\.editing && fsState\.level !== 'expert';/);
  assert.match(page, /\.step-card\.bed-first #project-card \{ display: none; \}/);
});

test('débutant : la matière répondue se replie, chaque question dit pourquoi, la note de profil se tait', () => {
  const card = read('project-card.js'), steps = read('journey-steps.js'), page = read('index.html');
  assert.match(card, /'✓ Matière : ' \+ ns\.material/);
  assert.match(card, /je retiens ce qui marche avec elle, et la prochaine fois tu n’auras rien à refaire/);
  assert.match(steps, /Tes réponses me servent à choisir pour toi entre solide, joli et rapide\./);
  assert.match(page, /La buse fait fondre le fil, le plateau garde ta pièce collée\./);
  assert.match(page, /var profileNote = fsState\.level === 'expert' \? PlyoJourney\.profileChangeNote/);
});
