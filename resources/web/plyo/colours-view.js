// Vue de la carte « Couleurs » à l'étape Filament (la logique est dans colours-logic.js). Pas de bouton plein ici : l'action principale
// (« Utiliser ces bobines », « C’est bon ») est dans la ligne d'action. Le changement de la couleur d'une pièce part tout de suite,
// sur ton clic ; la bobine d'une couleur du fichier (lot 21) n'est qu'une proposition jusqu'à « Utiliser ces bobines ».
(function (root) {
  function swatch(ui, color) {
    var s = ui.el('span', 'swatch');
    if (color) s.style.background = color;
    return s;
  }

  // opts : { rows (PlyoColours.pieceRows), fileRows (PlyoColours.fileRows, [] hors 3MF en couleurs), unfolded (pièces dépliées sous
  //          les couleurs du fichier), sameTray (PlyoColours.sameTrayNote), trays, system, emptyBlocks,
  //          picker: {ref, part, fileT, name, current, confirm, missing} | null, error, recheck (le refus propose « Vérifier à nouveau »),
  //          pending, handlers: { select(ref), open(ref, part, name, tray), openFile(t, name, tray), pick(tray), confirm(tray), cancel(),
  //          missing(), recheck(), useList(), openManual(), toggleOne(), paint() } }
  function render(slot, ui, opts) {
    var h = opts.handlers, P = root.PlyoColours, trays = opts.trays || [], pk = opts.picker, files = opts.fileRows || [];
    var body = ui.el('div', 'project-body canvas-choices colours-card');
    slot.textContent = '';
    body.appendChild(ui.el('p', 'muted small', files.length ? P.fileIntro(files) : P.INTRO));
    if (opts.system === 'manual') body.appendChild(ui.el('p', 'muted small', 'Ces bobines viennent de ce que tu m’as dit.'));
    if (opts.error) {
      body.appendChild(ui.el('p', 'project-error', opts.error));
      if (opts.recheck) body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
    }
    if (opts.pending) body.appendChild(ui.el('p', 'muted small', 'Je change la couleur…'));

    // La bobine : pastille et texte, sur une seule ligne (« PLA blanc · 2 » ne se coupe pas).
    function spool(tray, text) {
      var s = ui.el('span', 'muted small colour-spool');
      s.appendChild(swatch(ui, tray ? tray.color : ''));
      s.appendChild(ui.el('span', '', text));
      return s;
    }
    function line(target, isPart) {
      var row = ui.el('div', 'project-row colour-row' + (isPart ? ' colour-part' : '') + (target.selected ? ' on' : ''));
      var left = ui.el('div', 'project-label colour-label');
      if (isPart) {
        // Une partie se montre avec sa pièce : son numéro, et son nom d'origine en petit (ou en infobulle).
        var lab = ui.el('span', 'colour-part-name', target.label);
        if (target.title) lab.title = target.title;
        left.appendChild(lab);
        if (target.detail) left.appendChild(ui.el('span', 'muted small colour-detail', target.detail));
      } else {
        var pick = ui.button(target.name, function () { h.select(target.ref); }, 'link colour-name');
        if (target.title && target.title !== target.name) pick.title = target.title;
        pick.setAttribute('aria-label', target.name + ' : ' + target.text + ', la montrer dans la vue 3D');
        left.appendChild(pick);
      }
      row.appendChild(left);
      var right = ui.el('div', 'colour-right');
      right.appendChild(spool(target.tray, target.text));
      if (target.selected) right.appendChild(ui.el('span', 'project-ok', 'sélectionnée'));
      if (target.canChange && !opts.pending) right.appendChild(ui.button('changer', function () { h.open(target.piece || target.ref, isPart ? target.ref : '', target.name, target.tray); }, 'link'));
      row.appendChild(right);
      body.appendChild(row);
    }
    function fileLine(r) {
      var row = ui.el('div', 'project-row colour-row colour-file');
      var left = ui.el('div', 'project-label colour-label');
      var name = ui.el('span', 'colour-file-name');
      name.appendChild(swatch(ui, r.fileColour));
      name.appendChild(ui.el('span', '', r.fileName + ' du fichier'));
      left.appendChild(name);
      var where = P.fileWhere(r);
      if (where) left.appendChild(ui.el('span', 'muted small colour-detail', where));
      row.appendChild(left);
      var right = ui.el('div', 'colour-right');
      right.appendChild(spool(r.tray, r.text));
      if (trays.length > 1 && !opts.pending) right.appendChild(ui.button('changer', function () { h.openFile(r.t, r.fileName + ' du fichier', r.tray); }, 'link'));
      row.appendChild(right);
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
    function pieceLines() {
      (opts.rows || []).forEach(function (r) {
        line(r, false);
        if (pk && pk.fileT === undefined && pk.ref === r.ref && !pk.part) body.appendChild(picker());
        if (r.paintedText) body.appendChild(ui.el('p', 'muted small colour-part', r.paintedText));
        r.parts.forEach(function (q) {
          line(Object.assign({ piece: r.ref }, q), true);
          if (pk && pk.fileT === undefined && pk.ref === r.ref && pk.part === q.ref) body.appendChild(picker());
        });
        if (r.mixed) body.appendChild(ui.el('p', 'muted small colour-part', 'Ses parties n’ont pas la même couleur : change-les une par une.'));
      });
    }

    if (files.length) {
      // Un 3MF en couleurs : une ligne par couleur du fichier ; « changer » réaffecte toute la couleur (rien n'est écrit avant
      // « Utiliser ces bobines »).
      files.forEach(function (r) {
        fileLine(r);
        if (pk && pk.fileT === r.t) body.appendChild(picker());
      });
      if (opts.sameTray) body.appendChild(ui.el('p', 'small colour-same', opts.sameTray));
      if (files.some(function (r) { return r.painted.length > 0; })) {
        body.appendChild(ui.el('p', 'muted small', P.PAINTED_FILE));
        if (h.paint) body.appendChild(ui.button('Retoucher au pinceau', h.paint, 'link'));
      }
      var toggle = ui.button(P.ONE_PIECE, h.toggleOne, 'disclosure', 'chevron');
      toggle.setAttribute('aria-expanded', opts.unfolded ? 'true' : 'false');
      body.appendChild(toggle);
      if (opts.unfolded) pieceLines();
    } else pieceLines();
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
