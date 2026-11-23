// Assistant v2, étape 1 « Ta pièce » (lot 2) : déposer ou ouvrir un fichier, la galerie, « Créer avec l'IA » (description,
// croquis, photo par téléphone, puis « Changer quelque chose »), « Mes pièces récentes » (le petit bateau de test est dans la galerie) ; une fois
// la pièce posée : sa fiche, l'alerte « trop grande » et « Envie d'ajuster ? » (tourner, taille, copies, poser à plat, couper,
// ajouter une pièce). Mêmes messages au slicer que le panneau classique (model_add, gallery_get, plate_action, commands,
// open_tool, design_lib_get) ; logique partagée dans piece-logic.js, design-flow.js et design-builder.js.
// Vue seulement : PlyoV2.cards.piece rend la carte, PlyoV2.piece reçoit les fichiers et les réponses de l'IA (v2/panneau.js).
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var ui = V2.ui;
  var Piece = root.PlyoPiece, J = root.PlyoJourney, P = root.PlyoProject, F = root.PlyoDesignFlow, FS = root.PlyoFirstSteps, Logic = root.PlyoLogic;

  var panel = null;
  var request = 1000000;     // demandes au slicer de cette étape (plate_action, commands) : un compteur à part
  var MAX_COMMANDS = 6;      // ordres par envoi acceptés par le slicer (Commands::run)
  var USER_OPS = ['rotate', 'lay_flat', 'set_copies', 'scale']; // gestes que le slicer accepte sans fiche complète (ProjectLogic::user_plate_edit)
  var waiters = {};          // demande → suite (réponse du slicer)
  var sentPlate = {};        // demande plate_action → message et essais (relance d'une action refusée un instant)
  var gallery = null;        // modèles de la galerie lus par le slicer (null : pas encore demandés)
  var savedProjects = [];    // projets enregistrés (project_resume, conv_list) : « Mes pièces récentes »
  var lib = null;            // bibliothèque de dessin des pièces (piece-logic.js, designLibLoader)
  var EXAMPLES = ['Une équerre avec 2 trous de vis', 'Un crochet pour serviette', 'Une boîte 8 × 5 cm avec couvercle'];
  // Actions proposées par l'IA qui concernent la pièce (les autres viennent avec leurs étapes).
  var PIECE_ACTIONS = ['orient', 'arrange', 'scale_to_fit', 'open_tool', 'redesign'];

  // ---------- État de l'étape, pour la conversation affichée ----------
  function freshDesign(retouch, part) {
    return { retouch: !!retouch, text: '', images: [], busy: false, questions: [], answers: [], conversation: [], part: part || null, message: '', failed: false, planRequired: false, placing: null };
  }
  function fresh(id) {
    return { conv: id, screen: 'pick', cat: 'tout', adding: false, changing: false, offer: null, placing: '', error: null, queue: [],
      addingNow: false, arrangeAfter: false, tooBigNames: [], oldPart: null, newProjectFile: false,
      model: null, original: null, objects: null, bed: null, tooBig: false, kept: false, checkFit: false, entry: null,
      tool: null, working: false, last: null, toolAsked: false, design: freshDesign(false, null), said: null };
  }
  var S = fresh(null);
  function conv() { return panel ? panel.conv() : null; }
  function state() { var c = conv(); if (c && S.conv !== c.id) S = fresh(c.id); return S; }
  function project() { var c = conv(); return c ? c.project : P.emptyProject(); }
  function partName() { var p = project(); return p.part && p.part.name || ''; }
  function render() { if (panel) panel.render(); }
  function syncPhone() { if (panel) panel.syncPhone(); }
  function thread(text) { var c = conv(); if (c && root.PlyoThread && root.PlyoThread.add(c.project, 'etapes', text)) panel.scheduleSave(); }
  function note(text, tone) { panel.record({ kind: 'note', text: text, tone: tone || 'ok', icon: tone === 'error' ? 'alert' : 'check' }); }
  function signalsObjects() { var s = panel.tourSignals(); return s && typeof s.objects === 'number' ? s.objects : null; }
  function orcaPrinter() { var v = panel.values(); return v && v.context ? v.context.printer : ''; }

  // ---------- Petits éléments de la carte ----------
  function box(kind, iconName, title, text, acts) {
    var b = ui.el('div', 'note ' + (kind || ''));
    b.appendChild(ui.icon(iconName || 'info', 18));
    var body = ui.el('div', 'note-body');
    if (title) body.appendChild(ui.el('p', 'note-title', title));
    if (text) body.appendChild(ui.el('p', '', text));
    if (acts && acts.length) { var row = ui.el('div', 'acts'); acts.forEach(function (a) { if (a) row.appendChild(a); }); body.appendChild(row); }
    b.appendChild(body);
    b.body = body;
    return b;
  }
  function choice(iconName, title, sub, run, badge) {
    var b = ui.el('button', 'card');
    b.type = 'button';
    var ic = ui.el('span', 'ic');
    ic.appendChild(ui.icon(iconName, 22));
    b.appendChild(ic);
    var mid = ui.el('span', 'mid');
    mid.appendChild(ui.el('strong', '', title));
    if (sub) mid.appendChild(ui.el('small', '', sub));
    b.appendChild(mid);
    var end = ui.el('span', 'end');
    if (badge) end.appendChild(ui.el('span', 'badge ai', badge));
    end.appendChild(ui.icon('right', 16));
    b.appendChild(end);
    b.addEventListener('click', run);
    return b;
  }
  function section(text) { return ui.el('div', 'sec', text); }
  function spinLine(text) { var l = ui.el('div', 'scan'); l.appendChild(ui.el('span', 'spin')); l.appendChild(ui.el('span', '', text)); return l; }

  // ---------- Choisir la pièce ----------
  function openFile() { var input = document.getElementById('model-input'); if (input) input.click(); }
  function dropzone() {
    var dz = ui.el('div', 'dropzone');
    dz.setAttribute('role', 'button');
    dz.setAttribute('tabindex', '0');
    dz.setAttribute('aria-label', ui.fr('Dépose ta pièce ici, ou clique pour choisir un fichier'));
    dz.appendChild(ui.icon('upload', 28));
    dz.appendChild(ui.el('strong', '', 'Dépose ta pièce ici'));
    dz.appendChild(ui.el('span', '', 'STL, 3MF, OBJ ou STEP'));
    dz.addEventListener('click', openFile);
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(); } });
    ['dragenter', 'dragover'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation(); // le glisser-déposer du panneau ne le reprend pas une seconde fois
      dz.classList.remove('over');
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      var models = files.filter(function (f) { return FS.isModelFile(f.name); });
      if (models.length) addModels(models);
      else if (files.length) { state().error = { text: FS.unreadableFileText(files[0].name) }; render(); }
    });
    return dz;
  }

  function pickCard(ctx) {
    var st = state(), name = partName(), adding = st.adding && !!name;
    var body = ui.el('div', 'card-content');
    if (st.placing) body.appendChild(spinLine(st.placing));
    if (st.error) body.appendChild(errorBox(st.error));
    body.appendChild(dropzone());
    var cards = ui.el('div', 'cards');
    cards.appendChild(choice('folder', 'Ouvrir un fichier', 'STL, 3MF, OBJ, STEP depuis ton ordinateur', openFile));
    if (!adding) {
      cards.appendChild(choice('grid', 'Choisir dans la galerie', 'Des modèles testés, prêts à imprimer', openGallery));
      cards.appendChild(choice('spark', 'Créer avec l’IA', 'Décris la pièce ou montre un croquis', function () { whenChanging(function () { openDesign(false); }); }, 'IA'));
    }
    body.appendChild(cards);
    if (!adding) {
      body.appendChild(ui.el('p', 'small muted center', 'Un 3MF d’un autre créateur sera adapté à ta machine et à ta bobine.'));
    }
    if (st.changing && name) body.appendChild(box('tip', 'info', null, 'Une autre pièce choisie ici ouvre un nouveau projet, avec la même machine et la même bobine ; « ' + name + ' » reste dans tes projets.'));
    else if (st.oldPart && !name && !adding && signalsObjects() !== 0) body.appendChild(box('tip', 'info', null, '« ' + st.oldPart.label + ' », la pièce de ton projet d’avant, est encore sur le plateau : la pièce que tu choisis ici la remplace (« ' + st.oldPart.label + ' » reste dans tes projets).'));
    // Deuxième projet : les pièces des projets d'avant, rouvertes d'un clic avec leur plateau et leurs réglages.
    var recent = adding ? [] : Piece.recentParts(savedProjects, conv() && conv().id, 3);
    if (recent.length) {
      body.appendChild(section('Mes pièces récentes'));
      var list = ui.el('div', 'cards');
      recent.forEach(function (r) { list.appendChild(choice('cube', r.title, r.detail, function () { panel.openConversation(r.id); })); });
      body.appendChild(list);
    }
    var extra = [];
    if (adding) extra.push(ui.button('Annuler', function () { st.adding = false; render(); }, 'link muted'));
    else if (st.changing && name) extra.push(ui.button('Garder « ' + name + ' »', function () { st.changing = false; render(); }, 'link muted'));
    return {
      title: adding ? 'Quelle pièce ajouter ?' : 'Qu’est-ce qu’on imprime ?',
      sub: adding ? 'Elle se posera à côté de « ' + name + ' ».' : 'Choisis une pièce. Je m’occupe des réglages.',
      body: body, primary: null, extra: extra
    };
  }
  function errorBox(err) {
    var acts = [];
    if (err.pick !== false) acts.push(ui.button('Choisir un autre fichier', function () { state().error = null; openFile(); }, 'btn sm'));
    return box('error', 'alert', null, err.text, acts);
  }

  // « Ta pièce » rouverte avec une pièce : une autre pièce, c'est un autre projet (celui-ci reste dans « Mes projets »).
  function whenChanging(then) {
    var st = state(), name = partName();
    if (!(st.changing && name)) { then(); return; }
    var before = conv(), signals = panel.tourSignals();
    panel.newConversation();
    if (conv() === before) return;
    var now = state();
    now.oldPart = signals && signals.objects === 0 ? null : { label: name };
    then();
    panel.say('Nouveau projet pour cette pièce : « ' + name + ' » reste dans tes projets.');
  }

  // Fichiers 3D reçus (zone de dépôt, « Ouvrir un fichier », trombone, glisser-déposer sur le panneau).
  function addModels(files) {
    var st = state(), name = partName();
    if (!files.length || !panel) return;
    if (st.placing) { panel.say('Attends que la pièce en cours soit posée.'); return; }
    if (name && st.adding) { st.queue = files.slice(1); importModel(files[0], true); return; }
    if (name && st.changing) { whenChanging(function () { state().queue = files.slice(1); importModel(files[0], false); }); return; }
    if (name) { st.offer = files; panel.hold('piece'); return; } // sur ce plateau, ou un nouveau projet ?
    st.queue = files.slice(1);
    importModel(files[0], false);
  }
  function importModel(file, adding) {
    var st = state();
    if (file.size > Piece.MAX_MODEL_BYTES) {
      st.error = { text: '« ' + file.name + ' » est trop lourd pour passer par ce panneau (150 Mo au plus). Importe-le plutôt par le menu Fichier › Importer : je verrai la pièce arriver.', pick: false };
      render();
      return;
    }
    var reader = new root.FileReader();
    reader.onload = function () {
      var data = String(reader.result || ''), c = conv();
      st.addingNow = !!adding;
      panel.post({ type: 'model_add', name: file.name, data: data.slice(data.indexOf(',') + 1), project: c.project, conv: c.id,
        replace: adding ? false : P.replacesPlate(c.project, st.oldPart, st.newProjectFile) });
    };
    reader.onerror = function () { st.placing = ''; st.error = { text: '« ' + file.name + ' » n’a pas pu être lu.' }; render(); };
    st.placing = 'Je pose « ' + file.name + ' » sur le plateau…';
    st.error = null;
    st.offer = null;
    render();
    reader.readAsDataURL(file);
  }
  // Petit bateau de test et modèles de la galerie : posés par le slicer comme un fichier choisi.
  function importSample(sample) {
    var st = state(), c = conv();
    if (!c || st.placing) return;
    if (partName()) { panel.say('« ' + partName() + ' » est déjà sur le plateau.'); return; }
    var g = J.galleryList(gallery).filter(function (x) { return x.sample === sample; })[0];
    if (!g) return;
    st.placing = sample === 'benchy' ? 'Je pose le petit bateau de test sur le plateau…' : 'Je pose « ' + g.name + ' » sur le plateau…';
    st.error = null;
    st.screen = 'pick';
    render();
    panel.post({ type: 'model_add', sample: sample, project: c.project, conv: c.id, replace: P.replacesPlate(c.project, st.oldPart, st.newProjectFile) });
  }

  // Le slicer a posé (ou refusé) la pièce : fiche du projet, mesures, alerte « trop grande ».
  function onModelAdded(msg) {
    var c = conv();
    if (!c) return;
    var st = state();
    st.placing = '';
    if (!msg.ok && msg.busy) { st.queue = []; st.error = { text: msg.text, pick: false }; render(); return; }
    if (!msg.ok && msg.sample) {
      st.error = { text: (msg.text || 'Je n’ai pas pu poser le petit bateau de test.') + ' Choisis un fichier sur ton ordinateur, ou télécharge un modèle gratuit (par exemple sur printables.com), puis reviens ici.' };
      render();
      return;
    }
    if (!msg.ok) {
      st.queue = [];
      st.addingNow = false;
      st.error = { text: msg.reason === 'orca_refused' ? msg.text : (msg.text || 'Je n’ai pas pu poser cette pièce sur le plateau.') + ' Je prends les fichiers STL, 3MF, OBJ, STEP et AMF.' };
      if (st.design.placing) { st.design.placing = null; }
      render();
      return;
    }
    if (msg.adaptation && msg.name) c.project.adapted = msg.name; // adapté dès l'import : pas une deuxième fois
    var signals = panel.tourSignals();
    if (signals) signals.objects = Math.max(signals.objects || 0, 1); // sans attendre le prochain signal du plateau
    var first = !(c.project.part && c.project.part.name), adding = st.addingNow && !first;
    st.addingNow = false;
    st.error = null;
    if (Array.isArray(msg.file_colours) && msg.file_colours.length) c.project.file_colours = msg.file_colours.slice(0, 16);
    else if (first || msg.replaced > 0) delete c.project.file_colours;
    var m = msg.fits === false && Piece.measuredElsewhere(c.project, orcaPrinter()) ? Object.assign({}, msg, { fits: true }) : msg;
    thread((first ? 'Pièce posée : « ' : adding ? 'Pièce ajoutée au plateau : « ' : 'Pièce remplacée : « ') + msg.name + ' »' +
      (Array.isArray(msg.size_mm) ? ', ' + msg.size_mm.map(function (x) { return Math.round(x); }).join(' × ') + ' mm' : '') + (m.fits === false ? ' (trop grande pour le plateau)' : '') + '.');
    if (first) { c.project.part = { name: msg.name }; delete c.project.part_later; }
    else if (adding) {
      c.project.part.extra = (Array.isArray(c.project.part.extra) ? c.project.part.extra : []).concat([msg.name]).slice(0, 30);
      st.arrangeAfter = true;
    }
    if (m.fits === false) st.tooBigNames.push(msg.name);
    st.entry = panel.record({ kind: 'model', msg: m, reduced: false });
    if (!adding) {
      st.model = m;
      st.original = Array.isArray(m.size_mm) ? m.size_mm.slice() : null;
      st.tooBig = m.fits === false;
      st.kept = false;
      st.last = null;
    } else if (m.fits === false) st.tooBig = true;
    st.adding = false;
    st.changing = false;
    st.offer = null;
    st.newProjectFile = false;
    st.screen = 'pick';
    designPlaced(m);
    panel.scheduleSave();
    panel.hold('piece'); // la pièce posée reste à l'écran : « Envie d'ajuster ? », puis « Continuer »
    refreshPlate();
    nextQueued();
  }
  // Pièces suivantes d'un même choix : posées sans remplacer, puis le plateau est rangé par Orca.
  function nextQueued() {
    var st = state(), next = st.queue.shift();
    if (next) { importModel(next, true); return; }
    if (!st.arrangeAfter) { st.tooBigNames = []; return; }
    st.arrangeAfter = false;
    var big = st.tooBigNames;
    st.tooBigNames = [];
    plateAction('arrange', null, function (msg) {
      if (big.length) panel.say(J.arrangeTooBigText(big), 'warn');
      else if (!msg.ok) panel.say('Je n’ai pas pu ranger les pièces sur le plateau. Dans Plyo Slicer, le bouton « Organiser » (touche A) le fait aussi.', 'warn');
      refreshPlate();
    });
  }

  // ---------- Galerie ----------
  function openGallery() {
    var st = state();
    st.screen = 'gallery';
    if (gallery === null) panel.post({ type: 'gallery_get' });
    render();
  }
  function galleryCard() {
    var st = state(), items = J.galleryList(gallery);
    var cats = ['tout'].concat(['utile', 'jouet', 'déco', 'test'].filter(function (c) { return items.some(function (g) { return g.category === c; }); }));
    var body = ui.el('div', 'card-content');
    var tabs = ui.el('div', 'chips tabs');
    cats.forEach(function (c) {
      var b = ui.button(c === 'tout' ? 'Tout' : c[0].toUpperCase() + c.slice(1), function () { st.cat = c; render(); }, 'chip' + (st.cat === c ? ' sel' : ''));
      b.setAttribute('aria-pressed', st.cat === c ? 'true' : 'false');
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    var grid = ui.el('div', 'gallery');
    items.filter(function (g) { return st.cat === 'tout' || g.category === st.cat; }).forEach(function (g) {
      var b = ui.el('button', 'gitem');
      b.type = 'button';
      b.title = ui.fr(g.what || g.name);
      var th = ui.el('span', 'th');
      if (g.image) { var img = ui.el('img'); img.src = g.image; img.alt = ''; th.appendChild(img); }
      else th.appendChild(ui.icon(g.sample === 'benchy' ? 'boat' : 'cube', 34));
      b.appendChild(th);
      b.appendChild(ui.el('strong', '', g.name));
      b.appendChild(ui.el('small', '', g.credit ? g.category + ' · ' + g.credit : g.category));
      b.addEventListener('click', function () { whenChanging(function () { importSample(g.sample); }); });
      grid.appendChild(b);
    });
    body.appendChild(grid);
    if (gallery === null) body.appendChild(ui.el('p', 'small muted', 'Je cherche les autres modèles…'));
    return { title: 'Galerie', sub: 'Des modèles testés avec Plyo. Un clic et la pièce est sur le plateau.', body: body, primary: null,
      extra: [ui.button('Retour', function () { st.screen = 'pick'; render(); }, 'link muted')] };
  }

  // ---------- Créer avec l'IA ----------
  function openDesign(retouch) {
    var st = state(), c = conv();
    var keep = retouch ? (c.project.design && c.project.design.part) || st.design.part : null;
    st.design = freshDesign(retouch, keep);
    st.screen = 'design';
    if (partName()) panel.hold('piece'); else render();
    syncPhone(); // lien téléphone déjà ouvert : sa page demande maintenant le croquis
  }
  function closeDesign() { var st = state(); st.design.busy = false; st.screen = 'pick'; render(); syncPhone(); }
  function designSay(text, failed) { var d = state().design; d.busy = false; d.message = text; d.failed = !!failed; render(); }
  function designSubmit() {
    var st = state(), d = st.design;
    if (d.busy) return;
    if (!String(d.text || '').trim()) { designSay('Décris ta pièce en quelques mots.', true); return; }
    // Connexion demandée au premier appel à l'IA seulement ; la description repart seule ensuite.
    if (panel.requireLogin('Pour dessiner ta pièce, j’envoie ta description à l’IA : connecte-toi, sans mot de passe (tu reçois un code par e-mail). Ta description est gardée : elle partira dès que tu seras connecté.', designSubmit)) return;
    d.busy = true; d.message = ''; d.failed = false;
    render();
    lib.load().catch(function () {}); // en parallèle de la conception
    var c = conv(), v = panel.values() || {};
    var body = F.request(d, { locale: v.locale || 'fr', material: c.project.filament && !c.project.filament.proposed ? c.project.filament.type : '', requestId: Logic.newRequestId(root.crypto) });
    panel.apiFetch('/api/design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
    }).then(function (res) {
      if (state().design !== d) return; // annulé ou autre projet entre-temps
      var j = res.j || {}, o = Piece.designOutcome(res.status, j);
      if (o.gauge) panel.setGauge(o.gauge);
      if (o.kind === 'login') { designSay(o.text, true); return; }
      if (o.kind === 'plan') { d.planRequired = true; designSay(o.text, false); return; }
      if (o.kind === 'error') { if (o.spent) panel.setGauge(o.spent); designSay(o.text, true); return; }
      d.conversation.push({ role: 'user', text: body.text });
      if (j.message) d.conversation.push({ role: 'assistant', text: j.message });
      if (o.kind === 'question') { d.busy = false; d.questions = o.questions; d.answers = []; d.message = o.message; d.text = ''; render(); return; }
      if (o.kind === 'refused') { d.text = ''; designSay(o.text, false); return; }
      designPlace(j, d);
    }).catch(function () { if (state().design === d) designSay(Logic.errorView('network').text, true); });
  }
  function designPlace(answer, asked) {
    lib.load().then(function (M) {
      var st = state();
      if (st.design !== asked) return;
      var built = Piece.designFile(M, answer.part);
      if (!built.ok) { designSay('Je n’ai pas pu fabriquer cette pièce (' + built.error + '). Redécris-la plus simplement.', true); return; }
      var c = conv();
      c.project.design = { part: answer.part }; // gardée avec le projet : retouches depuis la discussion, et après un redémarrage
      panel.scheduleSave();
      st.design = freshDesign(false, answer.part);
      st.design.conversation = asked.conversation;
      st.design.placing = { message: answer.message || '', size: built.size, name: built.name, retouch: !!asked.retouch };
      st.screen = 'pick';
      st.placing = 'Je pose « ' + answer.part.name + ' » sur le plateau…';
      panel.post({ type: 'model_add', name: built.name, data: built.data, project: c.project, conv: c.id,
        replace: asked.retouch || P.replacesPlate(c.project, st.oldPart, st.newProjectFile) });
      render();
      syncPhone();
    }, function () { if (state().design === asked) designSay('Je n’arrive pas à charger l’outil de dessin des pièces. Relance Plyo Slicer, puis réessaie.', true); });
  }
  // Pièce dessinée posée : ce que c'est, ses cotes (les supposées signalées), et « Changer quelque chose ».
  function designPlaced(msg) {
    var st = state(), p = st.design.placing;
    if (!p || (msg.name !== p.name.replace(/\.stl$/, '') && msg.name !== p.name)) return;
    st.design.placing = null;
    var part = st.design.part, c = conv();
    thread('Pièce ' + (p.retouch ? 'retouchée' : 'dessinée') + ' par Plyo : « ' + part.name + ' », ' + root.PlyoDesign.sizeText(p.size) + (p.message ? '. ' + p.message : '.'));
    // Retouchée après la préparation : nouvelle pièce, le parcours repart de « Préparer » (découper à nouveau).
    if (F.redoesPreparation(J.currentStep(c.project), p.retouch)) { delete c.project.success; c.project.step = 'slice'; st.said = { redo: true }; }
    st.said = Object.assign(st.said || {}, { message: p.message, dims: F.dimensionLines(part) });
  }
  function designCard() {
    var st = state(), d = st.design;
    var body = ui.el('div', 'card-content');
    if (d.busy) {
      body.appendChild(spinLine('Je trace les contours, puis je place les trous.'));
      return { title: 'Je dessine ta pièce…', sub: 'Ça prend une dizaine de secondes.', body: body, primary: null, extra: [] };
    }
    if (d.questions.length) {
      if (d.message) body.appendChild(ui.rich(d.message));
      d.questions.forEach(function (q, i) {
        body.appendChild(ui.el('p', 'q', q.text));
        var row = ui.el('div', 'chips');
        q.choices.forEach(function (ch) {
          row.appendChild(ui.button(ch, function () {
            d.answers[i] = ch;
            if (d.answers.filter(Boolean).length < d.questions.length) { render(); return; }
            d.text = F.answersText(d.questions, d.answers);
            d.questions = []; d.answers = [];
            designSubmit();
          }, 'chip' + (d.answers[i] === ch ? ' sel' : '')));
        });
        body.appendChild(row);
      });
      return { title: 'Une précision', sub: 'Clique sur ta réponse.', body: body, primary: null,
        extra: [ui.button('Annuler', closeDesign, 'link muted')] };
    }
    if (d.message) body.appendChild(box(d.failed ? 'error' : 'tip', d.failed ? 'alert' : 'info', null, d.message));
    var ta = ui.el('textarea', 'field');
    ta.id = 'design-text';
    ta.rows = 4;
    ta.maxLength = 2000;
    ta.value = d.text || '';
    ta.placeholder = ui.fr(d.retouch ? 'Ex. : plus épaisse de 2 mm, un trou de 5 mm au centre' : 'Ex. : une équerre de 6 cm avec deux trous de vis de 4 mm');
    ta.setAttribute('aria-label', ui.fr(d.retouch ? 'Ce que je change' : 'Ta pièce'));
    ta.addEventListener('input', function () { d.text = ta.value; });
    body.appendChild(ta);
    if (!d.retouch) {
      var ex = ui.el('div', 'chips');
      EXAMPLES.forEach(function (t) { ex.appendChild(ui.button(t, function () { d.text = t; ta.value = t; }, 'chip')); });
      body.appendChild(ex);
    }
    d.images.forEach(function (img, i) {
      var row = ui.el('div', 'att-line');
      if (img.preview) { var th = ui.el('img'); th.src = img.preview; th.alt = ''; row.appendChild(th); }
      row.appendChild(ui.el('span', 'grow small', img.name || F.TEXT.attached));
      row.appendChild(ui.button('Retirer', function () { d.images.splice(i, 1); render(); }, 'link'));
      body.appendChild(row);
    });
    if (d.images.length < F.MAX_IMAGES && !d.retouch) {
      var row = ui.el('div', 'row');
      row.appendChild(ui.button('Joindre un croquis', attachSketch, 'btn sm', 'clip'));
      row.appendChild(ui.button('Photo avec mon téléphone', function () { panel.openPhone(); }, 'btn sm', 'phone'));
      body.appendChild(row);
    }
    body.appendChild(box('tip', 'info', null, d.retouch ? F.TEXT.retouchHelp : 'Mesure la place disponible avant : je dessine au millimètre près. ' + F.TEXT.scope));
    if (d.planRequired) {
      // Formule requise : les formules s'ouvrent d'ici (fenêtre de la v2, v2/menu.js), comme après une question.
      return { title: 'Créer avec l’IA', sub: null, body: body, primary: { label: 'Voir les formules', run: function () { if (V2.menu) V2.menu.openPlans(); } },
        extra: [ui.button('Retour', closeDesign, 'link muted')] };
    }
    return {
      title: d.retouch ? F.TEXT.retouchTitle : 'Créer avec l’IA',
      sub: d.retouch ? null : 'Décris la pièce avec tes mots, avec ses mesures si tu les connais.',
      body: body,
      primary: { label: d.retouch ? F.TEXT.retouchGo : 'Créer ma pièce', icon: 'spark', run: designSubmit },
      extra: [ui.button(d.retouch ? 'Annuler' : 'Retour', closeDesign, 'link muted')]
    };
  }
  // Croquis ou photo joint à la description : réduit à 1 600 px (photo-tools.js), deux images au plus.
  function attachSketch() {
    var pick = document.getElementById('sketch-input');
    if (pick) pick.click();
  }
  function addSketches(files) {
    var d = state().design;
    files.slice(0, Math.max(0, F.MAX_IMAGES - d.images.length)).forEach(function (file) {
      root.PlyoPhotos.downscale(file).then(function (a) {
        if (state().design !== d || d.images.length >= F.MAX_IMAGES) return;
        d.images.push({ name: String(file.name || '').slice(0, 60), media_type: a.media_type, data: a.data, preview: a.preview });
        render();
      }, function () { designSay('Je n’ai pas pu lire cette image : choisis un fichier PNG ou JPEG.', true); });
    });
  }
  // Croquis venu du téléphone : joint au formulaire, comme « Joindre un croquis ».
  function takeSketch(batch) {
    var st = state(), d = st.design;
    if (st.screen !== 'design' || d.retouch) return false;
    var room = F.MAX_IMAGES - d.images.length, photos = batch.photos.slice(0, Math.max(0, room));
    photos.forEach(function (p, i) { d.images.push({ name: 'Photo du téléphone' + (photos.length > 1 ? ' ' + (i + 1) : ''), media_type: p.media_type, data: p.data, preview: p.preview }); });
    if (batch.message && !String(d.text || '').trim()) d.text = batch.message;
    if (!photos.length) d.message = 'Ta pièce a déjà ' + F.MAX_IMAGES + ' images : retire-en une pour joindre celle du téléphone.';
    render();
    return true;
  }

  // ---------- Pièce posée : fiche, « trop grande », « Envie d'ajuster ? » ----------
  function current() { var st = state(); return Piece.pieceObject(st.objects, partName()); }
  // Plusieurs pièces sur le plateau : « Envie d'ajuster ? » demande laquelle (ou « Toutes »). st.target : ref, 'all' ou rien.
  function targets() { return Piece.plateTargets(state().objects); }
  function manyTargets() { return targets().length > 1; }
  function chosen() {
    var st = state(), list = targets();
    if (list.length < 2) return null;
    if (st.target === 'all') return 'all';
    return list.filter(function (t) { return t.ref === st.target; })[0] || null;
  }
  function pickTarget(ref) {
    var st = state(), pending = st.needTarget;
    st.target = ref;
    st.needTarget = null;
    st.tool = null;
    if (pending === 'rotate' || pending === 'flat') { adjust(pending); return; }
    if (pending === 'scale' || pending === 'copies') st.tool = pending;
    render();
  }
  function refreshPlate() { if (panel) panel.post({ type: 'ai_context' }); }
  function onPlate(msg) {
    var st = state();
    if (!msg.plate || !Array.isArray(msg.plate.objects)) return;
    st.objects = msg.plate.objects;
    st.bed = Array.isArray(msg.plate.bed_mm) ? msg.plate.bed_mm : st.bed;
    // Pièce choisie disparue du plateau : on redemande. Rien de choisi : la pièce sélectionnée dans Orca, s'il n'y en a qu'une.
    var list = targets();
    if (st.target && st.target !== 'all' && !list.some(function (t) { return t.ref === st.target; })) st.target = null;
    if (!st.target && list.length > 1) {
      var sel = list.filter(function (t) { return t.selected; });
      if (sel.length === 1) st.target = sel[0].ref;
    }
    var o = current();
    // La mesure du plateau lève l'alerte quand la pièce tient ; elle ne la pose qu'après un changement de taille fait ici.
    if (o && st.bed && !Piece.measuredElsewhere(project(), orcaPrinter())) {
      var ok = Piece.fits(o.size_mm, st.bed);
      if (ok) st.tooBig = false;
      else if (st.checkFit && !st.kept) st.tooBig = true;
    }
    st.checkFit = false;
    if (partName() && st.screen === 'pick') render();
  }
  function plateAction(kind, extra, after) {
    var id = ++request;
    sentPlate[id] = { message: Object.assign({ type: 'plate_action', kind: kind, request: id }, extra || {}), tries: 0 };
    waiters[id] = after || null;
    panel.post(sentPlate[id].message);
  }
  function onPlateAction(msg) {
    var sent = sentPlate[msg.request];
    if (!sent) return;
    var wait = Logic.plateRetryDelay(msg, sent.tries);
    if (wait) { sent.tries += 1; setTimeout(function () { panel.post(sent.message); }, wait); return; }
    delete sentPlate[msg.request];
    var after = waiters[msg.request];
    delete waiters[msg.request];
    if (after) after(msg);
  }
  // Ordres sur la pièce (« commands », comme ceux de l'IA) : une seule étape d'annulation par envoi.
  // `byUser` : geste fait à la main dans « Envie d'ajuster ? » (tourner, taille, copies, poser à plat). Le slicer l'accepte sans
  // imprimante ni bobine choisies : la pièce se prépare à l'étape 1. Les ordres proposés par l'IA restent soumis à la fiche du projet.
  function runCommands(list, after, byUser) {
    var id = ++request;
    waiters[id] = after;
    var msg = { type: 'commands', commands: list, request: id };
    if (byUser) msg.by_user = true;
    panel.post(msg);
  }
  function onCommands(msg) {
    var after = waiters[msg.request];
    if (!after) return;
    delete waiters[msg.request];
    after(msg);
  }
  function setLast(text, tone, undo) { var st = state(); st.last = { text: text, tone: tone || '', undo: undo === undefined ? null : undo }; }
  function adjust(kind, o) {
    var st = state();
    if (st.working) return;
    if (kind === 'cut') { st.tool = null; st.toolAsked = true; panel.post({ type: 'open_tool', tool: 'cut' }); return; }
    if (kind === 'add') { st.tool = null; st.adding = true; render(); return; }
    var many = manyTargets(), target = chosen();
    if (many && !target) { st.needTarget = kind; st.tool = null; render(); return; }
    if ((kind === 'scale' || kind === 'copies') && !o) { st.tool = st.tool === kind ? null : kind; render(); return; }
    var list;
    if (target === 'all') list = Piece.adjustMany(kind, targets(), o);
    else if (target) list = Piece.adjustCommands(kind, Object.assign({ ref: target.ref, label: target.label }, o || {}));
    else { var obj = current(); list = Piece.adjustCommands(kind, Object.assign({ ref: obj && obj.ref }, o || {})); }
    if (!list) return;
    st.working = true;
    setLast('Je modifie le plateau…', 'busy');
    render();
    runCommands(list, function (msg) {
      st.working = false;
      var done = (msg.done || []).filter(Boolean);
      if (done.length) {
        setLast(done.join(' · ') + (msg.text ? ' ' + msg.text : ''), 'ok', msg.undo_token);
        thread(done.join(' · ') + '.');
        note(done.join(' · ') + '.', 'ok');
      } else setLast(msg.text || 'Rien n’a changé sur le plateau.', 'error');
      if (kind === 'scale') st.checkFit = true;
      render();
      refreshPlate();
    }, true);
  }
  function undoLast() {
    var st = state(), token = st.last && st.last.undo;
    if (token === null || token === undefined) return;
    st.last.undo = null;
    plateAction('undo', { undo_token: token }, function (msg) {
      setLast(msg.ok ? 'C’est annulé : le plateau est revenu comme avant.' : msg.text, msg.ok ? '' : 'error', msg.ok ? null : token);
      render();
      refreshPlate();
    });
    render();
  }
  function reduce() {
    var st = state();
    if (st.working) return;
    st.working = true;
    render();
    plateAction('scale_to_fit', null, function (msg) {
      st.working = false;
      if (msg.ok) {
        st.tooBig = false;
        if (st.entry) { st.entry.reduced = true; panel.scheduleSave(); }
        setLast(Logic.plateText(msg, st.model && st.model.count), 'ok', msg.undo_token);
        note(Logic.plateText(msg, st.model && st.model.count), 'ok');
      } else setLast(msg.text, 'error');
      render();
      refreshPlate();
    });
  }

  function placedCard(ctx) {
    var st = state(), p = project(), name = partName(), obj = current();
    var size = obj && Array.isArray(obj.size_mm) ? obj.size_mm : st.model && st.model.size_mm;
    var copies = obj && obj.copies ? obj.copies : 1;
    var pct = obj && obj.scale_pct ? obj.scale_pct : Piece.sizePct(st.original, obj && obj.size_mm);
    var list = targets(), target = chosen();
    var body = ui.el('div', 'card-content');
    // Mesures et exemplaires lus sur le plateau (ai_context), une fois par projet affiché.
    if (!st.objects && !st.plateAsked) { st.plateAsked = true; setTimeout(refreshPlate, 0); }
    // Fiche de la pièce : nom, exemplaires, mesures lues sur le plateau.
    var line = ui.el('div', 'summary-line');
    var ic = ui.el('span', 'ic'); ic.appendChild(ui.icon('cube', 22)); line.appendChild(ic);
    var mid = ui.el('div', 'grow');
    mid.appendChild(ui.el('strong', '', name + (copies > 1 ? ' × ' + copies : '')));
    if (size) mid.appendChild(ui.el('small', '', Piece.mm(size) + (pct !== 100 ? ' · ' + pct + ' %' : '')));
    line.appendChild(mid);
    var change = ui.button('Changer', function () { st.changing = true; st.tool = null; render(); }, 'btn sm');
    change.id = 'piece-change';
    line.appendChild(change);
    body.appendChild(line);
    (p.part && Array.isArray(p.part.extra) ? p.part.extra : []).forEach(function (n) {
      var l = ui.el('div', 'summary-line');
      var i2 = ui.el('span', 'ic'); i2.appendChild(ui.icon('cube', 18)); l.appendChild(i2);
      l.appendChild(ui.el('strong', 'grow', n));
      body.appendChild(l);
    });
    if (st.placing) body.appendChild(spinLine(st.placing));
    if (st.error) body.appendChild(errorBox(st.error));
    // Une autre pièce déposée : sur ce plateau, ou un nouveau projet ?
    if (st.offer) {
      var files = st.offer, more = files.length - 1;
      body.appendChild(box('tip', 'cube', null, (more ? '« ' + files[0].name + ' » et ' + more + (more > 1 ? ' autres pièces' : ' autre pièce') : '« ' + files[0].name + ' »') + ' : sur le même plateau que « ' + name + ' », ou dans un nouveau projet ?', [
        ui.button('L’ajouter à ce plateau', function () { st.offer = null; st.queue = files.slice(1); importModel(files[0], true); }, 'btn sm'),
        ui.button('Nouveau projet', function () { st.offer = null; st.changing = true; whenChanging(function () { state().queue = files.slice(1); importModel(files[0], false); }); }, 'btn sm'),
        ui.button('Annuler', function () { st.offer = null; render(); }, 'link muted')
      ]));
    }
    if (st.tooBig) {
      var bed = st.bed || (st.model && st.model.bed_mm);
      var t = Piece.tooBigText(size, bed);
      var red = ui.button('Réduire pour que ça tienne', reduce, 'btn sm main', 'scale');
      red.id = 'piece-reduce';
      red.disabled = st.working;
      body.appendChild(box('warn', 'alert', t.title, t.text, [red,
        ui.button('Couper', function () { adjust('cut'); }, 'btn sm', 'cut'),
        ui.button('Garder cette taille', function () { st.kept = true; st.tooBig = false; render(); }, 'link muted')]));
    } else if (st.model) {
      body.appendChild(box('ok', 'check', null, 'Elle tient sur le plateau.'));
    }
    // Un 3MF adapté à la machine et au filament dès l'import, ou en plusieurs couleurs sur une machine à une bobine : dit ici.
    var ad = st.model && st.model.adaptation;
    if (ad && (Array.isArray(ad.adapted) && ad.adapted.length || ad.error)) {
      body.appendChild(ui.el('p', 'small muted', ad.error ? 'Je n’ai pas pu adapter les réglages de ce fichier à ton projet : ' + ad.error
        : 'J’ai adapté ce fichier à ton imprimante et à ton filament : ' + ad.adapted.length + ' réglage' + (ad.adapted.length > 1 ? 's' : '') + ' changé' + (ad.adapted.length > 1 ? 's' : '') + '.'));
    }
    if (st.model && st.model.colours_ignored > 1) body.appendChild(ui.el('p', 'small muted', J.coloursIgnoredText(st.model.name, st.model.colours_ignored)));
    // Pièce dessinée par Plyo : ses cotes, et « Changer quelque chose ».
    if (p.design && p.design.part) {
      var said = st.said || {}, dims = said.dims || F.dimensionLines(p.design.part);
      var txt = [said.message, dims.length ? 'Cotes : ' + dims.join(', ') + '. ' + F.TEXT.check : '', said.redo ? F.REDO_TEXT : ''].filter(Boolean).join(' ');
      if (txt) body.appendChild(ui.el('p', 'small muted', txt));
      body.appendChild(ui.button('Changer quelque chose sur la pièce', function () { openDesign(true); }, 'btn sm', 'spark'));
    }
    body.appendChild(section('Envie d’ajuster ? (facultatif)'));
    if (list.length > 1) body.appendChild(targetPicker(list, st));
    var grid = ui.el('div', 'acts-grid');
    [['rotate', 'rotate', 'Tourner'], ['scale', 'scale', 'Taille'], ['copies', 'copy', 'Copies'], ['flat', 'flat', 'Poser à plat'], ['cut', 'cut', 'Couper'], ['add', 'plus', 'Ajouter une pièce']].forEach(function (x) {
      var b = ui.el('button', 'act' + (st.tool === x[0] ? ' on' : ''));
      b.type = 'button';
      b.dataset.adjust = x[0];
      b.appendChild(ui.icon(x[1], 22));
      b.appendChild(ui.el('span', '', x[2]));
      b.disabled = st.working;
      if (x[0] === 'scale' || x[0] === 'copies') b.setAttribute('aria-expanded', st.tool === x[0] ? 'true' : 'false');
      b.addEventListener('click', function () { adjust(x[0]); });
      grid.appendChild(b);
    });
    body.appendChild(grid);
    if (st.tool === 'scale') body.appendChild(target === 'all' ? scalePop(commonPct(list), true) : scalePop(target ? Piece.targetPct(target, target.ref === (obj && obj.ref) ? st.original : null) : pct));
    if (st.tool === 'copies') body.appendChild(target === 'all' ? copiesAllPop(list) : copiesPop(target ? target.copies : copies));
    if (st.last) {
      var last = ui.el('div', 'done-line ' + (st.last.tone || ''));
      last.setAttribute('role', 'status');
      if (st.last.tone === 'busy') last.appendChild(ui.el('span', 'spin'));
      else last.appendChild(ui.icon(st.last.tone === 'error' ? 'alert' : 'check', 16));
      last.appendChild(ui.el('span', 'grow', st.last.text));
      if (st.last.undo !== null && st.last.undo !== undefined) last.appendChild(ui.button('Annuler', undoLast, 'link', 'undo'));
      body.appendChild(last);
    }
    var many = p.part && Array.isArray(p.part.extra) && p.part.extra.length;
    return {
      title: many ? 'Tes pièces sont sur le plateau' : 'Ta pièce est sur le plateau',
      sub: null,
      body: body,
      // Rouverte depuis la barre : le bouton de la carte ramène à l'étape en cours (v2/etapes.js).
      primary: ctx.revisit ? null : { label: 'Continuer', run: function () { st.tool = null; panel.hold(null); }, disabled: st.tooBig || !!st.placing }
    };
  }
  // Toutes les pièces : à la même taille, en % de leur taille d'origine (celles déjà à cette taille ne bougent pas).
  function commonPct(list) {
    var all = list.map(function (t) { return Piece.targetPct(t); });
    return all.every(function (v) { return v === all[0]; }) ? all[0] : 100;
  }
  function targetPicker(list, st) {
    var wrap = ui.el('div', 'target-pick');
    wrap.appendChild(ui.el('span', 'small muted', st.needTarget ? 'Quelle pièce ? Choisis-la, puis je m’en occupe.' : 'Quelle pièce ?'));
    var row = ui.el('div', 'chips');
    list.forEach(function (t) {
      var b = ui.button(t.label + (t.copies > 1 ? ' × ' + t.copies : ''), function () { pickTarget(t.ref); }, 'chip' + (st.target === t.ref ? ' sel' : ''));
      b.setAttribute('aria-pressed', st.target === t.ref ? 'true' : 'false');
      row.appendChild(b);
    });
    var all = ui.button('Toutes', function () { pickTarget('all'); }, 'chip' + (st.target === 'all' ? ' sel' : ''));
    all.setAttribute('aria-pressed', st.target === 'all' ? 'true' : 'false');
    row.appendChild(all);
    wrap.appendChild(row);
    if (st.needTarget) wrap.classList.add('ask');
    return wrap;
  }
  function copiesAllPop(list) {
    var pop = ui.el('div', 'inline-pop pop-head');
    pop.appendChild(ui.el('span', 'grow', 'Un exemplaire de plus ou de moins pour chaque pièce'));
    var minus = ui.button('−', function () { adjust('copies', { delta: -1 }); }, 'btn sm');
    minus.disabled = list.every(function (t) { return t.copies <= 1; });
    minus.setAttribute('aria-label', ui.fr('Un exemplaire de moins pour chaque pièce'));
    var plus = ui.button('+', function () { adjust('copies', { delta: 1 }); }, 'btn sm');
    plus.disabled = list.every(function (t) { return t.copies >= Piece.COPIES_MAX; });
    plus.setAttribute('aria-label', ui.fr('Un exemplaire de plus pour chaque pièce'));
    pop.appendChild(minus);
    pop.appendChild(plus);
    return pop;
  }
  function scalePop(pct, all) {
    var pop = ui.el('div', 'inline-pop');
    var head = ui.el('div', 'pop-head');
    head.appendChild(ui.el('span', '', all ? 'Taille de toutes les pièces' : 'Taille de la pièce'));
    var label = ui.el('b', '', pct + ' %');
    head.appendChild(label);
    pop.appendChild(head);
    var range = ui.el('input');
    range.type = 'range';
    range.min = String(Piece.SIZE_MIN); range.max = String(Piece.SIZE_MAX); range.step = '5';
    range.value = String(pct);
    range.setAttribute('aria-label', ui.fr('Taille en pourcentage de la taille d’origine'));
    range.addEventListener('input', function () { label.textContent = ui.fr(range.value + ' %'); });
    range.addEventListener('change', function () { adjust('scale', { from: pct, to: Number(range.value) }); });
    pop.appendChild(range);
    var row = ui.el('div', 'chips');
    [50, 75, 100, 150].forEach(function (v) {
      row.appendChild(ui.button(v === 100 ? 'Taille d’origine' : v + ' %', function () { adjust('scale', { from: pct, to: v }); }, 'chip' + (v === pct ? ' sel' : '')));
    });
    pop.appendChild(row);
    return pop;
  }
  function copiesPop(copies) {
    var pop = ui.el('div', 'inline-pop pop-head');
    pop.appendChild(ui.el('span', 'grow', 'Combien d’exemplaires ?'));
    var minus = ui.button('−', function () { adjust('copies', { copies: copies - 1 }); }, 'btn sm');
    minus.disabled = copies <= 1;
    minus.setAttribute('aria-label', ui.fr('Un exemplaire de moins'));
    var plus = ui.button('+', function () { adjust('copies', { copies: copies + 1 }); }, 'btn sm');
    plus.disabled = copies >= Piece.COPIES_MAX;
    plus.setAttribute('aria-label', ui.fr('Un exemplaire de plus'));
    pop.appendChild(minus);
    pop.appendChild(ui.el('b', 'count', String(copies)));
    pop.appendChild(plus);
    return pop;
  }

  // ---------- La carte de l'étape ----------
  V2.cards = V2.cards || {};
  V2.cards.piece = function (ctx) {
    if (!panel) return { title: 'Qu’est-ce qu’on imprime ?', sub: 'Choisis une pièce. Je m’occupe des réglages.', body: null, primary: null };
    var st = state();
    if (st.screen === 'design') return designCard();
    if (st.screen === 'gallery') return galleryCard();
    if (partName() && !st.adding && !st.changing) return placedCard(ctx);
    return pickCard(ctx);
  };

  // ---------- Réponses de l'IA : ordres sur le plateau et actions sur la pièce ----------
  function line(text, tone, iconName) {
    var l = ui.el('div', 'done-line ' + (tone || ''));
    l.appendChild(ui.icon(iconName || (tone === 'error' ? 'alert' : tone === 'ok' ? 'check' : 'info'), 16));
    l.appendChild(ui.el('span', 'grow', text));
    return l;
  }
  // Les ordres de l'IA sont exécutés dès la réponse (en une étape annulable), comme dans le classique ; la conversation garde ce
  // qui a été fait. Une conversation rouverte ne les rejoue pas.
  function commandsView(entry, archived) {
    var a = entry.data, wrap = ui.el('div', 'cmds');
    function show(result) {
      wrap.textContent = '';
      result.done.forEach(function (d) { wrap.appendChild(line(d || 'Fait sur le plateau', 'ok')); });
      if (result.text) wrap.appendChild(line(result.text, 'error'));
      (result.skipped || []).forEach(function (t) { if (t) wrap.appendChild(line(t, '')); });
      if (result.undone) wrap.appendChild(line('Annulé : le plateau est revenu comme avant.', '', 'undo'));
    }
    if (entry.commandsResult) { show(entry.commandsResult); return wrap; }
    if (archived) { wrap.appendChild(line('Ces changements n’ont pas été faits sur le plateau.', '')); return wrap; }
    var list = (a.commands || []).map(function (c) { return c && typeof c === 'object' && !Array.isArray(c) ? Object.assign({}, c, { summary: Logic.commandSummary(c) }) : c; });
    // Fiche du projet incomplète : le slicer refuse les ordres de l'IA. Des gestes simples (tourner, taille, copies, poser à
    // plat) se font quand même, sur ton clic, comme dans « Envie d'ajuster ? » ; les autres attendent la machine et la bobine.
    var incomplete = J.stillMissing(project(), ['printer', 'part', 'filament']);
    var simple = list.length > 0 && list.length <= MAX_COMMANDS && list.every(function (c) { return c && USER_OPS.indexOf(c.op) >= 0; });
    if (incomplete.length && incomplete.indexOf('part') < 0 && simple) {
      wrap.appendChild(line(list.map(function (c) { return c.summary; }).filter(Boolean).join(' · ') || 'Changements proposés sur la pièce', ''));
      wrap.appendChild(ui.button('Faire ces changements sur le plateau', function () { wrap.textContent = ''; wrap.appendChild(line('Je modifie le plateau…', '')); run(true); }, 'btn sm main', 'spark'));
      return wrap;
    }
    wrap.appendChild(line('Je modifie le plateau…', ''));
    run(false);
    return wrap;
    function run(byUser) {
    runCommands(list, function (msg) {
      entry.commandsResult = { done: msg.done || [], text: msg.text || '', skipped: msg.skipped || [] };
      if (entry.hist) entry.hist.text = root.PlyoConversation.summaryForHistory(a, entry.commandsResult).slice(0, 2000);
      panel.scheduleSave();
      show(entry.commandsResult);
      refreshPlate();
      // Refus parce que la fiche est incomplète : le bouton qui mène au choix, puis « Réessayer » ici.
      if (!msg.ok && Array.isArray(msg.missing) && msg.missing.length) {
        var acts = panel.refusalActions(msg, null, 'C’est noté. Retourne dans la conversation : « Réessayer » fait les changements proposés sur le plateau.');
        acts.forEach(function (x) { wrap.appendChild(ui.button(x.label, x.run, 'btn sm main')); });
        wrap.appendChild(ui.button('Réessayer', function () { delete entry.commandsResult; wrap.textContent = ''; wrap.appendChild(line('Je modifie le plateau…', '')); run(byUser); }, 'btn sm'));
        return;
      }
      if (msg.undo_token === undefined || !entry.commandsResult.done.length) return;
      var undo = ui.button('Annuler', function () {
        undo.disabled = true;
        plateAction('undo', { undo_token: msg.undo_token }, function (r) {
          if (!r.ok) { undo.disabled = false; wrap.appendChild(line(r.text, 'error')); return; }
          entry.commandsResult.undone = true;
          panel.scheduleSave();
          show(entry.commandsResult);
          refreshPlate();
        });
      }, 'link', 'undo');
      wrap.appendChild(undo);
    }, byUser);
    }
  }
  function actionsView(actions) {
    var row = ui.el('div', 'acts');
    actions.forEach(function (a) {
      var b = ui.button(a.label, function () {
        if (a.kind === 'open_tool') { panel.post({ type: 'open_tool', tool: a.target }); return; }
        b.disabled = true;
        if (a.kind === 'redesign') {
          // Retouche demandée dans la discussion : elle part au concepteur avec la pièce en cours ; on suit dans la carte.
          openDesign(true);
          state().design.text = String(a.target || '').slice(0, 200);
          designSubmit();
          return;
        }
        plateAction(a.kind, null, function (msg) {
          var text = Logic.plateText(msg, 1);
          row.appendChild(line(text, msg.ok ? 'ok' : 'error'));
          if (!msg.ok) b.disabled = false;
          if (msg.ok && a.kind === 'scale_to_fit') { var st = state(); st.tooBig = false; if (st.entry) st.entry.reduced = true; }
          if (msg.ok) note(text, 'ok');
          refreshPlate();
          render();
        });
      }, 'btn sm', a.kind === 'open_tool' ? 'info' : 'spark');
      row.appendChild(b);
    });
    return row;
  }
  function answerExtras(entry, box, archived) {
    var a = entry.data || {};
    if (Array.isArray(a.commands) && a.commands.length) box.appendChild(commandsView(entry, archived));
    if (archived) return;
    var acts = (a.actions || []).filter(function (x) { return Logic.actionSupported(x) && PIECE_ACTIONS.indexOf(x.kind) >= 0; });
    if (acts.length) box.appendChild(actionsView(acts));
  }

  // ---------- Branchement sur le panneau (v2/panneau.js) ----------
  function plug(p) {
    panel = p;
    lib = Piece.designLibLoader({ post: p.post, document: document, window: root });
    // Champs de fichier de l'étape (dans la page, cachés : WebKit ne signale pas toujours un champ resté hors de la page).
    var models = document.createElement('input');
    models.type = 'file'; models.id = 'model-input'; models.className = 'hidden'; models.multiple = true;
    models.setAttribute('accept', '.stl,.3mf,.obj,.step,.stp,.amf');
    models.addEventListener('change', function () { var f = Array.prototype.slice.call(models.files || []); models.value = ''; addModels(f.filter(function (x) { return FS.isModelFile(x.name); })); });
    document.body.appendChild(models);
    var sketch = document.createElement('input');
    sketch.type = 'file'; sketch.id = 'sketch-input'; sketch.className = 'hidden';
    sketch.setAttribute('accept', 'image/png,image/jpeg,image/webp');
    sketch.addEventListener('change', function () { var f = Array.prototype.slice.call(sketch.files || []); sketch.value = ''; addSketches(f); });
    document.body.appendChild(sketch);
    p.setPhoneRoute({ purpose: function () { var st = state(); return st.screen === 'design' && !st.design.retouch ? 'sketch' : 'defect'; }, take: takeSketch });
    p.on('model_added', onModelAdded);
    p.on('gallery', function (msg) { gallery = Array.isArray(msg.items) ? msg.items : []; if (state().screen === 'gallery') render(); });
    p.on('design_lib', function (msg) { lib.onMessage(msg); });
    p.on('plate_action', onPlateAction);
    p.on('commands', onCommands);
    p.on('ai_context', onPlate);
    p.on('open_tool', function (msg) {
      var st = state();
      if (st.toolAsked && partName()) { st.toolAsked = false; setLast(msg.text, msg.ok ? '' : 'error'); render(); }
      else p.say(msg.text, msg.ok ? 'info' : 'error');
    });
    p.on('project_resume', function (msg) { savedProjects = Array.isArray(msg.items) ? msg.items : []; if (!partName()) render(); });
    p.on('conv_list', function (msg) { savedProjects = Array.isArray(msg.items) ? msg.items : []; });
  }
  (V2.plugins = V2.plugins || []).push(plug);

  // `sample` : pose un modèle de la galerie par son nom (« benchy »), comme un clic dans la galerie.
  V2.piece = { sample: function (name) { whenChanging(function () { importSample(name); }); }, addModels: addModels,
    // Nouveau projet (v2/panneau.js) : la pièce du projet d'avant, encore sur le plateau, sera remplacée par la première posée.
    setOldPart: function (o) { var st = state(); st.oldPart = o || null; render(); }, answerExtras: answerExtras, attachSketch: attachSketch, state: function () { return state(); } };
})(typeof window !== 'undefined' ? window : globalThis);
