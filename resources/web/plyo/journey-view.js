// Rendu de la zone fixe du haut du panneau : barre des six étapes et ligne « Prochaine étape ».
// Pas d'état propre : index.html lui donne l'étape, le contexte et les gestes. Seule la ligne d'action porte un bouton plein.
// Chargé par index.html (window.PlyoJourneyView).
(function (root) {
  // ui : { el, button, icon }. opts.onRevisit(key) : une étape faite (Machine, Pièce, Filament, Préparer) rouverte d'un clic,
  // au clavier par Entrée ou Espace ; l'étape en cours et celles à venir ne réagissent pas.
  function renderBar(slot, ui, opts) {
    var J = root.PlyoJourney, mode = J.barMode(opts.widthPx), list = J.steps(opts.project);
    slot.textContent = '';
    var bar = ui.el('div', 'journey-bar ' + mode);
    bar.setAttribute('role', 'list');
    list.forEach(function (s, i) {
      var seg = ui.el('div', 'journey-seg is-' + s.state); // « is-done » : la classe globale .done (lignes « fait ») cassait la barre
      seg.setAttribute('role', 'listitem');
      if (s.state === 'current') seg.setAttribute('aria-current', 'step');
      var host = seg;
      if (opts.onRevisit && J.canRevisit(s)) {
        host = ui.el('div', 'journey-go');
        host.setAttribute('role', 'button');
        host.setAttribute('tabindex', '0');
        host.setAttribute('aria-label', J.revisitLabel(s));
        host.addEventListener('click', function () { opts.onRevisit(s.key); });
        host.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault(); // Espace ne fait pas défiler le panneau
          opts.onRevisit(s.key);
        });
        seg.appendChild(host);
      }
      host.appendChild(ui.el('i', 'journey-fill'));
      host.appendChild(ui.el('span', 'journey-name', (s.state === 'done' ? '✓ ' : '') + (mode === 'pills' ? String(i + 1) : s.label)));
      seg.title = host === seg ? s.label : J.revisitLabel(s);
      bar.appendChild(seg);
    });
    slot.appendChild(bar);
  }

  // handlers : { run(kind) }.
  function renderActionLine(slot, ui, opts) {
    var J = root.PlyoJourney, action = J.primaryAction(opts.step, opts.ctx);
    slot.textContent = '';
    var line = ui.el('div', 'journey-action');
    line.appendChild(ui.el('span', 'journey-prompt', J.prompt(opts.step, opts.ctx)));
    // Un lien toujours visible à côté de la consigne (hors du contenu qui défile), jamais un bouton plein.
    if (opts.extra) line.appendChild(ui.button(opts.extra.label, opts.extra.onClick, 'link journey-extra', opts.extra.icon));
    if (action.kind !== 'none') {
      var b = ui.button(action.label, function () { if (action.enabled) opts.handlers.run(action.kind); }, 'btn sm');
      if (!action.enabled) b.disabled = true;
      line.appendChild(b);
    }
    slot.appendChild(line);
  }

  // Suggestions au-dessus du champ de question. handlers : { ask(text), open(value) }.
  function renderSuggestions(slot, ui, opts) {
    var list = root.PlyoJourney.suggestionsFor(opts.step);
    slot.textContent = '';
    list.forEach(function (sug) {
      slot.appendChild(ui.button(sug.label, function () { if (sug.kind === 'ask') opts.handlers.ask(sug.value); else opts.handlers.open(sug.value); }, 'chip'));
    });
  }

  root.PlyoJourneyView = { renderSuggestions: renderSuggestions, renderBar: renderBar, renderActionLine: renderActionLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoJourneyView;
})(typeof window !== 'undefined' ? window : globalThis);
