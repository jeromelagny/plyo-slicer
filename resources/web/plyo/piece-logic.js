// Étape « Ta pièce » : ce qui ne dépend pas de la vue, partagé par le panneau classique (index.html) et la v2 (v2/piece.js).
// Taille mesurée sur une autre machine, réponse du concepteur de pièces (/api/design), fichier STL de la pièce dessinée,
// chargement de la bibliothèque de dessin (manifold-3d), ordres « Envie d'ajuster ? » envoyés au slicer, pièces récentes.
// Testé par node (tests/piece-logic.test.mjs). window.PlyoPiece.
(function (root) {
  var req = typeof require !== 'undefined' ? require : null;
  function mod(name, file) { return root[name] || (req ? req(file) : null); }

  // Un fichier 3D passe par le panneau jusqu'à 150 Mo (au-delà : menu Fichier › Importer d'Orca).
  var MAX_MODEL_BYTES = 150 * 1024 * 1024;

  // Machine pas encore confirmée : la taille est mesurée sur le plateau de la machine en cours d'Orca. « Trop grande » ne se
  // tait que si le projet en vise une autre (machine proposée différente) ; sinon c'est bien la tienne.
  function measuredElsewhere(project, orcaPrinter) {
    var P = mod('PlyoProject', './project-logic.js'), p = project || {};
    return !P.hasPrinter(p) && !!(p.printer && p.printer.preset) && p.printer.preset !== orcaPrinter;
  }

  // Même règle que PlateActions::fits (C++) : à plat dans un sens ou dans l'autre, et pas plus haute que la machine.
  // Un plateau inconnu (0) ne refuse rien.
  function fits(size, bed) {
    if (!Array.isArray(size) || size.length < 3 || !Array.isArray(bed) || bed.length < 3) return true;
    if (!(bed[0] > 0) || !(bed[1] > 0)) return true;
    var e = 1e-6, flat = function (a, b) { return a <= bed[0] + e && b <= bed[1] + e; };
    return (flat(size[0], size[1]) || flat(size[1], size[0])) && (!(bed[2] > 0) || size[2] <= bed[2] + e);
  }

  function mm(v) { return (v || []).map(function (n) { return String(Math.round(n * 10) / 10).replace('.', ','); }).join(' × ') + ' mm'; }

  // Alerte « trop grande » : le titre et ce qui dépasse, mesures lues par le slicer.
  function tooBigText(size, bed) {
    var detail = Array.isArray(size) && Array.isArray(bed) ? 'Elle mesure ' + mm(size) + ', et ton imprimante imprime jusqu’à ' + mm(bed) + '.' : '';
    return { title: 'Elle est trop grande pour le plateau.', text: detail };
  }

  // Réponse de /api/design → ce que le panneau fait : `kind` login | plan | error | question | refused | design ; `gauge` : la
  // jauge rendue avec la réponse ; `spent` : jauge vide renvoyée avec insufficient_credits.
  function designOutcome(status, j) {
    var F = mod('PlyoDesignFlow', './design-flow.js'), Logic = mod('PlyoLogic', './assistant-logic.js');
    j = j || {};
    var out = { gauge: j.credits && j.credits.gauge ? j.credits.gauge : null };
    if (status === 401) return Object.assign(out, { kind: 'login', text: 'Ta session a expiré : reconnecte-toi pour créer ta pièce.' });
    if (j.error === 'plan_required') return Object.assign(out, { kind: 'plan', text: F.TEXT.planRequired });
    if (status !== 200) return Object.assign(out, { kind: 'error', text: Logic.errorView(j.error || 'upstream_error', j).text, spent: j.error === 'insufficient_credits' && j.gauge ? j.gauge : null });
    if (j.status === 'question' && Array.isArray(j.questions) && j.questions.length) return Object.assign(out, { kind: 'question', questions: j.questions, message: j.message || '' });
    if (j.status !== 'design') return Object.assign(out, { kind: 'refused', text: j.message || 'Je ne peux pas dessiner cette pièce.' });
    return Object.assign(out, { kind: 'design' });
  }

  // Octets → base64, par tranches (une pièce dessinée fait vite plusieurs Mo).
  function base64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(bin);
  }
  // Pièce décrite par l'IA → fichier STL prêt pour model_add : { ok, error, name, data (base64), size (mm) }.
  // `M` : la bibliothèque chargée (designLibLoader).
  function designFile(M, part) {
    var D = mod('PlyoDesign', './design-builder.js'), F = mod('PlyoDesignFlow', './design-flow.js');
    var built = D.build(M, part);
    if (!built.ok) return { ok: false, error: built.error };
    return { ok: true, name: F.fileName(part), data: base64(D.toSTL(built.mesh, part.name)), size: built.size };
  }

  // manifold-3d, lue par le slicer dans ses ressources (la page est chargée comme texte) : module ES rendu classique, puis
  // instancié avec ses octets WebAssembly (la politique de sécurité permet 'wasm-unsafe-eval', jamais eval).
  // `env` : { post (vers le slicer), document, window }. Rend { load() → promesse de { Manifold, CrossSection }, onMessage(msg
  // « design_lib ») }. Un échec laisse réessayer au prochain appel.
  function designLibLoader(env) {
    var win = env.window || root, lib = { promise: null };
    function load() {
      if (lib.promise) return lib.promise;
      lib.promise = new Promise(function (resolve, reject) { lib.resolve = resolve; lib.reject = reject; });
      env.post({ type: 'design_lib_get' });
      return lib.promise;
    }
    function onMessage(msg) {
      var cur = lib;
      if (!cur.resolve) return;
      if (!msg.ok) { lib = { promise: null }; cur.reject(new Error('bibliothèque introuvable')); return; }
      try {
        var code = String(msg.js).replace(/import\.meta\.url/g, '"plyo://manifold.js"').replace(/export default Module;?\s*$/, 'window.__plyoManifold = Module;');
        var doc = env.document, tag = doc.createElement('script');
        var known = doc.querySelector ? doc.querySelector('script[nonce]') : null;
        tag.nonce = known ? known.nonce : '';
        tag.textContent = code;
        doc.head.appendChild(tag);
        var raw = win.atob(msg.wasm), bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        win.__plyoManifold({ wasmBinary: bytes }).then(function (w) {
          w.setup();
          cur.resolve({ Manifold: w.Manifold, CrossSection: w.CrossSection });
        }, function (e) { lib = { promise: null }; cur.reject(e); });
      } catch (e) { lib = { promise: null }; cur.reject(e); }
    }
    return { load: load, onMessage: onMessage };
  }

  // ---------- « Envie d'ajuster ? » : les ordres que le slicer exécute déjà pour l'assistant (message « commands ») ----------
  // La pièce du projet parmi celles du plateau (ai_context : { ref, name, size_mm, copies }) : son nom, sinon la sélectionnée,
  // sinon la première.
  function pieceObject(objects, name) {
    var list = Array.isArray(objects) ? objects.filter(function (o) { return o && typeof o === 'object'; }) : [];
    var base = String(name || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    return list.filter(function (o) { return String(o.name || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase() === base && base; })[0] ||
      list.filter(function (o) { return o.selected; })[0] || list[0] || null;
  }
  // Taille actuelle par rapport à la taille posée (la plus grande dimension : un quart de tour ne la change pas), en %.
  function sizePct(original, current) {
    if (!Array.isArray(original) || !Array.isArray(current)) return 100;
    var a = Math.max.apply(null, original), b = Math.max.apply(null, current);
    return a > 0 && b > 0 ? Math.round(b / a * 100) : 100;
  }
  var COPIES_MAX = 50, SIZE_MIN = 20, SIZE_MAX = 200;
  // `kind` : rotate | flat | copies | scale ; `o` : { ref, copies (voulu), from (% actuel), to (% voulu) }. Rend la liste des
  // ordres (avec leur phrase, rendue par le slicer pour chaque ordre fait), ou null si rien à faire.
  function adjustCommands(kind, o) {
    o = o || {};
    var c = null;
    if (kind === 'rotate') c = { op: 'rotate', axis: 'z', amount: 90, summary: 'Pièce tournée d’un quart de tour' };
    else if (kind === 'flat') c = { op: 'lay_flat', summary: 'Pièce posée sur sa plus grande face' };
    else if (kind === 'copies') {
      var n = Math.max(1, Math.min(COPIES_MAX, Math.round(Number(o.copies) || 1)));
      c = { op: 'set_copies', amount: n, summary: n > 1 ? n + ' exemplaires sur le plateau' : 'Un seul exemplaire sur le plateau' };
    } else if (kind === 'scale') {
      var from = Number(o.from) || 100, to = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(Number(o.to) || 100)));
      if (to === from) return null;
      c = { op: 'scale', amount: Math.round(to / from * 10000) / 100, summary: to === 100 ? 'Pièce remise à sa taille d’origine' : 'Pièce mise à ' + to + ' % de sa taille d’origine' };
    }
    if (!c) return null;
    if (o.ref) c.object = String(o.ref);
    return [c];
  }

  // « Mes pièces récentes » (deuxième projet) : les projets enregistrés qui ont une pièce, les plus récents d'abord, sans
  // celui affiché. `items` : liste du slicer (project_resume, conv_list) ; rend [{ id, title, detail }].
  function recentParts(items, currentId, max) {
    var Logic = mod('PlyoLogic', './assistant-logic.js');
    var list = (Array.isArray(items) ? items : []).filter(function (it) {
      return it && it.id && it.id !== currentId && it.project && it.project.part && typeof it.project.part.name === 'string' && it.project.part.name;
    });
    list.sort(function (a, b) { return String(b.updated || '') > String(a.updated || '') ? 1 : -1; });
    return list.slice(0, max || 3).map(function (it) { var e = Logic.projectEntry(it); return { id: it.id, title: e.title, detail: e.detail }; });
  }

  var api = { MAX_MODEL_BYTES: MAX_MODEL_BYTES, COPIES_MAX: COPIES_MAX, SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX,
    measuredElsewhere: measuredElsewhere, fits: fits, mm: mm, tooBigText: tooBigText, designOutcome: designOutcome, base64: base64,
    designFile: designFile, designLibLoader: designLibLoader, pieceObject: pieceObject, sizePct: sizePct, adjustCommands: adjustCommands,
    recentParts: recentParts };
  root.PlyoPiece = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
