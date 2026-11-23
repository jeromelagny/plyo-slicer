// Logique pure de l'étape « Machine et bobine » (sans DOM), partagée par le panneau classique (index.html) et la v2
// (v2/materiel.js) : quand lire les emplacements (Canvas, CFS, IFS, U1, saisie manuelle), quel écran d'emplacements montrer,
// quelle association couleur → emplacement proposer, et les matières proposées pour une nouvelle bobine.
// Chargée par les deux pages (window.PlyoMateriel) et testée par node (tests/materiel-logic.test.mjs).
(function (root) {
  var C = root.PlyoCanvas || (typeof require === 'function' ? require('./canvas-logic.js') : null);
  var Col = root.PlyoColours || (typeof require === 'function' ? require('./colours-logic.js') : null);

  // Matières d'une nouvelle bobine, dans l'ordre montré (PLA d'abord, présélectionné) ; `words` : un mot sur chacune.
  var MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];
  var MATERIAL_HELP = {
    PLA: 'Le plus courant et le plus facile.',
    PETG: 'Plus solide, supporte mieux la chaleur.',
    ABS: 'Résiste à la chaleur, demande une imprimante fermée.',
    ASA: 'Pour l’extérieur : résiste au soleil.',
    TPU: 'Souple, comme du caoutchouc.'
  };
  function materialHelp(type) { return MATERIAL_HELP[type] || ''; }

  // La machine du projet dans la liste du slicer (project_printers), ou null.
  function knownPrinter(printers, preset) {
    if (!preset || !Array.isArray(printers)) return null;
    return printers.filter(function (p) { return p && p.preset === preset; })[0] || null;
  }
  // Lire les emplacements sur la machine : seulement pour une machine reliée qu'on sait lire (`slots` : son traducteur),
  // à l'étape de la bobine (ou quand on la change).
  function slotsWanted(known, wantsFilament) { return !!(known && known.slots && known.linked && wantsFilament); }
  // Saisie manuelle : une machine qu'on ne sait pas lire, ou un CFS, IFS, U1 injoignable à la lecture. La CC2 garde sa liste.
  // `read` : { loading, preset (machine de la dernière lecture), state }.
  function manualWanted(known, wantsFilament, read) {
    if (!known || !wantsFilament) return false;
    if (known.slots === 'canvas') return false;
    if (!known.slots || !known.linked) return true;
    var r = read || {};
    return !r.loading && r.preset === known.preset && !!r.state && !r.state.ok;
  }
  // L'état en cours : la lecture sur la machine si elle a réussi, sinon la saisie de cette machine, sinon la lecture ratée.
  // `read`, `manual` : { preset, state }.
  function slotState(preset, read, manual) {
    if (!preset) return null;
    var r = read && read.preset === preset ? read.state : null, m = manual || {};
    if (r && r.ok) return r;
    return m.preset === preset && m.state && m.state.ok ? m.state : r;
  }
  // Les couleurs de la plaque : celles relues par la carte « Couleurs » si elle en a, sinon celles de la lecture ; au moins une.
  function canvasColours(state, coloursState) {
    var fresh = coloursState, c = fresh && Array.isArray(fresh.colours) && fresh.colours.length ? fresh.colours : state && Array.isArray(state.colours) ? state.colours : [];
    return c.length ? c : [{ t: 0, color: '', type: '' }];
  }
  // Proposition couleur → emplacement. Déjà choisi pour ces couleurs (`chosen` : project.canvas) : on le reprend ; sinon, une
  // couleur prend le type du filament du projet (`filament`, s'il est choisi). Un emplacement vide refusé à l'envoi (CFS, IFS)
  // n'est pas proposé.
  function canvasProposal(colours, state, chosen, filament) {
    var st = state || {}, trays = C.trays(st);
    if (Array.isArray(chosen) && chosen.length === colours.length && colours.every(function (c) { return chosen.some(function (e) { return e.t === c.t; }); }))
      return chosen.map(function (e) { return { t: e.t, color: (colours.filter(function (c) { return c.t === e.t; })[0] || {}).color, canvas_id: e.canvas_id, tray_id: e.tray_id }; });
    var wanted = colours.length === 1 ? [{ t: colours[0].t, color: colours[0].color, type: filament && !filament.proposed ? filament.type : colours[0].type }] : colours;
    if (st.empty_blocks) trays = trays.filter(function (t) { return !t.empty; });
    return C.propose(wanted, trays);
  }
  // Quel écran d'emplacements ? null (la liste des bobines), 'manual' (saisie ouverte), 'loading', 'recall' (rappel d'une saisie),
  // 'tooMany', 'colours' (carte « Couleurs »), 'multi' (un emplacement par couleur), 'single'.
  // o : { tempsPending, editing (« changer » la bobine), wantsFilament, manualForm, useList, wanted (slotsWanted), manualWanted,
  //       loading (lecture en cours), readFor (machine de la dernière lecture), preset (machine du projet), state (slotState),
  //       manualConfirmed, colours (canvasColours), coloursReady (carte « Couleurs » lue pour ce projet), coloursState,
  //       fileRows (nombre de couleurs du 3MF à associer) }.
  function canvasMode(o) {
    if (o.tempsPending && !o.editing) return null; // emplacement déjà choisi : on demande les températures
    if (o.manualForm && o.wantsFilament) return 'manual';
    if (o.useList) return null;
    if (o.wanted && (o.loading || o.readFor !== o.preset)) return 'loading';
    if (!o.wanted && !o.manualWanted) return null;
    var st = o.state;
    if (!st || !st.ok) return null;
    if (!C.askSlots(st)) return null; // un seul emplacement : aucune question
    if (st.source === 'manual' && !o.manualConfirmed) return 'recall';
    var trays = C.trays(st), colours = o.colours || [];
    if (C.tooMany(colours, trays)) return 'tooMany';
    // Plusieurs pièces, une pièce en parties ou plusieurs couleurs : la carte « Couleurs », une ligne par pièce (lot 20).
    if (!o.coloursReady) return 'loading'; // une lecture, sans réseau : la réponse suit tout de suite
    if (Col.wanted(o.coloursState, trays) || o.fileRows > 0) return 'colours';
    return colours.length > 1 ? 'multi' : 'single';
  }

  // Température écrite sur l'étiquette : « 205 », « 205 °C » ou une fourchette « 190-220 » (le milieu, arrondi à 5 °C) ; null
  // si illisible.
  function labelTemp(text) {
    var nums = String(text == null ? '' : text).match(/\d+/g);
    if (!nums) return null;
    var a = +nums[0], b = nums.length > 1 ? +nums[1] : a;
    return Math.round((a + b) / 2 / 5) * 5;
  }
  // Les changements à appliquer pour les températures de l'étiquette (buse, plateau, et leur première couche) ; [] si rien.
  function tempChanges(nozzle, bed) {
    var n = labelTemp(nozzle), b = labelTemp(bed), out = [];
    if (n !== null) out.push({ id: 'nozzle_temp', value: n }, { id: 'nozzle_temp_initial', value: n });
    if (b !== null) out.push({ id: 'bed_temp', value: b }, { id: 'bed_temp_initial', value: b });
    return out;
  }

  var api = { labelTemp: labelTemp, tempChanges: tempChanges, MATERIALS: MATERIALS, materialHelp: materialHelp, knownPrinter: knownPrinter, slotsWanted: slotsWanted, manualWanted: manualWanted, slotState: slotState,
    canvasColours: canvasColours, canvasProposal: canvasProposal, canvasMode: canvasMode };
  root.PlyoMateriel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
