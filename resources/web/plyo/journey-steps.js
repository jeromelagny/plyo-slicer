// Contenu des étapes 4 à 6 du parcours (Préparer, Imprimer, Résultat) dans le corps qui défile.
// Pas d'état propre : index.html donne le contexte et les gestes. Aucun bouton plein ici : le bouton plein de l'étape est
// celui de la ligne d'action (journey-view.js). Chargé par index.html (window.PlyoJourneySteps).
(function (root) {
  // ui : { el, button, icon }. opts : { step, ctx {sliced, linked, risks}, summary (texte durée et poids), handlers }.
  // handlers : { skip(), exportFile(), started(), photo(), changeMachine(), recheck() }. opts.machine : { name, reachable (true|false|null) }.
  function line(ui, iconName, text, tone) {
    var row = ui.el('div', 'printer-step' + (tone ? ' ' + tone : ''));
    row.appendChild(ui.icon(iconName, 14));
    row.appendChild(ui.el('span', '', text));
    return row;
  }

  // Questions d'intention (étape Préparer, avant la découpe). opts.intent : { mode: 'asking'|'ready', question, answers, total,
  // idk, guess, summary, changes, kept, level } ; handlers : { answer(qid, id), idk(), intentSkip(), reset() }.
  function renderIntent(body, ui, it, h) {
    var I = root.PlyoIntent;
    if (it.mode === 'asking') {
      var q = it.question, done = Object.keys(it.answers || {}).length;
      body.appendChild(ui.el('p', 'muted small', 'Question ' + (done + 1) + ' sur ' + it.total));
      body.appendChild(ui.el('p', 'intent-q', q.text));
      var acts = ui.el('div', 'printer-actions');
      if (it.idk) {
        var help = I.idkOptions(q.id, it.answers);
        body.appendChild(ui.el('p', 'muted small', 'Pas de souci. Laquelle ressemble le plus à ce que tu veux ?'));
        help.options.forEach(function (o) { acts.appendChild(ui.button(o.label + (o.sub ? ' · ' + o.sub : ''), function () { h.answer(q.id, o.answer); }, 'btn ghost sm')); });
        body.appendChild(acts);
        body.appendChild(ui.button('Choisis pour moi (réglages sûrs)', function () { h.answer(q.id, help.safe); }, 'link'));
      } else {
        q.choices.forEach(function (c) { acts.appendChild(ui.button(c.label, function () { h.answer(q.id, c.id); }, 'btn ghost sm')); });
        acts.appendChild(ui.button('Je ne sais pas', h.idk, 'link'));
        body.appendChild(acts);
        if (q.id === 'use' && it.guess) {
          var label = q.choices.filter(function (c) { return c.id === it.guess; })[0];
          if (label) {
            var g = ui.el('p', 'muted small', 'D’après son nom, ça ressemble à « ' + label.label + ' ». ');
            g.appendChild(ui.button('Oui, c’est ça', function () { h.answer('use', it.guess); }, 'link'));
            body.appendChild(g);
          }
        }
      }
      body.appendChild(ui.button('Je règle moi-même', h.intentSkip, 'link'));
      return;
    }
    var sum = it.summary;
    body.appendChild(ui.el('p', 'intent-q', sum.sentence));
    var ul = ui.el('ul', 'setup-checks');
    sum.bullets.forEach(function (b) { ul.appendChild(ui.el('li', '', b)); });
    body.appendChild(ul);
    if (sum.warning) body.appendChild(line(ui, 'alert', sum.warning, 'warn'));
    (it.kept || []).forEach(function (k) { body.appendChild(ui.el('p', 'muted small', 'Je garde ton réglage « ' + k.label + ' », que tu as changé toi-même.')); });
    var det = ui.el('details', 'intent-details');
    if (it.level === 'short') det.open = true;
    det.appendChild(ui.el('summary', '', 'Voir les ' + it.changes.length + ' réglages exacts'));
    it.changes.forEach(function (c) { det.appendChild(ui.el('div', 'muted small', c.label + ' : ' + String(c.value).replace('.', ','))); });
    body.appendChild(det);
    body.appendChild(ui.button('Changer une réponse', h.reset, 'link'));
  }

  function render(slot, ui, opts) {
    var c = opts.ctx || {}, h = opts.handlers;
    slot.textContent = '';
    var body = ui.el('div', 'project-body');
    if (opts.step === 'preparer' && opts.intent && !c.sliced) {
      renderIntent(body, ui, opts.intent, h);
    } else if (opts.step === 'preparer') {
      body.appendChild(line(ui, c.sliced ? 'check' : 'info', c.sliced ? 'Découpe faite' : 'Découpe à faire', c.sliced ? 'ok' : ''));
      if (c.sliced) body.appendChild(line(ui, c.risks > 0 ? 'alert' : 'check', c.risks > 0 ? c.risks + ' point' + (c.risks > 1 ? 's' : '') + ' à régler avant d’imprimer' : 'Aucun risque détecté', c.risks > 0 ? 'warn' : 'ok'));
      if (c.sliced && c.risks > 0) body.appendChild(ui.button('Passer outre', h.skip, 'link'));
    } else if (opts.step === 'imprimer') {
      if (opts.summary) body.appendChild(line(ui, 'check', opts.summary, 'ok'));
      // La machine est rappelée en lecture seule : en changer refait la préparation (réglages, filament, découpe).
      if (opts.machine) {
        body.appendChild(line(ui, 'wifi', 'Imprimer sur : ' + opts.machine.name, opts.machine.reachable === false ? 'warn' : ''));
        if (opts.machine.reachable === false) {
          body.appendChild(line(ui, 'alert', 'Elle ne répond pas. Allume-la et vérifie qu’elle est sur le même réseau : je revérifie toute seule.', 'warn'));
          body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
        }
        body.appendChild(ui.button('Refaire la préparation sur une autre machine', h.changeMachine, 'link'));
      }
      body.appendChild(ui.el('p', 'muted small', 'Vérifie que le plateau est vide et propre, et que le filament est chargé.'));
      var acts = ui.el('div', 'printer-actions');
      if (c.linked) acts.appendChild(ui.button('Exporter le fichier plutôt', h.exportFile, 'btn ghost sm', 'folder'));
      acts.appendChild(ui.button('L’impression a démarré', h.started, 'btn ghost sm', 'check'));
      body.appendChild(acts);
    } else if (opts.step === 'resultat') {
      body.appendChild(ui.el('p', '', 'Quand c’est fini, envoie-moi une photo : je te dis si c’est réussi et comment l’améliorer.'));
      body.appendChild(ui.button('Ajouter une photo depuis l’ordinateur', h.photo, 'btn ghost sm', 'camera'));
    }
    if (body.childNodes.length) slot.appendChild(body);
  }

  root.PlyoJourneySteps = { render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoJourneySteps;
})(typeof window !== 'undefined' ? window : globalThis);
