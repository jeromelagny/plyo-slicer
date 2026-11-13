// Logique pure des emplacements (Canvas, CFS, IFS, têtes de la U1, saisie manuelle : « canvas » désigne ici toute unité) : liste
// des emplacements, nom des couleurs, proposition couleur de la pièce → emplacement, vérification avant l'envoi. Chargée par
// index.html (window.PlyoCanvas) et testée par node (tests/canvas-logic.test.mjs). Le numéro affiché est `label`, donné par le
// traducteur (« 1A », « Ext », « 2 ») ; sans lui (CC2, projet enregistré avant) : tray_id + 1.
(function (root) {
  var PALETTE = [
    ['noir', 26, 26, 26], ['blanc', 245, 245, 245], ['gris', 140, 140, 140], ['crème', 243, 229, 200], ['brun', 123, 74, 18],
    ['rouge', 210, 32, 32], ['rose', 240, 112, 144], ['orange', 240, 128, 32], ['jaune', 240, 208, 32], ['vert', 48, 160, 64],
    ['bleu', 32, 96, 208], ['violet', 128, 64, 192]
  ];

  function rgb(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function distance(a, b) {
    var x = rgb(a), y = rgb(b);
    if (!x || !y) return Infinity;
    return Math.pow(x[0] - y[0], 2) * 2 + Math.pow(x[1] - y[1], 2) * 4 + Math.pow(x[2] - y[2], 2) * 3;
  }
  // Nom d'une couleur par sa teinte, comme on la nomme à l'œil. Avant, c'était la plus proche de douze couleurs de référence :
  // un bleu profond lu sur un CFS (#1B04AE, teinte 248°) était dit « violet », parce qu'il lui manque surtout du vert.
  function colourName(hex) {
    var c = rgb(hex);
    if (!c) return '';
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    // Sans couleur franche : noir, gris ou blanc selon la clarté.
    if (d < 0.1) return l < 0.2 ? 'noir' : l > 0.85 ? 'blanc' : 'gris';
    var h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (l < 0.08) return 'noir';
    if (h >= 20 && h < 70 && l > 0.8) return 'crème';                     // jaune ou orangé très clair
    if (h >= 10 && h < 50 && l < 0.42) return 'brun';                     // orangé sombre
    if (h >= 50 && h < 70 && l < 0.3) return 'brun';                      // jaune très sombre
    if (h >= 345 || h < 15) return l > 0.6 ? 'rose' : 'rouge';            // un rouge clair se dit rose
    if (h < 45) return 'orange';
    if (h < 70) return 'jaune';
    if (h < 170) return 'vert';
    if (h < 262) return 'bleu';                                           // du turquoise au bleu profond
    if (h < 290) return 'violet';
    if (h < 330) return l < 0.45 ? 'violet' : 'rose';                     // pourpre sombre, fuchsia clair
    return 'rose';
  }
  function upper(s) { return String(s || '').trim().toUpperCase(); }
  function trayText(type, color) { return (type || '?') + (colourName(color) ? ' ' + colourName(color) : ''); }

  // Les mots de chaque système ; sans système connu (réponse ancienne, projet enregistré) : ceux de la CC2.
  var WORDS = {
    canvas: { on: 'sur le Canvas', of: 'du Canvas', unit: 'le Canvas', your: 'ta CC2', the: 'l’emplacement', The: 'L’emplacement', Slot: 'Emplacement', slot: 'emplacement', slots: 'emplacements' },
    cfs: { on: 'sur le CFS', of: 'du CFS', unit: 'le CFS', your: 'ton CFS', the: 'l’emplacement', The: 'L’emplacement', Slot: 'Emplacement', slot: 'emplacement', slots: 'emplacements' },
    ifs: { on: 'sur l’IFS', of: 'de l’IFS', unit: 'l’IFS', your: 'ton IFS', the: 'l’emplacement', The: 'L’emplacement', Slot: 'Emplacement', slot: 'emplacement', slots: 'emplacements' },
    u1: { on: 'sur la U1', of: 'de la U1', unit: 'la U1', your: 'ta U1', the: 'la tête', The: 'La tête', Slot: 'Tête', slot: 'tête', slots: 'têtes' },
    manual: { on: 'sur ta machine', of: 'de ta machine', unit: 'ta machine', your: 'ta machine', the: 'l’emplacement', The: 'L’emplacement', Slot: 'Emplacement', slot: 'emplacement', slots: 'emplacements' }
  };
  function words(system) { return WORDS[system] || WORDS.canvas; }
  // Le numéro affiché d'un emplacement (lu ou choisi).
  function slotName(t) { return t.label !== undefined && t.label !== null && t.label !== '' ? String(t.label) : String(t.tray_id + 1); }

  function trays(state) {
    if (!state || !state.ok || !Array.isArray(state.canvases)) return [];
    var units = state.canvases.filter(function (c) { return c && c.connected; });
    var system = state.system || 'canvas', w = words(system), out = [];
    units.forEach(function (c) {
      (c.trays || []).forEach(function (t) {
        // CC2 : plusieurs Canvas se distinguent par un préfixe ; le libellé du CFS porte déjà sa boîte (« 1A »).
        var prefix = system === 'canvas' && units.length > 1 ? 'Canvas ' + (c.canvas_id + 1) + ' · ' : '';
        var name = slotName(t);
        out.push({ canvas_id: c.canvas_id, tray_id: t.tray_id, type: t.type || '', color: t.color || '', status: t.status,
          empty: t.status === 0, slot: name, system: system, label: prefix + (system === 'u1' ? w.Slot + ' ' : '') + name + ' · ' + trayText(t.type, t.color) });
      });
    });
    return out;
  }

  // colours : [{t, color, type?}] ; trays : trays(state). Rend [{t, color, canvas_id, tray_id}] (tray_id null si aucun).
  function propose(colours, list) {
    var used = {};
    return (colours || []).slice().sort(function (a, b) { return a.t - b.t; }).map(function (c) {
      var free = (list || []).filter(function (t) { return !used[t.canvas_id + ':' + t.tray_id]; });
      if (c.type) free = free.filter(function (t) { return upper(t.type) === upper(c.type); });
      // Même type puis couleur la plus proche. Le status de la CC2 n'est pas fiable (un emplacement chargé peut valoir 0) : il ne
      // départage que deux couleurs à égalité ; un emplacement vu vide reste proposé, avec la mention « vide ? » à l'écran.
      var best = null;
      free.forEach(function (t) {
        var d = best ? distance(c.color, t.color) - distance(c.color, best.color) : -1;
        if (!best || d < 0 || ((d === 0 || isNaN(d)) && best.empty && !t.empty)) best = t;
      });
      if (best) used[best.canvas_id + ':' + best.tray_id] = true;
      return { t: c.t, color: c.color, canvas_id: best ? best.canvas_id : null, tray_id: best ? best.tray_id : null };
    });
  }

  function complete(mapping) {
    return Array.isArray(mapping) && mapping.length > 0 && mapping.every(function (m) { return m.tray_id !== null && m.tray_id !== undefined; });
  }
  function tooMany(colours, list) { return (colours || []).length > (list || []).length; }

  // chosen : project.canvas ; fresh : trays(nouvelle lecture) ; opts : { system, empty_blocks } de cette lecture. Le status de la
  // CC2 n'est pas fiable : une simple remarque ; CFS et IFS refusent un emplacement vide à l'envoi (empty_blocks).
  function checkBeforeSend(chosen, fresh, opts) {
    var out = { block: [], notes: [] }, o = opts || {}, w = words(o.system);
    (chosen || []).forEach(function (e) {
      var n = slotName(e);
      var now = (fresh || []).filter(function (t) { return t.canvas_id === e.canvas_id && t.tray_id === e.tray_id; })[0];
      if (!now) { out.block.push(w.The + ' ' + n + ' n’est plus visible ' + w.on + '.'); return; }
      if (upper(now.type) !== upper(e.type)) { out.block.push(w.The + ' ' + n + ' contient maintenant du ' + (now.type || '?') + ' (choisi : ' + (e.type || '?') + ').'); return; }
      if (now.empty && o.empty_blocks) { out.block.push(w.The + ' ' + n + ' est vide.'); return; }
      if (now.empty) out.notes.push('L’imprimante pense que ' + w.the + ' ' + n + ' est vide : vérifie qu’il est bien chargé.');
      if (upper(now.color) !== upper(e.color)) out.notes.push(w.The + ' ' + n + ' a changé de couleur (maintenant ' + (colourName(now.color) || now.color) + ').');
    });
    return out;
  }

  function profileTypes(type) {
    var t = upper(type);
    if (!t) return [];
    var base = t.split(/[-+ ]/)[0];
    return base && base !== t ? [t, base] : [t];
  }

  // Une répartition imposée à l'envoi, ou seulement à sélectionner sur l'imprimante (lue sans imposer, saisie à la main) ? Un
  // projet enregistré avant ces champs vient de la CC2 : imposée.
  function isImposed(canvas) {
    return Array.isArray(canvas) && canvas.length > 0 && canvas.every(function (e) { return e.imposable !== false && e.source !== 'manual'; });
  }

  function mapLabel(canvas, imposable) {
    if (!Array.isArray(canvas) || !canvas.length) return '';
    var sorted = canvas.slice().sort(function (a, b) { return a.t - b.t; });
    // La U1 n'a pas de répartition à choisir sur la machine : on y vérifie seulement.
    var tail = imposable === false ? (sorted[0].system === 'u1' ? ' : à vérifier sur l’écran de la U1' : ' : à sélectionner sur l’imprimante') : '';
    if (sorted.length === 1) return words(sorted[0].system).Slot + ' ' + slotName(sorted[0]) + ' · ' + trayText(sorted[0].type, sorted[0].color) + tail;
    return sorted.map(function (e, i) {
      return (i ? 'couleur ' : 'Couleur ') + (e.t + 1) + ' → ' + words(e.system).slot + ' ' + slotName(e) + ' · ' + trayText(e.type, e.color);
    }).join(', ') + tail;
  }

  // Pas de relecture possible pour une saisie manuelle : la fenêtre d'Orca s'ouvre directement.
  function needsReread(canvas) { return Array.isArray(canvas) && canvas.length > 0 && canvas[0].source !== 'manual'; }

  // Après la relecture d'avant l'envoi : 'armed' (canvas_send, CFS et IFS), 'orca' (print_start : la fenêtre d'Orca, ou la carte de
  // la CC2 dans son fil d'envoi), 'refuse' (choisi pour être imposé, plus possible : rien ne part en silence d'une autre façon).
  function sendRoute(chosen, state) {
    if (!isImposed(chosen)) return 'orca';
    var system = state && state.system;
    if (system !== 'cfs' && system !== 'ifs') return 'orca';
    return state.imposable === true ? 'armed' : 'refuse';
  }

  // Ligne d'information de l'étape Imprimer, selon la nature des emplacements choisis (rien pour la CC2).
  function printNote(canvas) {
    if (!Array.isArray(canvas) || !canvas.length) return '';
    var first = canvas[0];
    if (!first.system || first.system === 'canvas') return '';
    var trial = first.validated === true ? '' : ' Plyo n’a pas encore été essayé sur cette marque : regarde sur l’écran de l’imprimante que la bonne bobine alimente.';
    if (first.source === 'manual') return 'Ces emplacements viennent de ce que tu m’as dit : sélectionne-les sur l’imprimante.';
    if (first.system === 'u1') return 'Ces couleurs sont sur tes têtes. Je ne change pas l’ordre des têtes : vérifie sur l’écran de la U1 laquelle imprime chaque couleur.' + trial;
    if (isImposed(canvas)) return 'Passe par « Envoyer et imprimer » : le bouton d’envoi de Plyo Slicer ouvre sa propre fenêtre et ne garde pas ce choix.' + trial;
    return 'Je lis ces emplacements, mais je ne les impose pas sur ta machine : choisis-les dans la fenêtre de Plyo Slicer à l’envoi.' + trial;
  }

  // Ce que dit le panneau quand Orca ouvre sa fenêtre d'envoi, s'il y a quelque chose à y vérifier (sinon vide : texte habituel).
  function orcaConfirm(canvas) {
    if (Array.isArray(canvas) && canvas.length && canvas[0].system === 'u1')
      return 'Plyo Slicer te demande de confirmer : valide, puis vérifie sur l’écran de ta U1 quelle tête imprime chaque couleur.';
    if (Array.isArray(canvas) && canvas.length && canvas[0].source === 'manual')
      return 'Plyo Slicer te demande de confirmer : valide, puis sélectionne sur l’imprimante les emplacements que tu m’as indiqués.';
    if (Array.isArray(canvas) && canvas.length && canvas[0].system && canvas[0].system !== 'canvas' && !isImposed(canvas))
      return 'Plyo Slicer te demande de confirmer : choisis les mêmes emplacements dans sa fenêtre, puis valide.';
    return '';
  }

  // Une question de répartition ? Pas avec un seul emplacement, ni sans lecture ni saisie (le profil ne permet pas de reconnaître une
  // machine à une bobine). La CC2 reste comme avant.
  function askSlots(state) {
    if (!state || !state.ok) return false;
    if (!state.system || state.system === 'canvas') return true;
    return trays(state).length > 1;
  }
  // Un seul emplacement, de type connu et différent du projet : une remarque, jamais un blocage.
  function typeMismatch(list, projectType) {
    if (!Array.isArray(list) || list.length !== 1 || !list[0].type || !projectType || upper(list[0].type) === upper(projectType)) return '';
    return 'Ta machine a du ' + list[0].type + ' chargé, et ce projet est prévu en ' + projectType + '. Change de bobine ou de filament si ce n’est pas voulu.';
  }

  // Un fichier exporté ne porte aucune répartition (la CC2 garde son texte).
  function exportNote(canvas) {
    return Array.isArray(canvas) && canvas.length && canvas[0].system && canvas[0].system !== 'canvas' ? 'Ce fichier ne garde pas les emplacements : sélectionne-les sur l’imprimante.' : '';
  }

  // --- Saisie manuelle : rangée par le slicer (slots.json), jamais envoyée comme répartition. ---
  var MANUAL_MAX = 16;
  // Noms de Slic3r::MaterialType : un autre nom serait effacé par SlotsLogic::sanitize_manual (un test le vérifie).
  var MANUAL_TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PETG-CF', 'PA', 'PC', 'PCTG', 'HIPS'];
  var MANUAL_COLOURS = PALETTE.map(function (p) { return { name: p[0], hex: '#' + ((1 << 24) + (p[1] << 16) + (p[2] << 8) + p[3]).toString(16).slice(1).toUpperCase() }; });
  function manualRecall(state) {
    var known = trays(state).filter(function (t) { return t.type || t.color; });
    if (!known.length) return 'Toujours les mêmes emplacements ?';
    return 'Toujours ' + known.slice(0, 3).map(function (t) { return trayText(t.type, t.color) + ' en ' + t.slot; }).join(', ') + (known.length > 3 ? '…' : '') + ' ?';
  }
  // Toujours 16 lignes : réduire le nombre puis l'augmenter garde ce qui a été choisi.
  function manualDraft(state) {
    var list = trays(state), out = [];
    for (var i = 0; i < MANUAL_MAX; i++) out.push({ type: list[i] ? list[i].type : '', color: list[i] ? list[i].color : '' });
    return out;
  }
  function manualCount(state) { return trays(state).length || 2; }
  // « Garder » : une matière pour chaque emplacement (la couleur reste facultative).
  function manualComplete(draft, count) { return draft.slice(0, count).every(function (d) { return !!d.type; }); }
  function manualSlots(draft, count) { return draft.slice(0, count).map(function (d) { return { type: d.type, color: d.color }; }); }

  var api = { MANUAL_MAX: MANUAL_MAX, MANUAL_TYPES: MANUAL_TYPES, MANUAL_COLOURS: MANUAL_COLOURS, manualRecall: manualRecall, manualDraft: manualDraft, manualCount: manualCount, manualComplete: manualComplete, manualSlots: manualSlots, needsReread: needsReread, exportNote: exportNote, askSlots: askSlots, typeMismatch: typeMismatch, sendRoute: sendRoute, printNote: printNote, orcaConfirm: orcaConfirm, colourName: colourName, trays: trays, propose: propose, complete: complete, tooMany: tooMany,
    checkBeforeSend: checkBeforeSend, profileTypes: profileTypes, mapLabel: mapLabel, distance: distance,
    words: words, slotName: slotName, isImposed: isImposed };
  root.PlyoCanvas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
