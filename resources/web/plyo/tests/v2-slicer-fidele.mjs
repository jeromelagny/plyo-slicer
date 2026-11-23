// Slicer simulé FIDÈLE pour les parcours de la v2 (tests/assistant-v2-parcours.test.mjs et l'outil de captures Playwright).
// Il reproduit, message par message, les règles de handle_page_message (src/plyo/PlyoAssistant.cpp) et des modules qu'il
// appelle : refus et textes exacts, champs renvoyés (missing, can_restore…), état d'Orca (imprimante et filament en cours),
// plateau (pièces, exemplaires, échelle), découpe, envoi, suivi. Il ne dit jamais oui là où le C++ dit non.
// Simplifications (notées) : pas de fenêtres d'Orca (confirmation d'envoi, enregistrement) ; une découpe dure ~40 ms ;
// le catalogue des réglages est réduit aux clés que la v2 envoie ; les profils copiés « (Plyo) » ne sont pas simulés.
// Ce fichier n'importe rien : l'outil Playwright l'injecte tel quel dans la page (sans les « export »).

export const TEXTS = {
  // ProjectLogic::refusal / edit_refusal
  stale_project: 'Plyo Slicer n\'est plus sur l\'imprimante ou le filament de ce projet. Remets le projet en place avant de changer des réglages.',
  stale_printer_edit: 'Plyo Slicer n\'est plus sur l\'imprimante de ce projet. Remets le projet en place avant de changer des réglages.',
  stale_filament_edit: 'Plyo Slicer n\'est plus sur le filament de ce projet. Remets le projet en place avant de changer des réglages.',
  // SettingsBridge::check_profiles
  stale_profiles: 'Tu as changé d\'imprimante ou de profil depuis la proposition : redemande-moi, je regarde les réglages d\'aujourd\'hui. Aucune modification appliquée.',
  // ProjectFilesLogic::BUSY_TEXT
  busy: 'J’attends que Plyo Slicer ait fini ce qu’il fait (découpe, envoi, test ou fenêtre ouverte) pour ranger le projet d’avant ; réessaie dans un instant.',
  // PlateActions / Commands
  plate_busy: 'Plyo Slicer est déjà occupé sur le plateau. Réessaie dans un instant.',
  plate_empty: 'Le plateau est vide : ajoute d\'abord un modèle.',
  no_commands: 'Aucun ordre à exécuter.',
  which_piece: 'Je ne sais pas quelle pièce modifier : clique d\'abord sur la pièce, puis redemande-moi.',
  tool_which: 'Clique d\'abord sur la pièce, puis redemande-moi d\'ouvrir l\'outil.',
  undo_wait: 'Attends la fin de l\'opération en cours, puis réessaie.',
  undo_changed: 'Le plateau a changé depuis : utilise « Annuler » du slicer (Cmd/Ctrl + Z) pour revenir en arrière pas à pas.',
  orca_refused: 'Plyo Slicer refuse de découper cette plaque pour l\'instant : je t\'explique pourquoi juste en dessous.',
  // Spools::create_or_choose
  spool_printer: 'Choisis d\'abord cette imprimante dans Plyo Slicer.',
  // Project::restore
  restore_no_printer: 'Le projet n\'a pas encore d\'imprimante.',
};

export const K1C = { preset: 'Creality K1C 0.4 nozzle', name: 'Creality K1C 0.4 nozzle', linked: true, host: '192.168.1.31', bed_mm: [220, 220, 250], vendor: 'Creality', model: 'Creality K1C', nozzles: ['0.4', '0.6'] };
export const ENDER = { preset: 'Creality Ender-3 V3 SE 0.4 nozzle', name: 'Creality Ender-3 V3 SE 0.4 nozzle', linked: false, host: '', bed_mm: [220, 220, 250], vendor: 'Creality', model: 'Creality Ender-3 V3 SE', nozzles: ['0.4'] };
export const CATALOG = [
  { vendor: 'Creality', model: 'Creality K1C', nozzles: ['0.4', '0.6'], bed_mm: [220, 220, 250] },
  { vendor: 'Creality', model: 'Creality Ender-3 V3 SE', nozzles: ['0.4'], bed_mm: [220, 220, 250] },
  { vendor: 'Prusa', model: 'Prusa MK4S', nozzles: ['0.4'], bed_mm: [250, 210, 220] },
];
const SAMPLES = { benchy: { name: 'Petit bateau de test (3DBenchy)', size: [60, 31, 48] }, cali_cat: { name: 'Chat de calibration (Cali Cat)', size: [35, 30, 40] } };
// Réglages de l'onglet Filament (SettingsBridge, Param::preset == TYPE_FILAMENT) et clés du catalogue de cet onglet.
const FILAMENT_IDS = ['nozzle_temp', 'nozzle_temp_initial', 'bed_temp', 'bed_temp_initial', 'retraction', 'overhang_fan_speed'];
const FILAMENT_KEY = /^(nozzle_temperature|nozzle_temperature_initial_layer|hot_plate_temp|textured_plate_temp|cool_plate_temp|eng_plate_temp|filament_|fan_|overhang_fan_speed|slow_down|close_fan)/;
// Opérations d'un geste fait à la main (ProjectLogic::user_plate_edit).
const USER_OPS = ['rotate', 'lay_flat', 'set_copies', 'scale'];
const PLATE_WIDE = ['orient', 'arrange', 'scale_to_fit', 'slice'];

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const short = (preset) => String(preset || '').replace(/ \d\.\d nozzle$/, '').replace(/^Creality /, '');

// ProjectLogic (missing, same_filament, refusal, edit_refusal, can_restore, missing_for).
function has(project, key, field) {
  const part = project && project[key];
  if (!part || typeof part !== 'object' || part.proposed === true) return false;
  return typeof part[field] === 'string' && part[field] !== '';
}
export function missing(project) {
  const out = [];
  if (!has(project, 'printer', 'preset')) out.push('printer');
  if (!has(project, 'part', 'name')) out.push('part');
  if (!has(project, 'filament', 'preset')) out.push('filament');
  return out;
}
export function sameFilament(projectPreset, current) {
  if (!projectPreset) return false;
  if (current === projectPreset) return true;
  return [' (Plyo)', ' — '].some((s) => String(current).startsWith(projectPreset + s));
}
function missingFor(project, filamentOnly) { const out = missing(project); return filamentOnly ? out.filter((x) => x !== 'part') : out; }
export function refusalText(project, printer, filament, filamentOnly) {
  const todo = missingFor(project, filamentOnly);
  if (todo.length) {
    const words = todo.map((t) => (t === 'printer' ? 'sur quelle machine' : t === 'part' ? 'quelle pièce' : 'avec quelle bobine'));
    const list = words.length === 1 ? words[0] : words.slice(0, -1).join(', ') + ' et ' + words[words.length - 1];
    return 'Pour appliquer ça, dis-moi d\'abord ' + list + ' tu imprimes.';
  }
  if (project.printer.preset !== printer || !sameFilament(project.filament.preset, filament)) return TEXTS.stale_project;
  return '';
}
function editRefusal(project, printer, filament) {
  const todo = missing(project);
  if (todo.indexOf('printer') < 0 && project.printer.preset !== printer) return TEXTS.stale_printer_edit;
  if (todo.indexOf('filament') < 0 && !sameFilament(project.filament.preset, filament)) return TEXTS.stale_filament_edit;
  return '';
}
function canRestore(project, printer, filament) {
  const todo = missing(project);
  if (todo.indexOf('printer') >= 0 || todo.indexOf('filament') >= 0) return false;
  return project.printer.preset !== printer || !sameFilament(project.filament.preset, filament);
}
function filamentOnly(changes) {
  if (!Array.isArray(changes) || !changes.length) return false;
  return changes.every((c) => c && typeof c === 'object' && (c.key !== undefined ? FILAMENT_KEY.test(c.key) : FILAMENT_IDS.indexOf(c.id) >= 0));
}
function fits(size, bed) {
  if (!bed || bed[0] <= 0 || bed[1] <= 0) return true;
  const flat = (a, b) => a <= bed[0] + 1e-6 && b <= bed[1] + 1e-6;
  return (flat(size[0], size[1]) || flat(size[1], size[0])) && (!bed[2] || size[2] <= bed[2] + 1e-6);
}

// `cfg` : printers (installées), orcaPrinter, orcaFilament, spools ({ preset: [...] }), conversations ({ id: conv }), attached,
// session, firststeps, habits, found (Wi-Fi), canvas, send ('ok' | 'unreachable' | 'refused' | 'device'), sliceError,
// sliceWarnings, preflightObjects, noSupportNeeded, cost, values (paramètres), deny (messages refusés à la main).
export function createSlicer(cfg = {}) {
  const S = {
    printers: clone(cfg.printers !== undefined ? cfg.printers : [K1C]),
    orca: { printer: '', filament: '', process: '0.20mm Standard @Creality', bed: 'Textured PEI Plate' },
    spools: clone(cfg.spools || {}),
    plate: { objects: [], nextRef: 1, selected: null },
    snapshot: 1000, snapshots: [], undo: [], nextUndo: 1,
    settings: { support: false, brim_type: 'no_brim', brim_width: 0, spiral_mode: false, top_shell_layers: 4, sparse_infill_density: '15%' },
    sliced: false, slicing: false, jobBusy: false, editsBlocked: false, sendBusy: false,
    attached: cfg.attached || '', convs: clone(cfg.conversations || {}), journal: [],
    session: cfg.session || null, habits: clone(cfg.habits || {}), firststeps: Object.assign({ seen: true }, cfg.firststeps || {}),
    found: clone(cfg.found || []), watch: null, log: [], refusals: [], unknown: [],
  };
  if (cfg.plate) { S.plate.objects = clone(cfg.plate); S.plate.nextRef = 100; }
  if (cfg.sliced) S.sliced = true;
  if (cfg.settings) Object.assign(S.settings, cfg.settings);
  S.orca.printer = cfg.orcaPrinter !== undefined ? cfg.orcaPrinter : (S.printers[0] ? S.printers[0].preset : '');
  S.orca.filament = cfg.orcaFilament || (S.orca.printer ? 'Generic PLA @' + short(S.orca.printer) : '');
  let emit = () => {};
  const later = (fn, ms) => setTimeout(fn, ms || 5);
  const refuse = (type, text, extra) => { S.refusals.push({ type, text }); return Object.assign({ ok: false, text }, extra || {}); };
  const printerOf = (preset) => S.printers.find((p) => p.preset === preset) || null;
  const bed = () => { const p = printerOf(S.orca.printer); return p ? p.bed_mm : [220, 220, 250]; };
  const plateSizes = () => S.plate.objects.map((o) => o.size_mm);
  function values() {
    const p = printerOf(S.orca.printer);
    return { type: 'values', locale: 'fr_FR', can_undo: S.undo.length > 0,
      context: { printer: S.orca.printer, filament: S.orca.filament, process: S.orca.process, nozzle_mm: 0.4 },
      params: clone(cfg.values || [{ id: 'brim_width', key: 'brim_width', label: 'Largeur de la bordure', unit: 'mm', value: S.settings.brim_width }]),
      bed: p ? { types: [{ value: 'Textured PEI Plate', label: 'Textured PEI Plate' }, { value: 'High Temp Plate', label: 'High Temp Plate' }], current: S.orca.bed } : null,
      machine: p ? { system: true, vendor: p.vendor, model: p.model, nozzles: p.nozzles, nozzle: '0.4' } : null };
  }
  function signals() {
    const p = printerOf(S.orca.printer);
    const sig = { type: 'tour_signals', objects: S.plate.objects.length, sliced: S.sliced, slicing: S.slicing, linked: !!(p && p.linked), user_file: false, notices: [],
      part_name: S.plate.objects[0] ? S.plate.objects[0].name : '' };
    if (S.sliced) { sig.ready_for_print = !cfg.notReady; sig.time_s = 3900; sig.weight_g = 41.6; if (cfg.cost) sig.cost = 0.92; }
    return sig;
  }
  function projectState() {
    const t = /PETG/.test(S.orca.filament) ? [240, 75] : /ABS|ASA/.test(S.orca.filament) ? [255, 100] : [210, 60];
    return { printer_preset: S.orca.printer, filament_preset: S.orca.filament, nozzle_temp: t[0], bed_temp: t[1] };
  }
  // Un changement de profil ou de plateau : Orca invalide la découpe et rafraîchit les valeurs (on_config_changed).
  function invalidate() { S.sliced = false; }
  function configChanged() { invalidate(); later(() => emit(values()), 8); }
  function takeSnapshot() { S.snapshots.push({ time: ++S.snapshot, objects: clone(S.plate.objects), before: clone(S.plateBefore) }); return S.snapshot; }

  // ---------- Refus de project_refusal (apply, commands) ----------
  function projectRefusal(data) {
    if (data.revert) return null;
    const project = data.project || null;
    const fo = data.type === 'apply' && filamentOnly(data.changes);
    const edit = !!data.project_edit;
    const text = edit ? editRefusal(project || {}, S.orca.printer, S.orca.filament) : refusalText(project || {}, S.orca.printer, S.orca.filament, fo);
    if (!text) return null;
    return refuse(data.type, text, { can_restore: canRestore(project || {}, S.orca.printer, S.orca.filament), missing: edit ? [] : missingFor(project || {}, fo) });
  }

  // ---------- Plateau ----------
  function targetOf(ref) {
    const list = S.plate.objects;
    if (ref) return list.find((o) => o.ref === String(ref)) || 'gone';
    if (S.plate.selected && list.find((o) => o.ref === S.plate.selected)) return list.find((o) => o.ref === S.plate.selected);
    if (list.length === 1) return list[0];
    return null;
  }
  function runCommands(list) {
    if (!Array.isArray(list) || !list.length || list.length > 6) return refuse('commands', TEXTS.no_commands, { done: [] });
    if (S.jobBusy) return refuse('commands', TEXTS.plate_busy, { done: [] });
    const before = clone(S.plate.objects);
    const done = [];
    let failure = '';
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      if (PLATE_WIDE.indexOf(c.op) >= 0) { if (c.op === 'arrange' || c.op === 'orient') done.push(c.summary || ''); continue; }
      const o = targetOf(c.object);
      if (!o) { failure = TEXTS.which_piece; break; }
      if (o === 'gone') { failure = 'Cette pièce n\'est plus sur le plateau.'; break; }
      if (c.op === 'rotate') { if (c.axis === 'z' && Math.abs(c.amount % 180) === 90) o.size_mm = [o.size_mm[1], o.size_mm[0], o.size_mm[2]]; }
      else if (c.op === 'lay_flat') { /* pose sur sa plus grande face : la taille vue de dessus ne change pas ici */ }
      else if (c.op === 'set_copies') o.copies = Math.max(1, Math.min(50, Math.round(Number(c.amount) || 1)));
      else if (c.op === 'scale') {
        const f = Math.max(1, Math.min(1000, Number(c.amount) || 100)) / 100;
        if (o.size_mm.some((x) => x * f > 2000)) { failure = 'La pièce dépasserait 2 m : ordre ignoré.'; break; }
        o.size_mm = o.size_mm.map((x) => Math.round(x * f * 100) / 100);
        o.scale_pct = Math.round((o.scale_pct || 100) * f);
      } else if (c.op === 'delete') S.plate.objects = S.plate.objects.filter((x) => x !== o);
      else if (c.op === 'select') S.plate.selected = o.ref;
      else { failure = 'Ordre inconnu : « ' + c.op + ' ».'; break; }
      done.push(c.summary || '');
    }
    if (failure) {
      S.plate.objects = before;
      if (done.length) failure += ' Rien n\'a été modifié sur le plateau.';
      S.refusals.push({ type: 'commands', text: failure });
      return { ok: false, done: [], text: failure, skipped: [] };
    }
    S.plateBefore = before;
    const token = takeSnapshot();
    invalidate();
    return { ok: true, done, text: '', skipped: [], undo_token: token };
  }
  function plateRun(kind) {
    if (!S.plate.objects.length) return refuse('plate_action', TEXTS.plate_empty);
    if (S.jobBusy) return refuse('plate_action', TEXTS.plate_busy, { reason: 'busy' });
    const one = S.plate.objects.length === 1;
    if (kind === 'orient' || kind === 'arrange') {
      S.plateBefore = clone(S.plate.objects);
      invalidate();
      return { ok: true, text: kind === 'orient' ? (one ? 'J\'oriente ta pièce au mieux.' : 'J\'oriente tes pièces au mieux.') : (one ? 'Je place la pièce sur le plateau.' : 'Je range les pièces sur le plateau.'), undo_token: takeSnapshot() };
    }
    if (kind === 'scale_to_fit') {
      const b = bed();
      if (plateSizes().every((s) => fits(s, b))) return refuse('plate_action', one ? 'La pièce tient déjà sur le plateau : rien à réduire.' : 'Les pièces de cette plaque tiennent déjà : rien à réduire.');
      S.plateBefore = clone(S.plate.objects);
      S.plate.objects.forEach((o) => {
        if (fits(o.size_mm, b)) return;
        const k = Math.min(b[0] / Math.max(o.size_mm[0], o.size_mm[1]), b[1] / Math.min(o.size_mm[0], o.size_mm[1]), b[2] / o.size_mm[2]) * 0.98;
        o.size_mm = o.size_mm.map((x) => Math.floor(x * k * 10) / 10);
        o.scale_pct = Math.round((o.scale_pct || 100) * k);
      });
      invalidate();
      return { ok: true, text: one ? 'J\'ai réduit la pièce pour qu\'elle tienne sur le plateau.' : 'J\'ai réduit les pièces de cette plaque pour qu\'elles tiennent.', undo_token: takeSnapshot() };
    }
    if (kind === 'slice') {
      const b = bed();
      const big = S.plate.objects.find((o) => !fits(o.size_mm, b));
      if (big) return refuse('plate_action', '« ' + big.name + ' » ne tient pas sur le plateau : je ne lance pas la découpe.', { reason: 'too_big', name: big.name, count: S.plate.objects.length, size_mm: big.size_mm, bed_mm: b, fits: false });
      if (cfg.sliceRefused) return refuse('plate_action', TEXTS.orca_refused, { reason: 'orca_refused', issues: clone(cfg.sliceRefused) });
      S.slicing = true;
      later(() => {
        S.slicing = false;
        if (cfg.sliceError) { emit({ type: 'slice_result', status: 'error', issues: clone(cfg.sliceError) }); return; }
        S.sliced = true;
        emit({ type: 'slice_result', status: 'ok', issues: clone(cfg.sliceWarnings || []), ready_for_print: !cfg.notReady });
        emit(signals());
      }, 40);
      return { ok: true, text: 'Je découpe la plaque : le temps d\'impression s\'affichera dans l\'aperçu.' };
    }
    return refuse('plate_action', 'Action inconnue.');
  }
  function plateUndo(token) {
    if (S.jobBusy) return refuse('plate_action', TEXTS.undo_wait);
    const last = S.snapshots[S.snapshots.length - 1];
    if (!last || last.time !== token) return refuse('plate_action', TEXTS.undo_changed);
    S.snapshots.pop();
    S.plate.objects = clone(last.before) || [];
    invalidate();
    return { ok: true, text: 'C\'est annulé.' };
  }
  function addModel(name, size, data) {
    const replace = !!data.replace;
    const replaced = replace ? S.plate.objects.length : 0;
    const before = clone(S.plate.objects);
    if (replace) S.plate.objects = [];
    const ref = String(S.plate.nextRef++);
    S.plate.objects.push({ ref, name, size_mm: size.slice(), copies: 1, scale_pct: 100, plate: 1 });
    S.plateBefore = before;
    const token = takeSnapshot();
    invalidate();
    const b = bed();
    const out = { ok: true, name, count: 1, size_mm: size.slice(), bed_mm: b.slice(), fits: fits(size, b) };
    if (replaced) Object.assign(out, { replaced, replaced_name: before[0].name, undo_token: token });
    return out;
  }

  // ---------- Envoi et suivi ----------
  function startPrint(data) {
    if (!S.sliced) { emit({ type: 'print_started', ok: false, reason: 'not_sliced' }); return; }
    if (cfg.notReady) { emit({ type: 'print_started', ok: false, reason: 'not_ready', issues: clone(cfg.notReadyIssues || []) }); return; }
    if (S.sendBusy) { emit({ type: 'print_started', ok: false, reason: 'busy', text: 'Un envoi est déjà en préparation : attends sa réponse.' }); return; }
    const p = printerOf(S.orca.printer);
    if (cfg.send === 'device') { emit({ type: 'print_started', ok: true, route: 'device' }); return; }
    emit({ type: 'print_send_waiting' });
    if (cfg.send === 'refused' || !(p && p.linked)) {
      S.sendBusy = true;
      later(() => { S.sendBusy = false; emit({ type: 'print_started', ok: false, reason: 'refused', failure: { code: 'before_send', step: 'connect', http: 0, text: 'Connection to printer failed' } }); }, 20);
      return;
    }
    later(() => {
      emit({ type: 'print_started', ok: true, route: 'host' });
      S.watch = { id: data.watch_id || '', preset: data.preset || '' };
      later(() => emit({ type: 'print_upload', phase: 'progress', percent: 40, job: 1 }), 10);
      if (cfg.send === 'unreachable') {
        later(() => emit({ type: 'print_upload', phase: 'failed', job: 1, failure: { code: 'unreachable', step: 'connect', http: 0, host_type: 'moonraker', text: 'Could not connect to 192.168.1.31' } }), 30);
        return;
      }
      later(() => emit({ type: 'print_upload', phase: 'arrived', job: 1 }), 30);
      if (data.preset) later(() => emit({ type: 'print_watch', id: S.watch.id, verdict: cfg.watchVerdict || 'started', file: 'piece.gcode' }), 50);
    }, 15);
  }

  // ---------- Messages ----------
  function handle(m) {
    const t = m.type;
    S.log.push(t);
    if ((cfg.deny || {})[t]) { emit(Object.assign({ type: t }, cfg.deny[t])); return; }
    switch (t) {
      case 'ready':
        emit({ type: 'status', text: 'Connecté au slicer.' });
        emit({ type: 'dictation', available: true, platform: 'mac' });
        emit(values());
        return;
      case 'get_values': emit(values()); return;
      case 'session_load': emit({ type: 'session', session: S.session }); return;
      case 'session_save': S.session = m.session; emit({ type: 'session_saved', ok: true }); return;
      case 'session_clear': S.session = null; emit({ type: 'session', session: null }); return;
      case 'login': S.session = cfg.loginSession || { access_token: 'a', refresh_token: 'r', expires_at: 9999999999, email: 'moi@exemple.fr' }; emit({ type: 'session', session: S.session }); return;
      case 'habits_get': emit({ type: 'habits', habits: clone(S.habits) }); return;
      case 'habits_set': S.habits = clone(m.habits || {}); return;
      case 'firststeps_state': emit({ type: 'firststeps', state: Object.assign({ needs_printer: !S.printers.length }, S.firststeps) }); return;
      case 'firststeps_set': Object.assign(S.firststeps, m.patch || {}); if (m.patch && m.patch.ui) { S.reopened = m.patch.ui; return; } emit({ type: 'firststeps', state: clone(S.firststeps) }); return;
      case 'tour_signals': emit(signals()); return;
      case 'calib_history': emit({ type: 'calib_history', items: [] }); return;
      case 'ai_context':
        emit({ type: 'ai_context', plate: { objects: clone(S.plate.objects.map((o) => Object.assign({}, o, o.ref === S.plate.selected ? { selected: true } : {}))), bed_mm: bed(), sliced: S.sliced, issues: [] },
          memory: [], limits: {}, snapshot: {}, context: { printer: S.orca.printer, filament: S.orca.filament } });
        return;
      case 'project_resume_get': {
        const c = S.attached ? S.convs[S.attached] : null;
        emit({ type: 'project_resume', attached: c ? S.attached : '', conversation: c ? clone(c) : null, items: list() });
        return;
      }
      case 'conv_list': emit({ type: 'conv_list', items: list() }); return;
      case 'conv_load': emit({ type: 'conv_loaded', id: m.id, conversation: S.convs[m.id] ? clone(S.convs[m.id]) : null }); return;
      case 'conv_save': S.convs[m.id] = clone(m.conversation); return;
      case 'conv_delete': delete S.convs[m.id]; emit({ type: 'conv_list', items: list() }); return;
      case 'project_attach':
        if (S.editsBlocked) { emit({ type: 'project_attach_refused', conv: m.conv, text: TEXTS.busy }); return; }
        S.attached = m.conv; emit({ type: 'project_attached', conv: m.conv }); return;
      case 'project_detach': S.attached = ''; return;
      case 'project_open': {
        const c = S.convs[m.conv];
        if (S.editsBlocked) emit({ type: 'project_opened', conv: m.conv, ok: false, reason: 'occupe' });
        else if (!c || !c.plate) emit({ type: 'project_opened', conv: m.conv, ok: false, reason: 'absent' });
        else { S.plate.objects = clone(c.plate); S.attached = m.conv; invalidate(); emit({ type: 'project_opened', conv: m.conv, ok: true }); }
        emit(values());
        return;
      }
      case 'gallery_get': emit({ type: 'gallery', items: [] }); return;
      case 'model_add': {
        if (S.editsBlocked) { emit({ type: 'model_added', ok: false, busy: true, text: TEXTS.busy }); return; }
        if (m.conv) S.attached = m.conv;
        let out;
        if (m.sample) {
          const g = SAMPLES[m.sample];
          out = g ? addModel(g.name, g.size, m) : refuse('model_add', 'Je ne trouve pas cette pièce dans les fichiers de Plyo.');
          out.sample = m.sample;
        } else {
          const ext = String(m.name || '').toLowerCase().split('.').pop();
          if (['stl', '3mf', 'obj', 'step', 'stp', 'amf'].indexOf(ext) < 0) out = refuse('model_add', 'Ce type de fichier n\'est pas un modèle 3D (STL, 3MF, OBJ, STEP ou AMF).');
          else out = addModel(String(m.name).replace(/\.[a-z0-9]+$/i, ''), (cfg.modelSize || [40, 30, 30]).slice(), m);
        }
        out.type = 'model_added';
        emit(out);
        return;
      }
      case 'commands': {
        const byUser = !!m.by_user && Array.isArray(m.commands) && m.commands.length > 0 && m.commands.every((c) => c && USER_OPS.indexOf(c.op) >= 0);
        const refused = !byUser ? projectRefusal(m) : S.editsBlocked ? refuse('commands', TEXTS.busy) : null;
        const done = refused || runCommands(m.commands);
        emit(Object.assign({ type: 'commands', request: m.request || 0 }, done));
        return;
      }
      case 'plate_action': {
        const out = m.kind === 'undo' ? plateUndo(m.undo_token) : plateRun(m.kind);
        emit(Object.assign({ type: 'plate_action', kind: m.kind, request: m.request || 0 }, out));
        return;
      }
      case 'open_tool': {
        // Commands::open_tool : la pièce `object` (choisie dans le panneau), sinon la sélection, sinon la seule du plateau.
        const o = targetOf(m.object || '');
        emit(o === 'gone' ? Object.assign({ type: 'open_tool' }, refuse('open_tool', 'Cette pièce n\'est plus sur le plateau.'))
          : o ? { type: 'open_tool', ok: true, text: 'J\'ai ouvert l\'outil « ' + (m.tool === 'cut' ? 'Couper' : m.tool) + ' » sur « ' + o.name + ' ».' } : Object.assign({ type: 'open_tool' }, refuse('open_tool', TEXTS.tool_which)));
        return;
      }
      case 'apply': {
        const result = (() => {
          if (S.editsBlocked) return refuse('apply', TEXTS.busy);
          const r = projectRefusal(m);
          if (r) return r;
          const same = (!m.printer_name || m.printer_name === S.orca.printer) && (!m.print_name || m.print_name === S.orca.process) && (!m.filament_name || m.filament_name === S.orca.filament);
          if (!same) return refuse('apply', TEXTS.stale_profiles);
          const before = clone(S.settings);
          (m.changes || []).forEach((c) => { const k = c.key || c.id; if (k in S.settings) S.settings[k] = c.value; });
          const id = S.nextUndo++;
          S.undo.push({ id, before });
          invalidate();
          later(() => emit(values()), 8);
          return { ok: true, text: 'Réglages appliqués.', undo_id: id, applied: (m.changes || []).map((c) => ({ id: c.key || c.id, before: null, after: c.value })) };
        })();
        emit(Object.assign({ type: 'result', request: m.request || 0 }, result));
        return;
      }
      case 'undo': {
        const i = m.undo_id ? S.undo.findIndex((u) => u.id === m.undo_id) : S.undo.length - 1;
        const out = i < 0 ? refuse('undo', 'Rien à annuler.') : (S.settings = S.undo[i].before, S.undo.splice(i, 1), invalidate(), { ok: true, text: 'Réglages d\'avant remis.', undo_id: m.undo_id || 0 });
        emit(Object.assign({ type: 'result', request: m.request || 0 }, out));
        return;
      }
      case 'manual_edits_get': emit({ type: 'manual_edits', items: [] }); return;
      case 'preflight': {
        const objs = S.plate.objects.map((o) => ({ name: o.name, height: o.size_mm[2], contact_mm2: 20, foot: [o.size_mm[0], o.size_mm[1]], needs_support: !cfg.noSupportNeeded, fits: fits(o.size_mm, bed()) }));
        emit({ type: 'preflight', data: { sliced: S.sliced, settings: clone(S.settings), objects: objs } });
        return;
      }
      case 'orca_issues': emit({ type: 'orca_issues', purpose: m.purpose || '', issues: clone(cfg.orcaIssues || []), busy: false, pending: false }); return;
      case 'project_state': emit(Object.assign({ type: 'project_state' }, projectState())); return;
      case 'project_printers': emit({ type: 'project_printers', printers: clone(S.printers.map((p) => ({ preset: p.preset, name: p.name, linked: p.linked, host: p.host, slots: p.slots, bed_mm: p.bed_mm }))) }); return;
      case 'project_reachable': { const p = printerOf(m.preset); later(() => emit({ type: 'project_reachable', preset: m.preset, ok: !!(p && p.linked && cfg.send !== 'unreachable') }), 10); return; }
      case 'printer_select_profile': {
        const p = printerOf(m.name);
        if (!p) { emit({ type: 'printer_profile_selected', ok: false }); return; }
        if (S.orca.printer !== p.preset) { S.orca.printer = p.preset; S.orca.filament = 'Generic PLA @' + short(p.preset); configChanged(); }
        emit({ type: 'printer_profile_selected', ok: true });
        return;
      }
      case 'project_restore': {
        const pr = m.project || {};
        const todo = missing(pr);
        let out;
        if (todo.indexOf('printer') >= 0) out = refuse('project_restore', TEXTS.restore_no_printer);
        else if (!printerOf(pr.printer.preset)) out = refuse('project_restore', 'L\'imprimante de ce projet n\'existe plus dans Plyo Slicer. Choisis-en une dans la fiche.');
        else {
          S.orca.printer = pr.printer.preset;
          if (todo.indexOf('filament') < 0) S.orca.filament = pr.filament.preset;
          configChanged();
          out = { ok: true, text: todo.indexOf('filament') < 0 ? 'Projet remis dans Plyo Slicer.' : 'Machine du projet remise dans Plyo Slicer.' };
        }
        emit(Object.assign({ type: 'project_restored' }, out));
        emit(values());
        return;
      }
      case 'printer_scan': later(() => emit({ type: 'printer_scan_result', printers: clone(S.found) }), 20); return;
      case 'setup_catalog': emit({ type: 'setup_catalog', catalog: clone(CATALOG) }); return;
      case 'setup_install': {
        const c = CATALOG.find((x) => x.model === m.model);
        if (!c) { emit({ type: 'setup_installed', ok: false }); return; }
        const preset = m.model + ' ' + m.nozzle + ' nozzle';
        const f = S.found.find((x) => x.match && x.match.model === m.model);
        if (!printerOf(preset)) S.printers.push({ preset, name: preset, linked: false, host: '', bed_mm: c.bed_mm, vendor: c.vendor, model: c.model, nozzles: c.nozzles, ip: f ? f.ip : '' });
        S.orca.printer = preset; S.orca.filament = 'Generic PLA @' + short(preset);
        configChanged();
        emit({ type: 'setup_installed', ok: true, preset });
        emit(values());
        return;
      }
      case 'printer_link_check': {
        const p = printerOf(S.orca.printer);
        emit({ type: 'printer_link_state', ok: true, current: S.orca.printer, matches: true, linked: !!(p && p.linked && m.printer && p.host === m.printer.ip), candidates: [] });
        return;
      }
      case 'printer_link_test': later(() => emit({ type: 'printer_link_tested', ok: true, webui: '' }), 10); return;
      case 'printer_link_save': {
        const p = printerOf(S.orca.printer);
        if (p) { p.linked = true; p.host = (m.printer && m.printer.ip) || '192.168.1.50'; }
        emit({ type: 'printer_link_saved', ok: true, profile: S.orca.printer });
        return;
      }
      case 'printer_link_recheck': later(() => emit({ type: 'printer_link_rechecked', code: cfg.send === 'unreachable' ? 'unreachable' : 'ok', http: 0, text: '' }), 10); return;
      case 'spools_get': emit({ type: 'spools', items: clone(S.spools[m.printer] || []) }); return;
      case 'brands_get': {
        const current = m.printer === S.orca.printer;
        emit({ type: 'brands', material: m.material, printer: m.printer, ok: current, brands: current ? [{ brand: 'Sunlu', ranges: [{ preset: 'Sunlu PLA', label: 'Sunlu PLA', short: 'PLA' }] }] : [] });
        return;
      }
      case 'spool_choose': {
        let out;
        if (S.editsBlocked) out = refuse('spool_choose', TEXTS.busy);
        else if (!m.printer || m.printer !== S.orca.printer) out = refuse('spool_choose', TEXTS.spool_printer);
        else {
          const listFor = S.spools[m.printer] = S.spools[m.printer] || [];
          let sp = listFor.find((x) => x.name.toLowerCase() === String(m.name).toLowerCase());
          const created = !sp;
          if (!sp) { sp = { id: 'sp-' + (listFor.length + 1), name: m.name, material: m.material, preset: m.name + ' @' + short(m.printer) }; listFor.push(sp); }
          S.orca.filament = sp.preset;
          configChanged();
          out = { ok: true, id: sp.id, name: sp.name, created, preset: sp.preset, printer: m.printer, preset_created: created, print_restored: null, success: { available: false } };
        }
        emit(Object.assign({ type: 'spool_chosen' }, out));
        emit(values());
        return;
      }
      case 'canvas_read': emit(Object.assign({ type: 'canvas_state', preset: m.preset, send: !!m.send, id: m.id || 0 }, clone(cfg.canvas || { ok: false, reason: 'no_canvas' }))); return;
      case 'colours_get': emit({ type: 'colours', id: m.id || 0, ok: true, pieces: S.plate.objects.map((o) => ({ ref: o.ref, name: o.name, t: 0 })), colours: [{ t: 0, color: '#FFFFFF' }] }); return;
      case 'slots_manual_get': emit({ type: 'slots_manual_state', preset: m.preset, ok: false, colours: [] }); return;
      case 'bed_type_set': {
        const before = S.orca.bed;
        const out = S.editsBlocked ? refuse('bed_type_set', TEXTS.busy) : (S.orca.bed = m.value, configChanged(), { ok: true, value: m.value, before, changed: before !== m.value });
        emit(Object.assign({ type: 'bed_type_set', token: m.token || 0 }, out));
        emit(values());
        return;
      }
      case 'model_adapt': emit({ type: 'model_adapted', adaptation: {} }); return;
      case 'print_start':
        if (m.export) {
          if (!S.sliced) { emit({ type: 'print_started', ok: false, reason: 'not_sliced', export: true }); return; }
          later(() => emit({ type: 'print_started', ok: true, export: true, folder: '/Users/moi/Desktop', file: 'piece.gcode' }), 15);
          return;
        }
        startPrint(m);
        return;
      case 'print_declared': case 'outcome_printed': case 'journal_add': case 'retouches_dismiss': case 'model_learned': case 'canvas_plan':
      case 'dictation_stop': case 'print_watch_start':
        if (t === 'journal_add') S.journal.push(clone(m));
        return;
      case 'print_watch_replay': return;
      case 'outcome_result': emit({ type: 'outcome_result_done', conv: m.conv, outcome: m.outcome, items: [], reliable: false }); return;
      case 'outcome_set': emit({ type: 'outcome_saved', ok: true }); return;
      case 'outcome_pending': emit({ type: 'outcome_pending', items: [] }); return;
      case 'spool_success': emit({ type: 'spool_success_done', ok: true, name: 'ta bobine' }); return;
      case 'spool_failure': emit({ type: 'spool_failure_done', ok: true }); return;
      case 'journal_list': emit({ type: 'journal', events: clone(S.journal), projects: Object.keys(S.convs) }); return;
      case 'show_setting': emit({ type: 'show_setting', key: m.key, ok: true }); return;
      case 'show_preview': emit({ type: 'show_preview', request: m.request || 0, ok: S.sliced, text: S.sliced ? '' : 'Découpe d\'abord la plaque.' }); return;
      case 'show_me': emit({ type: 'show_me', target: m.target, ok: true }); return;
      case 'explain': emit({ type: 'explain', key: m.key, label: m.key, value: 1, unit: '', min: 0, max: 5 }); return;
      case 'spool_adopt_check': emit({ type: 'spool_adopt_offer', ok: false }); return;
      case 'spool_about_current': emit({ type: 'spool_current', ok: false }); return;
      case 'retouches_get': emit({ type: 'print_retouches', pending: [] }); return;
      case 'file_filament_get': emit({ type: 'file_filament', info: null }); return;
      case 'reliable_get': emit({ type: 'reliable', ok: false }); return;
      case 'slot_brands_get': emit({ type: 'slot_brands', printer: m.printer, id: m.id || 0, items: [] }); return;
      case 'calib_start': emit({ type: 'calib_started', request: m.request || 0, ok: true, test: m.test, pass: 1, instructions: 'Imprime-la.', sections: [{ index: 0, label: '215 °C', value: 215 }] }); return;
      case 'dictation_start': emit({ type: 'dictation', available: true, platform: 'mac', started: true }); return;
      case 'phone': return;
      default: S.unknown.push(t);
    }
  }
  function list() {
    return Object.keys(S.convs).map((id) => ({ id, title: S.convs[id].title || '', updated: S.convs[id].updated || '', project: clone(S.convs[id].project) }));
  }

  const sim = {
    S,
    // Le pont : (message posté, emit) → réponses, comme handle_page_message.
    bridge(m, e) { emit = e; handle(m); },
    setEmit(e) { emit = e; },
    // Ce que fait l'utilisateur dans Orca, hors du panneau.
    orcaSelectsPrinter(preset) { S.orca.printer = preset; S.orca.filament = 'Generic PLA @' + short(preset); configChanged(); },
    orcaSelectsFilament(preset) { S.orca.filament = preset; configChanged(); },
    busy(on) { S.editsBlocked = !!on; S.jobBusy = !!on; },
    finishPrint(verdict) { if (S.watch) emit({ type: 'print_watch', id: S.watch.id, phase: 'end', verdict: verdict || 'finished', file: 'piece.gcode' }); },
    select(ref) { S.plate.selected = ref ? String(ref) : null; },
  };
  return sim;
}
