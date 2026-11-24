// Assistant v2, étape 2 « Imprimante et bobine » (lot 3) : les imprimantes connues ou trouvées sur le Wi-Fi en cartes, « Ajouter
// mon imprimante » (recherche Wi-Fi, catalogue des modèles, buse, liaison), « Buse · plateau · changer » (visibles d'office pour
// un confirmé), la bobine (PLA présélectionné, PETG, Autres, mes bobines nommées, « Préciser ma bobine » replié : marque, nom,
// températures de l'étiquette), les emplacements lus sur la machine (Canvas, CFS, IFS, U1, saisie manuelle), la carte Couleurs
// d'une pièce multicolore et, au deuxième projet, « Comme la dernière fois ? ».
// Mêmes messages au slicer que le panneau classique (project_printers, printer_select_profile, printer_scan, setup_catalog,
// setup_install, printer_link_*, spools_get, brands_get, spool_choose, project_state, apply, bed_type_set, canvas_read,
// canvas_apply, canvas_plan, slots_manual_*, colours_get, colour_set) ; logique partagée : machines-logic.js, spools-logic.js,
// canvas-logic.js, colours-logic.js, materiel-logic.js, project-logic.js, journey-logic.js. Vue seulement : PlyoV2.cards.materiel.
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var ui = V2.ui;
  var J = root.PlyoJourney, P = root.PlyoProject, M = root.PlyoMachines, Sp = root.PlyoSpools, C = root.PlyoCanvas, Col = root.PlyoColours,
    Mat = root.PlyoMateriel, Logic = root.PlyoLogic;

  var panel = null;
  var printers = null;        // machines installées (project_printers), null tant que le slicer ne les a pas données
  var reachable = {};         // machine reliée → joignable (project_reachable)
  var catalog = null;         // modèles installables (setup_catalog)
  var habits = M.emptyHabits();
  var level = '';             // niveau des premiers pas : « expert » = « Je connais déjà » (confirmé)
  var found = null;           // imprimantes trouvées sur le Wi-Fi et pas encore installées (recherche discrète, une par session)
  var scanning = { bg: false, asked: false };
  var request = 2000000;      // demandes de cette étape qui attendent un « result » ou un « plate_action »
  var waiters = {};
  var actions = null;         // gestes de la carte affichée (fermer l'étape rouverte)
  var machineSig = '';        // plateau, buse et modèle lus pour la machine en cours (message « values »)

  // ---------- État de l'étape, pour la conversation affichée ----------
  function freshSetup() { return { phase: '', printers: [], query: '', pick: null, found: null, retried: false, error: false, nozzle: '', preset: '', change: null, nozzleAuto: false, link: null, noneHelp: false }; }
  function fresh(id) {
    return { conv: id, screen: 'main', showList: false, showOthers: false, pending: null, error: {}, hwOpen: false, auto: false,
      pick: null, material: 'PLA', moreMats: false, name: '', nameSuggested: '', nameError: '', temps: { nozzle: '', bed: '' }, colour: '',
      brands: null, brandsFor: '', brandsPr: '', brandSel: '', rangeSel: '', otherBrand: '', brandTimer: null,
      spools: { printer: null, items: null },
      canvas: { preset: null, state: null, loading: false, mapping: null, useList: false, error: '', readId: 0, applying: null, planKey: null, brands: { of: null, id: 0, items: null }, choice: {}, dismissed: {} },
      manual: { preset: null, state: null, loading: false, confirmed: false, form: false, draft: null, count: 2, error: '' },
      colours: { state: null, id: 0, picker: null, token: 0, next: 0, error: '', recheck: false, open: false, shut: false, sent: null, unfolded: false, batch: null },
      bed: { token: 0, next: 0 }, setup: freshSetup(), adoptNote: '', keepSpool: null };
  }
  var S = fresh(null);
  function conv() { return panel ? panel.conv() : null; }
  function state() {
    var c = conv();
    if (c && S.conv !== c.id) {
      clearTimeout(S.brandTimer);
      S = fresh(c.id);
      // Le projet tel qu'on le trouve : une machine ou une bobine changée ensuite refait la préparation (resetStepOnChange).
      if (!c.seenProject) c.seenProject = JSON.parse(JSON.stringify(c.project));
    }
    return S;
  }
  function project() { var c = conv(); return c ? c.project : P.emptyProject(); }
  function render() { if (panel) panel.render(); }
  function values() { return panel ? panel.values() : null; }
  function orcaPrinter() { var v = values(); return v && v.context ? v.context.printer : ''; }
  function chosenPreset() { var p = project().printer; return p && !p.proposed ? p.preset : ''; }
  function selectedPrinter() { var p = project().printer; return p && p.preset ? p : null; }
  function known() { var p = selectedPrinter(); return p ? Mat.knownPrinter(printers, p.preset) : null; }
  function shortName(p) { return J.shortMachine(p) || (p && (p.name || p.preset)) || 'ton imprimante'; }
  function expert() { return level === 'expert'; }
  function thread(text) { var c = conv(); if (c && root.PlyoThread && root.PlyoThread.add(c.project, 'etapes', text)) panel.scheduleSave(); }
  // Une phrase dans la discussion, gardée avec la conversation.
  function note(text, tone, acts) {
    if (!text) return null;
    panel.record({ kind: 'note', text: text, tone: tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'ok' });
    return panel.say(text, tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'info', acts);
  }
  // Par le panneau : les autres étapes reçoivent la même copie (sinon l'une effacerait ce que l'autre vient de retenir).
  function saveHabits() { if (panel.setHabits) panel.setHabits(habits); else panel.post({ type: 'habits_set', habits: habits }); }

  // Machine ou bobine changée (comme projectChanged du classique) : une découpe déjà faite est périmée, un 3MF est adapté au
  // projet dès que la fiche est complète.
  function changed() {
    var c = conv();
    if (!c) return;
    c.project = J.resetStepOnChange(c.seenProject || null, c.project);
    c.seenProject = JSON.parse(JSON.stringify(c.project));
    if (P.needsAdaptation(c.project)) {
      c.project.adapted = c.project.part.name;
      panel.post({ type: 'model_adapt', project: c.project });
    }
    panel.scheduleSave();
    // L'étape rouverte depuis la barre est redevenue celle en cours : on la referme.
    if (actions && actions.revisit && J.barKey(J.currentStep(c.project)) === 'materiel' && actions.closeRevisit) { var close = actions.closeRevisit; actions = null; close(); return; }
    render();
  }
  function followSaved(saved) { var c = conv(); if (c && P.followSaved(c.project, saved)) panel.scheduleSave(); }

  // ---------- Petits éléments ----------
  function noteBox(kind, iconName, text, acts) {
    var b = ui.el('div', 'note ' + (kind || ''));
    b.appendChild(ui.icon(iconName || 'info', 18));
    var body = ui.el('div', 'note-body');
    if (text) body.appendChild(ui.el('p', '', text));
    if (acts && acts.length) { var row = ui.el('div', 'acts'); acts.forEach(function (a) { if (a) row.appendChild(a); }); body.appendChild(row); }
    b.appendChild(body);
    return b;
  }
  function section(text) { return ui.el('div', 'sec', text); }
  function spinLine(text) { var l = ui.el('div', 'scan'); l.appendChild(ui.el('span', 'spin')); l.appendChild(ui.el('span', '', text)); return l; }
  function badge(kind) {
    var b = ui.el('span', 'badge' + (kind === 'usb' ? ' usb' : ''));
    b.appendChild(ui.icon(kind === 'usb' ? 'usb' : 'wifi', 12));
    b.appendChild(ui.txt(kind === 'usb' ? 'USB' : 'Wi-Fi'));
    return b;
  }
  // Carte de choix (maquette) : icône, titre, sous-titre, badge, rond coché (radio) ou chevron.
  function card(o) {
    var b = ui.el('button', 'card' + (o.sel ? ' sel' : ''));
    b.type = 'button';
    if (o.radio) b.setAttribute('aria-pressed', o.sel ? 'true' : 'false');
    var ic = ui.el('span', 'ic');
    if (o.swatch) { var sw = ui.el('span', 'cyl'); sw.style.background = o.swatch; ic.appendChild(sw); } else ic.appendChild(ui.icon(o.icon || 'printer', 22));
    b.appendChild(ic);
    var mid = ui.el('span', 'mid');
    mid.appendChild(ui.el('strong', '', o.title));
    if (o.sub) mid.appendChild(ui.el('small', '', o.sub));
    b.appendChild(mid);
    var end = ui.el('span', 'end');
    if (o.badge) end.appendChild(o.badge);
    if (o.radio) { var ck = ui.el('span', 'check'); if (o.sel) ck.appendChild(ui.icon('check', 14)); end.appendChild(ck); }
    else end.appendChild(ui.icon('right', 16));
    b.appendChild(end);
    if (o.on) b.addEventListener('click', o.on);
    if (o.disabled) b.disabled = true;
    return b;
  }
  function chip(label, on, sel, id) {
    var b = ui.button(label, on, 'chip' + (sel ? ' sel' : ''));
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    if (id) b.dataset.value = id;
    return b;
  }
  function field(label, input) { var l = ui.el('label', 'fld'); l.appendChild(ui.el('span', '', label)); l.appendChild(input); return l; }
  function textInput(value, onInput, attrs) {
    var i = ui.el('input');
    i.type = 'text';
    i.value = value || '';
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    i.addEventListener('input', function () { onInput(i.value); });
    return i;
  }
  function select(options, current, onChange, label) {
    var s = ui.el('select');
    if (label) s.setAttribute('aria-label', ui.fr(label));
    options.forEach(function (o) {
      var opt = ui.el('option', '', o.label);
      opt.value = o.value;
      if (o.value === current) { opt.selected = true; opt.setAttribute('selected', ''); }
      if (o.disabled) opt.disabled = true;
      s.appendChild(opt);
    });
    s.value = current;
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  // ---------- Imprimante ----------
  function askPrinters() { panel.post({ type: 'project_printers' }); }
  function onPrinters(msg) {
    printers = Array.isArray(msg.printers) ? msg.printers : [];
    printers.forEach(function (p) { if (p.linked) panel.post({ type: 'project_reachable', preset: p.preset }); });
    if (found) found = found.filter(function (f) { return !M.isKnownHost(printers, f.ip); });
    render();
  }
  // Début de l'étape : une seule machine, choisie sans question (« changer » reste) ; plusieurs reliées, celle d'Orca ou la
  // dernière proposée (PlyoMachines.machineQuestion, comme le classique). Une recherche discrète sur le Wi-Fi, une par session.
  function ensureMachine() {
    var st = state(), p = project();
    if (!printers || !values() || st.pending || st.screen !== 'main') return;
    if (!scanning.asked) { scanning.asked = true; scanning.bg = true; panel.post({ type: 'printer_scan' }); }
    if (p.printer || st.auto) return;
    var q = M.machineQuestion(printers, { orcaPreset: orcaPrinter(), lastPreset: habits.last, hidden: habits.hidden });
    st.auto = true;
    if (q.mode === 'auto') setTimeout(function () { if (state() === st && !project().printer) pickPrinter(q.machine.preset, q.machine.label); }, 0);
    else if (q.mode === 'confirm') { p.printer = { preset: q.machine.preset, name: q.machine.label, proposed: true }; panel.scheduleSave(); }
  }
  // Choisir une machine la sélectionne dans Plyo Slicer (même message que le classique) ; `then` : la suite une fois faite.
  function pickPrinter(preset, name, then) {
    var st = state();
    st.error = {};
    st.pending = { kind: 'printer', preset: preset, name: name || preset, then: then || null };
    panel.post({ type: 'printer_select_profile', name: preset });
    render();
  }
  function onProfileSelected(msg) {
    var st = state(), pend = st.pending;
    if (st.setup.link && (!pend || pend.kind !== 'printer')) { linkProfileSelected(msg); return; }
    if (!pend || pend.kind !== 'printer') return;
    st.pending = null;
    if (!msg.ok) { st.error = { printer: 'Je n’ai pas pu sélectionner cette imprimante dans Plyo Slicer.' }; render(); return; }
    var p = project(), same = !!(p.filament && p.printer && p.printer.preset === pend.preset);
    p.printer = { preset: pend.preset, name: pend.name };
    if (!same) { p.filament = null; delete p.canvas; } // le filament dépend de la machine
    st.showList = false;
    st.spools = { printer: null, items: null };
    thread('Imprimante : « ' + shortName(p.printer) + ' ».');
    changed();
    if (pend.then) pend.then();
  }

  // ---------- Bobine ----------
  function ensureSpools(preset) {
    var st = state();
    if (!preset || st.spools.printer === preset) return;
    st.spools = { printer: preset, items: null };
    panel.post({ type: 'spools_get', printer: preset });
  }
  function spoolRows() { var st = state(), pr = selectedPrinter(); return pr && st.spools.printer === pr.preset && Array.isArray(st.spools.items) ? Sp.choiceRows(st.spools.items) : null; }
  // Ce qui est choisi dans la section bobine : une bobine connue ({ kind: 'spool', id, name, material }) ou une nouvelle ('new').
  function currentPick() {
    var st = state(), f = project().filament;
    if (st.pick) return st.pick;
    if (f && f.spool && f.spool.id && !(Array.isArray(project().canvas) && project().canvas.length)) return { kind: 'spool', id: f.spool.id, name: f.spool.name, material: f.type };
    return { kind: 'new' };
  }
  function askBrands(material) {
    var st = state(), pr = chosenPreset();
    st.brands = null;
    st.brandsFor = material;
    st.brandsPr = pr || '';
    st.brandSel = ''; st.rangeSel = ''; st.otherBrand = '';
    clearTimeout(st.brandTimer);
    if (!pr || !material) { st.brands = []; return; }
    panel.post({ type: 'brands_get', material: material, printer: pr });
    // Sans réponse du slicer, on montre quand même « Je ne sais pas » et la marque écrite à la main (comme le classique).
    st.brandTimer = setTimeout(function () { if (state() === st && st.brands === null && st.brandsFor === material) { st.brands = []; render(); } }, Sp.BRANDS_WAIT_MS);
  }
  function onBrands(msg) {
    var st = state();
    if (msg.material !== st.brandsFor || msg.printer !== chosenPreset()) return;
    clearTimeout(st.brandTimer);
    st.brands = msg.ok && Array.isArray(msg.brands) ? msg.brands : [];
    render();
  }
  // La marque choisie dans « Préciser ma bobine » (PlyoSpools.brandChoice), ou null tant que rien n'est dit.
  function brandChoice() {
    var st = state();
    if (st.brandSel === '__other') return Sp.otherChoice(st.otherBrand);
    if (st.brandSel === '__unknown') return Sp.unknownChoice();
    var g = (st.brands || []).filter(function (x) { return x.brand === st.brandSel; })[0];
    if (!g) return null;
    if (g.ranges.length === 1) return Sp.brandChoice(g, g.ranges[0]);
    var r = g.ranges.filter(function (x) { return x.preset === st.rangeSel; })[0];
    return Sp.brandChoice(g, r || null);
  }
  function dayToday() { var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; }; return Logic.dayText(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())); }
  // Le nom proposé : la marque (et la gamme) puis la couleur (« Sunlu PLA noir »), ou la matière et la couleur (« PLA rouge ») ;
  // sans l'une ni l'autre, la matière et le jour (« PLA du 23 novembre »), unique parmi les bobines de la machine.
  function suggestedName() {
    var st = state(), c = brandChoice(), rows = spoolRows() || [];
    var named = Mat.spoolName(c && Sp.suggestedName(c, st.material), st.material, st.colour, '');
    return named || Sp.autoName(st.material, dayToday(), rows.map(function (r) { return r.name; }));
  }
  function syncName() {
    var st = state(), sugg = suggestedName();
    if (!Sp.cleanName(st.name) || Sp.cleanName(st.name) === st.nameSuggested) st.name = sugg;
    st.nameSuggested = sugg;
  }
  function pickMaterial(type) {
    var st = state();
    st.pick = { kind: 'new' };
    if (st.material !== type) { st.material = type; askBrands(type); syncName(); }
    render();
  }
  // `choice` : la marque d'une NOUVELLE bobine ; `opts` : { temps ({nozzle, bed} de l'étiquette), asked (étiquette demandée dans
  // le formulaire : pas de seconde question), colour (teinte choisie, #RRGGBB, donnée à la pièce) }.
  function chooseSpool(name, material, choice, opts) {
    var st = state(), pr = chosenPreset(), v = values();
    if (!pr) return;
    st.error = {};
    st.pending = { kind: 'spool', type: material, asked: !!(opts && opts.asked), temps: opts && opts.temps || null, profileBefore: v && v.context ? v.context.filament : '' };
    var msg = { type: 'spool_choose', name: name, material: material, printer: pr };
    if (opts && opts.colour) msg.colour = opts.colour;
    if (choice && choice.brand) { msg.brand = choice.brand; msg.range = choice.kind === 'brand' ? choice.range : ''; msg.brand_preset = choice.kind === 'brand' ? choice.preset : ''; }
    panel.post(msg);
    render();
  }
  function onSpools(msg) { var st = state(); st.spools.items = Array.isArray(msg.items) ? msg.items : []; render(); }
  function onSpoolChosen(msg) {
    var st = state(), pend = st.pending;
    if (!pend || pend.kind !== 'spool') return;
    if (!msg.ok) {
      st.pending = null;
      st.error = { filament: msg.cancelled ? P.filamentChoiceError(msg, pend.type) : msg.text || 'Je n’ai pas pu choisir cette bobine. Réessaie.' };
      st.keepSpool = null;
      render();
      return;
    }
    st.spools = { printer: null, items: null }; // relue la prochaine fois (une bobine de plus)
    st.pending = { kind: 'filament', type: pend.type, spool: { id: msg.id, name: msg.name }, fresh: msg.preset_created === undefined ? !!msg.created : !!msg.preset_created,
      success: msg.success || null, printRestored: msg.print_restored || null, asked: pend.asked, temps: pend.temps,
      brand: typeof msg.brand === 'string' ? msg.brand : '', range: typeof msg.range === 'string' ? msg.range : '', brandProfile: msg.brand_profile === true };
    panel.post({ type: 'project_state' }); // le préréglage choisi et ses températures
  }
  function onProjectState(msg) {
    var st = state(), pend = st.pending, p = project();
    if (!pend) return;
    st.pending = null;
    if (pend.kind === 'adopt') {
      // Imprimante installée (ou buse changée) et sélectionnée dans Plyo Slicer : elle devient celle du projet. Sa bobine est
      // rechoisie pour elle, avec les mêmes températures.
      var kept = p.filament && !p.filament.proposed ? p.filament : null;
      p.printer = { preset: msg.printer_preset, name: msg.printer_preset };
      p.filament = null;
      delete p.canvas;
      st.spools = { printer: null, items: null };
      st.screen = 'main';
      changed();
      if (st.adoptNote) { note(st.adoptNote, 'ok'); st.adoptNote = ''; }
      if (kept && kept.spool && kept.type) chooseSpool(kept.spool.name, kept.type, null, { temps: { nozzle: kept.nozzle_temp, bed: kept.bed_temp }, keep: true });
      return;
    }
    if (pend.kind === 'temps') {
      if (p.filament) { p.filament.nozzle_temp = msg.nozzle_temp; p.filament.bed_temp = msg.bed_temp; }
      changed();
      return;
    }
    if (pend.kind !== 'filament') return;
    // Comme le classique : les températures de l'étiquette sont demandées (tempsCard) après un choix d'emplacements ou une
    // nouvelle bobine sans étiquette saisie ; gardées sans question pour une bobine connue (son préréglage les a déjà), choisie
    // d'un clic, ou dont l'étiquette vient d'être recopiée.
    var labelGiven = !!(pend.temps && Mat.tempChanges(pend.temps.nozzle, pend.temps.bed).length);
    // Emplacement dont l'étiquette a déjà été confirmée, et qui montre la même bobine : ses températures sont reprises.
    // Avec plusieurs couleurs, chaque emplacement compte : la question ne tombe que si tous ont déjà leur étiquette.
    var slotRecs = pend.canvas && p.printer && Array.isArray(p.canvas) ? p.canvas.map(function (e) { return { e: e, rec: Mat.slotTempsFor(habits, p.printer.preset, e) }; }).filter(function (x) { return !!x.rec; }) : [];
    var allRecalled = pend.canvas && Array.isArray(p.canvas) && p.canvas.length > 0 && slotRecs.length === p.canvas.length;
    var tempsOk = allRecalled || (!pend.canvas && !!pend.spool && (!pend.fresh || pend.asked || labelGiven));
    p.filament = { type: pend.type, preset: msg.filament_preset, nozzle_temp: msg.nozzle_temp, bed_temp: msg.bed_temp, temps_ok: tempsOk };
    if (pend.spool) p.filament.spool = pend.spool;
    if (pend.spool && pend.brand) { p.filament.brand = pend.brand; if (pend.range) p.filament.range = pend.range; if (pend.brandProfile) p.filament.brand_profile = true; }
    if (!pend.canvas) delete p.canvas; // une bobine de la liste remplace les emplacements choisis avant
    st.pick = null; st.temps = { nozzle: '', bed: '' }; st.slotTemps = {}; st.colour = ''; st.name = ''; st.nameSuggested = '';
    changed();
    closeRevisit(); // étape rouverte depuis la barre : le choix fait, on revient où on en était
    if (pend.canvas) { syncCanvasPlan(true); if (slotRecs.length) reuseSlotTemps(slotRecs, msg, allRecalled); return; } // sinon la carte des températures (tempsCard)
    announceSpool(pend, msg);
    // Températures de l'étiquette (« Préciser ma bobine ») : appliquées au profil de la bobine, comme dans le classique.
    var t = pend.temps;
    if (t && Mat.tempChanges(t.nozzle, t.bed).length && (Mat.labelTemp(t.nozzle) !== msg.nozzle_temp || Mat.labelTemp(t.bed) !== msg.bed_temp)) setTemps(t.nozzle, t.bed);
  }
  // Emplacements déjà connus (même bobine que la dernière fois) : leurs températures sont remises, une note par lot, et
  // « Ce n'est plus la même bobine » les oublie pour reposer la question.
  function reuseSlotTemps(list, msg, all) {
    var p = project(), printer = p.printer.preset, temps = [];
    list.forEach(function (x) {
      var rec = x.rec;
      var n = typeof rec.nozzle === 'number' ? rec.nozzle : null, b = typeof rec.bed === 'number' ? rec.bed : null;
      var nowN = x.e === p.canvas[0] ? msg.nozzle_temp : x.e.nozzle, nowB = x.e === p.canvas[0] ? msg.bed_temp : x.e.bed;
      if ((n !== null && n !== nowN) || (b !== null && b !== nowB)) temps.push({ e: x.e, nozzle: n, bed: b });
      x.shownN = n !== null ? n : nowN; x.shownB = b !== null ? b : nowB;
    });
    applySlotTemps(temps, true);
    if (!all) return; // les autres emplacements : la carte des températures, avec ceux-ci déjà remplis
    var again = ui.button(list.length > 1 ? 'Ce ne sont plus les mêmes bobines' : 'Ce n’est plus la même bobine', function () {
      again.disabled = true;
      list.forEach(function (x) { habits = Mat.forgetSlotTemps(habits, printer, x.e); });
      saveHabits();
      if (project() === p && p.filament) { p.filament.temps_ok = false; changed(); }
    }, 'link');
    var said = list.map(function (x) { return (list.length > 1 && x.e.label ? x.e.label + ' : ' : '') + 'buse ' + tempOf(x.shownN) + ', plateau ' + tempOf(x.shownB); });
    note((list.length > 1 ? 'Mêmes bobines que la dernière fois : je reprends leurs températures (' + said.join(' ; ') + ').'
      : 'Même bobine que la dernière fois' + (list[0].e.label ? ' dans l’emplacement ' + list[0].e.label : '') + ' : je reprends ses températures (' + said[0] + ').'), 'ok', [again]);
  }
  // Applique les températures d'étiquette : d'abord les couleurs 2 et suivantes (slot_temps_set, un profil par couleur), puis la
  // couleur 1 par l'onglet Filament (setTemps), qui enregistre son profil comme avant.
  function applySlotTemps(list, quiet) {
    var p = project(), first = p.canvas && p.canvas[0], others = list.filter(function (x) { return x.e !== first; }), main = list.filter(function (x) { return x.e === first; })[0];
    var failed = [];
    (function next() {
      if (others.length) {
        var x = others.shift(), id = ++request;
        waiters[id] = function (ok, text) { if (!ok) failed.push((x.e.label || 'couleur ' + (x.e.t + 1)) + ' : ' + (text || 'non réglée')); next(); };
        panel.post({ type: 'slot_temps_set', request: id, t: x.e.t, nozzle: x.nozzle !== null && x.nozzle !== undefined ? x.nozzle : -1, bed: x.bed !== null && x.bed !== undefined ? x.bed : -1 });
        return;
      }
      if (failed.length) note('Je n’ai pas pu régler toutes les températures (' + failed.join(' ; ') + ').', 'error');
      if (main) setTemps(main.nozzle !== null && main.nozzle !== undefined ? String(main.nozzle) : '', main.bed !== null && main.bed !== undefined ? String(main.bed) : '', quiet);
      else if (!quiet && list.length) note('Températures de tes bobines enregistrées.', 'ok');
    })();
  }
  function closeRevisit() { if (actions && actions.revisit && actions.closeRevisit) { var close = actions.closeRevisit; actions = null; close(); } }
  function tempOf(v) { return v != null ? v + ' °C' : '?'; }
  function announceSpool(pend, msg) {
    var name = pend.spool.name;
    thread('Bobine : « ' + name + ' ».');
    var r = pend.printRestored;
    if (r && !r.ok) note('Je n’ai pas pu remettre les réglages d’impression qui avaient marché avec ' + name + (r.text ? ' : ' + r.text : '.'), 'error');
    else if (r && Sp.printRestoredText(name, r)) {
      var undo = r.undo_id ? ui.button('Annuler', function () {
        undo.disabled = true;
        applyRequest({ type: 'undo', undo_id: r.undo_id }, function (ok, text) { if (!ok) { undo.disabled = false; note(text || 'Je n’ai pas pu annuler.', 'error'); return; } undo.remove(); note('C’est annulé : ce projet reprend les réglages d’impression de ton profil.', 'ok'); });
      }, 'link', 'undo') : null;
      note(Sp.printRestoredText(name, r), 'ok', undo ? [undo] : null);
      thread(Sp.printRestoredText(name, r) + (r.summary ? ' (' + r.summary + ')' : ''));
    }
    var label = !!(pend.temps && Mat.tempChanges(pend.temps.nozzle, pend.temps.bed).length); // ses températures suivent (setTemps)
    if (pend.fresh && pend.asked) note('« ' + name + ' » fait partie de tes bobines' + (label ? '.' : ' : je prends les températures conseillées (buse ' + tempOf(msg.nozzle_temp) + ', plateau ' + tempOf(msg.bed_temp) + ').'), 'ok');
    else if (pend.success && pend.success.available && !(r && r.ok && r.count > 0 && !pend.success.differs)) note(Sp.resumeText(name, pend.success), pend.success.differs ? 'info' : 'ok');
    else if (pend.fresh) note('« ' + name + ' » fait partie de tes bobines : je retiens ce qui marche avec elle.', 'ok');
  }
  // Un lot pour le slicer qui répond par « result » (apply, undo) : `after(ok, texte)`.
  function applyRequest(message, after) {
    var id = ++request;
    waiters[id] = after;
    message.request = id;
    panel.post(message);
  }
  function onResult(msg) {
    followSaved(msg.saved);
    var w = waiters[msg.request];
    if (!w) return;
    delete waiters[msg.request];
    w(!!msg.ok, msg.text, msg);
  }
  function setTemps(nozzle, bed, quiet) {
    var changes = Mat.tempChanges(nozzle, bed);
    if (!changes.length) return;
    applyRequest({ type: 'apply', project_edit: true, changes: changes, why: 'Étiquette de la bobine' }, function (ok, text) {
      if (!ok) { note(text || 'Je n’ai pas pu régler ces températures.', 'error'); return; }
      var n = Mat.labelTemp(nozzle), b = Mat.labelTemp(bed);
      if (!quiet) note('Températures de ta bobine enregistrées : ' + [n !== null ? 'buse ' + n + ' °C' : '', b !== null ? 'plateau ' + b + ' °C' : ''].filter(Boolean).join(', ') + '.', 'ok');
      state().pending = { kind: 'temps' };
      panel.post({ type: 'project_state' });
    });
  }

  // ---------- Buse et plateau ----------
  function bedInfo() { var pr = chosenPreset(), v = values(); return pr && pr === orcaPrinter() && v ? v.bed || null : null; }
  function nozzleMm() { var pr = chosenPreset(), v = values(), ctx = v && v.context; return pr && ctx && ctx.printer === pr && typeof ctx.nozzle_mm === 'number' ? ctx.nozzle_mm : null; }
  function nozzleOffer() { var v = values(); return M.nozzleChangeOffer(v && v.machine, chosenPreset(), orcaPrinter()); }
  function chooseBed(value) {
    var st = state(), pr = chosenPreset();
    if (!pr || st.bed.token) return;
    if (value === M.BED_UNKNOWN) {
      var bed = bedInfo();
      if (!M.bedAnswer(habits, pr) || M.bedAnswer(habits, pr) === M.BED_UNKNOWN) { habits = M.rememberBed(habits, pr, M.BED_UNKNOWN); saveHabits(); }
      note(M.bedUnknownText(bed), 'info');
      render();
      return;
    }
    st.bed.token = ++st.bed.next;
    panel.post({ type: 'bed_type_set', value: value, printer: pr, token: st.bed.token });
    render();
  }
  function onBedSet(msg) {
    var st = state();
    if (!msg.token || msg.token !== st.bed.token) return;
    st.bed.token = 0;
    var pr = chosenPreset();
    if (!msg.ok) { note(msg.text || 'Je n’ai pas pu changer le plateau.', 'error'); render(); return; }
    if (pr) { habits = M.rememberBed(habits, pr, msg.value); saveHabits(); }
    var back = msg.changed && msg.before ? ui.button(M.bedRevertLabel(msg.before), function () { back.disabled = true; chooseBed(msg.before); }, 'link') : null;
    note(M.bedChosenText(msg.value, msg.before, !!msg.changed), 'ok', back ? [back] : null);
    render();
  }
  // « Changer de buse » : une autre variante du même modèle, installée comme à l'installation ; la machine du projet suit.
  function changeNozzle(value) {
    var offer = nozzleOffer(), st = state();
    if (!offer || !value || value === offer.current) return;
    st.setup = freshSetup();
    st.setup.pick = { vendor: offer.vendor, model: offer.model, nozzles: offer.nozzles };
    st.setup.change = { from: offer.current };
    installModel(value);
  }
  function hardwareLine(body) {
    var st = state(), bed = bedInfo(), row = M.bedRow(bed), offer = nozzleOffer(), mm = nozzleMm();
    var parts = [];
    if (mm) parts.push('Buse ' + M.nozzleText(mm));
    if (row) parts.push(row.text.replace(/^Plateau : /, ''));
    if (!parts.length && !offer && !M.bedTypes(bed).length) return;
    if (expert() || st.hwOpen) {
      var grid = ui.el('div', 'row2 hw');
      if (offer) {
        var nq = M.nozzleChoice(offer.nozzles, offer.current);
        var opts = (nq.choices || []).map(function (c) { return { value: c.value, label: M.nozzleText(c.value) + (c.current ? ' (en place)' : '') }; });
        var ns = select(opts, offer.current, changeNozzle, 'Buse');
        ns.disabled = st.setup.phase === 'installing';
        grid.appendChild(field('Buse', ns));
      } else if (mm) {
        var fixed = ui.el('span', 'fixed', M.nozzleText(mm));
        grid.appendChild(field('Buse', fixed));
      }
      var types = M.bedTypes(bed);
      if (types.length) {
        var bopts = types.map(function (t) { return { value: t.value, label: M.bedName(t.value, t.label) }; }).concat([{ value: M.BED_UNKNOWN, label: 'Je ne sais pas' }]);
        var bs = select(bopts, bed.current, chooseBed, 'Plateau');
        bs.disabled = !!st.bed.token;
        grid.appendChild(field('Plateau', bs));
      }
      body.appendChild(grid);
      if (st.setup.phase === 'installing' && st.setup.change) body.appendChild(spinLine('Je passe sur la buse de ' + M.nozzleText(st.setup.nozzle) + '…'));
      if (types.length && !expert()) {
        var q = M.bedQuestion(bed);
        body.appendChild(ui.el('p', 'hint', q.help));
      }
      if (row && row.note) body.appendChild(ui.el('p', 'hint', row.note));
      return;
    }
    var line = ui.el('div', 'hwline');
    line.appendChild(ui.el('span', '', parts.join(' · ')));
    var ch = ui.button('changer', function () { st.hwOpen = true; render(); }, 'link');
    ch.id = 'hw-change';
    line.appendChild(ch);
    body.appendChild(line);
  }

  // ---------- Emplacements (Canvas, CFS, IFS, U1, saisie manuelle) ----------
  function wantsFilament() { return !!chosenPreset(); }
  function readCtx() { var st = state(); return { loading: st.canvas.loading, preset: st.canvas.preset, state: st.canvas.state }; }
  function slotState() { var st = state(), pr = chosenPreset(); return pr ? Mat.slotState(pr, { preset: st.canvas.preset, state: st.canvas.state }, st.manual) : null; }
  function coloursState() { var st = state(); return st.colours.state && st.colours.state.ok ? st.colours.state : null; }
  function colours() { return Mat.canvasColours(slotState(), coloursState()); }
  function fileRowsFor(trays) { return Col.fileRows(coloursState(), project().file_colours, trays, state().canvas.mapping, { partName: project().part && project().part.name || '' }); }
  function slotMode() {
    var st = state(), k = known(), wants = wantsFilament(), sst = slotState(), p = project();
    return Mat.canvasMode({ tempsPending: false, editing: true, wantsFilament: wants, manualForm: st.manual.form, useList: st.canvas.useList,
      wanted: Mat.slotsWanted(k, wants), manualWanted: Mat.manualWanted(k, wants, readCtx()), loading: st.canvas.loading, readFor: st.canvas.preset,
      preset: p.printer && p.printer.preset, state: sst, manualConfirmed: st.manual.confirmed, colours: colours(), coloursReady: !!st.colours.state,
      coloursState: coloursState(), fileRows: sst && sst.ok ? fileRowsFor(C.trays(sst)).length : 0 });
  }
  function proposal() { return Mat.canvasProposal(colours(), slotState(), project().canvas, project().filament); }
  function ensureSlots() {
    var st = state(), k = known(), pr = chosenPreset(), wants = wantsFilament();
    if (!pr) return;
    if (Mat.slotsWanted(k, wants) && !st.canvas.useList && !st.canvas.loading && st.canvas.preset !== pr) {
      st.canvas.preset = pr; st.canvas.loading = true; st.canvas.state = null; st.canvas.mapping = null; st.canvas.error = ''; st.canvas.readId += 1;
      panel.post({ type: 'canvas_read', preset: pr, id: st.canvas.readId });
    }
    if (Mat.manualWanted(k, wants, readCtx()) && !st.manual.loading && st.manual.preset !== pr) {
      st.manual.preset = pr; st.manual.loading = true; st.manual.state = null;
      panel.post({ type: 'slots_manual_get', preset: pr });
    }
    if ((Mat.slotsWanted(k, wants) || Mat.manualWanted(k, wants, readCtx())) && !st.colours.state && !st.colours.asked) requestColours();
  }
  function requestColours(select) {
    var st = state();
    st.colours.asked = true;
    st.colours.id += 1;
    var m = { type: 'colours_get', id: st.colours.id };
    if (select) m.select = select;
    panel.post(m);
  }
  function onCanvasState(msg) {
    var st = state();
    if (msg.id !== st.canvas.readId || msg.send) return;
    st.canvas.loading = false;
    if (msg.preset !== chosenPreset()) { st.canvas.preset = null; render(); return; }
    st.canvas.preset = msg.preset;
    st.canvas.state = msg;
    st.canvas.mapping = msg.ok ? proposal() : null;
    ensureSlotBrands(msg);
    render();
  }
  // Marque des emplacements (lot 5, comme le classique) : ce que chaque emplacement annonce (marque, nom), rapproché d'un profil
  // fourni par le slicer (slot_brands_get), une fois par lecture. « C'est bien cette bobine ? » : Oui prend le profil du
  // fabricant à l'envoi des emplacements (canvas_apply) ; « Je ne sais pas » garde les réglages communs.
  function ensureSlotBrands(sst) {
    var st = state(), b = st.canvas.brands, p = project();
    if (!sst || !sst.ok || b.of === sst || !p.printer) return;
    b.of = sst; b.items = null; b.id += 1;
    st.canvas.choice = {}; st.canvas.dismissed = {};
    var slots = C.trays(sst).map(function (t) { return { key: Sp.slotKey(t), type: t.type, brand: t.brand || '', name: t.name || '' }; });
    panel.post({ type: 'slot_brands_get', printer: p.printer.preset, id: b.id, slots: slots });
  }
  function onSlotBrands(msg) {
    var b = state().canvas.brands;
    if (msg.id !== b.id) return;
    b.items = {};
    (Array.isArray(msg.items) ? msg.items : []).forEach(function (it) { if (it && it.key) b.items[it.key] = it; });
    render();
  }
  // Marque retenue pour un emplacement : la réponse de cette lecture, sinon celle déjà gardée dans le projet.
  function slotChoice(key) {
    var st = state();
    if (st.canvas.choice[key]) return st.canvas.choice[key];
    var e = (Array.isArray(project().canvas) ? project().canvas : []).filter(function (x) { return Sp.slotKey(x) === key && x.brand; })[0];
    if (!e) return null;
    return e.range ? { kind: 'brand', brand: e.brand, range: e.range, short: e.range, preset: e.preset } : { kind: 'other', brand: e.brand, range: '', short: '', preset: '' };
  }
  function slotBrandsInto(body, sst, words) {
    var st = state(), items = st.canvas.brands.of === sst ? st.canvas.brands.items : null;
    if (!items) return;
    var trays = C.trays(sst), choices = {};
    trays.forEach(function (t) { var k = Sp.slotKey(t), c = slotChoice(k); if (c) choices[k] = c; });
    var offers = Sp.slotOffers(st.canvas.mapping, trays, items, choices, st.canvas.dismissed);
    var q = Sp.slotQuestion(offers, words);
    if (q) body.appendChild(noteBox('tip', 'spool', q, [
      ui.button('Oui', function () { offers.forEach(function (o) { st.canvas.choice[o.key] = Sp.brandChoice({ brand: o.match.brand }, o.match); }); render(); }, 'btn sm main'),
      ui.button('Je ne sais pas', function () { offers.forEach(function (o) { st.canvas.dismissed[o.key] = true; }); render(); }, 'btn sm')]));
    (st.canvas.mapping || []).forEach(function (m) {
      var t = trays.filter(function (x) { return x.canvas_id === m.canvas_id && x.tray_id === m.tray_id; })[0];
      if (!t) return;
      var c = choices[Sp.slotKey(t)];
      if (c) body.appendChild(ui.el('p', 'hint', t.slot + ' · ' + Sp.slotBrandText(c)));
    });
  }
  function onManualState(msg) {
    var st = state();
    if (msg.preset !== chosenPreset()) return;
    st.manual.loading = false;
    st.manual.state = msg;
    if (msg.ok && st.manual.confirmed) st.canvas.mapping = proposal();
    render();
  }
  function onManualSaved(msg) {
    var st = state();
    if (!msg.ok) { st.manual.error = 'Je n’ai pas pu garder ces emplacements. Réessaie.'; render(); return; }
    st.manual.form = false; st.manual.confirmed = true; st.manual.preset = null; // relus au prochain affichage
    render();
  }
  function onColours(msg) {
    var st = state();
    if (msg.id !== st.colours.id) return;
    var before = JSON.stringify([st.colours.state && st.colours.state.pieces, st.colours.state && st.colours.state.colours]);
    st.colours.state = msg;
    if (slotMode() === 'colours' && !st.colours.token && !Col.covers(st.canvas.mapping, colours())) st.canvas.mapping = proposal();
    if (before !== JSON.stringify([msg.pieces, msg.colours])) render();
  }
  function setTray(t, key) {
    var st = state(), parts = String(key).split(':');
    (st.canvas.mapping || []).forEach(function (m) { if (m.t !== t) return; m.canvas_id = key ? Number(parts[0]) : null; m.tray_id = key ? Number(parts[1]) : null; });
    render();
  }
  function canvasEntry(t, tray, st) {
    var choice = slotChoice(Sp.slotKey(tray));
    var entry = { t: t, canvas_id: tray.canvas_id, tray_id: tray.tray_id, type: tray.type, color: tray.color };
    if (choice && choice.brand && (choice.kind === 'brand' || choice.kind === 'brand_only' || choice.kind === 'other')) { entry.brand = choice.brand; if (choice.kind === 'brand') entry.range = choice.range; }
    if (st.system && st.system !== 'canvas') { entry.label = tray.slot; entry.imposable = st.imposable === true; entry.source = st.source; entry.system = st.system; entry.validated = st.validated === true; }
    return entry;
  }
  // Les emplacements choisis deviennent le filament du projet (canvas_apply, comme le classique) ; la couleur 1 donne le profil.
  function applyCanvas(mapping) {
    var st = state(), sst = slotState() || {}, trays = C.trays(sst), entries = [], full = [], unknown = null;
    (mapping || []).forEach(function (m) {
      var tray = trays.filter(function (t) { return t.tray_id === m.tray_id && t.canvas_id === m.canvas_id; })[0];
      if (!tray) return;
      if (!tray.type && sst.system && sst.system !== 'canvas') unknown = tray;
      // Marque confirmée pour cet emplacement : son profil, vérifié par le slicer ; sinon le générique.
      var choice = slotChoice(Sp.slotKey(tray)), sent = { t: m.t, type: tray.type, color: tray.color };
      if (choice && choice.kind === 'brand' && choice.preset) sent.preset = choice.preset;
      entries.push(sent);
      full.push(canvasEntry(m.t, tray, sst));
    });
    if (!entries.length || entries.length !== (mapping || []).length) { st.canvas.error = 'Choisis un emplacement pour chaque couleur.'; render(); return; }
    if (unknown) { st.canvas.error = 'Je ne connais pas la matière de ' + C.words(sst.system).the + ' ' + unknown.slot + ' : choisis-en un autre, ou choisis ta bobine dans la liste.'; render(); return; }
    st.canvas.error = '';
    st.canvas.applying = full;
    st.pending = { kind: 'canvas' };
    panel.post({ type: 'canvas_apply', entries: entries });
    render();
  }
  function onCanvasApplied(msg) {
    var st = state(), full = st.canvas.applying;
    st.canvas.applying = null;
    if (!full) return;
    if (!msg.ok) { st.pending = null; st.canvas.error = msg.text || 'Je n’ai pas pu choisir ces emplacements.'; render(); return; }
    var presets = {};
    (msg.presets || []).forEach(function (p) { presets[p.t] = p; });
    full.forEach(function (e) {
      var got = presets[e.t] || {};
      e.preset = got.preset || '';
      if (typeof got.nozzle === 'number') e.nozzle = got.nozzle; else delete e.nozzle;
      if (typeof got.bed === 'number') e.bed = got.bed; else delete e.bed;
    });
    full.sort(function (a, b) { return a.t - b.t; });
    project().canvas = full;
    thread('Emplacements : ' + C.mapLabel(full, C.isImposed(full)) + '.');
    st.pending = { kind: 'filament', type: full[0].type, canvas: true };
    panel.post({ type: 'project_state' });
  }
  // Le plan d'envoi (carte des emplacements) suit le projet affiché ; il n'est renvoyé que s'il change.
  function syncCanvasPlan(force) {
    var st = state(), p = project(), map = p.printer && C.isImposed(p.canvas) ? p.canvas.map(function (e) {
      var out = { t: e.t, canvas_id: e.canvas_id, tray_id: e.tray_id, type: e.type, preset: e.preset };
      if (e.label) out.label = e.label;
      return out;
    }) : [];
    var key = map.length ? p.printer.preset + JSON.stringify(map) : '';
    if (!force && key === st.canvas.planKey) return;
    st.canvas.planKey = key;
    panel.post(map.length ? { type: 'canvas_plan', preset: p.printer.preset, map: map } : { type: 'canvas_plan', clear: true });
  }
  function useList() { var st = state(); st.canvas.useList = true; st.colours.open = false; delete project().canvas; panel.scheduleSave(); render(); }
  function recheck() { var st = state(); st.canvas.preset = null; st.manual.preset = null; st.colours.picker = null; st.colours.error = ''; requestColours(); render(); }
  function openManual() {
    var st = state(), m = st.manual;
    m.draft = C.manualDraft(m.state); m.count = C.manualCount(m.state); m.form = true; m.error = '';
    st.canvas.useList = false; st.canvas.error = '';
    render();
  }
  function saveManual() {
    var m = state().manual;
    if (!C.manualComplete(m.draft, m.count)) return;
    panel.post({ type: 'slots_manual_save', preset: chosenPreset(), slots: C.manualSlots(m.draft, m.count) });
  }

  // Carte « Couleurs » : la vue partagée (colours-view.js) et les mêmes gestes que le classique ; une pièce change sur ton clic.
  var coloursHandlers = {
    select: function (ref) { requestColours(ref); },
    open: function (ref, part, name, tray) {
      var st = state(), trays = C.trays(slotState() || {});
      st.colours.picker = { ref: ref, part: part || '', name: name, current: tray || Col.trayFor(0, trays, st.canvas.mapping), confirm: null, missing: false };
      st.colours.error = ''; st.colours.recheck = false;
      render();
    },
    openFile: function (t, name, tray) {
      var st = state(), trays = C.trays(slotState() || {});
      st.colours.picker = { fileT: t, ref: '', part: '', name: name, current: tray || Col.trayFor(0, trays, st.canvas.mapping), confirm: null, missing: false };
      st.colours.error = ''; st.colours.recheck = false;
      render();
    },
    pick: function (tray) {
      var pk = state().colours.picker;
      if (!pk) return;
      if (Col.otherMaterialNote(pk.current, tray)) { pk.confirm = tray; render(); return; }
      if (pk.fileT !== undefined) { state().colours.picker = null; setTray(pk.fileT, Col.trayKey(tray)); } else setPieceColour(pk, tray);
    },
    confirm: function (tray) { var pk = state().colours.picker; if (!pk) return; if (pk.fileT !== undefined) { state().colours.picker = null; setTray(pk.fileT, Col.trayKey(tray)); } else setPieceColour(pk, tray); },
    // Vue directe : un clic sur la pastille d'une bobine, comme « changer » puis cette bobine.
    choose: function (ref, part, name, current, tray) {
      var st = state(), trays = C.trays(slotState() || {});
      st.colours.picker = { ref: ref, part: part || '', name: name, current: current || Col.trayFor(0, trays, st.canvas.mapping), confirm: null, missing: false };
      st.colours.error = ''; st.colours.recheck = false;
      coloursHandlers.pick(tray);
    },
    spread: function () { spreadColours(); },
    toggleOne: function () { var c = state().colours; c.unfolded = !c.unfolded; c.picker = null; render(); },
    paint: function () { panel.post({ type: 'open_tool', tool: 'paint_color' }); },
    cancel: function () { state().colours.picker = null; render(); },
    missing: function () { var pk = state().colours.picker; if (pk) { pk.missing = true; render(); } },
    recheck: recheck,
    useList: useList,
    openManual: function () { state().colours.picker = null; openManual(); }
  };
  // Le seul envoi de colour_set : un clic sur une bobine dans la carte (jamais une réponse de l'IA).
  function setPieceColour(pk, tray) {
    var st = state(), pr = chosenPreset(), sst = slotState() || {};
    if (!pr || st.colours.token) return;
    st.colours.token = ++st.colours.next;
    var token = st.colours.token;
    var mapping = (st.canvas.mapping || []).filter(function (m) { return m.tray_id !== null && m.tray_id !== undefined; }).map(function (m) { return { t: m.t, canvas_id: m.canvas_id, tray_id: m.tray_id }; });
    st.colours.sent = { token: token, name: pk.name, tray: tray, mapping: JSON.parse(JSON.stringify(st.canvas.mapping || [])) };
    st.colours.picker = null;
    setTimeout(function () { if (state() === st && st.colours.token === token) onColourSet({ token: token, ok: false, reason: 'slot', text: 'Plyo Slicer ne m’a pas répondu : touche « Vérifier à nouveau », puis réessaie.' }); }, 25000);
    panel.post({ type: 'colour_set', token: token, preset: pr, object: pk.ref, part: pk.part, all_parts: false, source: sst.source === 'manual' ? 'manual' : 'printer',
      slot: slotOf(tray), canvas: mapping });
    render();
  }
  // L'emplacement envoyé avec colour_set : sa marque confirmée suit (profil du fabricant, vérifié par le slicer).
  function slotOf(tray) {
    var out = { canvas_id: tray.canvas_id, tray_id: tray.tray_id, type: tray.type, color: tray.color }, c = slotChoice(Sp.slotKey(tray));
    if (c && c.kind === 'brand' && c.preset) out.preset = c.preset;
    return out;
  }
  // « Oui, une par pièce » : les changements un par un (chacun relit la machine), une seule note à la fin, un seul « Annuler ».
  function spreadColours() {
    var st = state(), sst = slotState() || {}, trays = C.trays(sst);
    var rows = Col.pieceRows(coloursState(), trays, st.canvas.mapping, { partName: project().part && project().part.name || '' });
    var plan = Col.spreadPlan(rows, trays);
    if (!plan || st.colours.token || st.colours.batch) return;
    var moves = plan.moves.filter(function (m) { return Col.trayKey(m.current) !== Col.trayKey(m.tray); });
    if (!moves.length) return;
    st.colours.batch = { moves: moves, done: 0, undo: [], before: JSON.parse(JSON.stringify(st.canvas.mapping || [])), text: plan.text };
    st.colours.error = '';
    nextSpread();
  }
  function nextSpread() {
    var st = state(), b = st.colours.batch;
    if (!b) return;
    if (b.done >= b.moves.length) { st.colours.batch = null; spreadDone(st, b); return; }
    var m = b.moves[b.done];
    setPieceColour({ ref: m.ref, part: '', name: m.name, current: m.current }, m.tray);
  }
  function spreadDone(st, b) {
    var undo = b.undo.length ? ui.button('Annuler', function () {
      undo.disabled = true;
      var tokens = b.undo.slice().reverse();
      (function back() {
        if (!tokens.length) { undo.remove(); if (state() === st) st.canvas.mapping = b.before; note('C’est annulé : tes pièces ont repris leur couleur.', 'ok'); requestColours(); render(); return; }
        plateUndo(tokens.shift(), function (r) {
          if (!r.ok) { undo.remove(); note((r.text || 'Je n’ai pas pu tout annuler.') + ' Remets les couleurs d’un clic dans la carte.', 'error'); requestColours(); render(); return; }
          back();
        });
      })();
    }, 'link', 'undo') : null;
    note('Chaque pièce a sa bobine : ' + b.text + '.', 'ok', undo ? [undo] : null);
    thread('Couleurs : ' + b.text + '.');
    requestColours();
    render();
  }
  function onColourSet(msg) {
    var st = state(), sent = st.colours.sent;
    if (!msg.token || msg.token !== st.colours.token) return;
    st.colours.token = 0; st.colours.sent = null;
    if (!sent) return;
    var batch = st.colours.batch;
    if (!msg.ok) {
      st.colours.error = (batch && batch.done ? 'Je me suis arrêté à « ' + sent.name + ' » : ' : '') + (msg.text || 'Je n’ai pas pu changer la couleur.');
      st.colours.recheck = msg.reason === 'slot' || msg.reason === 'gone';
      if (batch) { st.colours.batch = null; requestColours(); }
      render(); return;
    }
    st.canvas.mapping = Col.mappingFrom(msg.canvas, C.trays(slotState() || {}));
    if (batch) {
      if (msg.undo_token !== undefined && msg.undo_token !== null) batch.undo.push(msg.undo_token);
      batch.done += 1;
      nextSpread();
      return;
    }
    var undo = msg.undo_token !== undefined && msg.undo_token !== null ? ui.button('Annuler', function () {
      undo.disabled = true;
      plateUndo(msg.undo_token, function (r) {
        if (!r.ok) { undo.disabled = false; note(r.text || 'Je n’ai pas pu annuler.', 'error'); return; }
        undo.remove();
        if (state() === st) st.canvas.mapping = sent.mapping;
        note('C’est annulé : ' + sent.name + ' a repris sa couleur.', 'ok');
        requestColours();
        render();
      });
    }, 'link', 'undo') : null;
    note(Col.changedText(sent.name, Col.spoolText(sent.tray)), 'ok', undo ? [undo] : null);
    requestColours();
    render();
  }
  function plateUndo(token, after) {
    var id = ++request;
    waiters[id] = function (ok, text, msg) { after(msg); };
    panel.post({ type: 'plate_action', kind: 'undo', undo_token: token, request: id });
  }
  function onPlateAction(msg) { var w = waiters[msg.request]; if (!w) return; delete waiters[msg.request]; w(!!msg.ok, msg.text, msg); }

  // ---------- Ajouter mon imprimante : recherche Wi-Fi, catalogue, buse, installation, liaison ----------
  function startSetup() {
    var st = state();
    st.screen = 'add';
    st.setup = freshSetup();
    st.setup.phase = 'scan';
    if (!catalog) panel.post({ type: 'setup_catalog' });
    panel.post({ type: 'printer_scan' });
    render();
  }
  function onScanResult(msg) {
    var list = Array.isArray(msg.printers) ? msg.printers : [], st = state();
    if (scanning.bg) {
      scanning.bg = false;
      found = list.filter(function (f) { return f && f.ip && !M.isKnownHost(printers, f.ip); });
      if (st.screen === 'main') render();
    }
    if (st.screen === 'add' && st.setup.phase === 'scan') {
      // La première recherche tombe souvent pendant la demande d'autorisation du réseau local : on relance une fois.
      if (!list.length && !st.setup.retried) { st.setup.retried = true; panel.post({ type: 'printer_scan' }); return; }
      st.setup.printers = list;
      st.setup.phase = list.length ? 'found' : 'none';
      render();
    }
  }
  // Modèle choisi pour une imprimante au code inconnu : gardé ici et, avec un compte, partagé anonymement (comme le classique).
  function learnModel(printer, model) {
    if (!printer || !printer.code || printer.match || !printer.brand || !model) return;
    var report = { brand: printer.brand, code: printer.code, model: model };
    panel.post(Object.assign({ type: 'model_learned' }, report));
    if (panel.session()) panel.apiFetch('/api/printer-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }).catch(function () {});
  }
  // Une seule taille de buse : installée d'office ; débutant : la 0,4 mm livrée ; confirmé : la question.
  function chooseModel(match, printer) {
    var st = state();
    learnModel(printer, match && match.model);
    st.screen = 'add';
    st.setup.pick = match;
    st.setup.found = printer || null;
    st.setup.change = null;
    st.setup.link = null;
    var choice = M.nozzleChoice(match.nozzles);
    var novice = !expert() && !choice.auto ? M.noviceNozzle(match.nozzles) : '';
    st.setup.nozzleAuto = !!novice;
    if (choice.auto) installModel(choice.auto);
    else if (novice) installModel(novice);
    else { st.setup.phase = 'nozzle'; render(); }
  }
  function installModel(nozzle) {
    var st = state();
    st.setup.nozzle = nozzle;
    st.setup.phase = 'installing';
    st.setup.error = false;
    panel.post({ type: 'setup_install', vendor: st.setup.pick.vendor, model: st.setup.pick.model, nozzle: nozzle });
    render();
  }
  function onInstalled(msg) {
    var st = state(), s = st.setup, change = s.change;
    if (s.phase !== 'installing') return;
    if (msg.cancelled || !msg.ok) { s.error = !msg.cancelled; s.phase = change ? '' : s.found ? 'found' : 'search'; if (change) note('Je n’ai pas pu changer de buse. Réessaie, ou garde ta buse d’aujourd’hui.', 'error'); render(); return; }
    s.preset = msg.preset;
    if (change) {
      st.adoptNote = 'C’est noté : buse de ' + M.nozzleText(s.nozzle) + ' sur ta machine. Plyo Slicer est passé sur le profil « ' + msg.preset + ' ». Changer de buse refait la préparation.';
      s.phase = '';
      endSetup();
      return;
    }
    s.phase = s.found ? 'link' : 'done';
    if (s.found) startLink(s.found);
    render();
  }
  function endSetup() {
    var st = state(), s = st.setup;
    st.screen = 'main';
    if (s.preset) {
      if (!st.adoptNote) st.adoptNote = '« ' + (s.pick ? s.pick.model : s.preset) + ' » est installée' + (s.linked ? ' et reliée' : '') + ' : c’est l’imprimante de ce projet.';
      st.pending = { kind: 'adopt' };
      panel.post({ type: 'project_state' });
      askPrinters();
      found = (found || []).filter(function (f) { return !s.found || f.ip !== s.found.ip; });
    }
    st.setup = freshSetup();
    render();
  }
  // Relier : vérifier le profil, tester la connexion, enregistrer (mêmes messages et mêmes textes que le classique).
  var LINK_HELP = {
    octoprint: 'OctoPrint demande une clé API : dans OctoPrint, ouvre Paramètres, puis Clé API, et copie-la dans la fenêtre « Connexion ».',
    flashforge: 'Flashforge demande le numéro de série et le code de vérification : tu les trouves sur l’écran de l’imprimante, dans Réglages, puis Réseau.',
    elegoolink: 'Vérifie que le mode réseau local est activé sur l’écran de l’imprimante.'
  };
  function linkSay(text, tone, acts, extra) { var l = state().setup.link; if (!l) return; l.text = text; l.tone = tone || ''; l.acts = acts || []; l.extra = extra || null; render(); }
  function startLink(printer) {
    var st = state();
    st.setup.link = { printer: printer, code: '', text: '', tone: '', acts: [] };
    linkSay('Je vérifie ton profil d’imprimante…');
    panel.post({ type: 'printer_link_check', printer: printer });
  }
  function testLink() {
    var l = state().setup.link;
    linkSay('Je teste la connexion avec ' + (l.printer.name || 'ton imprimante') + '…');
    panel.post({ type: 'printer_link_test', printer: l.printer, access_code: l.code || '' });
  }
  function linkDone(text) { var s = state().setup; s.linked = true; s.phase = 'done'; linkSay(text, 'ok'); }
  function onLinkState(msg) {
    var l = state().setup.link;
    if (!l) return;
    if (!msg.ok) { linkSay('Je ne peux pas relier cette imprimante.', 'error'); return; }
    if (msg.linked) { linkDone('Déjà reliée à ton profil « ' + msg.current + ' ».'); return; }
    if (msg.matches) { testLink(); return; }
    var cands = Array.isArray(msg.candidates) ? msg.candidates : [];
    linkSay('Ton profil actuel est « ' + msg.current + ' », mais l’imprimante trouvée est ' + (l.printer.name || 'une autre') + '. ' + (cands.length ? 'Choisis le profil qui lui correspond :' : 'Je n’ai pas encore son profil.'), 'warn',
      cands.map(function (c) { return { label: 'Utiliser « ' + c + ' »', run: function () { linkSay('Je change de profil…'); panel.post({ type: 'printer_select_profile', name: c }); } }; }));
  }
  function linkProfileSelected(msg) {
    var l = state().setup.link;
    if (!msg.ok) { linkSay('Je n’ai pas pu changer de profil. Choisis-le à la main sous « Imprimante », puis réessaie.', 'error'); return; }
    startLink(l.printer);
  }
  function onLinkTested(msg) {
    var l = state().setup.link;
    if (!l) return;
    if (msg.ok) {
      var webui = typeof msg.webui === 'string' ? msg.webui : '';
      linkSay('La connexion fonctionne. Enregistre-la pour envoyer tes impressions directement.', 'ok', [{ label: 'Enregistrer la connexion', primary: true, run: function () {
        linkSay('J’enregistre…');
        panel.post({ type: 'printer_link_save', printer: l.printer, webui: webui, access_code: l.code || '' });
      } }]);
      return;
    }
    if (msg.auth) {
      linkSay(l.code ? 'Ce code d’accès est refusé par ' + (l.printer.name || 'ton imprimante') + '. Vérifie-le sur son écran et réessaie.'
        : (l.printer.name || 'Ton imprimante') + ' est joignable, mais elle demande son code d’accès. Tu le trouves sur son écran, dans les réglages réseau.', 'warn',
        [{ label: 'Tester avec ce code', primary: true, run: function () { if (!l.code) { l.hint = 'Écris d’abord le code d’accès dans la case, puis teste.'; render(); return; } l.hint = ''; testLink(); } }], 'code');
      return;
    }
    linkSay('Je n’arrive pas à joindre ' + (l.printer.name || 'l’imprimante') + '. ' + (LINK_HELP[l.printer.host_type] || 'Vérifie qu’elle est allumée et sur le même Wi-Fi, puis réessaie.') + (msg.message ? ' (' + msg.message + ')' : ''), 'error',
      [{ label: 'Réessayer', run: testLink }, { label: 'Ouvrir la fenêtre Connexion', run: function () { panel.post({ type: 'printer_link_dialog', printer: l.printer }); } }]);
  }
  function onLinkSaved(msg) {
    var l = state().setup.link;
    if (!l) return;
    if (msg.ok) linkDone('C’est relié ! Ton profil d’imprimante s’appelle maintenant « ' + msg.profile + ' ». ' + M.linkSummary(l.printer.host_type));
    else linkSay('Je n’ai pas pu enregistrer la connexion. Réessaie, ou ouvre la fenêtre « Connexion » depuis le bouton Wi-Fi à côté de « Imprimante ».', 'error', [{ label: 'Réessayer', run: testLink }]);
  }
  function onLinkDialogClosed(msg) {
    var l = state().setup.link;
    if (!l) return;
    if (msg.saved) linkDone('C’est relié ! ' + M.linkSummary(l.printer.host_type));
    else linkSay('Rien n’a été enregistré. Tu peux recommencer quand tu veux.', '', [{ label: 'Relier', run: function () { startLink(l.printer); } }]);
  }

  // ---------- Écrans ----------
  function setupCard() {
    var st = state(), s = st.setup, body = ui.el('div', 'card-content');
    var spec = { title: 'Ajouter mon imprimante', sub: 'Allume-la et branche-la au Wi-Fi si elle peut. Sinon, choisis son modèle.', body: body, primary: null,
      extra: [ui.button(s.phase === 'link' ? 'Passer cette étape' : 'Retour', function () { if (s.phase === 'link') { s.phase = 'done'; render(); } else endSetup(); }, 'link muted')] };
    if (s.phase === 'nozzle') {
      var nq = M.nozzleChoice(s.pick.nozzles);
      spec.title = nq.title || 'Quelle taille de buse ?';
      spec.sub = nq.text || null;
      var chips = ui.el('div', 'cards');
      (nq.choices || []).forEach(function (c) { chips.appendChild(card({ icon: 'printer', title: c.label, on: function () { installModel(c.value); } })); });
      body.appendChild(chips);
      if (nq.help) body.appendChild(ui.el('p', 'hint', nq.help));
      spec.extra = [ui.button('Retour', function () { s.phase = s.found ? 'found' : 'search'; render(); }, 'link muted')];
      return spec;
    }
    if (s.phase === 'installing') {
      spec.title = 'J’installe ' + s.pick.model + '…';
      spec.sub = 'Profil de l’imprimante, qualités d’impression et filaments conseillés.';
      body.appendChild(spinLine('Ça prend quelques secondes.'));
      spec.extra = [];
      return spec;
    }
    if (s.phase === 'link' || s.phase === 'done') {
      spec.title = s.phase === 'done' ? 'Ton imprimante est prête' : s.pick.model + ' est installée';
      spec.sub = s.phase === 'done' ? (s.linked || s.found ? 'Elle est installée et reliée : à l’étape Imprimer, je lui enverrai tes impressions.' :
        'Elle est installée. Pour imprimer, j’enregistrerai le fichier : tu le copieras sur la clé USB ou la carte SD de ton imprimante.')
        : 'Dernière étape : je la relie pour que tes impressions partent directement dessus.';
      if (s.nozzleAuto) body.appendChild(noteBox('tip', 'info', 'J’ai pris la buse de 0,4 mm, celle livrée avec presque toutes les imprimantes. Tu en as monté une autre ? « Buse · plateau · changer », à cette étape.'));
      var l = s.link;
      if (l && l.text) {
        var acts = (l.acts || []).map(function (a) { return ui.button(a.label, a.run, 'btn sm'); });
        var box = noteBox(l.tone === 'error' ? 'error' : l.tone === 'warn' ? 'warn' : l.tone === 'ok' ? 'ok' : '', l.tone === 'ok' ? 'check' : l.tone ? 'alert' : 'wifi', l.text, acts);
        if (l.extra === 'code') {
          var code = ui.el('input'); code.type = 'password'; code.maxLength = 64; code.autocomplete = 'off';
          code.setAttribute('aria-label', ui.fr('Code d’accès de l’imprimante')); code.placeholder = ui.fr('Code d’accès de l’imprimante');
          code.value = l.code || '';
          code.addEventListener('input', function () { l.code = code.value.trim(); });
          box.querySelector('.note-body').insertBefore(code, box.querySelector('.acts'));
          if (l.hint) box.querySelector('.note-body').appendChild(ui.el('p', 'err', l.hint));
        }
        body.appendChild(box);
      } else if (s.phase === 'link') body.appendChild(spinLine('Je vérifie ton profil d’imprimante…'));
      spec.primary = s.phase === 'done' ? { label: 'Continuer', run: endSetup } : null;
      if (s.phase === 'done') spec.extra = [];
      return spec;
    }
    // Recherche sur le Wi-Fi, puis le catalogue des modèles.
    if (s.error) body.appendChild(noteBox('error', 'alert', 'Je n’ai pas pu installer ce profil. Réessaie, ou choisis ton imprimante dans la liste.'));
    if (s.phase === 'scan') body.appendChild(spinLine('Je cherche sur ton Wi-Fi…'));
    else if (s.phase === 'found' || (s.phase === 'search' && s.printers.length)) {
      body.appendChild(section('Trouvée sur ton Wi-Fi'));
      var list = ui.el('div', 'cards');
      s.printers.forEach(function (p) {
        list.appendChild(card({ icon: 'wifi', title: p.match ? p.match.model : (p.name || p.brand || 'Imprimante'), sub: 'Adresse ' + p.ip + (p.match ? ' · ' + p.match.vendor : ' · modèle inconnu'),
          on: function () { if (p.match) chooseModel(p.match, p); else { s.found = p; s.query = p.brand || ''; s.phase = 'search'; render(); } } }));
      });
      body.appendChild(list);
    } else if (s.phase === 'none') {
      body.appendChild(noteBox('', 'info', 'Je n’ai pas trouvé d’imprimante sur ton Wi-Fi. Ajoute la tienne : il suffit de choisir son modèle.'));
      if (s.noneHelp) {
        var ol = ui.el('ol', 'hint');
        ['Elle est allumée, avec son écran actif.', 'Elle est connectée au Wi-Fi : sur son écran, va dans Réglages, puis Réseau ou Wi-Fi, choisis ta box et entre le mot de passe du Wi-Fi.',
          'Elle est sur le même Wi-Fi que cet ordinateur (pas le Wi-Fi « invités » de la box).'].forEach(function (t) { ol.appendChild(ui.el('li', '', t)); });
        body.appendChild(ol);
        body.appendChild(ui.el('p', 'hint', 'Beaucoup d’imprimantes n’ont pas de Wi-Fi : ce n’est pas grave, on passera par la clé USB ou la carte SD.'));
        body.appendChild(ui.button('Chercher encore', startSetup, 'btn sm', 'wifi'));
      } else body.appendChild(ui.button('Elle est en Wi-Fi mais je ne la vois pas', function () { s.noneHelp = true; render(); }, 'link'));
    }
    body.appendChild(section(s.found && s.found.brand && !s.found.match ? 'Quel modèle de ' + s.found.brand + ' ?' : 'Ou cherche son modèle'));
    var input = ui.el('input', 'search');
    input.type = 'search';
    input.id = 'model-search';
    input.placeholder = ui.fr('Ex. : Ender 3, K1, Bambu A1, Prusa…');
    input.setAttribute('aria-label', ui.fr('Nom de ton imprimante'));
    ['autocorrect', 'autocapitalize', 'autocomplete'].forEach(function (k) { input.setAttribute(k, 'off'); });
    input.setAttribute('spellcheck', 'false');
    input.value = s.query;
    var results = ui.el('div', 'cards');
    results.id = 'model-results';
    function refresh() {
      s.query = input.value;
      results.textContent = '';
      if (!catalog) { results.appendChild(spinLine('Chargement de la liste…')); return; }
      if (!s.query.trim()) { results.appendChild(ui.el('p', 'hint', 'Son nom est écrit dessus, souvent à l’avant : par exemple « Ender 3 V3 », « K1C » ou « A1 mini ».')); return; }
      var hits = M.searchModels(catalog, s.query);
      if (!hits.length) results.appendChild(ui.el('p', 'hint', 'Aucune imprimante ne correspond. Essaie avec moins de mots, par exemple juste « Ender ».'));
      hits.forEach(function (m) { results.appendChild(card({ icon: 'printer', title: m.model, sub: m.vendor, on: function () { chooseModel(m, s.found && !s.found.match ? s.found : null); } })); });
      if (hits.length > 1) results.appendChild(ui.el('p', 'hint', 'Plusieurs modèles se ressemblent : le nom exact est écrit sur ta machine, souvent à l’avant ou au dos.'));
    }
    input.addEventListener('input', refresh);
    body.appendChild(input);
    body.appendChild(results);
    refresh();
    return spec;
  }

  // « Comme la dernière fois ? » (deuxième projet) : la machine et la bobine d'avant, confirmées d'un clic.
  function lastTimeCard() {
    var p = project(), st = state(), body = ui.el('div', 'card-content'), pr = p.printer, f = p.filament, k = Mat.knownPrinter(printers, pr.preset);
    ensureSpools(pr.preset);
    var row = (spoolRows() || []).filter(function (r) { return r.id === f.spool.id || r.name === f.spool.name; })[0];
    var list = ui.el('div', 'cards');
    var linked = k ? k.linked : true;
    list.appendChild(card({ icon: 'printer', title: shortName(pr), sub: linked ? 'Reliée en Wi-Fi' + (reachable[pr.preset] === true ? ' · prête' : '') : 'Impression par clé USB', badge: badge(linked ? 'wifi' : 'usb'), sel: true, radio: true }));
    list.appendChild(card({ icon: 'spool', swatch: row && row.colour, title: f.spool.name, sub: row ? (row.detail.charAt(0).toUpperCase() + row.detail.slice(1)) : f.type, sel: true, radio: true }));
    body.appendChild(list);
    if (st.error.printer || st.error.filament) body.appendChild(noteBox('error', 'alert', st.error.printer || st.error.filament));
    body.appendChild(noteBox('tip', 'info', 'Vérifie juste que c’est bien cette bobine qui est dans la machine.'));
    var changeLink = ui.button('Changer d’imprimante ou de bobine', function () { st.showList = true; render(); }, 'link muted');
    changeLink.id = 'materiel-change';
    return { title: 'Comme la dernière fois ?', sub: null, body: body,
      primary: { label: st.pending ? 'Je prépare…' : 'Oui, c’est ça', disabled: !!st.pending, run: function () {
        pickPrinter(pr.preset, pr.name, function () {
          var fp = project().filament, kk = known();
          if (kk && kk.slots && kk.linked) { render(); return; } // emplacements à lire : on les choisit à l'écran
          if (fp && fp.spool) chooseSpool(fp.spool.name, fp.type);
        });
      } },
      extra: [changeLink] };
  }

  // Températures de l'étiquette demandées après le choix (emplacements, nouvelle bobine) : garder ou entrer les siennes.
  // Avec des emplacements, elles valent pour la couleur 1 (le filament du projet) : on dit laquelle.
  function tempsCard() {
    var p = project(), f = p.filament, st = state(), body = ui.el('div', 'card-content');
    var slots = Array.isArray(p.canvas) && p.canvas.length ? p.canvas : [{ t: 0 }], printer = p.printer && p.printer.preset;
    if (!st.slotTemps) st.slotTemps = {};
    var advised = function (e) { return e === slots[0] ? { n: f.nozzle_temp, b: f.bed_temp } : { n: e.nozzle, b: e.bed }; };
    // Une ligne par emplacement : déjà connu (gardé), sinon à remplir. Deux bobines de la même marque et de la même matière :
    // ce qui est tapé dans la première remplit l'autre, tant qu'elle n'a pas été touchée.
    var rows = slots.map(function (e) {
      var rec = printer && e.canvas_id !== undefined ? Mat.slotTempsFor(habits, printer, e) : null, v = st.slotTemps[e.t];
      if (!v) v = st.slotTemps[e.t] = { nozzle: rec && typeof rec.nozzle === 'number' ? String(rec.nozzle) : '', bed: rec && typeof rec.bed === 'number' ? String(rec.bed) : '', touched: !!rec, known: !!rec };
      return { e: e, v: v };
    });
    var twin = function (a, b) { return !!a.e.brand && a.e.brand === b.e.brand && String(a.e.range || '') === String(b.e.range || '') && String(a.e.type || '').toUpperCase() === String(b.e.type || '').toUpperCase(); };
    var many = rows.length > 1;
    body.appendChild(ui.el('p', '', many
      ? 'Ta pièce utilise ' + rows.length + ' bobines. J’ai mis les températures conseillées pour chacune : ton étiquette dit autre chose ?'
      : 'J’ai mis les températures conseillées pour du ' + f.type + ' : buse ' + tempOf(f.nozzle_temp) + ', plateau ' + tempOf(f.bed_temp) + '. Ton étiquette dit autre chose ?'));
    body.appendChild(ui.el('p', 'hint', 'Elles sont écrites sur l’étiquette de la bobine, souvent en fourchette. Rien d’écrit ? Laisse vide : je garde les conseillées.'));
    var inputs = {};
    rows.forEach(function (r, i) {
      var e = r.e, box = ui.el('div', many ? 'slot-temps' : '');
      if (!many && e.label) box.appendChild(ui.el('p', 'hint', 'C’est la bobine de l’emplacement ' + e.label + '.'));
      if (many) {
        var head = ui.el('div', 'row2 colour-line');
        var sw = ui.el('span', 'cyl small'); if (e.color) sw.style.background = e.color;
        head.appendChild(sw);
        head.appendChild(ui.el('b', 'grow', (e.label ? e.label + ' · ' : '') + C.trayText(e.type, e.color) + (e.brand ? ' · ' + e.brand + (e.range ? ' ' + e.range : '') : '') + (many ? ' (couleur ' + (e.t + 1) + ')' : '')));
        box.appendChild(head);
      }
      var a = advised(e);
      if (many) box.appendChild(ui.el('p', 'hint', r.v.known ? 'Même bobine que la dernière fois : je reprends ce que tu m’avais dit.' : 'Conseillées : buse ' + tempOf(a.n) + ', plateau ' + tempOf(a.b) + '.'));
      var row = ui.el('div', 'row2');
      var mirror = function (key, val) {
        rows.forEach(function (o, k) { if (k > i && !o.v.touched && twin(r, o)) { o.v[key] = val; var el = inputs[o.e.t + key]; if (el) el.value = val; } });
      };
      var nz = textInput(r.v.nozzle, function (val) { r.v.nozzle = val; r.v.touched = true; mirror('nozzle', val); }, { inputmode: 'numeric', placeholder: a.n != null ? String(a.n) : 'ex. 200-220' });
      var bd = textInput(r.v.bed, function (val) { r.v.bed = val; r.v.touched = true; mirror('bed', val); }, { inputmode: 'numeric', placeholder: a.b != null ? String(a.b) : 'ex. 60' });
      inputs[e.t + 'nozzle'] = nz; inputs[e.t + 'bed'] = bd;
      row.appendChild(field('Buse (°C)' + (many ? '' : ' sur l’étiquette'), nz));
      row.appendChild(field('Plateau (°C)', bd));
      box.appendChild(row);
      var prev = rows.slice(0, i).filter(function (o) { return twin(o, r); })[0];
      if (prev) box.appendChild(ui.el('p', 'hint', 'Même marque que ' + (prev.e.label || 'la couleur ' + (prev.e.t + 1)) + ' : je recopie ce que tu y tapes.'));
      body.appendChild(box);
    });
    return { title: many ? 'Quelles températures indiquent tes bobines ?' : 'Quelles températures indique ta bobine ?', sub: null, body: body, primary: { label: 'C’est bon', run: function () {
      f.temps_ok = true;
      var todo = [];
      rows.forEach(function (r) {
        var n = Mat.labelTemp(r.v.nozzle), b = Mat.labelTemp(r.v.bed);
        // Emplacement : retenu, pour ne plus reposer la question tant qu'il montre la même bobine.
        if (printer && r.e.canvas_id !== undefined) habits = Mat.rememberSlotTemps(habits, printer, r.e, n, b);
        var a = advised(r.e);
        if ((n !== null && n !== a.n) || (b !== null && b !== a.b)) todo.push({ e: r.e, nozzle: n, bed: b });
      });
      if (printer && slots[0].canvas_id !== undefined) saveHabits();
      changed();
      if (!Array.isArray(p.canvas) || !p.canvas.length) { var only = todo[0]; if (only) setTemps(only.nozzle !== null ? String(only.nozzle) : '', only.bed !== null ? String(only.bed) : ''); return; }
      applySlotTemps(todo, false);
    } } };
  }

  // La section « Ta bobine » quand la machine a des emplacements lus (ou décrits) : renvoie le bouton plein, ou null.
  function slotsSection(body, mode) {
    var st = state(), sst = slotState() || {}, trays = C.trays(sst), sys = mode === 'manual' ? 'manual' : sst.source === 'manual' ? 'manual' : sst.system || (known() && known().slots) || 'canvas';
    var w = C.words(sys), pr = selectedPrinter(), busy = !!st.pending;
    if (st.canvas.error) body.appendChild(noteBox('error', 'alert', st.canvas.error));
    var tpu = Mat.tpuWarning(sys, trays, project().filament && project().filament.type);
    if (tpu && mode !== 'loading' && mode !== 'manual') body.appendChild(noteBox('warn', 'alert', tpu, [ui.button('Imprimer depuis le porte-bobine', useList, 'link')]));
    if (mode === 'loading') { body.appendChild(spinLine(J.prompt('filament', { canvas: { mode: 'loading', system: sys } }))); return null; }
    if (mode === 'manual') {
      var m = st.manual;
      body.appendChild(ui.el('p', 'sub', 'Dis-moi ce qui est chargé, tel que c’est sur ta machine. Je m’en souviens ici, et je te le rappelle la prochaine fois. Il me faut au moins la matière de chaque emplacement.'));
      if (m.error) body.appendChild(noteBox('error', 'alert', m.error));
      var counts = []; for (var n = 1; n <= C.MANUAL_MAX; n++) counts.push({ value: String(n), label: String(n) });
      body.appendChild(field('Combien d’emplacements ?', select(counts, String(m.count), function (v) { m.count = Number(v); render(); }, 'Nombre d’emplacements')));
      m.draft.slice(0, m.count).forEach(function (d, i) {
        var r = ui.el('div', 'row2 manual');
        r.appendChild(ui.el('b', 'num', String(i + 1)));
        r.appendChild(select([{ value: '', label: 'Matière ?' }].concat(C.MANUAL_TYPES.map(function (t) { return { value: t, label: t }; })), d.type, function (v) { d.type = v; render(); }, 'Matière de l’emplacement ' + (i + 1)));
        r.appendChild(select([{ value: '', label: 'Couleur ?' }].concat(C.MANUAL_COLOURS.map(function (c) { return { value: c.hex, label: c.name }; })), d.color, function (v) { d.color = v; }, 'Couleur de l’emplacement ' + (i + 1)));
        body.appendChild(r);
      });
      body.appendChild(ui.button('Annuler', function () { m.form = false; m.error = ''; render(); }, 'link muted'));
      return { label: 'Garder ces emplacements', disabled: !C.manualComplete(m.draft, m.count), run: saveManual };
    }
    if (mode === 'recall') {
      body.appendChild(ui.el('p', 'sub', C.manualRecall(sst)));
      body.appendChild(slotGrid(trays, null, null, true));
      body.appendChild(ui.button('J’ai changé', openManual, 'link'));
      body.appendChild(ui.button('Choisir un autre filament', useList, 'link muted'));
      return { label: 'Oui, toujours les mêmes', run: function () { st.manual.confirmed = true; st.canvas.mapping = proposal(); render(); } };
    }
    if (mode === 'tooMany') {
      body.appendChild(noteBox('warn', 'alert', 'Ta pièce a ' + colours().length + ' couleurs et ' + w.unit + ' ' + trays.length + ' ' + w.slots + '. Réduis le nombre de couleurs de la pièce dans Plyo Slicer, puis reviens ici.', [ui.button('Vérifier à nouveau', recheck, 'link')]));
      body.appendChild(ui.button('Choisir un autre filament', useList, 'link muted'));
      return null;
    }
    var mapping = st.canvas.mapping || [];
    if (sys === 'u1') body.appendChild(ui.el('p', 'hint', 'Ces couleurs sont sur tes têtes. Vérifie sur l’écran de la U1 : je ne change pas l’ordre des têtes.'));
    else if (sst.imposable === false && sst.source !== 'manual') body.appendChild(ui.el('p', 'hint', 'Je lis ces emplacements, mais je ne peux pas imposer ton choix sur cette machine' + (sst.blocker ? ' (' + sst.blocker + ')' : '') + '. Tu le sélectionneras à l’envoi.'));
    if (mode === 'single') {
      body.appendChild(ui.el('p', 'sub', sys === 'manual' ? 'Touche l’emplacement où se trouve ta bobine.' : 'J’ai lu les bobines de ' + w.your + '. Laquelle utiliser ?'));
      var first = mapping[0];
      body.appendChild(slotGrid(trays, first, function (t) { setTray(first ? first.t : colours()[0].t, t.canvas_id + ':' + t.tray_id); }, false, sst.empty_blocks));
      if (trays.some(function (t) { return t.empty; }) && !sst.empty_blocks && sys !== 'manual') body.appendChild(ui.el('p', 'hint', '« vide ? » : l’imprimante pense que cet emplacement est vide. S’il est chargé, tu peux le choisir quand même.'));
    } else if (mode === 'multi') {
      body.appendChild(ui.el('p', 'sub', sys === 'u1' ? 'Je propose une tête par couleur d’après le type et la couleur. Change celles qui ne te conviennent pas.' : 'Je propose un emplacement par couleur d’après le type et la couleur. Change ceux qui ne te conviennent pas.'));
      mapping.forEach(function (mm) {
        var r = ui.el('div', 'row2 colour-line');
        var sw = ui.el('span', 'cyl small'); if (mm.color) sw.style.background = mm.color;
        r.appendChild(sw);
        r.appendChild(ui.el('span', 'grow', 'Couleur ' + (mm.t + 1)));
        r.appendChild(select([{ value: '', label: sys === 'u1' ? 'Choisir une tête…' : 'Choisir un emplacement…' }].concat(trays.map(function (t) {
          return { value: t.canvas_id + ':' + t.tray_id, label: t.label + (t.empty && sys !== 'manual' ? (sst.empty_blocks ? ' (vide)' : ' (vide ?)') : ''), disabled: t.empty && sst.empty_blocks };
        })), mm.tray_id === null || mm.tray_id === undefined ? '' : mm.canvas_id + ':' + mm.tray_id, function (v) { setTray(mm.t, v); }, (sys === 'u1' ? 'Tête' : 'Emplacement') + ' pour la couleur ' + (mm.t + 1)));
        body.appendChild(r);
      });
    } else if (mode === 'colours') {
      // Une pièce multicolore : ce qui est prévu en une phrase (« Coque en PLA blanc · 1, … »), la carte Couleurs à un clic.
      var rows = Col.pieceRows(coloursState(), trays, mapping, { partName: project().part && project().part.name || '' }), files = fileRowsFor(trays);
      var said = [];
      if (files.length) files.forEach(function (r) { said.push(r.fileName + ' en ' + r.text); });
      else rows.forEach(function (r) { if (r.parts.length) r.parts.forEach(function (q) { said.push((q.detail || q.name) + ' en ' + q.text); }); else said.push(r.name + ' en ' + r.text); });
      var n = colours().length;
      var lead = files.length ? 'Ta pièce a ' + files.length + ' couleurs : ' : rows.length > 1 ? 'Ta plaque a ' + rows.length + ' pièces : ' : n > 1 ? 'Ta pièce a ' + n + ' couleurs : ' : 'Ta pièce a plusieurs parties : ';
      body.appendChild(ui.el('p', 'sub', 'J’ai lu les bobines de ' + w.your + '.'));
      body.appendChild(slotGrid(trays, null, null, true, sst.empty_blocks));
      // Plusieurs pièces qui sortiraient toutes avec la même bobine : la carte s'ouvre d'office (on ne fait pas un porte-clés
      // trois couleurs en une seule), avec la répartition « une bobine par pièce » quand elle est possible.
      var allSame = !files.length && rows.length > 1 && rows.every(function (r) { return !r.parts.length && !r.mixed && Col.trayKey(r.tray) === Col.trayKey(rows[0].tray); });
      var shown = st.colours.open || (allSame && !st.colours.shut), spread = allSame && !st.colours.batch ? Col.spreadPlan(rows, trays) : null;
      var toggle = ui.button(shown ? 'Fermer les couleurs' : 'Changer les couleurs', function () { st.colours.open = !shown; st.colours.shut = shown; st.colours.picker = null; render(); }, 'link');
      toggle.id = 'colours-toggle';
      toggle.setAttribute('aria-expanded', shown ? 'true' : 'false');
      body.appendChild(noteBox('tip', 'info', lead + said.join(', ') + '.', [toggle]));
      if (shown) {
        var holder = ui.el('div', 'colours-box');
        root.PlyoColoursView.render(holder, { el: ui.el, button: ui.button, icon: ui.icon }, { rows: rows, fileRows: files, unfolded: st.colours.unfolded,
          sameTray: Col.sameTrayNote(files), trays: trays, system: sst.source === 'manual' ? 'manual' : sst.system || sys, emptyBlocks: !!sst.empty_blocks,
          picker: st.colours.picker, error: st.colours.error, recheck: st.colours.recheck, pending: !!st.colours.token || !!st.colours.batch, handlers: coloursHandlers,
          direct: true, intro: allSame ? Col.spreadIntro(rows) : 'Touche une pièce pour la voir dans la vue 3D, puis la bobine qui l’imprime.', spread: spread,
          pendingText: st.colours.batch ? 'Je donne une bobine à chaque pièce… (' + st.colours.batch.done + '/' + st.colours.batch.moves.length + ')' : '' });
        body.appendChild(holder);
      }
    }
    slotBrandsInto(body, sst, w);
    if (sys === 'manual') body.appendChild(ui.button('J’ai changé', openManual, 'link'));
    body.appendChild(ui.button('Choisir un autre filament', useList, 'link muted'));
    var complete = mode === 'colours' ? Col.complete(colours(), mapping, trays) : C.complete(mapping);
    var label = mode === 'colours' ? 'Utiliser ces bobines' : mode === 'multi' ? (sys === 'u1' ? 'Utiliser ces têtes' : 'Utiliser ces emplacements')
      : mapping[0] && mapping[0].tray_id !== null && mapping[0].tray_id !== undefined ? 'Oui, ' + w.the + ' ' + slotLabel(trays, mapping[0]) : 'Choisis ' + w.the;
    return { label: busy ? 'Je prépare…' : label, disabled: busy || !complete || !!st.colours.token, run: function () { applyCanvas(st.canvas.mapping); } };
  }
  function slotLabel(trays, m) { var t = trays.filter(function (x) { return x.canvas_id === m.canvas_id && x.tray_id === m.tray_id; })[0]; return t ? t.slot : ''; }
  // Grille des emplacements (maquette) : une pastille de la couleur, le numéro, la matière.
  function slotGrid(trays, chosen, onPick, readOnly, emptyBlocks) {
    var grid = ui.el('div', 'slots');
    trays.forEach(function (t) {
      var on = !!chosen && chosen.tray_id === t.tray_id && chosen.canvas_id === t.canvas_id;
      var b = ui.el(readOnly ? 'div' : 'button', 'slot' + (on ? ' sel' : '') + (t.empty ? ' empty' : ''));
      if (!readOnly) { b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.addEventListener('click', function () { onPick(t); }); if (t.empty && emptyBlocks) b.disabled = true; }
      var cyl = ui.el('div', 'cyl');
      if (t.color && !t.empty) cyl.style.background = t.color;
      b.appendChild(cyl);
      b.appendChild(ui.el('b', '', t.slot));
      b.appendChild(ui.el('div', '', t.empty ? (emptyBlocks ? 'vide' : 'vide ?') : C.trayText(t.type, t.color)));
      b.title = ui.fr(t.label);
      grid.appendChild(b);
    });
    return grid;
  }

  // La section « Ta bobine » sans emplacements : mes bobines, la matière (PLA présélectionné), « Préciser ma bobine ».
  function spoolSection(body) {
    var st = state(), rows = spoolRows(), pick = currentPick(), pr = selectedPrinter();
    if (st.error.filament) body.appendChild(noteBox('error', 'alert', st.error.filament));
    var k = known(), read = st.canvas.state;
    if (k && k.slots && k.linked && read && !read.ok && !st.canvas.useList) body.appendChild(ui.el('p', 'hint', k.slots === 'canvas' ? 'Je ne lis pas ton Canvas pour l’instant : choisis ta bobine ici, l’imprimante choisira l’emplacement.' : 'Je ne lis pas les emplacements de ta machine pour l’instant : choisis ta bobine ici.'));
    if (k && k.slots_reason === 'link_incomplete') body.appendChild(noteBox('', 'info', 'Ta machine a été reliée sans son numéro de série ni son code d’accès : je ne lis pas ses emplacements.', [ui.button('Relier à nouveau', startSetup, 'link')]));
    if (Array.isArray(rows) && rows.length) {
      var list = ui.el('div', 'cards spools');
      rows.slice(0, 6).forEach(function (r) {
        list.appendChild(card({ icon: 'spool', swatch: r.colour, title: r.label, sub: r.detail.charAt(0).toUpperCase() + r.detail.slice(1), radio: true,
          sel: pick.kind === 'spool' && (pick.id === r.id || pick.name === r.name),
          on: function () { st.pick = { kind: 'spool', id: r.id, name: r.name, material: r.material }; render(); } }));
      });
      body.appendChild(list);
      body.appendChild(ui.el('p', 'sub', 'Ou une nouvelle bobine : regarde son étiquette. Pas sûr ? Prends PLA, c’est le plus courant.'));
    } else if (rows === null && chosenPreset()) body.appendChild(spinLine('Je cherche tes bobines…'));
    else body.appendChild(ui.el('p', 'sub', 'Regarde l’étiquette de la bobine. Pas sûr ? Prends PLA, c’est le plus courant.'));
    var isNew = pick.kind === 'new';
    var chips = ui.el('div', 'chips mats');
    Mat.MATERIALS.filter(function (m, i) { return i < 2 || st.moreMats || st.material === m; }).forEach(function (m) {
      chips.appendChild(chip(m, function () { pickMaterial(m); }, isNew && st.material === m, m));
    });
    if (!st.moreMats) chips.appendChild(chip('Autres…', function () { st.moreMats = true; render(); }, false));
    body.appendChild(chips);
    if (isNew) body.appendChild(ui.el('p', 'hint', Mat.materialHelp(st.material)));
    // Une nouvelle bobine : après la matière, sa marque, sa couleur et les températures écrites sur l'étiquette.
    if (isNew) {
      if (st.brandsFor !== st.material || st.brandsPr !== (chosenPreset() || '')) { askBrands(st.material); syncName(); }
      body.appendChild(newSpoolForm());
    }
    if (Mat.manualWanted(k, wantsFilament(), readCtx()) && k && !(k.slots && k.linked)) body.appendChild(ui.button(expert() ? 'Ma machine a plusieurs bobines (AMS, CFS…)' : 'Ma machine a plusieurs bobines à la fois (AMS, CFS…)', openManual, 'link'));
    // Le bouton plein : la machine et la bobine ensemble.
    var name = shortName(pr), busy = !!st.pending;
    var label = pick.kind === 'spool' ? 'Oui, sur ' + name + ' avec ' + pick.name : 'Oui, sur ' + name + ' avec cette bobine';
    return { label: busy ? 'Je prépare…' : label, disabled: busy, run: commitSpool };
  }
  function newSpoolForm() {
    var st = state(), box = ui.el('div', 'in new-spool');
    // Marque : celles du slicer pour cette matière et cette machine ; « Je ne sais pas » et la marque écrite à la main.
    var groups = st.brands, opts = [{ value: '', label: groups === null ? 'Je cherche les marques…' : 'Choisir…' }, { value: '__unknown', label: 'Je ne sais pas' }];
    if (Array.isArray(groups)) Sp.brandButtons(groups, true).shown.forEach(function (g) { opts.push({ value: g.brand, label: g.brand }); });
    opts.push({ value: '__other', label: 'Une autre marque…' });
    var row = ui.el('div', 'row2');
    row.appendChild(field('Marque', select(opts, st.brandSel, function (v) { st.brandSel = v; st.rangeSel = ''; syncName(); render(); }, 'Marque de ta bobine')));
    var g = (groups || []).filter(function (x) { return x.brand === st.brandSel; })[0];
    if (g && g.ranges.length > 1) row.appendChild(field('Gamme', select([{ value: '', label: 'Je ne sais pas' }].concat(g.ranges.map(function (r) { return { value: r.preset, label: r.short || r.label }; })), st.rangeSel, function (v) { st.rangeSel = v; syncName(); render(); }, 'Gamme de ta bobine')));
    if (st.brandSel === '__other') row.appendChild(field('Sa marque', textInput(st.otherBrand, function (v) { st.otherBrand = v; syncName(); }, { maxlength: '60', 'aria-label': 'Marque de ta bobine' })));
    box.appendChild(row);
    if (g && g.ranges.length > 1 && !st.rangeSel) box.appendChild(ui.el('p', 'hint', Sp.rangeHelp(g.brand)));
    var c = brandChoice();
    if (c) box.appendChild(ui.el('p', 'hint', Sp.brandNote(c, st.material)));
    // Couleur : une pastille par couleur courante ; elle colore la pièce dans Plyo Slicer et entre dans le nom.
    var colourBox = ui.el('div', 'fld');
    colourBox.appendChild(ui.el('span', '', 'Couleur'));
    var chips = ui.el('div', 'chips colours-pick');
    Mat.COLOURS.forEach(function (col) {
      var b = chip(col.name.charAt(0).toUpperCase() + col.name.slice(1), function () { st.colour = st.colour === col.name ? '' : col.name; syncName(); render(); }, st.colour === col.name, col.name);
      b.classList.add('colour');
      var sw = ui.el('span', 'cyl small'); sw.style.background = col.hex;
      b.insertBefore(sw, b.firstChild);
      chips.appendChild(b);
    });
    colourBox.appendChild(chips);
    box.appendChild(colourBox);
    // Températures : presque toujours imprimées sur l'étiquette, souvent en fourchette.
    var temps = ui.el('div', 'row2');
    temps.appendChild(field('Buse (°C)', textInput(st.temps.nozzle, function (v) { st.temps.nozzle = v; }, { inputmode: 'numeric', placeholder: 'ex. 190-220', 'aria-label': 'Température de buse sur l’étiquette' })));
    temps.appendChild(field('Plateau (°C)', textInput(st.temps.bed, function (v) { st.temps.bed = v; }, { inputmode: 'numeric', placeholder: 'ex. 50-60', 'aria-label': 'Température de plateau sur l’étiquette' })));
    box.appendChild(temps);
    box.appendChild(ui.el('p', 'hint', 'Elles sont écrites sur l’étiquette de la bobine, souvent en fourchette. Rien d’écrit ? Laisse vide : je prends les températures conseillées.'));
    // Le nom : obligatoire pour la retrouver, prérempli d'après la marque et la couleur.
    var name = textInput(st.name, function (v) { st.name = v; st.nameError = ''; }, { maxlength: '60', 'aria-label': 'Nom de ta bobine' });
    name.id = 'spool-name';
    box.appendChild(field('Nom (pour la retrouver)', name));
    if (st.nameError) box.appendChild(ui.el('p', 'err', Sp.nameErrorText(st.nameError) || st.nameError));
    return box;
  }
  // « Oui, sur … » : la machine d'abord si elle n'est que proposée, puis la bobine (connue, en un clic, ou précisée).
  function commitSpool() {
    var st = state(), p = project();
    if (st.pending) return;
    if (!p.printer) return;
    if (!P.hasPrinter(p)) {
      pickPrinter(p.printer.preset, p.printer.name, function () {
        var k = known();
        if (k && k.slots && k.linked) { render(); return; } // emplacements à lire : on les choisit à l'écran
        commitSpool();
      });
      return;
    }
    var pick = currentPick();
    if (pick.kind === 'spool') { chooseSpool(pick.name, pick.material || (p.filament && p.filament.type) || 'PLA'); return; }
    st.nameError = Sp.nameError(st.name);
    if (st.brandSel === '__other' && !Sp.otherChoice(st.otherBrand)) { st.nameError = 'Écris la marque (au moins 2 lettres), ou choisis « Je ne sais pas ».'; render(); return; }
    if (st.nameError) { render(); return; }
    var col = Mat.colourOf(st.colour);
    chooseSpool(Sp.cleanName(st.name), st.material, brandChoice(), { temps: { nozzle: st.temps.nozzle, bed: st.temps.bed }, asked: true, colour: col ? col.hex : '' });
  }

  function mainCard(ctx) {
    var st = state(), p = project(), body = ui.el('div', 'card-content'), pr = selectedPrinter(), mode = null;
    ensureMachine();
    if (st.error.printer) body.appendChild(noteBox('error', 'alert', st.error.printer));
    var visible = printers ? J.machineCards(M.visiblePrinters(printers, habits.hidden), st.showOthers) : null;
    var extraFound = (found || []).filter(function (f) { return !M.isKnownHost(printers, f.ip); });
    var primary = null;
    if (!printers) body.appendChild(spinLine('Je cherche tes imprimantes…'));
    else {
      var list = ui.el('div', 'cards printers');
      visible.cards.forEach(function (m) {
        var on = reachable[m.preset] === true;
        list.appendChild(card({ icon: 'printer', title: J.shortMachine(m), sub: m.linked ? 'Reliée en Wi-Fi' + (on ? ' · prête' : '') : 'Impression par clé USB', badge: badge(m.linked ? 'wifi' : 'usb'),
          sel: !!pr && pr.preset === m.preset, radio: true, disabled: !!st.pending,
          on: function () { if (pr && pr.preset === m.preset && !pr.proposed) return; st.pick = null; pickPrinter(m.preset, m.label); } }));
      });
      extraFound.forEach(function (f) {
        list.appendChild(card({ icon: 'printer', title: f.match ? f.match.model : (f.name || f.brand || 'Imprimante'), sub: 'Trouvée sur ton Wi-Fi', badge: badge('wifi'), radio: true, sel: false, disabled: !!st.pending,
          on: function () { st.setup = freshSetup(); if (f.match) chooseModel(f.match, f); else { st.screen = 'add'; st.setup.phase = 'search'; st.setup.found = f; st.setup.query = f.brand || ''; if (!catalog) panel.post({ type: 'setup_catalog' }); render(); } } }));
      });
      if (list.children.length) body.appendChild(list);
      if (visible.folded) body.appendChild(ui.button('Autres machines installées (' + visible.folded + ')', function () { st.showOthers = true; render(); }, 'link'));
      if (!list.children.length) {
        body.appendChild(noteBox('', 'info', scanning.bg ? 'Je cherche ton imprimante sur le Wi-Fi…' : 'Je n’ai pas trouvé d’imprimante sur ton Wi-Fi. Ajoute la tienne : il suffit de choisir son modèle.'));
        primary = { label: 'Ajouter mon imprimante', icon: 'plus', run: startSetup };
      } else {
        var add = ui.button('Ajouter mon imprimante', startSetup, 'btn sm', 'plus');
        add.id = 'printer-add';
        body.appendChild(ui.el('div', 'left')).appendChild(add);
      }
    }
    if (pr && printers) {
      if (!pr.proposed) hardwareLine(body);
      body.appendChild(section('Ta bobine'));
      if (!pr.proposed) { ensureSpools(pr.preset); ensureSlots(); }
      else ensureSpools(pr.preset);
      mode = pr.proposed ? null : slotMode();
      primary = mode ? slotsSection(body, mode) : spoolSection(body);
    } else if (printers && !primary) primary = { label: 'Choisis ton imprimante', disabled: true, run: function () {} };
    // Étape rouverte depuis la barre, rien de changé : on revient à l'étape en cours.
    var f = p.filament, withSlots = Array.isArray(p.canvas) && p.canvas.length > 0;
    if (ctx.revisit && f && !f.proposed && pr && !pr.proposed && primary && !primary.disabled) {
      var same = mode ? withSlots && Col.sameAsChosen(st.canvas.mapping, p.canvas, colours()) : !st.pick && !withSlots;
      if (same) primary = { label: 'Garder ces choix', run: ctx.actions.closeRevisit };
    }
    var extra = [];
    if (st.showList && p.printer && p.printer.proposed) extra.push(ui.button('Retour', function () { st.showList = false; render(); }, 'link muted'));
    return { title: 'Sur quelle imprimante ?', sub: null, body: body, primary: primary, extra: extra };
  }

  // ---------- La carte de l'étape ----------
  V2.cards = V2.cards || {};
  V2.cards.materiel = function (ctx) {
    if (!panel) return { title: 'Sur quelle imprimante ?', sub: null, body: null, primary: null };
    var st = state(), p = project();
    actions = ctx.actions ? Object.assign({ revisit: !!ctx.revisit }, ctx.actions) : null;
    if (st.screen === 'add') return setupCard();
    if (p.printer && p.printer.proposed && p.filament && p.filament.proposed && p.filament.spool && p.filament.spool.name && !st.showList) return lastTimeCard();
    if (!ctx.revisit && J.tempsPending(p) && P.nextStep(p) === 'ready') return tempsCard();
    return mainCard(ctx);
  };

  // ---------- Branchement sur le panneau (v2/panneau.js) ----------
  function plug(p) {
    panel = p;
    p.on('project_printers', onPrinters);
    p.on('project_reachable', function (msg) { reachable[msg.preset] = !!msg.ok; if (J.barKey(J.currentStep(project())) === 'materiel') render(); });
    p.on('printer_profile_selected', onProfileSelected);
    p.on('printer_scan_result', onScanResult);
    p.on('setup_catalog', function (msg) { catalog = Array.isArray(msg.catalog) ? msg.catalog : []; var st = state(); if (st.screen === 'add') render(); });
    p.on('setup_installed', onInstalled);
    p.on('printer_link_state', onLinkState);
    p.on('printer_link_tested', onLinkTested);
    p.on('printer_link_saved', onLinkSaved);
    p.on('printer_link_dialog_closed', onLinkDialogClosed);
    p.on('spools', onSpools);
    p.on('brands', onBrands);
    p.on('spool_chosen', onSpoolChosen);
    p.on('project_state', onProjectState);
    p.on('result', onResult);
    p.on('bed_type_set', onBedSet);
    p.on('canvas_state', onCanvasState);
    p.on('canvas_applied', onCanvasApplied);
    p.on('slots_manual_state', onManualState);
    p.on('slots_manual_saved', onManualSaved);
    p.on('colours', onColours);
    p.on('slot_brands', onSlotBrands);
    p.on('colour_set', onColourSet);
    p.on('plate_action', onPlateAction);
    p.on('slot_temps', onPlateAction);
    p.on('habits', function (msg) { habits = Object.assign(M.emptyHabits(), msg.habits || {}); });
    p.on('firststeps', function (msg) { var s = msg.state || {}; level = s.level || ''; if (J.barKey(J.currentStep(project())) === 'materiel') render(); });
    // Profil copié « <nom> (Plyo) » par une adaptation ou un lot appliqué : le filament du projet suit (repris du lot 2).
    p.on('model_added', function (msg) { if (msg.adaptation) followSaved(msg.adaptation.saved); });
    p.on('model_adapted', function (msg) {
      var ad = msg.adaptation;
      if (!ad) return;
      followSaved(ad.saved);
      // La carte « J'ai adapté ce fichier » (liste, écartés, « Annuler ») est dans la discussion : v2/finitions.js.
      var n = Array.isArray(ad.adapted) ? ad.adapted.length : 0;
      if (ad.error) thread('Adaptation du fichier impossible : ' + ad.error);
      else if (n) thread('Fichier adapté : ' + n + ' réglage' + (n > 1 ? 's' : '') + ' changé' + (n > 1 ? 's' : '') + '.');
    });
    p.on('values', function (msg) {
      // Plateau, buse et modèle lus pour la machine en cours : la ligne « Buse · plateau » suit.
      var sig = JSON.stringify([msg.bed || null, msg.machine || null, msg.context ? [msg.context.printer, msg.context.nozzle_mm] : null]);
      if (sig !== machineSig) { machineSig = sig; if (J.barKey(J.currentStep(project())) === 'materiel') render(); }
    });
    askPrinters();
    p.post({ type: 'firststeps_state' });
  }
  (V2.plugins = V2.plugins || []).push(plug);

  // Pour l'étape 3 (v2/imprimer.js, carte « Plyo Slicer est passé sur … ») : prendre la machine d'Orca, ou rattacher au projet
  // la bobine qu'Orca utilise (même chemin que le choix d'une bobine : le slicer relit le préréglage et ses températures).
  function attachSpool(spool, material) {
    var p = project();
    if (!spool || !spool.id) return;
    state().pending = { kind: 'filament', type: material || (p.filament && p.filament.type) || '', spool: { id: spool.id, name: spool.name }, fresh: false, success: null, profileBefore: '' };
    panel.post({ type: 'project_state' });
  }
  // « Mes machines › Ajouter une machine » (menu, lot 5) : l'écran « Ajouter mon imprimante » de l'étape 2, rouverte au besoin.
  function addPrinter() {
    startSetup();
    if (J.barKey(J.currentStep(project())) !== 'materiel' && panel.openStep) panel.openStep('materiel');
  }
  V2.materiel = { state: function () { return state(); }, printers: function () { return printers; }, pickPrinter: function (preset, name) { pickPrinter(preset, name); }, attachSpool: attachSpool, addPrinter: addPrinter };
})(typeof window !== 'undefined' ? window : globalThis);
