// Logique pure des machines (imprimantes) et des habitudes de filament, sans DOM.
// Chargée par index.html (window.PlyoMachines) et testée par node (tests/machines-logic.test.mjs).
// Une « machine » = un regroupement des profils d'imprimante qui désignent la même imprimante reliée (PlyoJourney.groupPrinters).
// Habitudes : { machines: { [profil]: { filament: {type, nozzle_temp, bed_temp} } }, hidden: [profil], last: profil }.
(function (root) {
  var J = root.PlyoJourney || (typeof require !== 'undefined' ? require('./journey-logic.js') : null);

  function emptyHabits() { return { machines: {}, hidden: [], last: '', intent_skips: 0 }; }
  function clone(h) {
    var src = h && typeof h === 'object' ? h : {};
    var out = { machines: src.machines && typeof src.machines === 'object' && !Array.isArray(src.machines) ? JSON.parse(JSON.stringify(src.machines)) : {},
      hidden: Array.isArray(src.hidden) ? src.hidden.filter(function (x) { return typeof x === 'string'; }) : [], last: typeof src.last === 'string' ? src.last : '' };
    if (src.level === 'short' || src.level === 'detailed') out.level = src.level;
    if (src.level_manual === true) out.level_manual = true;
    if (src.level_hold === true) out.level_hold = true;
    out.intent_skips = typeof src.intent_skips === 'number' ? src.intent_skips : 0;
    if (src.ask_intent === false) out.ask_intent = false;
    return out;
  }

  // Que demander au début d'une impression ? `printers` : liste du slicer ; `ctx` : { orcaPreset, lastPreset, hidden }.
  // setup = rien de reconnu (aucune reliée, et zéro ou plusieurs non reliées : la liste répond) ; auto = une seule (choisie sans
  // question, `changer` reste dans la fiche), reliée ou non ; confirm = plusieurs reliées (confirmation en un toucher).
  function machineQuestion(printers, ctx) {
    var c = ctx || {}, hidden = c.hidden || [], visible = function (m) { return hidden.indexOf(m.preset) < 0; };
    var groups = J.groupPrinters(printers), machines = groups.main.filter(visible);
    if (!machines.length) {
      var others = groups.others.filter(visible);
      return others.length === 1 ? { mode: 'auto', machine: others[0] } : { mode: 'setup', machine: null };
    }
    if (machines.length === 1) return { mode: 'auto', machine: machines[0] };
    var pick = function (preset) { return machines.filter(function (m) { return m.preset === preset; })[0]; };
    return { mode: 'confirm', machine: pick(c.orcaPreset) || pick(c.lastPreset) || machines[0] };
  }

  function habitFor(habits, preset) {
    var m = habits && habits.machines && typeof habits.machines === 'object' ? habits.machines[preset] : null;
    return m && m.filament && m.filament.type ? { type: m.filament.type, nozzle_temp: m.filament.nozzle_temp, bed_temp: m.filament.bed_temp, spool: typeof m.filament.spool === 'string' ? m.filament.spool : '' } : null;
  }

  function rememberFilament(habits, preset, filament) {
    var h = clone(habits);
    if (!preset || !filament || !filament.type) return h;
    h.machines[preset] = { filament: { type: filament.type, nozzle_temp: filament.nozzle_temp, bed_temp: filament.bed_temp } };
    if (filament.spool && typeof filament.spool.name === 'string' && filament.spool.name) h.machines[preset].filament.spool = filament.spool.name.slice(0, 60);
    h.last = preset;
    return h;
  }

  // Une machine en remplace une autre : elle reprend ses habitudes de filament ; l'ancienne reste intacte.
  function replaceMachine(habits, from, to) {
    var h = clone(habits), f = habitFor(h, from);
    if (!f || !to) return h;
    h.machines[to] = { filament: f };
    return h;
  }
  function hideMachine(habits, preset) { var h = clone(habits); if (preset && h.hidden.indexOf(preset) < 0) h.hidden.push(preset); return h; }
  function unhideMachine(habits, preset) { var h = clone(habits); h.hidden = h.hidden.filter(function (x) { return x !== preset; }); return h; }

  // La liste sans les machines masquées (tous les profils d'une machine masquée disparaissent ; rien n'est supprimé dans Orca).
  function visiblePrinters(printers, hidden) {
    var list = Array.isArray(printers) ? printers : [], hide = hidden || [];
    var hiddenLabels = J.groupPrinters(list).main.filter(function (m) { return hide.indexOf(m.preset) >= 0; }).map(function (m) { return m.label.toLowerCase(); });
    return list.filter(function (p) { return hiddenLabels.indexOf(J.machineLabel(p).toLowerCase()) < 0; });
  }

  // Une machine trouvée sur le réseau est-elle déjà dans la liste ? (adresse de connexion, avec ou sans port)
  function isKnownHost(printers, ip) {
    if (!ip || !Array.isArray(printers)) return false;
    return printers.some(function (p) { return p && p.host && String(p.host).split(':')[0] === ip; });
  }

  // Pièce trop grande pour la machine choisie : une autre machine reliée dont le plateau (mm) l'accepte, sinon null.
  // `size` : [x, y, z] de la pièce ; un plateau accepte la pièce à plat, dans un sens ou dans l'autre, et la hauteur si elle est connue.
  function machineThatFits(printers, currentPreset, size) {
    if (!Array.isArray(printers) || !Array.isArray(size)) return null;
    var fits = function (bed) { return Array.isArray(bed) && ((size[0] <= bed[0] && size[1] <= bed[1]) || (size[1] <= bed[0] && size[0] <= bed[1])) && !(bed[2] > 0 && size[2] > bed[2]); };
    var current = printers.filter(function (p) { return p.preset === currentPreset; })[0];
    if (current && fits(current.bed_mm)) return null;
    var found = printers.filter(function (p) { return p.preset !== currentPreset && p.linked && fits(p.bed_mm); })[0];
    return found ? { preset: found.preset, label: J.machineLabel(found) } : null;
  }

  // Niveau d'explication : « detailed » par défaut ; deviné tant que l'utilisateur ne l'a pas choisi lui-même.
  function levelOf(habits) { return habits && habits.level === 'short' ? 'short' : 'detailed'; }
  // Supposition (jamais au-dessus d'un choix fait à la main dans le menu) : « short » quand le vocabulaire le montre ; retour à
  // « detailed » quand l'utilisateur demande ce qu'est un terme (`definition`), et alors plus de passage automatique en court
  // (`level_hold`) : son vocabulaire d'avant ne le ferait pas remonter au message suivant.
  function guessLevel(habits, level, definition) {
    var h = clone(habits);
    if (h.level_manual) return h;
    if (definition) { if (h.level === 'short') { h.level = 'detailed'; h.level_hold = true; } return h; }
    if (level === 'short' && !h.level_hold) h.level = 'short';
    return h;
  }
  // Ce que la supposition a changé, pour le dire : 'up' (passé en court), 'down' (revenu au détaillé), '' sinon.
  function levelChange(before, after) {
    var a = levelOf(before), b = levelOf(after);
    return a === b ? '' : b === 'short' ? 'up' : 'down';
  }
  function chooseLevel(habits, level) { var h = clone(habits); h.level = level === 'short' ? 'short' : 'detailed'; h.level_manual = true; delete h.level_hold; return h; }

  // Questions d'intention : passées (skipped = true) ou répondues ; après trois projets passés de suite, on propose d'arrêter.
  function askIntent(habits) { return !(habits && habits.ask_intent === false); }
  function noteIntent(habits, skipped) { var h = clone(habits); h.intent_skips = skipped ? Math.min(100, (h.intent_skips || 0) + 1) : 0; return h; }
  function offerStopAsking(habits) { return askIntent(habits) && !!habits && (habits.intent_skips || 0) >= 3; }
  function stopAsking(habits, stop) { var h = clone(habits); if (stop) h.ask_intent = false; else { delete h.ask_intent; h.intent_skips = 0; } return h; }

  // Recherche dans le catalogue d'Orca (modèles installables) : chaque mot doit apparaître. Une marque seule (« Creality »)
  // montre tous ses modèles, triés, pour qu'on retrouve le sien en faisant défiler ; sinon les 8 premiers résultats.
  function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\-_]+/g, ' '); }
  function searchModels(catalog, query) {
    var words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length || !Array.isArray(catalog)) return [];
    var found = catalog.filter(function (m) {
      var hay = fold(m.vendor + ' ' + m.model);
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    var brandOnly = words.length && fold(query).trim() && found.length && found.every(function (m) { return fold(m.vendor) === fold(query).trim(); });
    if (!brandOnly) return found.slice(0, 8);
    return found.slice().sort(function (a, b) { return a.model.localeCompare(b.model, 'fr', { numeric: true }); });
  }

  // Phrase dite quand une machine vient d'être reliée : ce que Plyo vérifiera après un envoi (PlyoPrinterStatus.cpp lit
  // l'état des Creality et des Klipper/Moonraker ; les autres connexions ne disent pas encore si l'impression a démarré).
  var WATCHED = ['crealityprint', 'moonraker'];
  function linkSummary(hostType) {
    return WATCHED.indexOf(hostType) >= 0 ? 'Après chaque envoi, je vérifie qu’elle démarre bien.'
      : 'Après un envoi, regarde son écran : je ne sais pas encore vérifier qu’elle démarre.';
  }

  var api = { levelOf: levelOf, guessLevel: guessLevel, levelChange: levelChange, chooseLevel: chooseLevel, askIntent: askIntent, noteIntent: noteIntent,
    offerStopAsking: offerStopAsking, stopAsking: stopAsking, machineThatFits: machineThatFits, visiblePrinters: visiblePrinters, isKnownHost: isKnownHost, machineQuestion: machineQuestion, habitFor: habitFor, rememberFilament: rememberFilament, replaceMachine: replaceMachine,
    hideMachine: hideMachine, unhideMachine: unhideMachine, emptyHabits: emptyHabits, searchModels: searchModels, linkSummary: linkSummary };
  root.PlyoMachines = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
