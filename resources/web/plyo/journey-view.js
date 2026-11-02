// Rendu de la zone fixe du haut du panneau : barre des six étapes et ligne « Prochaine étape ».
// Pas d'état propre : index.html lui donne l'étape, le contexte et les gestes. Seule la ligne d'action porte un bouton plein.
// Chargé par index.html (window.PlyoJourneyView).
(function (root) {
  // ui : { el, button, icon }.
  function renderBar(slot, ui, opts) {
    var J = root.PlyoJourney, mode = J.barMode(opts.widthPx), list = J.steps(opts.project);
    slot.textContent = '';
    var bar = ui.el('div', 'journey-bar ' + mode);
    bar.setAttribute('role', 'list');
    list.forEach(function (s, i) {
      var seg = ui.el('div', 'journey-seg ' + s.state);
      seg.setAttribute('role', 'listitem');
      if (s.state === 'current') seg.setAttribute('aria-current', 'step');
      seg.appendChild(ui.el('i', 'journey-fill'));
      seg.appendChild(ui.el('span', 'journey-name', mode === 'pills' ? String(i + 1) : s.label));
      seg.title = s.label;
      bar.appendChild(seg);
    });
    slot.appendChild(bar);
  }

  // handlers : { run(kind), toggleFold() }. `folded` : le contenu de l'étape est replié.
  function renderActionLine(slot, ui, opts) {
    var J = root.PlyoJourney, action = J.primaryAction(opts.step, opts.ctx);
    slot.textContent = '';
    var line = ui.el('div', 'journey-action');
    var arrow = ui.button('', opts.handlers.toggleFold, 'link journey-fold');
    arrow.appendChild(ui.icon('chevron', 14));
    arrow.setAttribute('aria-expanded', opts.folded ? 'false' : 'true');
    arrow.setAttribute('aria-label', opts.folded ? 'Afficher l’étape' : 'Replier l’étape');
    line.appendChild(arrow);
    line.appendChild(ui.el('span', 'journey-prompt', J.prompt(opts.step, opts.ctx)));
    if (action.kind !== 'none') line.appendChild(ui.button(action.label, function () { opts.handlers.run(action.kind); }, 'btn sm'));
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
