// Vue des emplacements (Canvas, CFS, IFS…) à l'étape Filament (la logique est dans canvas-logic.js). Pas de bouton plein ici :
// l'action principale (« Oui, l'emplacement 4 », « Utiliser ces emplacements ») est dans la ligne d'action.
(function (root) {
  function swatch(ui, color) {
    var s = ui.el('span', 'swatch');
    if (color) s.style.background = color;
    return s;
  }

  // opts : { mode: single|multi|tooMany, system, emptyBlocks, trays, colours, mapping, error, handlers: { pickTray(tray), setTray(t, key), recheck(), useList() } }
  // emptyBlocks : un emplacement vide sera refusé à l'envoi (CFS, IFS) : il ne se choisit pas. Sur la CC2 son « status » n'est pas fiable : « vide ? ».
  function render(slot, ui, opts) {
    var h = opts.handlers, trays = opts.trays || [], body = ui.el('div', 'project-body canvas-choices');
    var w = root.PlyoCanvas.words(opts.system);
    slot.textContent = '';
    if (opts.error) body.appendChild(ui.el('p', 'project-error', opts.error));
    if (opts.mode === 'tooMany') {
      body.appendChild(ui.el('p', 'muted small', 'Ta pièce a ' + opts.colours.length + ' couleurs et ' + w.unit + ' ' + trays.length +
        ' ' + w.slots + '. Réduis le nombre de couleurs de la pièce dans Orca, puis reviens ici.'));
      body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
    } else if (opts.mode === 'multi') {
      body.appendChild(ui.el('p', 'muted small', 'Je propose un emplacement par couleur d’après le type et la couleur. Change ceux qui ne te conviennent pas.'));
      (opts.mapping || []).forEach(function (m) {
        var row = ui.el('label', 'canvas-row');
        row.appendChild(swatch(ui, m.color));
        row.appendChild(ui.el('span', 'canvas-colour', 'Couleur ' + (m.t + 1)));
        var select = ui.el('select', 'field canvas-select');
        select.setAttribute('aria-label', 'Emplacement pour la couleur ' + (m.t + 1));
        var none = ui.el('option', '', 'Choisir un emplacement…');
        none.value = '';
        select.appendChild(none);
        trays.forEach(function (t) {
          var o = ui.el('option', '', t.label + (t.empty ? (opts.emptyBlocks ? ' (vide)' : ' (l’imprimante le croit vide)') : ''));
          o.value = t.canvas_id + ':' + t.tray_id;
          if (t.empty && opts.emptyBlocks) o.disabled = true;
          if (m.tray_id === t.tray_id && m.canvas_id === t.canvas_id) o.selected = true;
          select.appendChild(o);
        });
        select.addEventListener('change', function () { h.setTray(m.t, select.value); });
        row.appendChild(select);
        body.appendChild(row);
      });
    } else {
      body.appendChild(ui.el('p', 'muted small', 'Tes emplacements, tels que réglés sur l’écran de l’imprimante. Touche celui où se trouve ton filament.'));
      var acts = ui.el('div', 'printer-actions');
      var chosen = (opts.mapping || [])[0];
      trays.forEach(function (t) {
        var on = chosen && chosen.tray_id === t.tray_id && chosen.canvas_id === t.canvas_id;
        var b = ui.button(t.label + (t.empty ? (opts.emptyBlocks ? ' · vide' : ' · vide ?') : ''), function () { h.pickTray(t); }, 'btn ghost sm' + (on ? ' on' : ''));
        b.insertBefore(swatch(ui, t.color), b.firstChild);
        if (t.empty && opts.emptyBlocks) b.disabled = true;
        acts.appendChild(b);
      });
      body.appendChild(acts);
      if (trays.some(function (t) { return t.empty; }) && !opts.emptyBlocks)
        body.appendChild(ui.el('p', 'muted small', '« vide ? » : l’imprimante pense que cet emplacement est vide. S’il est chargé, tu peux le choisir quand même.'));
    }
    if (opts.emptyBlocks && opts.mode !== 'tooMany' && trays.some(function (t) { return t.empty; })) {
      body.appendChild(ui.el('p', 'muted small', 'Un emplacement vide ne peut pas être choisi : charge ta bobine, règle-la sur l’écran de l’imprimante, puis relis.'));
      body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
    }
    body.appendChild(ui.button('Choisir un autre filament', h.useList, 'link'));
    slot.appendChild(body);
  }

  root.PlyoCanvasView = { render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoCanvasView;
})(typeof window !== 'undefined' ? window : globalThis);
