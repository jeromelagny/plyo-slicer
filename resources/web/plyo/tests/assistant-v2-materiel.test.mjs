// Assistant v2, lot 3 : étape 2 « Imprimante et bobine » (v2/materiel.js), exécutée avec un DOM factice et un pont simulé
// (tests/v2-dom.mjs). Les messages envoyés au slicer sont ceux du panneau classique.
// node --test resources/web/plyo/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2, response, sleep, read } from './v2-dom.mjs';

const norm = (t) => String(t).replace(/[\u00a0\u202f]/g, ' ');
const texts = (el) => norm(el.textContent);
const byText = (el, re) => el.querySelectorAll('button').find((b) => re.test(texts(b)));
const K1C = { preset: 'Creality K1C 0.4 nozzle', name: 'Creality K1C 0.4 nozzle', linked: true, host: '192.168.1.31' };
const ENDER = { preset: 'Creality Ender-3 V3 SE 0.4 nozzle', name: 'Creality Ender-3 V3 SE 0.4 nozzle', linked: false, host: '' };
const K2 = { preset: 'Creality K2 Plus 0.4 nozzle', name: 'Creality K2 Plus 0.4 nozzle', linked: true, host: '192.168.1.42', slots: 'cfs' };
const CFS = { ok: true, system: 'cfs', imposable: true, validated: true, empty_blocks: true, colours: [{ t: 0, color: '#FFFFFF', type: 'PLA' }],
  canvases: [{ canvas_id: 0, connected: true, trays: [
    { tray_id: 0, type: 'PLA', color: '#F4F4F4', status: 1, label: '1A' }, { tray_id: 1, type: 'PLA', color: '#222222', status: 1, label: '1B' },
    { tray_id: 2, type: 'PLA', color: '#D1495B', status: 1, label: '1C' }, { tray_id: 3, type: '', color: '', status: 0, label: '1D' }] }] };
const KEY = { ok: true, pieces: [{ ref: '1', name: 'Porte-clés', t: 0, parts: [{ ref: '11', name: 'Prénom', t: 0 }, { ref: '12', name: 'Fond', t: 1 }] }], colours: [{ t: 0, color: '#FFFFFF' }, { t: 1, color: '#D1495B' }] };
const BRANDS = [{ brand: 'Creality', printer: true, ranges: [{ preset: 'Creality Hyper PLA', label: 'Creality Hyper PLA', short: 'Hyper PLA' }, { preset: 'Creality CR-PLA', label: 'Creality CR-PLA', short: 'CR-PLA' }] },
  { brand: 'Sunlu', ranges: [{ preset: 'Sunlu PLA', label: 'Sunlu PLA', short: 'PLA' }] }];
const conversation = (project) => ({ title: 'x', updated: '2026-11-23T10:00:00Z', history: [], entries: [], project });
const PART_ONLY = { printer: null, filament: null, part: { name: 'Petit bateau' } };

// Pont simulé : la machine d'Orca suit printer_select_profile ; la bobine choisie devient le filament d'Orca.
function bridge(cfg = {}) {
  const orca = { printer: cfg.orca || K1C.preset, filament: 'Generic PLA', bed: 'Textured PEI Plate' };
  let material = 'PLA';
  const values = () => ({ type: 'values', locale: 'fr', params: [], context: { printer: orca.printer, filament: orca.filament, nozzle_mm: 0.4 },
    bed: { types: [{ value: 'Textured PEI Plate', label: 'Textured PEI Plate' }, { value: 'High Temp Plate', label: 'High Temp Plate' }], current: orca.bed },
    machine: { system: true, vendor: 'Creality', model: 'Creality K1C', nozzles: ['0.4', '0.6'], nozzle: '0.4' } });
  return (m, emit) => {
    if (m.type === 'ready') emit(values());
    else if (m.type === 'session_load') emit({ type: 'session', session: null });
    else if (m.type === 'project_resume_get') emit({ type: 'project_resume', attached: cfg.conversation ? 'c-1' : '', conversation: cfg.conversation || null, items: [] });
    else if (m.type === 'tour_signals') emit({ type: 'tour_signals', objects: 1, user_file: false });
    else if (m.type === 'habits_get') emit({ type: 'habits', habits: cfg.habits || {} });
    else if (m.type === 'firststeps_state') emit({ type: 'firststeps', state: { level: cfg.level || 'novice', seen: true } });
    else if (m.type === 'project_printers') emit({ type: 'project_printers', printers: cfg.printers || [] });
    else if (m.type === 'project_reachable') emit({ type: 'project_reachable', preset: m.preset, ok: true });
    else if (m.type === 'printer_scan') emit({ type: 'printer_scan_result', printers: cfg.found || [] });
    else if (m.type === 'setup_catalog') emit({ type: 'setup_catalog', catalog: [{ vendor: 'Creality', model: 'Creality Ender-3 V3 SE', nozzles: ['0.4'] }, { vendor: 'Creality', model: 'Creality Ender-3 V3', nozzles: ['0.4', '0.6'] }, { vendor: 'Prusa', model: 'Prusa MK4S', nozzles: ['0.4'] }] });
    else if (m.type === 'setup_install') { orca.printer = m.model + ' ' + m.nozzle + ' nozzle'; emit({ type: 'setup_installed', ok: true, preset: orca.printer }); }
    else if (m.type === 'printer_select_profile') { orca.printer = m.name; emit({ type: 'printer_profile_selected', ok: true }); emit(values()); }
    else if (m.type === 'spools_get') emit({ type: 'spools', items: cfg.spools || [] });
    else if (m.type === 'brands_get') emit({ type: 'brands', material: m.material, printer: m.printer, ok: true, brands: BRANDS });
    else if (m.type === 'spool_choose') { material = m.material; orca.filament = m.name + ' @K1C'; const known = (cfg.spools || []).some((x) => x.name === m.name); emit({ type: 'spool_chosen', ok: true, id: 'id-' + m.name, name: m.name, created: !known, preset_created: !known, success: { available: false } }); }
    else if (m.type === 'project_state') emit({ type: 'project_state', printer_preset: orca.printer, filament_preset: orca.filament, nozzle_temp: material === 'PETG' ? 240 : 210, bed_temp: material === 'PETG' ? 75 : 60 });
    else if (m.type === 'apply') emit({ type: 'result', request: m.request, ok: true, text: 'ok', undo_id: 3 });
    else if (m.type === 'bed_type_set') { const before = orca.bed; orca.bed = m.value; emit({ type: 'bed_type_set', token: m.token, ok: true, value: m.value, before, changed: before !== m.value }); emit(values()); }
    else if (m.type === 'canvas_read') emit(Object.assign({ type: 'canvas_state', preset: m.preset, id: m.id, send: false }, cfg.canvas || { ok: false }));
    else if (m.type === 'colours_get') emit(Object.assign({ type: 'colours', id: m.id }, cfg.colours || { ok: true, pieces: [{ ref: '1', name: 'Pièce', t: 0 }], colours: [{ t: 0, color: '#FFFFFF' }] }));
    else if (m.type === 'slots_manual_get') emit({ type: 'slots_manual_state', preset: m.preset, ok: false });
    else if (m.type === 'slot_brands_get') emit({ type: 'slot_brands', id: m.id, items: (cfg.slotBrands || []) });
    else if (m.type === 'canvas_apply') { orca.filament = 'CFS PLA'; emit({ type: 'canvas_applied', ok: true, presets: m.entries.map((e) => ({ t: e.t, preset: e.t === 0 ? 'CFS PLA' : 'CFS PLA ' + e.t })) }); }
  };
}
const start = async (cfg) => { const p = loadV2({ bridge: bridge(cfg), fetch: async () => response(404, {}) }); await sleep(40); return p; };
const sent = (p, type) => p.posted.filter((m) => m.type === type);

test('lot 3 : une seule imprimante reliée, choisie d’office ; PLA présélectionné, « Oui, sur … avec du PLA » choisit la bobine en un clic', async () => {
  const p = await start({ printers: [K1C, ENDER], conversation: conversation(PART_ONLY) });
  try {
    await sleep(30);
    const card = p.$('stepcard');
    assert.match(texts(card), /Étape 2 sur 3.*Sur quelle imprimante \?/);
    assert.deepEqual(sent(p, 'printer_select_profile').map((m) => m.name), [K1C.preset], 'la seule machine reliée est choisie (machineQuestion)');
    const conv = p.ctx.PlyoV2.panel.conv();
    assert.equal(conv.project.printer.preset, K1C.preset);
    const cards = card.querySelectorAll('.card');
    assert.match(texts(cards[0]), /Creality K1C.*Reliée en Wi-Fi.*Wi-Fi/);
    assert.ok(cards[0].classList.contains('sel'));
    assert.match(texts(cards[1]), /Creality Ender-3 V3 SE.*Impression par clé USB.*USB/);
    assert.ok(sent(p, 'printer_scan').length === 1, 'une recherche discrète sur le Wi-Fi');
    assert.match(texts(card), /Buse 0,4 mm · Plaque PEI texturée.*changer/, 'buse et plateau lus sur la machine');
    assert.deepEqual(card.querySelector('.mats').querySelectorAll('.chip').map(texts), ['PLA', 'PETG', 'Autres…']);
    assert.ok(card.querySelector('.mats').querySelector('.chip.sel').dataset.value === 'PLA', 'PLA présélectionné');
    assert.ok(!card.querySelector('.fold').classList.contains('open'), '« Préciser ma bobine » replié');
    assert.equal(texts(p.$('card-primary')), 'Oui, sur Creality K1C avec du PLA');
    // PETG, puis « Autres… »
    byText(card, /^PETG$/).click();
    assert.equal(texts(p.$('card-primary')), 'Oui, sur Creality K1C avec du PETG');
    byText(p.$('stepcard'), /^Autres…$/).click();
    assert.deepEqual(p.$('stepcard').querySelector('.mats').querySelectorAll('.chip').map(texts), ['PLA', 'PETG', 'ABS', 'ASA', 'TPU']);
    byText(p.$('stepcard'), /^PLA$/).click();
    p.$('card-primary').click();
    await sleep(30);
    const choose = sent(p, 'spool_choose').at(-1);
    assert.equal(choose.material, 'PLA');
    assert.match(choose.name, /^PLA du \d+(er)? \w+/, 'nom du jour, comme le classique');
    assert.equal(choose.printer, K1C.preset);
    assert.ok(!('brand_preset' in choose), 'pas de marque sans geste');
    assert.equal(conv.project.filament.type, 'PLA');
    assert.equal(conv.project.filament.temps_ok, true);
    assert.equal(conv.project.filament.spool.name, choose.name);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'imprimer', 'étape suivante');
    assert.match(texts(p.$('msgs')), /réglages courants du PLA \(buse 210 °C, plateau 60 °C\)/);
    assert.match(conv.project.thread.map((t) => t.text).join(' '), /Bobine : « PLA du/);
    assert.ok(!/crédit|token|question(s)? restante/i.test(texts(p.document.body)), 'jamais de crédits ni de tokens');
  } finally { p.stop(); }
});

test('lot 3 : mes bobines nommées, « Préciser ma bobine » (marque, gamme, nom avec son aide, températures de l’étiquette)', async () => {
  const spools = [{ id: 's1', name: 'Sunlu PLA blanc', material: 'PLA', last_ok_at: '2026-11-20', last_outcome: 'ok', colour: '#F4F4F4' }];
  const p = await start({ printers: [K1C], spools, conversation: conversation(PART_ONLY) });
  try {
    await sleep(30);
    let card = p.$('stepcard');
    assert.match(texts(card.querySelector('.spools')), /Sunlu PLA blanc.*✓ réussie le 20\/11/);
    card.querySelector('.spools').querySelector('.card').click();
    assert.equal(texts(p.$('card-primary')), 'Oui, sur Creality K1C avec Sunlu PLA blanc');
    // Préciser : marques du slicer pour cette matière et cette machine.
    p.$('spool-precise').click();
    await sleep(10);
    assert.equal(sent(p, 'brands_get').at(-1).material, 'PLA');
    card = p.$('stepcard');
    assert.ok(card.querySelector('.fold').classList.contains('open'));
    assert.match(texts(card), /Regarde l’étiquette de ta bobine : écris la marque et le type/, 'l’aide du nom, comme le classique');
    // Nom vide : refusé avec la raison, rien ne part.
    p.$('spool-name').value = '';
    p.$('spool-name').dispatch('input');
    const before = sent(p, 'spool_choose').length;
    p.$('card-primary').click();
    assert.equal(sent(p, 'spool_choose').length, before);
    assert.match(texts(p.$('stepcard')), /Écris le nom de ta bobine : il me sert à la retrouver la prochaine fois\./);
    // Marque à plusieurs gammes : « Gamme » ; le nom suit la marque tant qu'on ne l'a pas changé.
    const brand = p.$('stepcard').querySelectorAll('select').find((s) => s.getAttribute('aria-label') === 'Marque de ta bobine');
    brand.value = 'Creality'; brand.dispatch('change');
    const range = p.$('stepcard').querySelectorAll('select').find((s) => s.getAttribute('aria-label') === 'Gamme de ta bobine');
    range.value = 'Creality Hyper PLA'; range.dispatch('change');
    assert.equal(p.$('spool-name').value, 'Creality Hyper PLA');
    assert.match(texts(p.$('stepcard')), /Je pars des réglages prévus par Creality pour sa gamme Hyper PLA\./);
    const nozzle = p.$('stepcard').querySelectorAll('input').find((i) => i.getAttribute('aria-label') === 'Température de buse sur l’étiquette');
    nozzle.value = '190-220'; nozzle.dispatch('input');
    assert.equal(texts(p.$('card-primary')), 'Oui, sur Creality K1C avec cette bobine');
    p.$('card-primary').click();
    await sleep(30);
    const choose = sent(p, 'spool_choose').at(-1);
    assert.deepEqual([choose.name, choose.material, choose.brand, choose.range, choose.brand_preset], ['Creality Hyper PLA', 'PLA', 'Creality', 'Creality Hyper PLA', 'Creality Hyper PLA']);
    const apply = sent(p, 'apply').at(-1);
    assert.deepEqual(apply.changes, [{ id: 'nozzle_temp', value: 205 }, { id: 'nozzle_temp_initial', value: 205 }], 'température de l’étiquette appliquée');
    assert.equal(apply.project_edit, true);
    await sleep(20);
    assert.match(texts(p.$('msgs')), /Températures de ta bobine enregistrées : buse 205 °C\./);
  } finally { p.stop(); }
});

test('lot 3 : imprimante trouvée sur le Wi-Fi en carte ; « Ajouter mon imprimante » : recherche, catalogue, installation, adoption', async () => {
  const found = [{ ip: '192.168.1.42', name: 'K2 Plus', brand: 'Creality', match: { vendor: 'Creality', model: 'Creality K2 Plus', nozzles: ['0.4'] } }];
  const p = await start({ printers: [ENDER], found, conversation: conversation(PART_ONLY) });
  try {
    await sleep(30);
    let card = p.$('stepcard');
    assert.match(texts(card), /Creality K2 Plus.*Trouvée sur ton Wi-Fi/);
    p.$('printer-add').click();
    await sleep(20);
    card = p.$('stepcard');
    assert.match(texts(card), /Ajouter mon imprimante.*Allume-la et branche-la au Wi-Fi si elle peut/);
    assert.ok(sent(p, 'setup_catalog').length === 1);
    assert.match(texts(card), /Trouvée sur ton Wi-Fi.*Creality K2 Plus.*Adresse 192\.168\.1\.42/);
    // Le catalogue : la recherche filtre sans redessiner la carte (le champ garde ce qu'on tape).
    const input = p.$('model-search');
    input.value = 'ender v3';
    input.dispatch('input');
    assert.deepEqual(p.$('model-results').querySelectorAll('.card').map((c) => texts(c.querySelector('strong'))), ['Creality Ender-3 V3 SE', 'Creality Ender-3 V3']);
    // Débutant : un modèle à deux buses s'installe avec la 0,4 mm livrée.
    p.$('model-results').querySelectorAll('.card')[1].click();
    await sleep(20);
    assert.deepEqual(sent(p, 'setup_install').at(-1), { type: 'setup_install', vendor: 'Creality', model: 'Creality Ender-3 V3', nozzle: '0.4' });
    card = p.$('stepcard');
    assert.match(texts(card), /Ton imprimante est prête/);
    assert.match(texts(card), /J’ai pris la buse de 0,4 mm/);
    p.$('card-primary').click();
    await sleep(30);
    assert.equal(p.ctx.PlyoV2.panel.conv().project.printer.preset, 'Creality Ender-3 V3 0.4 nozzle', 'l’imprimante installée devient celle du projet');
    assert.match(texts(p.$('msgs')), /« Creality Ender-3 V3 » est installée : c’est l’imprimante de ce projet\./);
    assert.ok(sent(p, 'project_printers').length >= 2, 'liste des machines relue');
  } finally { p.stop(); }
});

test('lot 3 : confirmé : buse et plateau visibles d’office ; le plateau change sur un clic (bed_type_set), retenu dans les habitudes', async () => {
  const p = await start({ level: 'expert', printers: [K1C], conversation: conversation(PART_ONLY) });
  try {
    await sleep(30);
    const sels = p.$('stepcard').querySelectorAll('select');
    const bed = sels.find((s) => s.getAttribute('aria-label') === 'Plateau'), nozzle = sels.find((s) => s.getAttribute('aria-label') === 'Buse');
    assert.ok(bed && nozzle, 'questions visibles d’office');
    assert.deepEqual(nozzle.querySelectorAll('option').map(texts), ['0,4 mm (en place)', '0,6 mm']);
    bed.value = 'High Temp Plate'; bed.dispatch('change');
    await sleep(20);
    assert.deepEqual(sent(p, 'bed_type_set').at(-1), { type: 'bed_type_set', value: 'High Temp Plate', printer: K1C.preset, token: 1 });
    assert.equal(sent(p, 'habits_set').at(-1).habits.beds[K1C.preset], 'High Temp Plate');
    assert.match(texts(p.$('msgs')), /C’est noté : ton plateau est « Plaque lisse haute température »/);
    // Une autre buse : la variante du même modèle, installée et adoptée par le projet.
    const n2 = p.$('stepcard').querySelectorAll('select').find((s) => s.getAttribute('aria-label') === 'Buse');
    n2.value = '0.6'; n2.dispatch('change');
    await sleep(30);
    assert.deepEqual(sent(p, 'setup_install').at(-1), { type: 'setup_install', vendor: 'Creality', model: 'Creality K1C', nozzle: '0.6' });
    assert.equal(p.ctx.PlyoV2.panel.conv().project.printer.preset, 'Creality K1C 0.6 nozzle');
  } finally { p.stop(); }
});

test('lot 3 : débutant : buse et plateau repliés derrière « changer »', async () => {
  const p = await start({ printers: [K1C], conversation: conversation(PART_ONLY) });
  try {
    await sleep(30);
    assert.equal(p.$('stepcard').querySelectorAll('select').length, 0);
    p.$('hw-change').click();
    assert.ok(p.$('stepcard').querySelectorAll('select').some((s) => s.getAttribute('aria-label') === 'Plateau'));
  } finally { p.stop(); }
});

test('lot 3 : CFS lu sur la machine : grille des emplacements, « Oui, l’emplacement 1B », canvas_apply puis le plan d’envoi', async () => {
  const p = await start({ printers: [K2], orca: K2.preset, canvas: CFS, conversation: conversation(PART_ONLY) });
  try {
    await sleep(40);
    assert.equal(sent(p, 'canvas_read').at(-1).preset, K2.preset);
    const card = p.$('stepcard');
    assert.match(texts(card), /J’ai lu les bobines de ton CFS\. Laquelle utiliser \?/);
    const slots = card.querySelectorAll('.slot');
    assert.deepEqual(slots.map((s) => texts(s)), ['1APLA blanc', '1BPLA noir', '1CPLA rouge', '1Dvide']);
    assert.equal(slots[3].disabled, true, 'un emplacement vide refusé à l’envoi ne se choisit pas');
    slots[1].click();
    assert.equal(texts(p.$('card-primary')), 'Oui, l’emplacement 1B');
    p.$('card-primary').click();
    await sleep(30);
    assert.deepEqual(sent(p, 'canvas_apply').at(-1).entries, [{ t: 0, type: 'PLA', color: '#222222' }]);
    const project = p.ctx.PlyoV2.panel.conv().project;
    assert.equal(project.canvas[0].label, '1B');
    assert.equal(project.filament.preset, 'CFS PLA');
    const plan = sent(p, 'canvas_plan').at(-1);
    assert.deepEqual([plan.preset, plan.map[0].tray_id, plan.map[0].label], [K2.preset, 1, '1B']);
    // Les températures de l'étiquette sont demandées ensuite (comme le classique), pour la bobine de l'emplacement choisi.
    assert.equal(project.filament.temps_ok, false);
    const tcard = p.$('stepcard');
    assert.match(texts(tcard), /Quelles températures indique ta bobine \?/);
    assert.match(texts(tcard), /emplacement 1B/);
    const [buse, plateau] = tcard.querySelectorAll('input');
    buse.value = '200-220'; buse.dispatch('input');
    plateau.value = '60'; plateau.dispatch('input');
    p.$('card-primary').click();
    await sleep(30);
    assert.equal(project.filament.temps_ok, true);
    const apply = sent(p, 'apply').at(-1);
    assert.deepEqual(apply.changes.map((c) => [c.id, c.value]), [['nozzle_temp', 210], ['nozzle_temp_initial', 210], ['bed_temp', 60], ['bed_temp_initial', 60]]);
  } finally { p.stop(); }
});

test('lot 3 : pièce multicolore : la note « Ta pièce a 2 couleurs », la carte Couleurs (vue partagée) et « Utiliser ces bobines »', async () => {
  const p = await start({ printers: [K2], orca: K2.preset, canvas: Object.assign({}, CFS, { colours: KEY.colours }), colours: KEY, conversation: conversation(PART_ONLY) });
  try {
    await sleep(40);
    const card = p.$('stepcard');
    assert.match(texts(card), /Ta pièce a 2 couleurs : Prénom en PLA blanc · 1A, Fond en PLA rouge · 1C\./);
    p.$('colours-toggle').click();
    const box = p.$('stepcard').querySelector('.colours-box');
    assert.ok(box, 'la carte Couleurs');
    assert.match(texts(box), /Partie 1.*Prénom.*Partie 2.*Fond/);
    assert.equal(texts(p.$('card-primary')), 'Utiliser ces bobines');
    p.$('card-primary').click();
    await sleep(30);
    assert.deepEqual(sent(p, 'canvas_apply').at(-1).entries.map((e) => e.color), ['#F4F4F4', '#D1495B']);
    assert.equal(p.ctx.PlyoV2.panel.conv().project.canvas.length, 2);
  } finally { p.stop(); }
});

test('lot 3 : deuxième projet : « Comme la dernière fois ? », puis « Oui, c’est ça » prend la machine et la bobine d’avant', async () => {
  const last = { printer: { preset: K1C.preset, name: K1C.name, proposed: true }, part: { name: 'Crochet' },
    filament: { type: 'PLA', preset: 'Sunlu PLA blanc', proposed: true, spool: { id: 's1', name: 'Sunlu PLA blanc' } } };
  const spools = [{ id: 's1', name: 'Sunlu PLA blanc', material: 'PLA', last_ok_at: '2026-11-20', last_outcome: 'ok' }];
  const p = await start({ printers: [K1C, ENDER], spools, conversation: conversation(last) });
  try {
    await sleep(30);
    const card = p.$('stepcard');
    assert.match(texts(card), /Comme la dernière fois \?/);
    assert.match(texts(card), /Creality K1C.*Sunlu PLA blanc.*✓ réussie le 20\/11.*Vérifie juste que c’est bien cette bobine qui est dans la machine\./);
    assert.equal(texts(p.$('card-primary')), 'Oui, c’est ça');
    assert.equal(sent(p, 'printer_select_profile').length, 0, 'rien n’est appliqué sans confirmation');
    // « Changer d'imprimante ou de bobine » : la liste, « Retour » y ramène.
    p.$('materiel-change').click();
    assert.match(texts(p.$('stepcard')), /Sur quelle imprimante \?/);
    byText(p.$('stepcard'), /^Retour$/).click();
    p.$('card-primary').click();
    await sleep(30);
    assert.equal(sent(p, 'printer_select_profile').at(-1).name, K1C.preset);
    assert.deepEqual([sent(p, 'spool_choose').at(-1).name, sent(p, 'spool_choose').at(-1).material], ['Sunlu PLA blanc', 'PLA']);
    const project = p.ctx.PlyoV2.panel.conv().project;
    assert.ok(!project.printer.proposed && !project.filament.proposed);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'imprimer');
  } finally { p.stop(); }
});

test('lot 3 : un 3MF adapté renomme le profil copié « (Plyo) » : le filament du projet suit (syncProjectNames, laissé par le lot 2)', async () => {
  const project = { printer: { preset: K1C.preset, name: K1C.name }, part: { name: 'boite.3mf' }, filament: { type: 'PLA', preset: 'Generic PLA', temps_ok: true }, adapted: 'boite.3mf' };
  const p = await start({ printers: [K1C], conversation: conversation(project) });
  try {
    p.emit({ type: 'model_adapted', adaptation: { adapted: [{ label: 'Vitesse', before: 1, after: 2 }], saved: [{ type: 'filament', from: 'Generic PLA', name: 'Generic PLA (Plyo)' }] } });
    await sleep(10);
    assert.equal(p.ctx.PlyoV2.panel.conv().project.filament.preset, 'Generic PLA (Plyo)');
    assert.match(texts(p.$('msgs')), /J’ai adapté ce fichier à ton imprimante et à ton filament : 1 réglage changé\./);
  } finally { p.stop(); }
});

test('lot 3 : la page inclut la logique partagée, le classique l’utilise aussi', () => {
  const v2 = read('v2/index.html'), classic = read('index.html');
  for (const f of ['canvas-logic.js', 'colours-logic.js', 'colours-view.js', 'spools-logic.js', 'materiel-logic.js', 'v2/materiel.js'])
    assert.ok(v2.includes('<!--plyo-include:' + f + '-->'), f);
  assert.ok(v2.indexOf('plyo-include:materiel-logic.js') > v2.indexOf('plyo-include:colours-logic.js'), 'après ce dont elle a besoin');
  assert.ok(classic.includes('<!--plyo-include:materiel-logic.js-->'));
  for (const call of ['PlyoMateriel.canvasMode(', 'PlyoMateriel.canvasProposal(', 'PlyoMateriel.slotState(', 'PlyoMateriel.tempChanges(', 'PlyoProject.followSaved('])
    assert.ok(classic.includes(call), call);
  const view = read('v2/materiel.js');
  // Messages du pont : ceux du classique, jamais d'autres.
  for (const type of ['project_printers', 'printer_select_profile', 'printer_scan', 'setup_catalog', 'setup_install', 'spools_get', 'brands_get', 'spool_choose', 'project_state', 'bed_type_set', 'canvas_read', 'canvas_apply', 'canvas_plan', 'colours_get', 'colour_set', 'slots_manual_get', 'slots_manual_save'])
    assert.ok(view.includes("type: '" + type + "'"), type);
  assert.ok(!/onclick=|innerHTML/.test(view), 'pas de HTML ni de gestionnaire en ligne (CSP)');
});

test('lot 3 : l’étape rouverte depuis la barre : « Garder ces choix », ou une autre bobine qui refait la préparation et ramène à l’étape en cours', async () => {
  const project = { printer: { preset: K1C.preset, name: K1C.name }, part: { name: 'Petit bateau' }, filament: { type: 'PLA', preset: 'PLA du 1er novembre @K1C', temps_ok: true, spool: { id: 'a', name: 'PLA du 1er novembre' } }, step: 'print' };
  const p = await start({ printers: [K1C], conversation: conversation(project) });
  try {
    await sleep(30);
    assert.equal(p.$('stepper').querySelector('.st.cur').dataset.step, 'imprimer');
    p.$('stepper').querySelectorAll('.st')[1].click();
    assert.match(texts(p.$('stepcard')), /Étape 2 sur 3 · rouverte/);
    assert.equal(texts(p.$('card-primary')), 'Garder ces choix');
    byText(p.$('stepcard'), /^PETG$/).click();
    assert.equal(texts(p.$('card-primary')), 'Oui, sur Creality K1C avec du PETG');
    p.$('card-primary').click();
    await sleep(30);
    assert.equal(sent(p, 'spool_choose').at(-1).material, 'PETG');
    const conv = p.ctx.PlyoV2.panel.conv();
    assert.equal(conv.project.filament.type, 'PETG');
    assert.equal(conv.project.step, 'slice', 'bobine changée après la découpe : la préparation est à refaire');
    assert.ok(!/rouverte/.test(texts(p.$('stepcard'))), 'retour à l’étape en cours');
  } finally { p.stop(); }
});

test('lot 5 : marque d’un emplacement (slot_brands_get) : « C’est bien cette bobine ? », Oui prend le profil du fabricant à l’envoi des emplacements', async () => {
  const canvas = JSON.parse(JSON.stringify(CFS));
  Object.assign(canvas.canvases[0].trays[1], { brand: 'Creality', name: 'Hyper PLA' });
  const slotBrands = [{ key: '0:1', match: { brand: 'Creality', preset: 'Creality Hyper PLA @K2', label: 'Creality Hyper PLA', short: 'Hyper PLA' } }];
  const p = await start({ printers: [K2], orca: K2.preset, canvas, slotBrands, conversation: conversation(PART_ONLY) });
  try {
    await sleep(40);
    const ask = sent(p, 'slot_brands_get').at(-1);
    assert.equal(ask.printer, K2.preset);
    assert.ok(ask.slots.some((x) => x.key === '0:1' && x.brand === 'Creality'));
    p.$('stepcard').querySelectorAll('.slot')[1].click();
    assert.match(texts(p.$('stepcard')), /annonce « Creality Hyper PLA » à l’emplacement 1B : c’est bien cette bobine \?/);
    byText(p.$('stepcard'), /^Oui$/).click();
    assert.match(texts(p.$('stepcard')), /1B · Marque : Creality Hyper PLA/);
    p.$('card-primary').click();
    await sleep(30);
    assert.deepEqual(sent(p, 'canvas_apply').at(-1).entries, [{ t: 0, type: 'PLA', color: '#222222', preset: 'Creality Hyper PLA @K2' }]);
    assert.equal(p.ctx.PlyoV2.panel.conv().project.canvas[0].brand, 'Creality');
  } finally { p.stop(); }
});
