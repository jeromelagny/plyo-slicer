// Contenu des étapes 4 à 6 du parcours (Préparer, Imprimer, Résultat) dans le corps qui défile.
// Pas d'état propre : index.html donne le contexte et les gestes. Aucun bouton plein ici : le bouton plein de l'étape est
// celui de la ligne d'action (journey-view.js). Chargé par index.html (window.PlyoJourneySteps).
(function (root) {
  // ui : { el, button, icon }. opts : { step, ctx {sliced, linked, risks}, summary (texte durée et poids), handlers }.
  // handlers : { skip(), exportFile(), started(), photo() }
  function line(ui, iconName, text, tone) {
    var row = ui.el('div', 'printer-step' + (tone ? ' ' + tone : ''));
    row.appendChild(ui.icon(iconName, 14));
    row.appendChild(ui.el('span', '', text));
    return row;
  }

  function render(slot, ui, opts) {
    var c = opts.ctx || {}, h = opts.handlers;
    slot.textContent = '';
    var body = ui.el('div', 'project-body');
    if (opts.step === 'preparer') {
      body.appendChild(line(ui, c.sliced ? 'check' : 'info', c.sliced ? 'Découpe faite' : 'Découpe à faire', c.sliced ? 'ok' : ''));
      if (c.sliced) body.appendChild(line(ui, c.risks > 0 ? 'alert' : 'check', c.risks > 0 ? c.risks + ' point' + (c.risks > 1 ? 's' : '') + ' à régler avant d’imprimer' : 'Aucun risque détecté', c.risks > 0 ? 'warn' : 'ok'));
      if (c.sliced && c.risks > 0) body.appendChild(ui.button('Passer outre', h.skip, 'link'));
    } else if (opts.step === 'imprimer') {
      if (opts.summary) body.appendChild(line(ui, 'check', opts.summary, 'ok'));
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
