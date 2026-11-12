// Tests de la logique du projet (fiche « Mon projet ») : node --test resources/web/plyo/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../project-logic.js');

const printer = { preset: 'Elegoo Centauri Carbon 2 0.4 nozzle', name: 'Centauri Carbon 2' };
const filament = { type: 'PLA', preset: 'Generic PLA @ECC2', nozzle_temp: 215, bed_temp: 60 };

test('nextStep suit l’ordre imprimante, pièce, filament, puis ready', () => {
  assert.equal(P.nextStep(P.emptyProject()), 'printer');
  assert.equal(P.nextStep({ printer: printer, filament: null, part: null }), 'part');
  assert.equal(P.nextStep({ printer: printer, filament: null, part: { name: 'a.stl' } }), 'filament');
  assert.equal(P.nextStep({ printer: printer, filament: filament, part: null }), 'part');
  assert.equal(P.nextStep({ printer: printer, filament: filament, part: { name: 'a.stl' } }), 'ready');
});

test('nextStep accepte un projet absent ou abîmé', () => {
  assert.equal(P.nextStep(null), 'printer');
  assert.equal(P.nextStep('abc'), 'printer');
});

test('proposeFrom reprend imprimante et bobine à confirmer, sans pièce', () => {
  const p = P.proposeFrom({ printer: printer, filament: Object.assign({ spool: { id: 'b1', name: 'Sunlu PLA+ noir' } }, filament), part: { name: 'a.stl' } });
  assert.equal(p.printer.proposed, true);
  assert.equal(p.filament.proposed, true);
  assert.equal(p.part, null);
  assert.equal(P.nextStep(p), 'printer');
});

test('confirm retire la marque « proposé »', () => {
  const p = P.confirm(P.proposeFrom({ printer: printer, filament: Object.assign({ spool: { id: 'b1', name: 'Sunlu PLA+ noir' } }, filament), part: null }));
  assert.equal(p.printer.proposed, undefined);
  assert.equal(P.nextStep(p), 'part');
});

test('nextGuidedStep va de slice à after puis null', () => {
  assert.deepEqual(P.GUIDED_STEPS, ['slice', 'print', 'after']);
  assert.equal(P.nextGuidedStep('slice'), 'print');
  assert.equal(P.nextGuidedStep('after'), null);
});

test('partFromPlate prend la pièce posée sur le plateau quand la fiche attend la pièce', () => {
  const ready = { printer: printer, filament: filament, part: null };
  assert.equal(P.partFromPlate(ready, { objects: 1, part_name: 'bague.3mf' }), 'bague.3mf');
  assert.equal(P.partFromPlate(ready, { objects: 2, part_name: '' }), 'Pièce posée sur le plateau');
  assert.equal(P.partFromPlate(ready, { objects: 0, part_name: '' }), null);
  assert.equal(P.partFromPlate({ printer: printer, filament: filament, part: { name: 'a.stl' } }, { objects: 1, part_name: 'b.stl' }), null);
  assert.equal(P.partFromPlate({ printer: printer, filament: null, part: null }, { objects: 1, part_name: 'b.stl' }), 'b.stl');
  assert.equal(P.partFromPlate(P.emptyProject(), { objects: 1, part_name: 'b.stl' }), 'b.stl'); // pièce déjà sur le plateau avant même la machine
  assert.equal(P.partFromPlate(ready, null), null);
});

test('needsAdaptation : un 3MF se règle sur le projet une fois machine, pièce et filament choisis, une seule fois par pièce et par machine', () => {
  const ready = { printer: printer, filament: filament, part: { name: 'bague.3mf' } };
  assert.equal(P.needsAdaptation(ready), true);
  assert.equal(P.needsAdaptation(Object.assign({ adapted: 'bague.3mf' }, ready)), false);
  assert.equal(P.needsAdaptation(Object.assign({ adapted: 'autre.3mf' }, ready)), true);
  assert.equal(P.needsAdaptation({ printer: printer, filament: filament, part: { name: 'bague.stl' } }), false);
  assert.equal(P.needsAdaptation({ printer: printer, filament: null, part: { name: 'bague.3mf' } }), false);
  assert.equal(P.needsAdaptation({ printer: printer, filament: Object.assign({ proposed: true }, filament), part: { name: 'bague.3mf' } }), false);
  assert.equal(P.needsAdaptation(null), false);
});

test('restorable : remettre le projet dans Orca ne demande que la machine, le filament est facultatif', () => {
  assert.equal(P.restorable({ printer: printer }), true);
  assert.equal(P.restorable({ printer: printer, part: { name: 'a.stl' } }), true);
  assert.equal(P.restorable({ printer: Object.assign({ proposed: true }, printer) }), false);
  assert.equal(P.restorable(P.emptyProject()), false);
  assert.equal(P.restorable(null), false);
});

test('partFromPlate : la pièce du projet précédent n’est pas reprise en silence', () => {
  const old = { name: 'premier.stl', objects: 1 };
  assert.equal(P.partFromPlate({}, { objects: 1, part_name: 'premier.stl' }, old), null);
  assert.equal(P.partFromPlate({}, { objects: 1, part_name: 'neuf.stl' }, old), 'neuf.stl', 'une autre pièce est reconnue');
  assert.equal(P.partFromPlate({}, { objects: 2, part_name: 'premier.stl' }, old), 'Pièce posée sur le plateau', 'une pièce de plus est reconnue');
  assert.equal(P.partFromPlate({}, { objects: 1, part_name: 'premier.stl' }), 'premier.stl', 'sans projet précédent : comme avant');
});

test('les emplacements du projet gardent leur numéro et leur nature à la copie', async () => {
  const entry = { t: 0, canvas_id: 1, tray_id: 0, label: '1A', imposable: true, source: 'printer', system: 'cfs' };
  assert.deepEqual(P.confirm({ printer: null, filament: null, part: null, canvas: [entry] }).canvas, [entry]);
});

test('filamentChoiceError : un choix annulé dans la fenêtre d’Orca n’est pas un profil introuvable', () => {
  assert.equal(P.filamentChoiceError({ ok: false }, 'PLA'), 'Je n’ai pas trouvé de profil PLA pour cette imprimante. Choisis un autre filament.');
  const cancelled = P.filamentChoiceError({ ok: false, cancelled: true }, 'PLA');
  assert.ok(!cancelled.includes('pas trouvé'), cancelled);
  assert.ok(cancelled.includes('Choix annulé'));
  assert.ok(cancelled.includes('ton filament n’a pas changé'));
});

test('proposeFrom reprend la bobine du projet précédent, à confirmer (« Sunlu PLA+ noir, comme la dernière fois ? »)', () => {
  const prev = { printer: printer, filament: Object.assign({ spool: { id: 'b1', name: 'Sunlu PLA+ noir' } }, filament), part: { name: 'a.stl' } };
  const next = P.proposeFrom(prev);
  assert.deepEqual(next.filament.spool, { id: 'b1', name: 'Sunlu PLA+ noir' });
  assert.equal(next.filament.proposed, true);
  assert.equal(P.nextStep(Object.assign({}, next, { printer: printer, part: { name: 'b.stl' } })), 'filament', 'une bobine proposée n’est pas choisie');
});

test('proposeFrom : un filament sans bobine (projet d’avant « Quelle bobine ? ») n’est pas proposé', () => {
  const next = P.proposeFrom({ printer: printer, filament: filament, part: { name: 'a.stl' } });
  assert.equal(next.filament, null, 'l’étape Filament montre la liste et « Une nouvelle bobine »');
  assert.equal(next.printer.proposed, true);
});

// ---------- Lot 7 : un projet 3MF par conversation ----------
test('projet de la conversation : rouvert seulement quand la fiche a une pièce', () => {
  assert.equal(P.opensProjectFile({ part: { name: 'clip.stl' } }), true);
  assert.equal(P.opensProjectFile({ part: null }), false);
  assert.equal(P.opensProjectFile(P.emptyProject()), false);
  assert.equal(P.opensProjectFile(null), false);
});

test('projet de la conversation : texte quand le plateau ne revient pas', () => {
  assert.equal(P.projectOpenedText(''), '');
  const lost = 'Je n’ai pas retrouvé le plateau de cette conversation : je remets ta machine et ta bobine.';
  assert.equal(P.projectOpenedText('absent'), lost);
  assert.equal(P.projectOpenedText('abime'), lost);
  assert.equal(P.projectOpenedText('trop_gros'), lost);
  // L'utilisateur a gardé son propre projet dans la question d'Orca : on ne touche à rien.
  assert.equal(P.projectOpenedText('annule'), 'D’accord, ton plateau reste tel quel.');
  assert.equal(P.restoresAfterOpen(''), false);
  assert.equal(P.restoresAfterOpen('absent'), true);
  assert.equal(P.restoresAfterOpen('annule'), false);
});

test('projet de la conversation : plateau trop lourd', () => {
  assert.match(P.tooHeavyText(), /50 Mo/);
  assert.match(P.tooHeavyText(), /fiche/);
});

test('projet de la conversation : jamais attaché à un fichier de l’utilisateur', () => {
  assert.equal(P.mayAttach({ objects: 1 }), true);
  assert.equal(P.mayAttach({ objects: 1, user_file: true }), false);
  assert.equal(P.mayAttach(null), true);
});

test('projet de la conversation : slicer occupé, plateau trop lourd d’une conversation quittée', () => {
  assert.equal(P.restoresAfterOpen('occupe'), false);
  assert.match(P.projectOpenedText('occupe'), /occupé/);
  assert.match(P.tooHeavyText(true), /conversation précédente/);
  assert.doesNotMatch(P.tooHeavyText(false), /précédente/);
});

test('projet de la conversation : plateau détaché par Orca, rouvert seulement sur la même machine', () => {
  assert.deepEqual(P.afterDetached({ conv: 'a', same_printer: true }, 'a'), 'open');
  assert.deepEqual(P.afterDetached({ conv: 'a', same_printer: false }, 'a'), 'attach');
  assert.deepEqual(P.afterDetached({ conv: 'a', same_printer: true }, 'b'), '');
});

test('projet de la conversation : 3MF impossible à écrire (disque plein, droits)', () => {
  assert.match(P.projectFileText('echec', false), /place sur ton disque/);
  assert.match(P.projectFileText('echec', true), /conversation précédente/);
  assert.equal(P.projectFileText('', false), P.tooHeavyText(false));
  assert.equal(P.projectFileText('trop_gros', true), P.tooHeavyText(true));
});

test('ouverture refusée parce qu’Orca est occupé : le panneau redemande, puis le dit, sans rien changer d’ici là', () => {
  // Rouvert, ou refusé pour une autre raison : plus rien à redemander.
  assert.equal(P.openRetryStep('', 0), 'done');
  assert.equal(P.openRetryStep('absent', 3), 'done');
  assert.equal(P.openRetryStep('annule', 0), 'done');
  // Occupé : nouvel essai toutes les 3 s, une minute au plus (20 essais), puis on s’arrête et on le dit.
  assert.equal(P.openRetryStep('occupe', 0), 'retry');
  assert.equal(P.openRetryStep('occupe', 19), 'retry');
  assert.equal(P.openRetryStep('occupe', 20), 'give_up');
  assert.equal(P.OPEN_RETRY_MS, 3000);
  assert.match(P.projectOpenedText('occupe'), /dès qu’il a fini/);
  assert.match(P.openGiveUpText(), /Mes conversations/);
});
