// Pièces sur mesure (« Crée-moi une pièce ») : la description fermée renvoyée par l'assistant (plyo-api, design-schema.ts)
// est vérifiée à nouveau ici, puis construite avec manifold-3d (solide fermé garanti) et écrite en STL binaire pour le
// slicer (model_add, comme un fichier choisi). Aucun code venu de l'IA n'est exécuté : seules ces formes existent.
// Conventions des formes : voir design-schema.ts (mm, degrés ; pavés et cylindres centrés en X et Y, posés sur z = 0).
// Sans dépendance au panneau (testé par tests/design-builder.test.mjs). Chargé par index.html (window.PlyoDesign).
(function (root) {
  var KINDS = ['box', 'cylinder', 'sphere', 'extrude', 'revolve', 'union', 'difference', 'intersection', 'translate', 'rotate', 'mirror', 'grid', 'ring'];
  var LEAVES = { box: 1, cylinder: 1, sphere: 1, extrude: 1, revolve: 1 };
  var LIMITS = { maxNodes: 200, maxDepth: 24, minSize: 0.2, maxSize: 500, maxPoints: 200, maxCopies: 400 };
  var ID = /^[A-Za-z0-9_-]{1,40}$/;

  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function inRange(v, lo, hi) { return finite(v) && v >= lo && v <= hi; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  // Même règle que checkDesign (plyo-api) : une forme isolée, "" si elle est valable.
  function nodeProblem(n) {
    var L = LIMITS, size = function (v) { return inRange(v, L.minSize, L.maxSize); }, coord = function (v) { return inRange(v, -L.maxSize, L.maxSize); };
    var children = arr(n.children), leaf = !!LEAVES[n.kind];
    if (KINDS.indexOf(n.kind) < 0) return 'forme inconnue';
    if (leaf && children.length) return 'une forme de base n’a pas d’enfant';
    if (!leaf && !children.length) return 'une opération demande au moins un enfant';
    var s = arr(n.size), p = arr(n.points), v = arr(n.vector), c = arr(n.count), sp = arr(n.spacing);
    switch (n.kind) {
      case 'box':
        if (s.length !== 3 || !s.every(size)) return 'pavé : trois tailles entre 0,2 et 500 mm';
        if (n.rounding !== null && n.rounding !== undefined && !inRange(n.rounding, 0, Math.min(s[0], s[1]) / 2 - 0.01)) return 'pavé : arrondi trop grand';
        return '';
      case 'cylinder':
        if (!inRange(n.radius, 0.1, L.maxSize / 2) || !size(n.height)) return 'cylindre : rayon ou hauteur hors limites';
        if (n.radius_top !== null && n.radius_top !== undefined && !inRange(n.radius_top, 0, L.maxSize / 2)) return 'cylindre : rayon du haut hors limites';
        return '';
      case 'sphere': return inRange(n.radius, 0.1, L.maxSize / 2) ? '' : 'sphère : rayon hors limites';
      case 'extrude': case 'revolve':
        if (p.length < 3 || p.length > L.maxPoints) return 'profil : de 3 à 200 points';
        if (!p.every(function (q) { return Array.isArray(q) && q.length === 2 && q.every(coord); })) return 'profil : points hors limites';
        if (n.kind === 'extrude' && !size(n.height)) return 'extrusion : hauteur hors limites';
        if (n.kind === 'revolve' && !p.every(function (q) { return q[0] >= 0; })) return 'révolution : profil du côté r ≥ 0';
        return '';
      case 'union': case 'intersection': return '';
      case 'difference': return children.length >= 2 ? '' : 'soustraction : au moins deux enfants';
      case 'translate': return v.length === 3 && v.every(coord) ? '' : 'déplacement hors limites';
      case 'rotate': return v.length === 3 && v.every(function (a) { return inRange(a, -360, 360); }) ? '' : 'rotation hors limites';
      case 'mirror': return v.length === 3 && v.every(finite) && v.some(function (a) { return a !== 0; }) ? '' : 'symétrie : normale nulle';
      case 'grid':
        if (c.length !== 2 || !c.every(function (k) { return Number.isInteger(k) && k >= 1 && k <= 20; })) return 'grille : de 1 à 20 copies par côté';
        return sp.length === 2 && sp.every(function (d) { return inRange(d, 0, L.maxSize); }) ? '' : 'grille : écarts hors limites';
      case 'ring':
        if (c.length !== 1 || !Number.isInteger(c[0]) || c[0] < 2 || c[0] > 36) return 'anneau : de 2 à 36 copies';
        return inRange(n.radius, 0, L.maxSize / 2) ? '' : 'anneau : rayon hors limites';
    }
    return 'forme inconnue';
  }

  // { ok: true } ou { ok: false, error, node? } : identifiants, liens, boucles, profondeur, copies, paramètres.
  function check(part) {
    var nodes = part && Array.isArray(part.nodes) ? part.nodes : [];
    if (!nodes.length) return { ok: false, error: 'aucune forme' };
    if (nodes.length > LIMITS.maxNodes) return { ok: false, error: 'plus de 200 formes' };
    var byId = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || typeof n.id !== 'string' || !ID.test(n.id)) return { ok: false, error: 'identifiant invalide' };
      if (byId[n.id]) return { ok: false, error: 'identifiant en double', node: n.id };
      byId[n.id] = n;
    }
    if (!byId[part.root]) return { ok: false, error: 'racine inconnue' };
    for (var j = 0; j < nodes.length; j++) {
      var why = nodeProblem(nodes[j]);
      if (why) return { ok: false, error: why, node: nodes[j].id };
      var kids = arr(nodes[j].children);
      for (var k = 0; k < kids.length; k++) if (!byId[kids[k]]) return { ok: false, error: 'enfant inconnu', node: nodes[j].id };
    }
    var open = {}, tooMany = false;
    function walk(id, depth, copies) {
      if (depth > LIMITS.maxDepth) return 'trop d’opérations imbriquées';
      if (open[id]) return 'boucle entre les formes';
      var nd = byId[id];
      var here = nd.kind === 'grid' ? copies * nd.count[0] * nd.count[1] : nd.kind === 'ring' ? copies * nd.count[0] : copies;
      if (here > LIMITS.maxCopies) tooMany = true;
      open[id] = true;
      var kids2 = arr(nd.children);
      for (var m = 0; m < kids2.length; m++) { var w = walk(kids2[m], depth + 1, here); if (w) return w; }
      open[id] = false;
      return '';
    }
    var loop = walk(part.root, 1, 1);
    if (loop) return { ok: false, error: loop };
    if (tooMany) return { ok: false, error: 'trop de copies (400 au plus)' };
    return { ok: true };
  }

  // Finesse des arrondis : environ un segment par demi-millimètre de tour, entre 24 et 96.
  function segments(r) { return Math.max(24, Math.min(96, Math.ceil(2 * Math.PI * r / 0.5))); }

  // Construit la pièce. M : le module manifold-3d initialisé ({ Manifold, CrossSection }). Rend { ok, mesh: { positions
  // (Float32Array, x y z par sommet), triangles (Uint32Array) }, size: [x, y, z] mm, volume, triangles } ou { ok: false, error }.
  // La pièce est posée sur z = 0. Tous les objets du module sont libérés (mémoire WebAssembly), réussite ou non.
  function build(M, part) {
    var verdict = check(part);
    if (!verdict.ok) return verdict;
    var byId = {};
    part.nodes.forEach(function (n) { byId[n.id] = n; });
    var made = [];
    function keep(x) { made.push(x); return x; }
    function unionOf(list) { return list.length === 1 ? list[0] : keep(M.Manifold.union(list)); }
    function make(id) {
      var n = byId[id], kids = arr(n.children).map(make);
      switch (n.kind) {
        case 'box': {
          var s = n.size, r = n.rounding || 0;
          if (r > 0) {
            var sq = keep(M.CrossSection.square([s[0] - 2 * r, s[1] - 2 * r], true));
            var rounded = keep(sq.offset(r, 'Round', 2, segments(r)));
            return keep(rounded.extrude(s[2]));
          }
          return keep(keep(M.Manifold.cube([s[0], s[1], s[2]], false)).translate([-s[0] / 2, -s[1] / 2, 0]));
        }
        case 'cylinder': {
          var top = n.radius_top === null || n.radius_top === undefined ? n.radius : n.radius_top;
          return keep(M.Manifold.cylinder(n.height, n.radius, top, segments(Math.max(n.radius, top))));
        }
        case 'sphere': return keep(M.Manifold.sphere(n.radius, segments(n.radius)));
        case 'extrude': return keep(M.Manifold.extrude(keep(new M.CrossSection([n.points], 'NonZero')), n.height));
        case 'revolve': return keep(M.Manifold.revolve(keep(new M.CrossSection([n.points], 'NonZero')), segments(Math.max.apply(null, n.points.map(function (q) { return q[0]; })))));
        case 'union': return unionOf(kids);
        case 'difference': return keep(M.Manifold.difference(kids));
        case 'intersection': return keep(M.Manifold.intersection(kids));
        case 'translate': return keep(unionOf(kids).translate(n.vector));
        case 'rotate': return keep(unionOf(kids).rotate(n.vector));
        case 'mirror': return keep(unionOf(kids).mirror(n.vector));
        case 'grid': {
          var one = unionOf(kids), copies = [];
          for (var ix = 0; ix < n.count[0]; ix++)
            for (var iy = 0; iy < n.count[1]; iy++)
              copies.push(keep(one.translate([(ix - (n.count[0] - 1) / 2) * n.spacing[0], (iy - (n.count[1] - 1) / 2) * n.spacing[1], 0])));
          return unionOf(copies);
        }
        case 'ring': {
          var base = keep(unionOf(kids).translate([n.radius, 0, 0])), around = [];
          for (var a = 0; a < n.count[0]; a++) around.push(keep(base.rotate([0, 0, 360 * a / n.count[0]])));
          return unionOf(around);
        }
      }
      throw new Error('forme inconnue');
    }
    try {
      var solid = make(part.root);
      if (solid.status() !== 'NoError' || solid.isEmpty()) return { ok: false, error: 'la pièce construite est vide ou abîmée' };
      var box = solid.boundingBox();
      var placed = keep(solid.translate([0, 0, -box.min[2]]));
      var gl = placed.getMesh(), np = gl.numProp, count = gl.vertProperties.length / np;
      var positions = new Float32Array(count * 3);
      for (var v = 0; v < count; v++) for (var c = 0; c < 3; c++) positions[v * 3 + c] = gl.vertProperties[v * np + c];
      var result = {
        ok: true,
        mesh: { positions: positions, triangles: new Uint32Array(gl.triVerts) },
        size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]].map(function (x) { return Math.round(x * 100) / 100; }),
        volume: Math.round(placed.volume() * 10) / 10,
        triangles: placed.numTri()
      };
      if (gl.delete) gl.delete();
      return result;
    } catch (e) {
      return { ok: false, error: 'construction impossible : ' + String(e && e.message || e).slice(0, 200) };
    } finally {
      made.forEach(function (x) { try { if (x && x.delete) x.delete(); } catch (e) { /* déjà libéré */ } });
    }
  }

  // STL binaire (en-tête de 80 octets, nombre de triangles, puis normale + 3 sommets + 2 octets par triangle).
  function toSTL(mesh, title) {
    var p = mesh.positions, t = mesh.triangles, n = t.length / 3;
    var buf = new ArrayBuffer(84 + n * 50), view = new DataView(buf), bytes = new Uint8Array(buf);
    var head = String(title || 'Plyo').slice(0, 79);
    for (var i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i) & 0x7f;
    view.setUint32(80, n, true);
    var o = 84;
    for (var f = 0; f < n; f++) {
      var a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
      var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      var vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      view.setFloat32(o, nx / len, true); view.setFloat32(o + 4, ny / len, true); view.setFloat32(o + 8, nz / len, true);
      o += 12;
      [a, b, c].forEach(function (k) { view.setFloat32(o, p[k], true); view.setFloat32(o + 4, p[k + 1], true); view.setFloat32(o + 8, p[k + 2], true); o += 12; });
      o += 2;
    }
    return bytes;
  }

  // Cotes montrées dans la carte « Voilà ta pièce » : « 80 × 60 × 12 mm », virgule décimale.
  function sizeText(size) { return size.map(function (x) { return String(Math.round(x * 10) / 10).replace('.', ','); }).join(' × ') + ' mm'; }

  var api = { KINDS: KINDS, LIMITS: LIMITS, check: check, build: build, toSTL: toSTL, sizeText: sizeText };
  root.PlyoDesign = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
