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
  assert.equal(L.fr('Valeur : 0,8 mm'), 'Valeur' + NBSP + ': 0,8' + NBSP + 'mm');
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

test('nom court de la machine : « A1 · PLA Basic »', () => {
  assert.equal(L.shortMachine('Bambu Lab A1 0.4 nozzle', 'Bambu PLA Basic'), 'A1 · PLA Basic');
  assert.equal(L.shortMachine('Bambu Lab X1 Carbon 0.4 nozzle', 'Generic PETG'), 'X1 Carbon · PETG');
  assert.equal(L.shortMachine('Creality Ender-3 V3 0.4 nozzle(projet.3mf)', 'Bambu PLA Basic @BBL A1'), 'Ender-3 V3 · PLA Basic');
  assert.equal(L.shortMachine('Original Prusa MK4 0.6 nozzle', ''), 'MK4');
  assert.equal(L.shortMachine('', 'Generic PLA'), 'PLA');
  assert.equal(L.shortMachine('Ma machine', 'Mon fil'), 'Ma machine · Mon fil');
  assert.equal(L.shortMachine('', ''), '');
});

test('statut d’une pièce du journal : Réussi, Pas réglé, En attente, Sans réglage', () => {
  const ch = [{ id: 'retraction', before: 0.8, after: 1.2 }];
  assert.deepEqual(L.journalStatus({ changes: ch, outcome: 'ok' }), { label: 'Réussi', tone: 'ok' });
  assert.deepEqual(L.journalStatus({ changes: ch, outcome: 'bad' }), { label: 'Pas réglé', tone: 'bad' });
  assert.deepEqual(L.journalStatus({ changes: ch, outcome: '' }), { label: 'En attente', tone: 'warn' });
  assert.deepEqual(L.journalStatus({ changes: [] }), { label: 'Sans réglage', tone: '' });
});

test('typographie française : un nombre reste collé à son unité', () => {
  assert.equal(L.fr('240 → 235 °C'), '240 → 235\u00A0°C');
  assert.equal(L.fr('1,2 mm et 35 % et 12 g'), '1,2\u00A0mm et 35\u00A0% et 12\u00A0g');
  assert.equal(L.fr('environ 45 min'), 'environ 45\u00A0min');
  assert.equal(L.fr('3 pièces'), '3 pièces');            // pas une unité
  assert.equal(L.fr('2 grandes pièces'), '2 grandes pièces');
});

test('tour de calibration affichée dans l’ordre physique : le haut en premier', () => {
  const sections = [{ index: 0, label: '230 °C', value: 230 }, { index: 1, label: '225 °C', value: 225 }, { index: 2, label: '220 °C', value: 220 }];
  const tower = L.calibOrder(sections, true);
  assert.deepEqual(tower.map((s) => s.label), ['220 °C', '225 °C', '230 °C']);
  assert.deepEqual(tower.map((s) => s.where), ['En haut', '', 'En bas']);
  assert.equal(tower[0].index, 2);
  // Carrés ou lignes d'un test à plat : l'ordre reçu, sans repère.
  assert.deepEqual(L.calibOrder(sections, false).map((s) => [s.label, s.where]), [['230 °C', ''], ['225 °C', ''], ['220 °C', '']]);
  assert.deepEqual(L.calibOrder([], true), []);
});

test('typographie française : le jour reste collé au mois', () => {
  assert.equal(L.fr('le 1er novembre'), 'le 1er\u00A0novembre');
  assert.equal(L.fr('Le 24 octobre, on'), 'Le 24\u00A0octobre, on');
  assert.equal(L.fr('24 pièces'), '24 pièces');
});

test('nouveaux codes du service : trop de demandes, demande en cours, photo illisible', () => {
  const rl = L.errorView('rate_limited', { retry_after: 12 });
  assert.equal(rl.text, 'Trop de demandes d’un coup : réessaie dans 12 s.');
  assert.equal(rl.action, 'retry');
  assert.equal(rl.wait, 12);
  assert.equal(L.errorView('rate_limited', {}).text, 'Trop de demandes d’un coup : réessaie dans un instant.');
  assert.equal(L.errorView('rate_limited', {}).wait, 0);
  assert.equal(L.errorView('rate_limited', { retry_after: '7' }).wait, 7);
  assert.equal(L.errorView('request_in_progress').text, 'Une autre demande est déjà en cours : attends sa réponse.');
  assert.equal(L.errorView('request_in_progress').action, 'none');
  assert.equal(L.errorView('invalid_image').text, 'Cette photo n’est pas lisible (JPEG, PNG ou WebP) : reprends-la.');
  // Les anciens codes ne changent pas.
  assert.equal(L.errorView('insufficient_credits').action, 'credits');
});

test('délai d’attente : champ retry_after, sinon en-tête Retry-After (secondes), sinon 0', () => {
  assert.equal(L.retryAfter({ retry_after: 30 }, '5'), 30);
  assert.equal(L.retryAfter({}, '5'), 5);
  assert.equal(L.retryAfter(null, null), 0);
  assert.equal(L.retryAfter({ retry_after: -3 }, 'abc'), 0);
});

test('outcomePayload : imprimante et filament coupés à 100 caractères', () => {
  const p = L.outcomePayload({ printer: 'P'.repeat(150), filament: 'F'.repeat(120), changes: [], defect: 'x' }, 'ok');
  assert.equal(p.printer.length, 100);
  assert.equal(p.filament.length, 100);
});

test('photos du téléphone manquantes : phrase au singulier ou au pluriel', () => {
  assert.equal(L.missingPhotosText(1), '1 photo n’a pas pu être récupérée : renvoie-la depuis ton téléphone.');
  assert.equal(L.missingPhotosText(3), '3 photos n’ont pas pu être récupérées : renvoie-les depuis ton téléphone.');
  assert.equal(L.missingPhotosText(0), '');
  assert.equal(L.missingPhotosText(undefined), '');
});
