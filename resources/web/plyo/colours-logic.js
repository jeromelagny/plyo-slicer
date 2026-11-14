// Logique pure de la carte « Couleurs » (étape Filament) : quelle bobine imprime chaque pièce de la plaque, et les textes de la
// carte. L'état vient du slicer (message « colours », Plyo::Colours::state) : pièces [{ref, name, selected, t, mixed, parts, painted,
// splittable}] et couleurs utilisées. `trays` : PlyoCanvas.trays(état des emplacements) ; `canvas` : l'association en cours
// [{t, canvas_id, tray_id}]. « t » (la couleur du projet) ne sort jamais d'ici vers l'écran : on montre la bobine, en toutes lettres.
// Chargée par index.html (window.PlyoColours) et testée par node (tests/couleurs-lot20.test.mjs).
(function (root) {
  var C = root.PlyoCanvas || (typeof require === 'function' ? require('./canvas-logic.js') : null);

  var NO_SPOOL = 'pas encore de bobine';
  var MIXED = 'plusieurs couleurs';
  var PAINTED = 'Elle a des zones peintes : changer sa couleur garde sa peinture.';
  var INTRO = 'Touche une pièce pour la voir dans la vue 3D, puis « changer » pour choisir la bobine qui l’imprime.';

  function pieces(state) { return state && state.ok && Array.isArray(state.pieces) ? state.pieces : []; }
  function upper(s) { return String(s || '').trim().toUpperCase(); }
  function trayKey(t) { return t ? t.canvas_id + ':' + t.tray_id : ''; }

  // Couleurs que porte une pièce ou une partie (pas seulement ses zones peintes).
  function baseColours(list) {
    var out = {};
    list.forEach(function (p) {
      if (Array.isArray(p.parts) && p.parts.length) p.parts.forEach(function (q) { out[q.t] = true; });
      else out[p.t] = true;
    });
    return out;
  }
  // Plusieurs bobines, et quelque chose à colorier : plusieurs pièces, une pièce faite de parties, ou plusieurs couleurs. Une couleur
  // portée seulement par des zones peintes garde la carte d'une bobine par couleur (cette carte-ci ne change que la couleur des pièces).
  function wanted(state, trays) {
    var list = pieces(state), colours = state && Array.isArray(state.colours) ? state.colours : [];
    if (!list.length || !Array.isArray(trays) || trays.length < 2) return false;
    var base = baseColours(list);
    if (colours.some(function (c) { return !base[c.t]; })) return false;
    return list.length > 1 || list.some(function (p) { return Array.isArray(p.parts) && p.parts.length > 0; }) || colours.length > 1;
  }

  // La bobine associée à la couleur `t`, ou null.
  function trayFor(t, trays, canvas) {
    var e = (Array.isArray(canvas) ? canvas : []).filter(function (x) { return x && x.t === t && x.tray_id !== null && x.tray_id !== undefined; })[0];
    if (!e) return null;
    return (trays || []).filter(function (x) { return x.canvas_id === e.canvas_id && x.tray_id === e.tray_id; })[0] || null;
  }
  // « PLA bleu · 1B » : la matière, la couleur nommée par sa teinte, le numéro de l'emplacement.
  function spoolText(tray) { return tray ? C.trayText(tray.type, tray.color) + ' · ' + tray.slot : NO_SPOOL; }

  function pieceRows(state, trays, canvas) {
    var many = Array.isArray(trays) && trays.length > 1;
    return pieces(state).map(function (p) {
      var tray = p.mixed ? null : trayFor(p.t, trays, canvas);
      var parts = (Array.isArray(p.parts) ? p.parts : []).map(function (q) {
        var tq = trayFor(q.t, trays, canvas);
        return { ref: String(q.ref), name: q.name || 'Partie', tray: tq, text: spoolText(tq), canChange: many };
      });
      var painted = Array.isArray(p.painted) && p.painted.length > 0;
      return { ref: String(p.ref), name: p.name || 'Pièce', selected: !!p.selected, mixed: !!p.mixed, tray: tray,
        text: p.mixed ? MIXED : spoolText(tray), painted: painted, paintedText: painted ? PAINTED : '', parts: parts, canChange: !p.mixed && many };
    });
  }

  // L'association couvre-t-elle chaque couleur utilisée par la plaque ? (« Utiliser ces bobines »)
  function complete(colours, canvas, trays) {
    var list = Array.isArray(colours) ? colours : [];
    return list.length > 0 && list.every(function (c) { return !!trayFor(c.t, trays, canvas); });
  }

  function changedText(name, trayText) { return name + ' : maintenant en ' + trayText; }

  // Deux matières différentes (bobine d'avant, bobine choisie) : un avertissement simple, '' sinon.
  function otherMaterialNote(trayA, trayB) {
    if (!trayA || !trayB || !trayA.type || !trayB.type || upper(trayA.type) === upper(trayB.type)) return '';
    return 'Cette bobine est en ' + trayB.type + ', et l’autre en ' + trayA.type + ' : deux matières différentes collent mal entre elles. Choisis-la seulement si c’est voulu.';
  }

  // Le nom d'une couleur accordé à « bobine ».
  var FEMININE = { noir: 'noire', blanc: 'blanche', gris: 'grise', brun: 'brune', vert: 'verte', bleu: 'bleue', violet: 'violette' };
  function missingText(colourName) {
    var hint = 'charge-la dans un emplacement libre, règle-la sur l’écran de l’imprimante, puis touche « Vérifier à nouveau ».';
    if (!colourName) return 'Ta couleur n’est pas là ? Charge-la dans un emplacement libre, règle-la sur l’écran de l’imprimante, puis touche « Vérifier à nouveau ».';
    return 'Aucune bobine ' + (FEMININE[colourName] || colourName) + ' : ' + hint;
  }

  // L'association rendue par le slicer après un changement ([{t, canvas_id, tray_id}]), avec la couleur de chaque bobine, pour la
  // vue des emplacements (canvasUI.mapping).
  function mappingFrom(canvas, trays) {
    return (Array.isArray(canvas) ? canvas : []).filter(function (e) { return e && typeof e.t === 'number'; }).map(function (e) {
      var tray = (trays || []).filter(function (x) { return x.canvas_id === e.canvas_id && x.tray_id === e.tray_id; })[0];
      return { t: e.t, color: tray ? tray.color : '', canvas_id: e.canvas_id, tray_id: e.tray_id };
    });
  }

  // Bobines retrouvées dans l'association enregistrée du projet (fiche, quand les emplacements ne sont pas relus).
  function traysFromCanvas(canvas) {
    return (Array.isArray(canvas) ? canvas : []).filter(function (e) { return e && typeof e.tray_id === 'number'; }).map(function (e) {
      return { canvas_id: e.canvas_id, tray_id: e.tray_id, type: e.type || '', color: e.color || '', slot: C.slotName(e) };
    });
  }

  // Ligne « Couleurs » de la fiche du projet : '' sans association choisie ou sans rien à colorier.
  function ficheText(state, trays, canvas) {
    var list = pieces(state);
    if (!Array.isArray(canvas) || !canvas.length || !list.length) return '';
    var worth = list.length > 1 || list.some(function (p) { return Array.isArray(p.parts) && p.parts.length > 0; }) || (Array.isArray(state.colours) && state.colours.length > 1);
    if (!worth) return '';
    var rows = pieceRows(state, trays, canvas);
    if (rows.length > 3) return 'Couleurs : ' + rows.length + ' pièces';
    return 'Couleurs : ' + rows.map(function (r) { return r.name + ' en ' + r.text; }).join(', ');
  }

  var api = { NO_SPOOL: NO_SPOOL, MIXED: MIXED, PAINTED: PAINTED, INTRO: INTRO, wanted: wanted, pieceRows: pieceRows, complete: complete, changedText: changedText,
    otherMaterialNote: otherMaterialNote, missingText: missingText, spoolText: spoolText, trayFor: trayFor, trayKey: trayKey, mappingFrom: mappingFrom,
    traysFromCanvas: traysFromCanvas, ficheText: ficheText };
  root.PlyoColours = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
