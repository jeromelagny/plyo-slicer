import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const J = require('../journey-logic.js');
const here = new URL('..', import.meta.url).pathname;
const read = f => fs.readFileSync(here + f, 'utf8');

test('accueil du débutant : la règle du jeu, une seule fois, jamais pour « Je connais déjà »', () => {
  assert.equal(J.showsWelcome({ seen: true, level: 'beginner', greeted: false }), true);
  assert.equal(J.showsWelcome({ seen: true, level: 'skipped', greeted: false }), true);
  assert.equal(J.showsWelcome({ seen: true, level: 'beginner', greeted: true }), false);
  assert.equal(J.showsWelcome({ seen: true, level: 'expert', greeted: false }), false);
  assert.equal(J.showsWelcome({}), false); // état pas encore reçu du slicer
  assert.match(J.WELCOME.lines.map(l => l.text).join(' '), /clique sur le bouton/);
  assert.equal(J.WELCOME.go, 'C’est parti');
});

test('les choix qui font avancer sont des boutons, plus des liens soulignés', () => {
  const card = read('project-card.js'), steps = read('journey-steps.js');
  for (const label of ['Une autre machine', 'Une autre bobine', 'Autre marque', 'Pas encore de fichier ? Essaie avec le petit bateau de test'])
    assert.match(card, new RegExp("ui\\.button\\('" + label.replace(/[?]/g, '\\?') + "'[^\\n]*'btn ghost sm'"), label);
  assert.match(card, /ui\.button\(q\.unknown, h\.unknownBed, 'btn ghost sm'\)/);
  assert.match(steps, /ui\.button\('Je ne sais pas', h\.idk, 'btn ghost sm'\)/);
  assert.ok(!steps.includes("ui.button('Oui, c’est ça'"), 'le choix suggéré se clique lui-même');
  // « Clique sur ta réponse : » au-dessus des choix (plaque, matière, marque, questions sur la pièce).
  assert.equal((card.match(/'pick-hint', 'Clique sur ta réponse :'/g) || []).length, 3);
  assert.match(steps, /'pick-hint', 'Clique sur ta réponse :'/);
});

test('page : accueil seul à l’écran, consigne masquée pour le confirmé, bouton après l’explication', () => {
  const page = read('index.html');
  assert.match(page, /#view-guide\.welcoming > :not\(#welcome-slot\) \{ display: none !important; \}/);
  assert.match(page, /body:not\(\.novice\) \.pick-hint \{ display: none; \}/);
  assert.match(page, /classList\.toggle\('act-after', !!\(intentNow && intentNow\.mode === 'ready'\)\)/);
  assert.match(page, /patch: \{ greeted: true \}/);
});
