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

  // Nom technique (un nom de fichier : « 3DBenchy.drc », « boite.stl ») : la pièce porte plutôt un nom parlant.
  var FILE_EXT = /\.(stl|3mf|obj|step|stp|amf|drc|ply|gcode)$/i;
  function technical(name) { return FILE_EXT.test(String(name || '').trim()); }
  function tidy(name) {
    var s = String(name || '').trim().replace(FILE_EXT, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  // Le nom montré pour une pièce : le sien s'il est parlant ; sinon le nom de la pièce du projet (« Petit bateau de test
  // (3DBenchy) ») s'il désigne bien ce fichier, sinon le nom du fichier sans son extension.
  function pieceName(name, partName) {
    var n = String(name || '').trim();
    if (!n) return 'Pièce';
    if (!technical(n)) return n;
    var stem = n.replace(FILE_EXT, '');
    if (partName && !technical(partName) && stem && String(partName).toLowerCase().indexOf(stem.toLowerCase()) >= 0) return String(partName);
    return tidy(n) || 'Pièce';
  }
  // Le nom d'une partie dit-il quelque chose de plus que sa pièce ? Pas s'il la répète (« Pièce », « Pièce_2 », nommées ainsi par
  // le slicer) ou si c'est un nom de fichier.
  function partDetail(partName, pieceRawName) {
    var q = String(partName || '').trim(), p = String(pieceRawName || '').trim();
    if (!q || technical(q) || q === p || (p && q.indexOf(p + '_') === 0 && /^\d+$/.test(q.slice(p.length + 1)))) return '';
    return q;
  }

  // opts : { partName } (nom de la pièce du projet, pour une pièce au nom technique).
  function pieceRows(state, trays, canvas, opts) {
    var many = Array.isArray(trays) && trays.length > 1, o = opts || {};
    return pieces(state).map(function (p) {
      var tray = p.mixed ? null : trayFor(p.t, trays, canvas), name = pieceName(p.name, o.partName);
      // Les parties sont numérotées (« Partie 2 »), décalées sous leur pièce ; leur nom d'origine reste en petit quand il dit
      // quelque chose, et en infobulle.
      var parts = (Array.isArray(p.parts) ? p.parts : []).map(function (q, i) {
        var tq = trayFor(q.t, trays, canvas), detail = partDetail(q.name, p.name);
        return { ref: String(q.ref), label: 'Partie ' + (i + 1), detail: detail, title: q.name || '', name: detail || name + ', partie ' + (i + 1),
          tray: tq, text: spoolText(tq), canChange: many };
      });
      var painted = Array.isArray(p.painted) && p.painted.length > 0;
      return { ref: String(p.ref), name: name, title: p.name || '', selected: !!p.selected, mixed: !!p.mixed, tray: tray,
        text: p.mixed ? MIXED : spoolText(tray), painted: painted, paintedText: painted ? PAINTED : '', parts: parts, canChange: !p.mixed && many };
    });
  }

  // --- Lot 21 : un 3MF en couleurs ---

  // Une couleur du fichier (« #RRGGBB »), '' sinon.
  function fileColour(fileColours, t) {
    var c = Array.isArray(fileColours) ? fileColours[t] : '';
    return typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c) ? c.toUpperCase() : '';
  }
  // Une ligne par couleur du fichier que porte la plaque : sa teinte prévue, les pièces (ou parties) qui la portent, les zones
  // peintes, la bobine associée. [] si le fichier prévoit moins de deux couleurs sur cette plaque (la carte par pièce suffit).
  // opts : { partName }.
  function fileRows(state, fileColours, trays, canvas, opts) {
    var colours = state && state.ok && Array.isArray(state.colours) ? state.colours : [], rows = pieceRows(state, trays, canvas, opts), list = pieces(state);
    var out = colours.filter(function (c) { return !!fileColour(fileColours, c.t); }).map(function (c) {
      var on = [], painted = [];
      list.forEach(function (p, i) {
        var r = rows[i], qs = Array.isArray(p.parts) ? p.parts : [];
        if (qs.length) {
          var mine = qs.filter(function (q) { return q.t === c.t; });
          if (mine.length === qs.length) on.push(r.name);
          else mine.forEach(function (q) { on.push(r.parts[qs.indexOf(q)].detail || r.name + ', partie ' + (qs.indexOf(q) + 1)); });
        } else if (p.t === c.t) on.push(r.name);
        if (Array.isArray(p.painted) && p.painted.indexOf(c.t) >= 0) painted.push(r.name);
      });
      var hex = fileColour(fileColours, c.t), tray = trayFor(c.t, trays, canvas);
      return { t: c.t, fileColour: hex, fileName: C.colourName(hex) || 'couleur', pieces: on, painted: painted, tray: tray, text: spoolText(tray) };
    });
    return out.length >= 2 ? out : [];
  }
  function fileIntro(rows) { return 'Ce fichier prévoit ' + rows.length + ' couleurs. Pour chacune, choisis la bobine qui l’imprime.'; }
  // « sur Coque, Bouton » ; « zones peintes sur Coque ».
  function fileWhere(row) {
    var parts = [];
    if (row.pieces.length) parts.push('sur ' + row.pieces.join(', '));
    if (row.painted.length) parts.push('zones peintes sur ' + row.painted.join(', '));
    return parts.join(' · ');
  }
  // Deux couleurs du fichier (ou plus) sur la même bobine : la carte le dit. '' sinon.
  function sameTrayNote(rows) {
    var groups = {}, order = [];
    (rows || []).forEach(function (r) {
      if (!r.tray) return;
      var k = trayKey(r.tray);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });
    return order.filter(function (k) { return groups[k].length > 1; }).map(function (k) {
      var g = groups[k], names = g.map(function (r) { return r.fileName; }), spool = spoolText(g[0].tray);
      var distinct = names.filter(function (n, i) { return names.indexOf(n) === i; }).length === names.length;
      if (!distinct) return 'Ces ' + g.length + ' couleurs du fichier sortiront toutes en ' + spool + '.';
      var said = names.map(function (n) { return (/^[aeiouyéèêh]/i.test(n) ? 'l’' : 'le ') + n; });
      var list = said.length === 2 ? said[0] + ' et ' + said[1] : said.slice(0, -1).join(', ') + ' et ' + said[said.length - 1];
      return list.charAt(0).toUpperCase() + list.slice(1) + ' sortiront ' + (g.length === 2 ? 'tous les deux' : 'tous') + ' en ' + spool + '.';
    }).join(' ');
  }
  var PAINTED_FILE = 'Les zones peintes gardent leur peinture : tu choisis seulement la bobine de chaque couleur.';
  var ONE_PIECE = 'Changer la couleur d’une seule pièce';

  // La plaque mérite-t-elle la carte « Couleurs » (plusieurs pièces, une pièce en parties, ou plusieurs couleurs) ?
  function worth(state) {
    var list = pieces(state);
    return list.length > 1 || list.some(function (p) { return Array.isArray(p.parts) && p.parts.length > 0; }) || (!!state && Array.isArray(state.colours) && state.colours.length > 1);
  }
  // Pièces de la plaque pas encore vues (refs), pour ne proposer la carte qu'une fois par pièce posée.
  function newPieces(state, seen) {
    var s = seen || {};
    return pieces(state).map(function (p) { return String(p.ref); }).filter(function (r) { return !s[r]; });
  }
  // L'invitation à choisir les couleurs, quand une pièce posée après l'étape Filament le mérite. `expert` (« Je connais déjà ») :
  // une ligne discrète. opts : { partName }.
  var INVITE_BUTTON = 'Choisir les couleurs';
  function inviteText(state, fileColours, trays, opts, expert) {
    if (expert) return 'Ta plaque peut s’imprimer en plusieurs couleurs.';
    var list = pieces(state), files = fileRows(state, fileColours, trays, [], opts);
    if (files.length) return 'Ce fichier prévoit ' + files.length + ' couleurs, et ta machine a plusieurs bobines : choisis la bobine qui imprime chacune.';
    if (list.length > 1) return 'Ta plaque a maintenant ' + list.length + ' pièces, et ta machine a plusieurs bobines : tu peux choisir la bobine qui imprime chacune.';
    var parted = list.filter(function (p) { return Array.isArray(p.parts) && p.parts.length > 0; })[0];
    if (parted) return '« ' + pieceName(parted.name, (opts || {}).partName) + ' » est faite de ' + parted.parts.length + ' parties, et ta machine a plusieurs bobines : tu peux choisir la bobine de chacune.';
    return 'Ta plaque a plusieurs couleurs, et ta machine a plusieurs bobines : choisis la bobine qui imprime chacune.';
  }
  // L'association en cours (`mapping`) est-elle celle déjà choisie pour le projet (`canvas`), pour chaque couleur utilisée ?
  function sameAsChosen(mapping, canvas, colours) {
    var list = Array.isArray(colours) ? colours : [];
    if (!list.length) return true;
    return list.every(function (c) {
      var a = (mapping || []).filter(function (m) { return m && m.t === c.t; })[0], b = (canvas || []).filter(function (m) { return m && m.t === c.t; })[0];
      return !!a && !!b && a.canvas_id === b.canvas_id && a.tray_id === b.tray_id;
    });
  }
  // L'association couvre-t-elle exactement les couleurs utilisées ? Sinon (une pièce posée a apporté des couleurs) elle est
  // proposée à nouveau.
  function covers(mapping, colours) {
    var m = Array.isArray(mapping) ? mapping : [], list = Array.isArray(colours) ? colours : [];
    return m.length === list.length && list.every(function (c) { return m.some(function (e) { return e && e.t === c.t; }); });
  }

  // L'association couvre-t-elle chaque couleur utilisée par la plaque ? (« Utiliser ces bobines »)
  function complete(colours, canvas, trays) {
    var list = Array.isArray(colours) ? colours : [];
    return list.length > 0 && list.every(function (c) { return !!trayFor(c.t, trays, canvas); });
  }

  // « Une bobine par pièce » : plusieurs pièces sans parties, toutes sur la même bobine (ou sans bobine), et assez de bobines
  // chargées de la même matière. L'ordre : « couleur 1, 2, 3… » si chaque nom le dit, sinon celui du plateau. null sinon.
  var RANK = /(?:couleur|color|colour|coul\.?)\s*(\d+)/i;
  function spreadPlan(rows, trays) {
    var list = (rows || []).filter(function (r) { return r && !r.mixed && !(r.parts && r.parts.length); });
    if (list.length < 2 || list.length !== (rows || []).length) return null;
    var first = list[0].tray, same = list.every(function (r) { return trayKey(r.tray) === trayKey(first); });
    if (!same) return null;
    var usable = (trays || []).filter(function (t) { return t && !t.empty && t.type && (!first || upper(t.type) === upper(first.type)); });
    if (usable.length < list.length) return null;
    var ranked = list.every(function (r) { return RANK.test(r.title || r.name); });
    var ordered = ranked ? list.slice().sort(function (a, b) { return Number(RANK.exec(a.title || a.name)[1]) - Number(RANK.exec(b.title || b.name)[1]); }) : list;
    // La bobine en cours reste à la première pièce : une étape de moins, et la couleur 1 garde son emplacement.
    if (first) usable = [first].concat(usable.filter(function (t) { return trayKey(t) !== trayKey(first); }));
    var moves = ordered.map(function (r, i) { return { ref: r.ref, name: r.name, current: r.tray, tray: usable[i] }; });
    return { moves: moves, text: moves.map(function (m) { return m.name + ' → ' + spoolText(m.tray); }).join(', ') };
  }
  function spreadIntro(rows) {
    var r = rows || [], t = r[0] && r[0].tray;
    return 'Tes ' + r.length + ' pièces sortiront toutes ' + (t ? 'en ' + spoolText(t) : 'avec la même bobine') + '. Donne une bobine à chaque pièce : touche sa couleur ci-dessous.';
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

  // Ligne « Couleurs » de la fiche du projet : '' sans association choisie ou sans rien à colorier. opts : { partName }.
  function ficheText(state, trays, canvas, opts) {
    if (!Array.isArray(canvas) || !canvas.length || !pieces(state).length || !worth(state)) return '';
    var rows = pieceRows(state, trays, canvas, opts);
    if (rows.length > 3) return 'Couleurs : ' + rows.length + ' pièces';
    return 'Couleurs : ' + rows.map(function (r) { return r.name + ' en ' + r.text; }).join(', ');
  }

  var api = { NO_SPOOL: NO_SPOOL, MIXED: MIXED, PAINTED: PAINTED, INTRO: INTRO, wanted: wanted, pieceRows: pieceRows, complete: complete, changedText: changedText,
    otherMaterialNote: otherMaterialNote, missingText: missingText, spoolText: spoolText, trayFor: trayFor, trayKey: trayKey, mappingFrom: mappingFrom,
    traysFromCanvas: traysFromCanvas, ficheText: ficheText, pieceName: pieceName, partDetail: partDetail, fileRows: fileRows, fileIntro: fileIntro,
    fileWhere: fileWhere, sameTrayNote: sameTrayNote, PAINTED_FILE: PAINTED_FILE, ONE_PIECE: ONE_PIECE, worth: worth, newPieces: newPieces,
    INVITE_BUTTON: INVITE_BUTTON, inviteText: inviteText, spreadPlan: spreadPlan, spreadIntro: spreadIntro, sameAsChosen: sameAsChosen, covers: covers, fileColour: fileColour };
  root.PlyoColours = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
