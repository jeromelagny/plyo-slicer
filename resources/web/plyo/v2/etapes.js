// Assistant v2 : barre des trois étapes et carte de l'étape en cours. Chargé par v2/index.html.
// L'étape vient de l'état réel du projet (journey-logic.js, project-logic.js), comme dans le panneau classique. Chaque étape
// a sa carte dans PlyoV2.cards (piece, materiel, imprimer) : une fonction qui reçoit le contexte et rend
// { title, sub, body (élément ou null), primary ({ label, run, disabled } ou null), extra ([éléments] sous le bouton) }.
// Les lots suivants remplacent ces cartes minimales (lot 2 : ta pièce, lot 3 : imprimante et bobine, lot 4 : imprimer).
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var J = root.PlyoJourney;
  var ui = V2.ui;

  // Noms de la barre de la v2 (la clé reste celle de journey-logic.js, BAR).
  var LABELS = { piece: 'Ta pièce', materiel: 'Imprimante et bobine', imprimer: 'Imprimer' };
  var ICON_OF = { printer: 'printer', part: 'cube', filament: 'spool' };

  // Les trois étapes, avec leur état réel (« done », « current », « todo ») et si une étape faite peut se rouvrir.
  function bar(project) {
    return J.steps(project).map(function (s, i) {
      return { key: s.key, n: i + 1, label: LABELS[s.key] || s.label, state: s.state, revisit: J.canRevisit(s) };
    });
  }
  function barKeyOf(project) { return J.barKey(J.currentStep(project)); }
  function numberOf(key) { return J.BAR.findIndex(function (b) { return b.key === key; }) + 1; }

  // `opened` : étape faite rouverte d'un clic (sinon null) ; `onOpen(key)` : clic sur une étape faite ; null pendant une
  // réponse de l'assistant (la barre ne bouge pas).
  function renderBar(nav, project, opened, onOpen) {
    nav.textContent = '';
    bar(project).forEach(function (s, i) {
      if (i) nav.appendChild(ui.el('span', 'st-line' + (s.state !== 'todo' ? ' on' : '')));
      var shown = opened ? s.key === opened : s.state === 'current';
      var b = ui.el('button', 'st' + (s.state === 'current' ? ' cur' : '') + (s.state === 'done' ? ' done' : '') + (shown && opened ? ' open' : ''));
      b.type = 'button';
      b.dataset.step = s.key;
      // Une étape faite se rouvre ; pendant qu'elle est rouverte, l'étape en cours ramène où on en était.
      var can = !!onOpen && ((s.revisit && s.key !== opened) || (!!opened && s.state === 'current'));
      b.disabled = !can;
      if (shown) b.setAttribute('aria-current', 'step');
      if (can) {
        var back = s.state === 'current';
        b.title = ui.fr(back ? 'Revenir à l’étape en cours' : J.revisitLabel({ label: s.label }));
        b.addEventListener('click', function () { onOpen(back ? null : s.key); });
      }
      var n = ui.el('span', 'n');
      if (s.state === 'done') n.appendChild(ui.icon('check', 12)); else n.textContent = String(s.n);
      b.appendChild(n);
      b.appendChild(ui.el('span', 'l', s.label));
      nav.appendChild(b);
    });
  }

  // Ce qui est déjà choisi dans la fiche du projet (machine, pièce, bobine), lu dans le projet : jamais en dur.
  function chosenRows(project, nozzleMm) {
    var rows = J.filledRows(project, { nozzleMm: nozzleMm });
    if (!rows.length) return null;
    var list = ui.el('div', 'chosen');
    rows.forEach(function (r) {
      var line = ui.el('div', 'chosen-line');
      var ic = ui.el('span', 'ic');
      ic.appendChild(ui.icon(ICON_OF[r.line] || 'info', 18));
      line.appendChild(ic);
      line.appendChild(ui.el('span', 'grow', r.text));
      list.appendChild(line);
    });
    return list;
  }

  // Cartes minimales du lot 1 : le titre de l'étape, ce qui est déjà choisi, et le passage par l'ancien assistant pour la
  // suite tant que l'étape n'est pas construite ici.
  function waiting(ctx) {
    var box = ui.el('div', 'note tip');
    box.appendChild(ui.icon('info', 18));
    var body = ui.el('div');
    body.appendChild(ui.el('p', '', 'Cette étape arrive bientôt dans ce panneau. En attendant, fais-la dans l’ancien assistant : ton projet y est déjà.'));
    body.appendChild(ui.button('Ouvrir l’ancien assistant', ctx.actions.classic, 'link'));
    box.appendChild(body);
    return box;
  }
  function minimal(title, sub) {
    return function (ctx) {
      var body = ui.el('div', 'card-content');
      var rows = chosenRows(ctx.project, ctx.nozzleMm);
      if (rows) body.appendChild(rows);
      body.appendChild(waiting(ctx));
      return { title: typeof title === 'function' ? title(ctx) : title, sub: sub, body: body, primary: null };
    };
  }
  var cards = V2.cards = V2.cards || {};
  if (!cards.piece) cards.piece = minimal('Qu’est-ce qu’on imprime ?', 'Choisis une pièce. Je m’occupe des réglages.');
  if (!cards.materiel) cards.materiel = minimal(function (ctx) { return ctx.step === 'filament' ? 'Quelle bobine ?' : 'Sur quelle imprimante ?'; }, null);
  if (!cards.imprimer) cards.imprimer = minimal(function (ctx) { return J.prompt(ctx.step, {}); }, null);

  // Carte de l'étape affichée (`key`) dans `section` : en-tête (« Étape N sur 3 »), contenu, puis le bouton plein collé en bas
  // de la carte. Une étape rouverte a son bouton : « Revenir à l'étape en cours ».
  function renderCard(section, key, ctx) {
    var spec = (cards[key] || cards.piece)(ctx) || {};
    section.textContent = '';
    section.dataset.step = key;
    var head = ui.el('div', 'card-head');
    head.appendChild(ui.el('p', 'kicker', 'Étape ' + numberOf(key) + ' sur 3' + (ctx.revisit ? ' · rouverte' : '')));
    head.appendChild(ui.el('h2', 't', spec.title || LABELS[key]));
    if (spec.sub) head.appendChild(ui.el('p', 'sub', spec.sub));
    section.appendChild(head);
    if (spec.body) section.appendChild(spec.body);
    var primary = spec.primary || (ctx.revisit ? { label: 'Revenir à l’étape en cours', run: ctx.actions.closeRevisit } : null);
    var extra = (spec.extra || []).filter(Boolean);
    var foot = ui.el('div', 'foot' + (primary || extra.length ? '' : ' hidden'));
    if (primary) {
      var b = ui.button(primary.label, primary.run, 'btn primary wide', primary.icon);
      b.disabled = !!primary.disabled;
      b.id = 'card-primary';
      foot.appendChild(b);
    }
    extra.forEach(function (x) { foot.appendChild(x); });
    section.appendChild(foot);
  }

  V2.etapes = { LABELS: LABELS, bar: bar, barKeyOf: barKeyOf, renderBar: renderBar, renderCard: renderCard, chosenRows: chosenRows };
})(typeof window !== 'undefined' ? window : globalThis);
