// Logique pure des machines (imprimantes) et des habitudes de filament, sans DOM.
// Chargée par index.html (window.PlyoMachines) et testée par node (tests/machines-logic.test.mjs).
// Une « machine » = un regroupement des profils d'imprimante qui désignent la même imprimante reliée (PlyoJourney.groupPrinters).
// Habitudes : { machines: { [profil]: { filament: {type, nozzle_temp, bed_temp} } }, hidden: [profil], last: profil }.
(function (root) {
  var J = root.PlyoJourney || (typeof require !== 'undefined' ? require('./journey-logic.js') : null);

  function emptyHabits() { return { machines: {}, hidden: [], last: '' }; }
  function clone(h) {
    var src = h && typeof h === 'object' ? h : {};
    return { machines: src.machines && typeof src.machines === 'object' && !Array.isArray(src.machines) ? JSON.parse(JSON.stringify(src.machines)) : {},
      hidden: Array.isArray(src.hidden) ? src.hidden.filter(function (x) { return typeof x === 'string'; }) : [], last: typeof src.last === 'string' ? src.last : '' };
  }

  // Que demander au début d'une impression ? `printers` : liste du slicer ; `ctx` : { orcaPreset, lastPreset, hidden }.
  // setup = aucune machine reliée ; auto = une seule (choisie sans question) ; confirm = plusieurs (confirmation en un toucher).
  function machineQuestion(printers, ctx) {
    var c = ctx || {}, hidden = c.hidden || [];
    var machines = J.groupPrinters(printers).main.filter(function (m) { return hidden.indexOf(m.preset) < 0; });
    if (!machines.length) return { mode: 'setup', machine: null };
    if (machines.length === 1) return { mode: 'auto', machine: machines[0] };
    var pick = function (preset) { return machines.filter(function (m) { return m.preset === preset; })[0]; };
    return { mode: 'confirm', machine: pick(c.orcaPreset) || pick(c.lastPreset) || machines[0] };
  }

  function habitFor(habits, preset) {
    var m = habits && habits.machines && typeof habits.machines === 'object' ? habits.machines[preset] : null;
    return m && m.filament && m.filament.type ? { type: m.filament.type, nozzle_temp: m.filament.nozzle_temp, bed_temp: m.filament.bed_temp } : null;
  }

  function rememberFilament(habits, preset, filament) {
    var h = clone(habits);
    if (!preset || !filament || !filament.type) return h;
    h.machines[preset] = { filament: { type: filament.type, nozzle_temp: filament.nozzle_temp, bed_temp: filament.bed_temp } };
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
  // `size` : [x, y, z] de la pièce ; un plateau accepte la pièce à plat, dans un sens ou dans l'autre.
  function machineThatFits(printers, currentPreset, size) {
    if (!Array.isArray(printers) || !Array.isArray(size)) return null;
    var fits = function (bed) { return Array.isArray(bed) && ((size[0] <= bed[0] && size[1] <= bed[1]) || (size[1] <= bed[0] && size[0] <= bed[1])); };
    var current = printers.filter(function (p) { return p.preset === currentPreset; })[0];
    if (current && fits(current.bed_mm)) return null;
    var found = printers.filter(function (p) { return p.preset !== currentPreset && p.linked && fits(p.bed_mm); })[0];
    return found ? { preset: found.preset, label: J.machineLabel(found) } : null;
  }

  var api = { machineThatFits: machineThatFits, visiblePrinters: visiblePrinters, isKnownHost: isKnownHost, machineQuestion: machineQuestion, habitFor: habitFor, rememberFilament: rememberFilament, replaceMachine: replaceMachine,
    hideMachine: hideMachine, unhideMachine: unhideMachine, emptyHabits: emptyHabits };
  root.PlyoMachines = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
