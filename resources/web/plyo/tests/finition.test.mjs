// Tests de la finition du panneau (lot 3) : node --test resources/web/plyo/tests/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../assistant-logic.js');

test('conversation rouverte : l’erreur seulement quand elle manque, jamais après une réouverture réussie', () => {
  const ok = { type: 'conv_loaded', id: 'a', conversation: { entries: [] } };
  const missing = { type: 'conv_loaded', id: 'a', conversation: null };
  assert.deepEqual(L.convLoaded(ok, false, false), { restore: true, followUp: false, error: false });
  assert.deepEqual(L.convLoaded(ok, true, false), { restore: true, followUp: true, error: false });
  assert.deepEqual(L.convLoaded(missing, true, false), { restore: false, followUp: false, error: true });
  assert.deepEqual(L.convLoaded(missing, false, false), { restore: false, followUp: false, error: true });
  // Réouverture automatique au lancement : un échec reste silencieux (l'accueil s'affiche).
  assert.deepEqual(L.convLoaded(missing, false, true), { restore: false, followUp: false, error: false });
});

const NNBSP = '\u202F', NBSP = '\u00A0';
test('typographie française : espaces insécables avant ? ! ; : et dans « »', () => {
  assert.equal(L.fr('Ça a marché ?'), 'Ça a marché' + NNBSP + '?');
  assert.equal(L.fr('Super !'), 'Super' + NNBSP + '!');
  assert.equal(L.fr('Oui ; non'), 'Oui' + NNBSP + '; non');
  assert.equal(L.fr('Valeur : 0,8 mm'), 'Valeur' + NBSP + ': 0,8 mm');
  assert.equal(L.fr('« Tour »'), '«' + NBSP + 'Tour' + NBSP + '»');
  // Ponctuation collée (texte de l'IA) : l'espace manquante est ajoutée.
  assert.equal(L.fr('Prêt?'), 'Prêt' + NNBSP + '?');
  assert.equal(L.fr('Note: oui'), 'Note' + NBSP + ': oui');
  assert.equal(L.fr('«Tour»'), '«' + NBSP + 'Tour' + NBSP + '»');
});

test('typographie française : heures, adresses et doubles passages intacts', () => {
  assert.equal(L.fr('à 18:00'), 'à 18:00');
  assert.equal(L.fr('https://makerworld.com/a?b=1'), 'https://makerworld.com/a?b=1');
  assert.equal(L.fr(L.fr('Ça a marché ?')), L.fr('Ça a marché ?'));
  assert.equal(L.fr(''), '');
  assert.equal(L.fr(null), '');
  assert.equal(L.fr('Quoi ?!'), 'Quoi' + NNBSP + '?!');
});

test('typographie française : apostrophe droite remplacée par l’apostrophe typographique', () => {
  assert.equal(L.fr("l'ordinateur d'Orca"), 'l’ordinateur d’Orca');
  assert.equal(L.fr("aujourd'hui"), 'aujourd’hui');
});

test('action sur le plateau : le texte du slicer passe au singulier pour une seule pièce', () => {
  const plural = 'J\'ai réduit les pièces de cette plaque pour qu\'elles tiennent.';
  assert.equal(L.plateText({ kind: 'scale_to_fit', ok: true, text: plural }, 1), 'J’ai réduit la pièce pour qu’elle tienne sur le plateau.');
  assert.equal(L.plateText({ kind: 'scale_to_fit', ok: true, text: plural }, 3), plural);
  assert.equal(L.plateText({ kind: 'scale_to_fit', ok: true, text: plural }, undefined), plural);
  assert.equal(L.plateText({ kind: 'scale_to_fit', ok: false, text: 'Rien à réduire.' }, 1), 'Rien à réduire.');
  assert.equal(L.plateText({ kind: 'arrange', ok: true, text: 'Je range les pièces sur le plateau.' }, 1), 'Je range la pièce sur le plateau.');
  assert.equal(L.plateText({ kind: 'orient', ok: true, text: 'Orientée.' }, 1), 'Orientée.');
});

test('une seule façon d’écrire une date : « 24 octobre », « 1er novembre »', () => {
  assert.equal(L.dayText('2026-10-24T18:00:00'), '24 octobre');
  assert.equal(L.dayText('2026-11-01'), '1er novembre');
  assert.equal(L.dayText(''), '');
  assert.equal(L.dayText('n’importe quoi'), '');
});

test('« Ça n’a pas marché » : les anciennes valeurs, seulement pour les réglages encore à la valeur essayée', () => {
  const item = { changes: [{ id: 'retraction', before: 0.8, after: 1.2 }, { id: 'nozzle_temp', before: 220, after: 210 }, { id: 'brim_type', before: 'no_brim', after: 'outer_only' }] };
  const params = [{ id: 'retraction', value: 1.2 }, { id: 'nozzle_temp', value: 215 }, { id: 'brim_type', value: 'outer_only' }];
  // La température a été changée à la main depuis : on n'y touche pas.
  assert.deepEqual(L.revertChanges(item, params), [{ id: 'retraction', value: 0.8 }, { id: 'brim_type', value: 'no_brim' }]);
  assert.deepEqual(L.revertChanges(item, null), [{ id: 'retraction', value: 0.8 }, { id: 'nozzle_temp', value: 220 }, { id: 'brim_type', value: 'no_brim' }]);
  assert.deepEqual(L.revertChanges(item, [{ id: 'retraction', value: 1.2000000001 }]), [{ id: 'retraction', value: 0.8 }]);
  assert.deepEqual(L.revertChanges({ changes: [] }, params), []);
  assert.deepEqual(L.revertChanges({}, params), []);
});

test('« Chercher une autre piste » : la demande préremplie rappelle le problème et le mot ajouté', () => {
  assert.equal(L.retryPrompt({ why: 'Fils d’araignée' }, 'encore quelques fils'),
    'Les réglages essayés pour « Fils d’araignée » n’ont pas marché (encore quelques fils). Qu’est-ce que je peux essayer d’autre ?');
  assert.equal(L.retryPrompt({ why: '' }, ''), 'Les réglages essayés n’ont pas marché. Qu’est-ce que je peux essayer d’autre ?');
});

test('alerte de jauge : seulement au passage d’un seuil pendant la session, pas sous chaque réponse', () => {
  const low = { used_pct: 84, resets_at: '2026-11-01T00:00:00.000Z', state: 'low' };
  const empty = { ...low, used_pct: 100, state: 'empty' };
  assert.equal(L.gaugeNotice(low, null, 'ok'), 'low');      // 79 % → 84 % : on prévient
  assert.equal(L.gaugeNotice(low, null, 'low'), null);      // déjà au-dessus avant cette réponse : rien
  assert.equal(L.gaugeNotice(low, null, null), null);       // premier relevé (lancement) : rien
  assert.equal(L.gaugeNotice(empty, null, 'low'), 'empty');
  assert.equal(L.gaugeNotice(low, 'low:2026-11-01T00:00:00.000Z', 'ok'), null); // déjà dit ce mois-ci
});
