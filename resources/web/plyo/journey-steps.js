// Contenu des étapes 4 à 6 du parcours (Préparer, Imprimer, Résultat) dans le corps qui défile.
// Pas d'état propre : index.html donne le contexte et les gestes. Aucun bouton plein ici : le bouton plein de l'étape est
// celui de la ligne d'action (journey-view.js). Chargé par index.html (window.PlyoJourneySteps).
(function (root) {
  // ui : { el, button, icon }. opts : { step, ctx {sliced, linked, risks}, summary (texte durée et poids), endAsk (question de fin), handlers }.
  // handlers : { skip(), exportFile(), started(), photo(), success(), failed(), endChoice(id), changeMachine(), recheck() }. opts.machine : { name, reachable (true|false|null) }.
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
    it.changes.forEach(function (c) { det.appendChild(ui.el('div', 'muted small', c.label + ' : ' + root.PlyoIntent.displayValue(c))); });
    body.appendChild(det);
    body.appendChild(ui.button('Changer une réponse', h.reset, 'link'));
  }

  // « Aucun risque » n'est dit que si la vérification a vraiment eu lieu et n'a rien trouvé.
  function checkedLine(checked) {
    if (checked === 'clean') return 'Aucun risque détecté';
    return checked === 'ignored' ? 'Points ignorés : ils restent à ta charge' : 'Vérification en cours';
  }

  // Question de fin d'impression (PlyoJourney.endQuestion) : son texte et ses choix, tous discrets. À l'étape Résultat, ou
  // en note du guide quand on est ailleurs (index.html).
  function endCard(ui, q, onChoice) {
    var box = ui.el('div', 'end-question');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Fin de l’impression');
    box.appendChild(ui.el('p', '', q.text));
    var acts = ui.el('div', 'printer-actions');
    q.choices.forEach(function (c) { acts.appendChild(ui.button(c.label, function () { onChoice(c.id); }, 'btn ghost sm')); });
    box.appendChild(acts);
    return box;
  }

  function render(slot, ui, opts) {
    var c = opts.ctx || {}, h = opts.handlers;
    slot.textContent = '';
    var body = ui.el('div', 'project-body');
    if (c.plateEmpty && (opts.step === 'preparer' || opts.step === 'imprimer')) {
      body.appendChild(ui.el('p', '', 'Choisis le même fichier : je le repose sur le plateau et on reprend ton projet.'));
    } else if (opts.step === 'preparer' && opts.intent && !c.sliced) {
      renderIntent(body, ui, opts.intent, h);
    } else if (opts.step === 'preparer') {
      body.appendChild(line(ui, c.sliced ? 'check' : 'info', c.sliced ? 'Découpe faite' : c.slicing ? 'Découpe en cours' : 'Découpe à faire', c.sliced ? 'ok' : ''));
      if (c.sliced) body.appendChild(line(ui, c.risks > 0 ? 'alert' : 'check', c.risks > 0 ? c.risks + ' point' + (c.risks > 1 ? 's' : '') + ' à régler avant d’imprimer' : checkedLine(c.checked), c.risks > 0 || c.checked === 'ignored' ? 'warn' : c.checked === 'clean' ? 'ok' : ''));
      if (c.sliced && c.risks > 0) body.appendChild(ui.button('Imprimer quand même', h.skip, 'link'));
    } else if (opts.step === 'imprimer') {
      // Dans l'étape et non en bas des messages : le texte entier reste lu, sous les suggestions rien n'est coupé.
      if (opts.exported) body.appendChild(line(ui, 'check', opts.exported, 'ok exported'));
      if (opts.summary) body.appendChild(line(ui, 'check', opts.summary, 'ok'));
      // La machine est rappelée en lecture seule : en changer refait la préparation (réglages, filament, découpe).
      if (opts.machine) {
        body.appendChild(line(ui, c.linked ? 'wifi' : 'printer', 'Imprimer sur : ' + opts.machine.name, opts.machine.reachable === false ? 'warn' : ''));
        if (opts.machine.reachable === false) {
          body.appendChild(line(ui, 'alert', 'Elle ne répond pas. Allume-la et vérifie qu’elle est sur le même réseau : je revérifie toute seule.', 'warn'));
          body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
        }
        body.appendChild(ui.button('Refaire la préparation sur une autre machine', h.changeMachine, 'link'));
      }
      // Emplacements du Canvas choisis à l'étape Filament : rappel, et relance sans carte si la CC2 les a refusés.
      if (opts.canvas) {
        body.appendChild(line(ui, 'palette', opts.canvas, ''));
        body.appendChild(ui.button('Changer les emplacements', h.changeSlots, 'link'));
        if (opts.slotsNote) body.appendChild(ui.el('p', 'muted small', opts.slotsNote));
      }
      // Hors CC2, le sens d'un départ sans carte n'est pas vérifié : on relit, ou on change d'emplacements (lien ci-dessus).
      if (opts.slotRemark) body.appendChild(line(ui, 'alert', opts.slotRemark, ''));
      if (opts.refused) {
        body.appendChild(line(ui, 'alert', opts.refused, 'warn'));
        if (opts.offerPlain === false) body.appendChild(ui.button('Relire les emplacements', h.rereadSlots, 'link'));
        else body.appendChild(ui.button('Démarrer sans carte', h.startPlain, 'link'));
      }
      body.appendChild(ui.el('p', 'muted small', 'Vérifie que le plateau est vide et propre, et que le filament est chargé.'));
      var acts = ui.el('div', 'printer-actions');
      if (c.linked) { var ex = ui.button('Exporter le fichier plutôt', h.exportFile, 'btn ghost sm', 'folder'); ex.disabled = !!c.sending; acts.appendChild(ex); }
      // sentArmed : Orca a seulement pris l'envoi (CFS, IFS) ; c'est l'utilisateur qui voit si elle imprime.
      if (opts.sent) acts.appendChild(ui.button(opts.sentArmed ? 'Oui, elle imprime' : 'L’impression a démarré', h.started, 'btn ghost sm', 'check'));
      body.appendChild(acts);
    } else if (opts.step === 'resultat') {
      var after = ui.el('div', 'printer-actions');
      if (!c.success && opts.endAsk) {
        // La machine a dit comment l'impression a fini : sa question remplace « Ça a marché ? ». Après une erreur, « Non,
        // c'est raté » reste là : la bobine n'est marquée que si tu le dis.
        body.appendChild(endCard(ui, opts.endAsk, h.endChoice));
        if (opts.endAsk.verdict === 'error' && opts.spoolAsk && !opts.spoolNo) after.appendChild(ui.button('Non, c’est raté', h.failed, 'btn ghost sm', 'x'));
        after.appendChild(ui.button('Nouvelle pièce', h.newPart, 'btn ghost sm', 'plus'));
        after.appendChild(ui.button('Ajouter une photo depuis l’ordinateur', h.photo, 'btn ghost sm', 'camera'));
      } else if (!c.success) {
        // opts.spoolAsk : nom de la bobine de l'envoi (ou de l'export) fait depuis le panneau. « Oui » retient ses réglages,
        // « Non » mène à la photo du défaut. opts.spoolNo : « Non » vient d'être répondu.
        if (opts.spoolNo) body.appendChild(ui.el('p', '', 'Dommage. Envoie-moi une photo de ta pièce : je te dis ce qui cloche et comment corriger.'));
        else if (opts.spoolAsk) body.appendChild(ui.el('p', '', 'Ça a marché avec ' + opts.spoolAsk + ' ? Si oui, je retiens ces réglages pour la prochaine fois.'));
        else body.appendChild(ui.el('p', '', 'Quand c’est fini, envoie-moi une photo : je te dis si c’est réussi et comment l’améliorer.'));
        after.appendChild(ui.button('Oui, c’est réussi', h.success, 'btn ghost sm', 'check'));
        if (opts.spoolAsk && !opts.spoolNo) after.appendChild(ui.button('Non, c’est raté', h.failed, 'btn ghost sm', 'x'));
        after.appendChild(ui.button('Nouvelle pièce', h.newPart, 'btn ghost sm', 'plus'));
        after.appendChild(ui.button('Ajouter une photo depuis l’ordinateur', h.photo, 'btn ghost sm', 'camera'));
      }
      body.appendChild(after);
      body.appendChild(ui.button('Réimprimer cette pièce', h.reprint, 'link'));
    }
    if (body.childNodes.length) slot.appendChild(body);
  }

  root.PlyoJourneySteps = { render: render, endCard: endCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoJourneySteps;
})(typeof window !== 'undefined' ? window : globalThis);
