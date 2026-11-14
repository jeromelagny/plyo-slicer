// Vue de la carte « Couleurs » à l'étape Filament (la logique est dans colours-logic.js). Pas de bouton plein ici : l'action principale
// (« Utiliser ces bobines », « C’est bon ») est dans la ligne d'action. Le changement d'une couleur part tout de suite, sur ton clic.
(function (root) {
  function swatch(ui, color) {
    var s = ui.el('span', 'swatch');
    if (color) s.style.background = color;
    return s;
  }

  // opts : { rows (PlyoColours.pieceRows), trays, system, emptyBlocks, picker: {ref, part, name, current, confirm, missing} | null,
  //          error, recheck (le refus propose « Vérifier à nouveau »), pending, handlers: { select(ref), open(ref, part, name, tray),
  //          pick(tray), confirm(tray), cancel(), missing(), recheck(), useList(), openManual() } }
  function render(slot, ui, opts) {
    var h = opts.handlers, P = root.PlyoColours, trays = opts.trays || [], pk = opts.picker;
    var body = ui.el('div', 'project-body canvas-choices colours-card');
    slot.textContent = '';
    body.appendChild(ui.el('p', 'muted small', P.INTRO));
    if (opts.system === 'manual') body.appendChild(ui.el('p', 'muted small', 'Ces bobines viennent de ce que tu m’as dit.'));
    if (opts.error) {
      body.appendChild(ui.el('p', 'project-error', opts.error));
      if (opts.recheck) body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
    }
    if (opts.pending) body.appendChild(ui.el('p', 'muted small', 'Je change la couleur…'));

    function line(target, isPart) {
      var row = ui.el('div', 'project-row colour-row' + (isPart ? ' project-sub' : '') + (target.selected ? ' on' : ''));
      var left = ui.el('div', 'project-label');
      var pick = ui.button(target.name, function () { h.select(target.ref); }, 'link colour-name');
      pick.insertBefore(swatch(ui, target.tray ? target.tray.color : ''), pick.firstChild);
      pick.setAttribute('aria-label', target.name + ' : ' + target.text + (isPart ? '' : ', la montrer dans la vue 3D'));
      if (isPart) pick.disabled = true; // une partie se montre avec sa pièce
      left.appendChild(pick);
      left.appendChild(ui.el('span', 'muted small', target.text));
      if (target.selected) left.appendChild(ui.el('span', 'project-ok', 'sélectionnée'));
      row.appendChild(left);
      if (target.canChange && !opts.pending) row.appendChild(ui.button('changer', function () { h.open(target.piece || target.ref, isPart ? target.ref : '', target.name, target.tray); }, 'link'));
      body.appendChild(row);
    }
    function picker() {
      var box = ui.el('div', 'brand-ask colour-picker');
      box.appendChild(ui.el('p', 'small', 'Quelle bobine pour « ' + pk.name + ' » ?'));
      if (pk.confirm) {
        box.appendChild(ui.el('p', 'small', P.otherMaterialNote(pk.current, pk.confirm)));
        var yes = ui.el('div', 'printer-actions');
        yes.appendChild(ui.button('Oui, cette bobine', function () { h.confirm(pk.confirm); }, 'btn ghost sm', 'check'));
        yes.appendChild(ui.button('Annuler', h.cancel, 'link'));
        box.appendChild(yes);
        return box;
      }
      var acts = ui.el('div', 'printer-actions');
      trays.forEach(function (t) {
        var on = pk.current && P.trayKey(pk.current) === P.trayKey(t);
        var b = ui.button(P.spoolText(t) + (t.empty && opts.system !== 'manual' ? (opts.emptyBlocks ? ' · vide' : ' · vide ?') : ''), function () { h.pick(t); }, 'btn ghost sm' + (on ? ' on' : ''));
        b.insertBefore(swatch(ui, t.color), b.firstChild);
        if ((t.empty && opts.emptyBlocks) || !t.type) b.disabled = true; // matière inconnue : on ne saurait pas quel profil prendre
        acts.appendChild(b);
      });
      box.appendChild(acts);
      if (pk.missing) box.appendChild(ui.el('p', 'muted small', P.missingText('')));
      var links = ui.el('div', 'printer-actions');
      links.appendChild(pk.missing ? ui.button('Vérifier à nouveau', h.recheck, 'link') : ui.button('Ma couleur n’est pas là', h.missing, 'link'));
      links.appendChild(ui.button('Annuler', h.cancel, 'link'));
      box.appendChild(links);
      return box;
    }

    (opts.rows || []).forEach(function (r) {
      line(r, false);
      if (pk && pk.ref === r.ref && !pk.part) body.appendChild(picker());
      if (r.paintedText) body.appendChild(ui.el('p', 'muted small project-sub', r.paintedText));
      r.parts.forEach(function (q) {
        line(Object.assign({ piece: r.ref }, q), true);
        if (pk && pk.ref === r.ref && pk.part === q.ref) body.appendChild(picker());
      });
      if (r.mixed) body.appendChild(ui.el('p', 'muted small project-sub', 'Ses parties n’ont pas la même couleur : change-les une par une.'));
    });
    if (trays.length) {
      var legend = ui.el('p', 'muted small colours-legend', 'Tes bobines : ' + trays.map(function (t) { return P.spoolText(t) + (t.empty ? ' (vide)' : ''); }).join(', '));
      body.appendChild(legend);
    }
    if (opts.system === 'manual') body.appendChild(ui.button('J’ai changé', h.openManual, 'link'));
    body.appendChild(ui.button('Choisir un autre filament', h.useList, 'link'));
    slot.appendChild(body);
  }

  root.PlyoColoursView = { render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoColoursView;
})(typeof window !== 'undefined' ? window : globalThis);
