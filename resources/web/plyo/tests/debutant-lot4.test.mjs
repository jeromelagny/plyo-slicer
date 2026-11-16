import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const here = new URL('..', import.meta.url).pathname;
const read = f => fs.readFileSync(here + f, 'utf8');

test('débutant : PLA et PETG d’abord avec un mot sur chacun, les autres matières à un clic', () => {
  const card = read('project-card.js');
  assert.match(card, /var MATERIAL_WORDS = 'PLA : le plus courant et le plus facile\. PETG : plus solide, supporte mieux la chaleur\.';/);
  assert.match(card, /ui\.button\('Autres matières', h\.moreMaterials, 'btn ghost sm'\)/);
  assert.match(card, /'Ma machine a plusieurs bobines à la fois \(AMS, CFS…\)'/);
});

test('débutant : la fiche de réglages dit ce que veulent dire les cases, et compte « 1 réglage sur 2 »', () => {
  const page = read('index.html');
  assert.match(page, /Coché = je le change pour toi\. Décoche ce que tu préfères garder\./);
  assert.match(page, /laisse-le décoché si tu débutes, ou coche-le pour l’essayer/);
  assert.match(page, /\(n < rows\.length \? ' sur ' \+ rows\.length : ''\)/);
});

test('débutant : « découper » expliqué, et où lire le nom exact de son imprimante', () => {
  assert.match(read('journey-steps.js'), /Découper, c’est transformer ta pièce en instructions que ton imprimante sait suivre/);
  assert.match(read('index.html'), /Plusieurs modèles se ressemblent : le nom exact est écrit sur ta machine/);
});

test('un écran, peu de choix : machine proposée sans « pas dans la liste » ni « Mes machines », rangé dans le menu', () => {
  const page = read('index.html'), card = read('project-card.js');
  assert.match(page, /extra: step === 'machine' && !\(conv\.project\.printer && conv\.project\.printer\.proposed && !projectUI\.showList\)/);
  assert.ok(!card.includes("'Mes machines…'"));
  assert.match(page, /id="m-machines" role="menuitem" data-icon="printer">Mes machines</);
  assert.match(page, /\.project-body > \.btn \{ align-self: flex-start; \}/);
  assert.match(card, /dot\.style\.background = r\.colour/);
});
