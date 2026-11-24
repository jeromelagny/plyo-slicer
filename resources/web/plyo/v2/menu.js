// Assistant v2 (lot 5) : le menu du panneau et ses fenêtres. Rien ne disparaît par rapport au panneau classique : ce qui sert
// rarement est ici. Groupes de la maquette : Projet (Nouveau projet, Annuler les derniers réglages, Reposer les questions sur
// ma pièce), Mes affaires (Mes projets, Mes pièces, Mes machines, Mes bobines, Améliorer ma bobine, Journal), Préférences
// (Réponses courtes, Disposition simple, Me guider pas à pas), Compte (Mon utilisation, connexion), Aide, puis « Revenir à
// l'ancien assistant » (v2/panneau.js). Aussi : la fenêtre « Mon utilisation » (clic sur la jauge), « Les formules » (seul
// endroit où paraît « environ N questions »), l'accueil du débutant.
// Mêmes messages au slicer que le classique : undo, conv_list, conv_delete, journal_list, project_printers, spools_get,
// habits_set, firststeps_set, printer_link_recheck, printer_link_dialog_current ; service : /api/me/credits.
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var ui = V2.ui, W = V2.fenetre;
  var Logic = root.PlyoLogic, J = root.PlyoJourney, M = root.PlyoMachines, Sp = root.PlyoSpools;
  var panel = null;
  var fs = {};             // état des premiers pas (firststeps) : niveau, disposition, accueil vu
  var printers = null;     // machines installées (project_printers), pour « Mes machines »
  var request = 4000000, undoWaiting = null;
  var lists = { convs: null, parts: null, journal: null, spools: null, machines: null };

  // « Mon utilisation » : le paiement n'est pas branché. La formule en cours, sans boutons factices (comme le classique).
  var PLAN_TEXT = { gratuit: 'Pour découvrir l’assistant : une jauge qui se recharge chaque mois.',
    plus: 'Pour imprimer chaque semaine et demander de l’aide sans compter.',
    pro: 'Pour un usage intensif ou professionnel : une jauge beaucoup plus grande.' };
  // Bloc des formules du brief « coût IA », repris tel quel du panneau classique (ni prix ni promesse) : la v2 l'affiche
  // dans sa propre fenêtre, la seule où paraît « environ N questions ».
  var FORMULES = [
    'Bientôt : Plyo+ et Pro pour une jauge plus grande chaque mois. Plyo+ correspond à environ 100 questions ou 40 photos par mois, Pro à environ 330 questions ou 130 photos. Plyo+ ouvre aussi les pièces sur mesure et plusieurs photos dans une même demande. Une recharge sans abonnement agrandira aussi ta jauge (ce que tu n’en utilises pas reste le mois suivant).',
    'Le slicer, l’onglet Étapes et l’envoi à l’imprimante ne touchent jamais la jauge. Tu verras les formules ici dès qu’elles seront prêtes ; d’ici là, ta jauge gratuite se recharge chaque mois.'
  ];
  var HOW = [
    'Chaque demande à l’IA remplit un peu ta jauge : un peu plus avec des photos, rien quand la demande sort de l’impression 3D. Une réponse commencée va toujours jusqu’au bout.',
    'Toujours gratuit : l’accueil, le parcours en étapes, les explications des réglages (le « ? » à côté d’un réglage, ou « c’est quoi la rétraction ? »), « Montre-moi où il est », la pose d’un modèle sur le plateau et le lancement des tests de calibration.'
  ];
  var HELP = [
    ['Une IA qui te guide', 'L’assistant est une IA : il peut se tromper. Il propose, et **tu valides chaque réglage** avant qu’il soit appliqué. Les réglages restent toujours dans des plages sûres, vérifiées par Plyo, et tout s’annule d’un clic.'],
    ['Ce que je sais faire', '- Regarder la photo d’une impression ratée et te dire ce qui cloche\n- Proposer des réglages : tu choisis ce qu’on applique, et tout s’annule d’un clic\n- Répondre à tes questions d’impression 3D, avec tes mots\n- Te montrer où se trouve un bouton ou un réglage dans la fenêtre de Plyo\n- Orienter, ranger, réduire ou découper tes pièces quand tu me le demandes\n- Te guider pour calibrer ta bobine : « Améliorer ma bobine », dans le menu, pose le test (gratuit) ; seule la lecture de la photo du test utilise ta jauge'],
    ['Gratuit, sans compte', 'Le parcours en étapes, les explications des réglages (le « ? » à côté d’un réglage, ou « c’est quoi la rétraction ? »), « Montre-moi où il est », la pose d’un modèle sur le plateau et le lancement des tests de calibration.'],
    ['Avec ton compte', 'Les réponses de l’IA et la lecture des photos remplissent ta jauge du mois, en haut à droite. Elle se recharge chaque mois.'],
    ['Astuces', '- **Entrée** envoie, **Maj + Entrée** va à la ligne\n- Clique dans un réglage des onglets de Plyo : je te propose de l’expliquer\n- Glisse une photo ou le fichier 3D de ta pièce (STL, 3MF…) directement dans ce panneau\n- Le panneau d’avant reste là : « Revenir à l’ancien assistant », en bas de ce menu'],
    ['Tes données', 'Tes projets et tes discussions avec moi restent sur cet ordinateur. Tes photos servent seulement à répondre à ta demande. Une réponse te semble fausse ? Clique sur « Signaler » sous la réponse : ça nous aide à corriger l’assistant.']
  ];
  var LAYOUT_NOTES = {
    simple: 'Disposition simple : la barre de réglages de Plyo Slicer est repliée, tu vois ta pièce et moi. Pour la rouvrir : « Disposition simple » dans le menu, ou Maj + Tab.',
    advanced: 'Disposition complète : la barre de réglages de Plyo Slicer est de retour, à gauche.'
  };

  function $(id) { return document.getElementById(id); }
  function conv() { return panel.conv(); }
  function habits() { return panel.habits(); }
  function closeMenu() { $('menu').classList.add('hidden'); $('btn-more').setAttribute('aria-expanded', 'false'); }
  function blocked() {
    if (!panel.busy()) return false;
    panel.say('Attends la fin de la réponse (ou annule-la) avant de changer de projet.');
    return true;
  }

  // ---------- Le menu ----------
  function item(icon, label, run, o) {
    o = o || {};
    var b = ui.el('button', o.toggle !== undefined ? 'tgl' : '');
    b.type = 'button';
    b.setAttribute('role', o.toggle !== undefined ? 'menuitemcheckbox' : 'menuitem');
    if (o.toggle !== undefined) b.setAttribute('aria-checked', o.toggle ? 'true' : 'false');
    if (o.id) b.id = o.id;
    b.appendChild(ui.icon(icon, 16));
    b.appendChild(ui.el('span', 'grow', label));
    if (o.toggle !== undefined) b.appendChild(ui.el('span', 'tg' + (o.toggle ? ' on' : '')));
    if (o.title) b.title = ui.fr(o.title);
    b.disabled = !!o.disabled;
    b.addEventListener('click', function (e) { if (e && e.stopPropagation) e.stopPropagation(); closeMenu(); run(); });
    return b;
  }
  function group(box, title) { box.appendChild(ui.el('hr')); box.appendChild(ui.el('div', 'g', title)); }
  // « Reposer les questions sur ma pièce » : quand elles ont été passées, ou que tu as demandé de ne plus les poser (classique).
  function intentAgain() {
    var c = conv(), it = c && c.project.intent;
    return !M.askIntent(habits()) || !!(it && (it.skipped || it.applied));
  }
  function renderMenu() {
    var box = $('menu-items'), v = panel.values(), session = panel.session();
    box.textContent = '';
    box.appendChild(ui.el('div', 'g', 'Projet'));
    box.appendChild(item('plus', 'Nouveau projet', newProject, { id: 'm-new' }));
    box.appendChild(item('undo', 'Annuler les derniers réglages de l’assistant', undoLast, { id: 'm-undo', disabled: !(v && v.can_undo),
      title: v && v.can_undo ? 'Remet les réglages d’avant la dernière application' : 'Rien à annuler pour l’instant' }));
    if (conv() && conv().project.part && intentAgain()) box.appendChild(item('help', 'Reposer les questions sur ma pièce', askIntentAgain, { id: 'm-intent' }));
    group(box, 'Mes affaires');
    box.appendChild(item('folder', 'Mes projets', openProjects, { id: 'm-convs' }));
    box.appendChild(item('cube', 'Mes pièces', openParts, { id: 'm-parts' }));
    box.appendChild(item('printer', 'Mes machines', openMachines, { id: 'm-machines' }));
    box.appendChild(item('spool', 'Mes bobines', openSpools, { id: 'm-spools' }));
    box.appendChild(item('target', 'Améliorer ma bobine (tests)', openCalib, { id: 'm-calib' }));
    box.appendChild(item('book', 'Journal des impressions', openJournal, { id: 'm-journal' }));
    group(box, 'Préférences');
    box.appendChild(item('info', 'Réponses courtes', toggleShort, { id: 'm-level', toggle: M.levelOf(habits()) === 'short' }));
    box.appendChild(item('grid', 'Disposition simple', toggleLayout, { id: 'm-layout', toggle: fs.layout === 'simple',
      title: 'Coché : seulement le plateau et l’assistant ; la barre de réglages de Plyo Slicer est repliée' }));
    box.appendChild(item('home', 'Me guider pas à pas', toggleGuide, { id: 'm-start', toggle: fs.level !== 'expert', title: J.startMenuLabel(fs.level) }));
    group(box, 'Compte');
    if (session) {
      if (panel.email() || session.email) box.appendChild(ui.el('div', 'who', panel.email() || session.email));
      box.appendChild(item('bars', 'Mon utilisation', openUsage, { id: 'm-usage' }));
      box.appendChild(item('logout', 'Me déconnecter', function () { panel.logout(); }, { id: 'm-logout' }));
    } else box.appendChild(item('login', 'Me connecter', function () { panel.openLogin(); }, { id: 'm-login' }));
    box.appendChild(ui.el('hr'));
    box.appendChild(item('help', 'Aide', openHelp, { id: 'm-help' }));
  }

  // ---------- Projet ----------
  function newProject() { if (blocked()) return; panel.newConversation(); }
  // Le dernier lot de l'assistant, comme « Annuler les derniers réglages appliqués » du classique.
  function undoLast() {
    undoWaiting = ++request;
    panel.post({ type: 'undo', request: undoWaiting });
  }
  function onResult(msg) {
    if (!undoWaiting || msg.request !== undoWaiting) return;
    undoWaiting = null;
    // Choisi dans le menu : la réponse se voit aussi en haut de la carte de l'étape (sinon rien ne bouge en apparence).
    panel.tell(msg.text || (msg.ok ? 'Réglages d’avant remis.' : 'Je n’ai pas pu annuler.'), msg.ok ? 'info' : 'error');
  }
  function askIntentAgain() {
    var c = conv();
    panel.setHabits(M.stopAsking(habits(), false));
    if (!c) return;
    var p = c.project, redo = root.PlyoProject.nextStep(p) === 'ready', sig = panel.tourSignals();
    // Plaque déjà découpée : retour à la préparation avec les questions ; la découpe sera refaite avec les nouvelles réponses.
    p.intent = redo && sig && sig.sliced ? { reask: true } : {};
    if (redo) p.step = 'slice';
    panel.scheduleSave();
    panel.render();
  }

  // ---------- Mes projets ----------
  function askList() { panel.post({ type: 'conv_list' }); }
  function openProjects() {
    W.open({ title: 'Mes projets', sub: 'Chaque pièce a son projet : son plateau, ses réglages et ta discussion avec moi. Tes projets restent sur cet ordinateur ; au-delà de 30, je range le plus ancien et je te le dis.',
      fill: function (body) { lists.convs = body; body.appendChild(ui.el('p', 'hint', 'Chargement…')); askList(); },
      onClose: function () { lists.convs = null; } });
  }
  function fillProjects(items) {
    var body = lists.convs;
    if (!body || !body.isConnected) return;
    body.textContent = '';
    if (!items.length) { body.appendChild(W.empty('Pas encore de projet. Pose une pièce à l’étape 1, ou pose une question : ton projet sera gardé ici.')); return; }
    var list = ui.el('div', 'list'), c = conv();
    items.forEach(function (it) {
      var e = Logic.projectEntry(it), here = c && c.id === it.id;
      var li = W.row({ icon: 'folder', title: e.title, sub: (here ? 'Ouvert · ' : '') + e.detail, current: here, acts: here ? [] : [{ label: 'Rouvrir', run: function () { W.close(); panel.openConversation(it.id); } }] });
      var del = ui.button('', function () { confirmDelete(li, it, e); }, 'iconbtn', 'x');
      del.title = ui.fr('Supprimer ce projet');
      del.setAttribute('aria-label', ui.fr('Supprimer « ' + e.title + ' »'));
      li.appendChild(del);
      list.appendChild(li);
    });
    body.appendChild(list);
  }
  // Jamais en un clic : la question remplace la ligne, « Garder » la remet.
  function confirmDelete(li, it, e) {
    var kept = li.childNodes.slice ? li.childNodes.slice() : Array.prototype.slice.call(li.childNodes);
    li.textContent = '';
    var mid = ui.el('div', 'grow');
    mid.appendChild(ui.el('p', '', Logic.deleteQuestion(e)));
    li.appendChild(mid);
    li.appendChild(ui.button('Supprimer', function () {
      var c = conv();
      if (c && c.id === it.id) panel.newConversation();
      panel.post({ type: 'conv_delete', id: it.id });
    }, 'btn sm danger', 'x'));
    li.appendChild(ui.button('Garder', function () { li.textContent = ''; kept.forEach(function (n) { li.appendChild(n); }); }, 'btn sm'));
  }

  // ---------- Mes pièces : les projets qui ont une pièce, à rouvrir pour la réimprimer ----------
  function openParts() {
    W.open({ title: 'Mes pièces', sub: 'Les pièces de tes projets, la plus récente d’abord. Ce que tu as imprimé et ce qui a changé est dans le journal.',
      fill: function (body) { lists.parts = body; body.appendChild(ui.el('p', 'hint', 'Chargement…')); askList(); },
      foot: [ui.button('Journal des impressions', function () { openJournal(); }, 'link'), ui.el('span', 'grow'), ui.button('Fermer', function () { W.close(); }, 'btn sm')],
      onClose: function () { lists.parts = null; } });
  }
  function fillParts(items) {
    var body = lists.parts;
    if (!body || !body.isConnected) return;
    body.textContent = '';
    var c = conv(), parts = root.PlyoPiece.recentParts(items, null, 30);
    if (!parts.length) { body.appendChild(W.empty('Pas encore de pièce. Pose-en une à l’étape 1 : elle apparaîtra ici.')); return; }
    var list = ui.el('div', 'list');
    parts.forEach(function (it) {
      var here = c && c.id === it.id;
      list.appendChild(W.row({ icon: 'cube', title: it.title, sub: (here ? 'Ouverte · ' : '') + it.detail, current: here,
        acts: here ? [] : [{ label: 'Rouvrir', run: function () { W.close(); panel.openConversation(it.id); } }] }));
    });
    body.appendChild(list);
  }

  // ---------- Journal des impressions (journal_list, comme « Mes pièces » du classique) ----------
  function openJournal() {
    W.open({ title: 'Journal des impressions', sub: 'Les pièces que tu as imprimées ou exportées avec l’assistant : le problème vu, les réglages appliqués et le résultat. Tout reste sur cet ordinateur.',
      fill: function (body) { lists.journal = body; body.appendChild(ui.el('p', 'hint', 'Chargement…')); panel.post({ type: 'journal_list' }); },
      onClose: function () { lists.journal = null; } });
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function dayOf(iso) { var d = new Date(iso); return isNaN(d) ? '' : Logic.dayText(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())); }
  function paramOf(id) { var v = panel.values(); return (v && Array.isArray(v.params) && v.params.filter(function (x) { return x.id === id; })[0]) || { label: id, unit: '', value: null }; }
  function fillJournal(events, projects) {
    var body = lists.journal;
    if (!body || !body.isConnected) return;
    body.textContent = '';
    var groups = Logic.journalGroups(events);
    if (!groups.length) { body.appendChild(W.empty('Pas encore de pièce. Exporte ou imprime une pièce, ou pose une question à son sujet : elle apparaîtra ici, avec les réglages essayés et le résultat.')); return; }
    var v = panel.values(), here = v && v.context;
    groups.forEach(function (g) {
      var box = ui.el('div', 'jpart');
      box.appendChild(ui.el('h4', '', g.part));
      g.events.forEach(function (e) {
        var row = ui.el('div', 'jev');
        if (e.thumb) { var img = ui.el('img', 'thumb'); img.src = e.thumb; img.alt = ''; row.appendChild(img); }
        else { var ph = ui.el('span', 'thumb ph'); ph.appendChild(ui.icon('cube', 20)); row.appendChild(ph); }
        var col = ui.el('div', 'grow');
        var st = Logic.journalStatus(e);
        var top = ui.el('div', 'jtop');
        top.appendChild(ui.el('small', '', [dayOf(e.at), Logic.shortMachine(e.printer, e.filament)].filter(Boolean).join(' · ')));
        top.appendChild(ui.el('span', 'badge' + (st.tone ? ' ' + st.tone : ''), st.label));
        col.appendChild(top);
        col.appendChild(ui.el('p', '', Logic.journalProblem(e)));
        var q = Logic.outcomeQuestion(e, function (id) { var p = paramOf(id); return p.label === id ? null : p; });
        if (q.changes.length) { var ul = ui.el('ul', 'hint'); q.changes.forEach(function (x) { ul.appendChild(ui.el('li', '', x)); }); col.appendChild(ul); }
        if (e.note) col.appendChild(ui.el('p', 'hint', 'Ton mot : « ' + e.note + ' »'));
        var acts = ui.el('div', 'acts');
        if (!Array.isArray(projects) || projects.indexOf(e.conv) >= 0) acts.appendChild(ui.button('Ouvrir le projet', function () { W.close(); panel.openConversation(e.conv); }, 'btn sm', 'folder'));
        else col.appendChild(ui.el('p', 'hint', 'Son projet a été supprimé : ses réglages restent ici.'));
        var again = Logic.reapplyChanges(e, here, v && v.params);
        if (again && V2.imprimer && V2.imprimer.applyBatches) {
          var re = ui.button('Réappliquer', function () {
            re.disabled = true;
            V2.imprimer.applyBatches(Logic.batchesOf(again), 'Journal : ' + g.part, null, function (ok, text, ids) {
              if (!ok) { re.disabled = false; panel.say(text, 'error'); return; }
              W.close();
              var line = panel.say('Réglages de « ' + g.part + ' » réappliqués.', 'info', ids.length ? [{ label: 'Annuler', run: function () {
                V2.imprimer.undoBatches(ids, function (okU, t) { if (!okU) { panel.say(t, 'error'); return; } line.remove(); panel.say('Réglages d’avant remis.'); });
              } }] : null);
            });
          }, 'btn sm', 'undo');
          re.title = ui.fr('Remettre ces réglages sur ton profil actuel');
          acts.appendChild(re);
        }
        if (!again && e.changes && e.changes.length && e.outcome !== 'bad') col.appendChild(ui.el('p', 'hint', 'Trouvés pour une autre imprimante ou un autre filament : pas réappliqués ici.'));
        col.appendChild(acts);
        row.appendChild(col);
        box.appendChild(row);
      });
      body.appendChild(box);
    });
  }

  // ---------- Mes machines (machines-view.js, comme le volet du classique) ----------
  function openMachines() {
    W.open({ title: 'Mes machines', sub: 'Ce que j’ai appris sur chacune reste en mémoire.',
      fill: function (body) { lists.machines = body; fillMachines(); panel.post({ type: 'project_printers' }); },
      onClose: function () { lists.machines = null; } });
  }
  var machineHandlers = {
    hide: function (preset) { panel.setHabits(M.hideMachine(habits(), preset)); fillMachines(); panel.render(); },
    show: function (preset) { panel.setHabits(M.unhideMachine(habits(), preset)); fillMachines(); panel.render(); },
    copyHabits: function (from, to) { panel.setHabits(M.replaceMachine(habits(), from, to)); fillMachines(); },
    add: function () { W.close(); if (V2.materiel && V2.materiel.addPrinter) V2.materiel.addPrinter(); }
  };
  function fillMachines() {
    var body = lists.machines;
    if (!body || !body.isConnected) return;
    var box = ui.el('div', 'machines');
    root.PlyoMachinesView.renderDrawer(box, { el: ui.el, button: function (label, run, cls, icon) { return ui.button(label, run, /link/.test(cls || '') ? 'link' : 'btn sm', icon); }, icon: ui.icon },
      { printers: printers || [], habits: habits(), handlers: machineHandlers });
    body.textContent = '';
    body.appendChild(box);
    // La machine en cours dans Plyo Slicer : tester sa liaison, ou ouvrir la fenêtre « Connexion » (code d'accès, clé d'API).
    var v = panel.values(), cur = v && v.context ? v.context.printer : '';
    if (cur) {
      var link = ui.el('div', 'note');
      link.appendChild(ui.icon('wifi', 18));
      var nb = ui.el('div', 'note-body');
      nb.appendChild(ui.el('p', '', 'Liaison de ' + J.machineLabel({ name: cur }) + ' (la machine en cours dans Plyo Slicer)'));
      var st = ui.el('p', 'hint hidden');
      st.id = 'link-status';
      nb.appendChild(st);
      var acts = ui.el('div', 'acts');
      acts.appendChild(ui.button('Tester la liaison', function () { st.textContent = ui.fr('Je teste la liaison…'); st.classList.remove('hidden'); panel.post({ type: 'printer_link_recheck' }); }, 'btn sm', 'wifi'));
      acts.appendChild(ui.button('Relier (fenêtre Connexion)', function () { panel.post({ type: 'printer_link_dialog_current' }); }, 'btn sm'));
      nb.appendChild(acts);
      link.appendChild(nb);
      body.appendChild(link);
    }
  }
  function linkSaid(text) { var st = $('link-status'); if (st && st.isConnected) { st.textContent = ui.fr(text); st.classList.remove('hidden'); return true; } return false; }

  // ---------- Mes bobines (spools_get, bobines retenues pour la machine du projet ou celle d'Orca) ----------
  function spoolPrinter() {
    var c = conv(), p = c && c.project.printer, v = panel.values();
    return p && p.preset && !p.proposed ? p.preset : v && v.context ? v.context.printer : '';
  }
  function openSpools() {
    var pr = spoolPrinter();
    W.open({ title: 'Mes bobines', sub: 'Ce qui marche est retenu bobine par bobine' + (pr ? ', sur ' + J.machineLabel({ name: pr }) + '.' : '.'),
      fill: function (body) {
        lists.spools = body;
        if (!pr) { body.appendChild(W.empty('Choisis d’abord ton imprimante, à l’étape 2 : tes bobines sont retenues machine par machine.')); return; }
        body.appendChild(ui.el('p', 'hint', 'Chargement…'));
        panel.post({ type: 'spools_get', printer: pr });
      },
      onClose: function () { lists.spools = null; } });
  }
  function fillSpools(msg) {
    var body = lists.spools;
    if (!body || !body.isConnected) return;
    body.textContent = '';
    var rows = Sp.choiceRows(msg.items);
    if (!rows.length) { body.appendChild(W.empty('Pas encore de bobine retenue sur cette machine. Choisis ta bobine à l’étape 2 : après une impression réussie, je retiens ses réglages.')); return; }
    var list = ui.el('div', 'list');
    rows.forEach(function (r) {
      list.appendChild(W.row({ icon: r.colour ? null : 'spool', swatch: r.colour || null, title: r.label, sub: [r.material, r.detail].filter(Boolean).join(' · '),
        acts: [{ label: 'Améliorer', run: function () { openCalib(); } }] }));
    });
    body.appendChild(list);
  }

  // ---------- Améliorer ma bobine (tests de calibration, v2/imprimer.js) ----------
  function openCalib() {
    W.open({ title: 'Améliorer ma bobine', sub: 'J’imprime un petit test, tu me montres le résultat en photo, et je règle ta bobine pour de bon.',
      fill: function (body, close) {
        if (!V2.imprimer || !V2.imprimer.calibChooser) return;
        var c = conv();
        if (!c || !c.project.printer || c.project.printer.proposed || !c.project.filament || c.project.filament.proposed) {
          body.appendChild(W.empty('Choisis d’abord ton imprimante et ta bobine, à l’étape 2 : le test se règle pour elles.'));
          return;
        }
        var chooser = V2.imprimer.calibChooser();
        // Un test choisi : la fenêtre se ferme, le test arrive dans la discussion.
        chooser.querySelectorAll('.card').forEach(function (b) { b.addEventListener('click', function () { close(); }); });
        body.appendChild(chooser);
      } });
  }

  // ---------- Préférences ----------
  function toggleShort() {
    panel.setHabits(M.chooseLevel(habits(), M.levelOf(habits()) === 'short' ? 'detailed' : 'short'));
    panel.say(M.levelOf(habits()) === 'short' ? 'Je te répondrai de façon courte et technique.' : 'Je t’expliquerai les choses en détail.');
  }
  function toggleLayout() {
    var layout = fs.layout === 'simple' ? 'advanced' : 'simple';
    fs.layout = layout;
    panel.post({ type: 'firststeps_set', patch: { layout: layout, layout_chosen: true } });
    panel.say(LAYOUT_NOTES[layout]);
  }
  // « Me guider pas à pas » (débutant) ou « Je connais déjà » (confirmé) : guidé ou moins de questions ; l'assistant s'ouvre toujours.
  function setLevel(level, quiet) {
    fs.level = level;
    var patch = { level: level };
    // « Je connais déjà » ne déplie plus la barre de réglages (repliée pour tout le monde ; « Disposition simple » se décoche).
    if (level === 'expert') { fs.greeted = true; patch.greeted = true; }
    panel.post({ type: 'firststeps_set', patch: patch });
    if (!quiet) panel.say(J.startChangeNote(level));
  }
  function toggleGuide() { setLevel(fs.level === 'expert' ? 'beginner' : 'expert'); }

  // ---------- Compte : « Mon utilisation » et « Les formules » ----------
  function openUsage() {
    if (panel.requireLogin('Ta jauge est liée à ton compte. Pour la voir, connecte-toi : pas de mot de passe, tu reçois un code par e-mail.', openUsage)) return;
    W.open({ title: 'Mon utilisation', sub: null,
      foot: [ui.button('Voir les formules', function () { openPlans(); }, 'btn sm'), ui.el('span', 'grow'), ui.button('Fermer', function () { W.close(); }, 'btn sm')],
      fill: function (body) {
        var big = ui.el('div', 'gbig');
        var name = ui.el('small', '', 'Jauge IA');
        var pct = ui.el('div', 'pct', '…');
        var used = ui.el('small', '', 'utilisés ce mois-ci');
        var bar = ui.el('div', 'progress'), fill = ui.el('i');
        bar.appendChild(fill);
        var when = ui.el('p', 'hint', '');
        var extra = ui.el('p', 'hint hidden', '');
        [name, pct, used, bar, when, extra].forEach(function (n) { big.appendChild(n); });
        body.appendChild(big);
        var plan = ui.el('div', 'plan cur');
        var planName = ui.el('h4', '', '');
        var planText = ui.el('p', 'hint', '');
        plan.appendChild(planName);
        plan.appendChild(planText);
        plan.appendChild(ui.el('span', 'badge', 'Ta formule'));
        body.appendChild(plan);
        body.appendChild(ui.el('p', 'hint', 'Les explications de réglages, le parcours en étapes et l’envoi à l’imprimante ne l’utilisent pas.'));
        function show(g) {
          var v = Logic.gaugeView(g);
          if (!v) return;
          name.textContent = ui.fr('Jauge IA · formule ' + v.plan);
          pct.textContent = ui.fr(v.label);
          fill.style.width = Math.max(2, v.pct) + '%';
          big.classList.toggle('low', v.state === 'low');
          big.classList.toggle('empty', v.state === 'empty');
          when.textContent = ui.fr(Logic.gaugeResetText(g));
          extra.textContent = ui.fr(Logic.gaugeExtraText(g));
          extra.classList.toggle('hidden', !extra.textContent);
          planName.textContent = ui.fr(v.plan);
          planText.textContent = ui.fr(PLAN_TEXT[g.plan] || PLAN_TEXT.gratuit);
        }
        show(panel.gauge());
        var loading = ui.el('p', 'hint', panel.gauge() ? '' : 'Chargement…');
        if (!panel.gauge()) body.appendChild(loading);
        panel.apiFetch('/api/me/credits', { method: 'GET' })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
          .then(function (data) { loading.remove(); panel.setGauge(data.gauge, true); show(data.gauge); })
          .catch(function () { loading.textContent = ui.fr('Le détail n’a pas pu être chargé. Vérifie ta connexion, puis rouvre cette fenêtre.'); if (!loading.parentNode) body.appendChild(loading); });
      } });
  }
  function openPlans() {
    W.open({ title: 'Les formules', wide: true, sub: 'Le parcours, les explications des réglages, la galerie et les tests de calibration sont gratuits. La jauge sert aux réponses de l’IA et à la lecture des photos.',
      fill: function (body) {
        var g = panel.gauge(), cur = g && g.plan ? g.plan : 'gratuit';
        var plans = ui.el('div', 'plans');
        [['gratuit', 'Gratuit'], ['plus', 'Plyo+'], ['pro', 'Pro']].forEach(function (x) {
          var b = ui.el('div', 'plan' + (cur === x[0] ? ' cur' : ''));
          b.appendChild(ui.el('h4', '', x[1]));
          b.appendChild(ui.el('p', 'hint', PLAN_TEXT[x[0]]));
          if (cur === x[0] && panel.session()) b.appendChild(ui.el('span', 'badge', 'Ta formule'));
          plans.appendChild(b);
        });
        body.appendChild(plans);
        var soon = ui.el('div', 'note tip');
        soon.appendChild(ui.icon('info', 18));
        var sb = ui.el('div', 'note-body');
        sb.appendChild(ui.el('p', 'note-title', 'Les formules arrivent'));
        FORMULES.forEach(function (t) { sb.appendChild(ui.el('p', '', t)); });
        soon.appendChild(sb);
        body.appendChild(soon);
        body.appendChild(ui.el('h4', 'mh', 'Comment la jauge se remplit'));
        HOW.forEach(function (t) { body.appendChild(ui.rich(t, 'hint')); });
      } });
  }

  // ---------- Aide ----------
  function openHelp() {
    W.open({ title: 'Aide', fill: function (body) {
      HELP.forEach(function (s) { body.appendChild(ui.el('h4', 'mh', s[0])); body.appendChild(ui.rich(s[1], 'hint')); });
    } });
  }

  // ---------- Accueil du débutant (premier projet, tant que « C'est parti » n'est pas cliqué) ----------
  var welcomed = false;
  function maybeWelcome() {
    if (welcomed || !J.showsWelcome(fs) || W.isOpen()) return;
    welcomed = true;
    var w = J.WELCOME, box = ui.el('input');
    box.type = 'checkbox';
    function go() {
      fs.greeted = true;
      if (box.checked) setLevel('expert', true);
      else panel.post({ type: 'firststeps_set', patch: { greeted: true } });
      W.close();
    }
    W.open({ title: w.title, sub: null,
      fill: function (body) {
        var list = ui.el('ol', 'welcome');
        w.lines.forEach(function (l, i) {
          var li = ui.el('li');
          li.appendChild(ui.el('b', '', String(i + 1)));
          li.appendChild(ui.el('span', '', l.text));
          list.appendChild(li);
        });
        body.appendChild(list);
        // « Je connais déjà » devient une case à cocher (maquette) ; la préférence reste dans le menu.
        var lab = ui.el('label', 'check-line');
        lab.appendChild(box);
        lab.appendChild(ui.el('span', '', 'Je connais déjà l’impression 3D : moins de questions, réponses courtes'));
        body.appendChild(lab);
      },
      foot: [ui.button(w.go, go, 'btn primary wide')] });
  }

  // ---------- Branchement ----------
  function plug(pn) {
    panel = pn;
    $('btn-more').addEventListener('click', renderMenu);
    renderMenu();
    $('gauge').addEventListener('click', openUsage);
    pn.on('result', onResult);
    pn.on('conv_list', function (msg) { var items = Array.isArray(msg.items) ? msg.items : []; fillProjects(items); fillParts(items); });
    pn.on('journal', function (msg) { fillJournal(msg.events || [], msg.projects); });
    pn.on('spools', function (msg) { fillSpools(msg); });
    pn.on('project_printers', function (msg) { printers = Array.isArray(msg.printers) ? msg.printers : []; fillMachines(); });
    pn.on('firststeps', function (msg) { fs = Object.assign({}, msg.state || {}); maybeWelcome(); });
    pn.on('printer_link_rechecked', function (msg) { linkSaid(root.PlyoPreflight.linkRecheckView(msg, 'ton imprimante').text); });
    pn.on('printer_link_current_closed', function (msg) { if (!linkSaid(msg.ok ? 'Liaison enregistrée.' : msg.text || 'Fenêtre fermée sans changement.')) { if (msg.text) pn.say(msg.text, msg.ok ? 'info' : 'warn'); } });
  }
  (V2.plugins = V2.plugins || []).push(plug);

  V2.menu = { render: renderMenu, openUsage: openUsage, openPlans: openPlans, openProjects: openProjects, openParts: openParts, openMachines: openMachines,
    openSpools: openSpools, openCalib: openCalib, openJournal: openJournal, openHelp: openHelp, state: function () { return fs; } };
})(typeof window !== 'undefined' ? window : globalThis);
