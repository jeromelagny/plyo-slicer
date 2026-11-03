// Logique pure des emplacements du Canvas (Centauri Carbon 2) : liste des emplacements, nom des couleurs, proposition
// couleur de la pièce → emplacement, vérification avant l'envoi. Chargée par index.html (window.PlyoCanvas) et testée
// par node (tests/canvas-logic.test.mjs). Les emplacements sont numérotés tray_id 0 à 3 ; l'écran affiche tray_id + 1.
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
  function colourName(hex) {
    if (!rgb(hex)) return '';
    var best = '', bestD = Infinity;
    PALETTE.forEach(function (p) {
      var d = distance(hex, '#' + ((1 << 24) + (p[1] << 16) + (p[2] << 8) + p[3]).toString(16).slice(1));
      if (d < bestD) { bestD = d; best = p[0]; }
    });
    return best;
  }
  function upper(s) { return String(s || '').trim().toUpperCase(); }
  function trayText(type, color) { return (type || '?') + (colourName(color) ? ' ' + colourName(color) : ''); }

  function trays(state) {
    if (!state || !state.ok || !Array.isArray(state.canvases)) return [];
    var units = state.canvases.filter(function (c) { return c && c.connected; });
    var out = [];
    units.forEach(function (c) {
      (c.trays || []).forEach(function (t) {
        var prefix = units.length > 1 ? 'Canvas ' + (c.canvas_id + 1) + ' · ' : '';
        out.push({ canvas_id: c.canvas_id, tray_id: t.tray_id, type: t.type || '', color: t.color || '', status: t.status,
          empty: t.status === 0, label: prefix + (t.tray_id + 1) + ' · ' + trayText(t.type, t.color) });
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
      var full = free.filter(function (t) { return !t.empty; });
      var pool = full.length ? full : free;
      var best = null;
      pool.forEach(function (t) { if (!best || distance(c.color, t.color) < distance(c.color, best.color)) best = t; });
      if (best) used[best.canvas_id + ':' + best.tray_id] = true;
      return { t: c.t, color: c.color, canvas_id: best ? best.canvas_id : null, tray_id: best ? best.tray_id : null };
    });
  }

  function complete(mapping) {
    return Array.isArray(mapping) && mapping.length > 0 && mapping.every(function (m) { return m.tray_id !== null && m.tray_id !== undefined; });
  }
  function tooMany(colours, list) { return (colours || []).length > (list || []).length; }

  // chosen : project.canvas ; fresh : trays(nouvelle lecture).
  function checkBeforeSend(chosen, fresh) {
    var out = { block: [], notes: [] };
    (chosen || []).forEach(function (e) {
      var n = e.tray_id + 1;
      var now = (fresh || []).filter(function (t) { return t.canvas_id === e.canvas_id && t.tray_id === e.tray_id; })[0];
      if (!now) { out.block.push('L’emplacement ' + n + ' n’est plus visible sur le Canvas.'); return; }
      if (upper(now.type) !== upper(e.type)) { out.block.push('L’emplacement ' + n + ' contient maintenant du ' + (now.type || '?') + ' (choisi : ' + (e.type || '?') + ').'); return; }
      if (now.empty) out.notes.push('L’imprimante pense que l’emplacement ' + n + ' est vide : vérifie qu’il est bien chargé.');
      if (upper(now.color) !== upper(e.color)) out.notes.push('L’emplacement ' + n + ' a changé de couleur (maintenant ' + (colourName(now.color) || now.color) + ').');
    });
    return out;
  }

  function profileTypes(type) {
    var t = upper(type);
    if (!t) return [];
    var base = t.split(/[-+ ]/)[0];
    return base && base !== t ? [t, base] : [t];
  }

  function mapLabel(canvas) {
    if (!Array.isArray(canvas) || !canvas.length) return '';
    var sorted = canvas.slice().sort(function (a, b) { return a.t - b.t; });
    if (sorted.length === 1) return 'Emplacement ' + (sorted[0].tray_id + 1) + ' · ' + trayText(sorted[0].type, sorted[0].color);
    return sorted.map(function (e, i) {
      return (i ? 'couleur ' : 'Couleur ') + (e.t + 1) + ' → emplacement ' + (e.tray_id + 1) + ' · ' + trayText(e.type, e.color);
    }).join(', ');
  }

  var api = { colourName: colourName, trays: trays, propose: propose, complete: complete, tooMany: tooMany,
    checkBeforeSend: checkBeforeSend, profileTypes: profileTypes, mapLabel: mapLabel, distance: distance };
  root.PlyoCanvas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
