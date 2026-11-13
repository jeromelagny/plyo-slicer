// Vue des emplacements (Canvas, CFS, IFS…) à l'étape Filament (la logique est dans canvas-logic.js). Pas de bouton plein ici :
// l'action principale (« Oui, l'emplacement 4 », « Utiliser ces emplacements ») est dans la ligne d'action.
(function (root) {
  function swatch(ui, color) {
    var s = ui.el('span', 'swatch');
    if (color) s.style.background = color;
    return s;
  }

  // readOnly : lire sans imposer, avec `blocker` (pourquoi) ; trial : lecture pas encore essayée sur une vraie machine (validated faux).
  // opts : { mode: single|multi|tooMany, system, emptyBlocks, readOnly, blocker, trial, trays, colours, mapping, error, handlers: { pickTray(tray), setTray(t, key), recheck(), useList() } }
  // emptyBlocks : un emplacement vide sera refusé à l'envoi (CFS, IFS) : il ne se choisit pas. Sur la CC2 son « status » n'est pas fiable : « vide ? ».
  // Marque d'un emplacement (opts.brand, voir index.html slotBrandView) : une ligne discrète « Marque : … · changer », et la
  // question « De quelle marque ? » sous elle quand on l'a ouverte. Rien tant que le slicer n'a pas répondu.
  function brandRow(body, ui, opts, tray) {
    var b = opts.brand, S = root.PlyoSpools;
    if (!b || !tray) return;
    var key = S.slotKey(tray), it = b.items[key];
    if (!it || !it.material) return;
    var row = ui.el('div', 'project-row project-sub');
    row.appendChild(ui.el('span', 'muted small', (opts.mode === 'multi' ? tray.slot + ' · ' : '') + S.slotBrandText(b.choices[key])));
    row.appendChild(ui.button('changer', function () { opts.handlers.slotBrandOpen(key); }, 'link'));
    body.appendChild(row);
    if (b.picker && b.picker.key === key)
      root.PlyoProjectCard.renderBrandPicker(body, ui, { brands: it.brands, state: b.picker, field: 'Marque de la bobine ' + tray.slot, handlers: b.pickerHandlers });
  }
  // Une seule question pour les emplacements dont l'annonce correspond à un profil fourni : jamais bloquante (sans réponse,
  // les réglages communs restent), « Oui » prend le profil de la marque pour chacun.
  function brandQuestion(body, ui, opts) {
    var b = opts.brand, h = opts.handlers;
    if (!b || !b.question || b.picker) return;
    var box = ui.el('div', 'brand-ask');
    box.appendChild(ui.el('p', 'small', b.question));
    var acts = ui.el('div', 'printer-actions');
    acts.appendChild(ui.button(b.offers.length === 1 ? 'Oui, c’est elle' : 'Oui, ce sont elles', function () { h.slotBrandYes(b.offers); }, 'btn ghost sm', 'check'));
    if (b.offers.length === 1) acts.appendChild(ui.button('Autre marque', function () { h.slotBrandOpen(b.offers[0].key); }, 'link'));
    acts.appendChild(ui.button('Je ne sais pas', function () { h.slotBrandUnknown(b.offers); }, 'link'));
    box.appendChild(acts);
    if (b.offers.length > 1) box.appendChild(ui.el('p', 'muted small', 'Pour en changer une, touche « changer » sur sa ligne.'));
    body.appendChild(box);
  }

  function render(slot, ui, opts) {
    var h = opts.handlers, trays = opts.trays || [], body = ui.el('div', 'project-body canvas-choices');
    var w = root.PlyoCanvas.words(opts.system);
    // Le panneau se redessine souvent : la marque en cours de saisie garde le curseur tant que rien de ce qui est montré ne change.
    var b0 = opts.brand, pk0 = b0 && b0.picker;
    var key = JSON.stringify([opts.mode, opts.mapping, opts.error, trays, b0 ? [b0.choices, b0.question, !!b0.items, pk0 && [pk0.key, pk0.showAll, pk0.picked && pk0.picked.brand, pk0.other, pk0.error]] : null]);
    var active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && active.dataset && active.dataset.spoolName && slot.contains(active) && slot.canvasKey === key) return;
    slot.canvasKey = key;
    slot.textContent = '';
    if (opts.error) body.appendChild(ui.el('p', 'project-error', opts.error));
    var u1 = opts.system === 'u1', manual = opts.system === 'manual';
    if (manual) body.appendChild(ui.el('p', 'muted small', 'Ces emplacements viennent de ce que tu m’as dit.'));
    if (opts.system === 'u1') body.appendChild(ui.el('p', 'muted small', 'Ces couleurs sont sur tes têtes. Vérifie sur l’écran de la U1 : je ne change pas l’ordre des têtes.' + (opts.trial ? ' Cette lecture n’a pas encore été essayée sur une vraie U1.' : '')));
    else if (opts.readOnly) body.appendChild(ui.el('p', 'muted small', 'Je lis ces emplacements, mais je ne peux pas imposer ton choix sur cette machine' + (opts.blocker ? ' (' + opts.blocker + ')' : '') + '. Il sert à régler le bon filament ; tu le sélectionneras à l’envoi.'));
    else if (opts.trial) body.appendChild(ui.el('p', 'muted small', 'Plyo n’a pas encore été essayé sur cette marque : compare ces emplacements avec l’écran de ton imprimante.'));
    if (opts.mode === 'tooMany') {
      body.appendChild(ui.el('p', 'muted small', 'Ta pièce a ' + opts.colours.length + ' couleurs et ' + w.unit + ' ' + trays.length +
        ' ' + w.slots + '. Réduis le nombre de couleurs de la pièce dans Plyo Slicer, puis reviens ici.'));
      body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
    } else if (opts.mode === 'multi') {
      body.appendChild(ui.el('p', 'muted small', u1 ? 'Je propose une tête par couleur d’après le type et la couleur. Change celles qui ne te conviennent pas.' : 'Je propose un emplacement par couleur d’après le type et la couleur. Change ceux qui ne te conviennent pas.'));
      (opts.mapping || []).forEach(function (m) {
        var row = ui.el('label', 'canvas-row');
        row.appendChild(swatch(ui, m.color));
        row.appendChild(ui.el('span', 'canvas-colour', 'Couleur ' + (m.t + 1)));
        var select = ui.el('select', 'field canvas-select');
        select.setAttribute('aria-label', (u1 ? 'Tête' : 'Emplacement') + ' pour la couleur ' + (m.t + 1));
        var none = ui.el('option', '', u1 ? 'Choisir une tête…' : 'Choisir un emplacement…');
        none.value = '';
        select.appendChild(none);
        trays.forEach(function (t) {
          var o = ui.el('option', '', t.label + (t.empty && !manual ? (opts.emptyBlocks ? ' (vide)' : ' (l’imprimante le croit vide)') : ''));
          o.value = t.canvas_id + ':' + t.tray_id;
          if (t.empty && opts.emptyBlocks) o.disabled = true;
          if (m.tray_id === t.tray_id && m.canvas_id === t.canvas_id) o.selected = true;
          select.appendChild(o);
        });
        select.addEventListener('change', function () { h.setTray(m.t, select.value); });
        row.appendChild(select);
        body.appendChild(row);
        brandRow(body, ui, opts, trays.filter(function (t) { return t.tray_id === m.tray_id && t.canvas_id === m.canvas_id; })[0]);
      });
      brandQuestion(body, ui, opts);
    } else {
      body.appendChild(ui.el('p', 'muted small', u1 ? 'Tes têtes, telles que réglées sur l’écran de l’imprimante. Touche celle où se trouve ton filament.' : (manual ? 'Touche celui où se trouve ton filament.' : 'Tes emplacements, tels que réglés sur l’écran de l’imprimante. Touche celui où se trouve ton filament.')));
      var acts = ui.el('div', 'printer-actions');
      var chosen = (opts.mapping || [])[0];
      trays.forEach(function (t) {
        var on = chosen && chosen.tray_id === t.tray_id && chosen.canvas_id === t.canvas_id;
        var b = ui.button(t.label + (t.empty && !manual ? (opts.emptyBlocks ? ' · vide' : ' · vide ?') : ''), function () { h.pickTray(t); }, 'btn ghost sm' + (on ? ' on' : ''));
        b.insertBefore(swatch(ui, t.color), b.firstChild);
        if (t.empty && opts.emptyBlocks) b.disabled = true;
        acts.appendChild(b);
      });
      body.appendChild(acts);
      // La marque de l'emplacement proposé (celui que garde « Utiliser… » de la ligne d'action).
      brandQuestion(body, ui, opts);
      brandRow(body, ui, opts, chosen && trays.filter(function (t) { return t.tray_id === chosen.tray_id && t.canvas_id === chosen.canvas_id; })[0]);
      if (trays.some(function (t) { return t.empty; }) && !opts.emptyBlocks && !manual)
        body.appendChild(ui.el('p', 'muted small', '« vide ? » : l’imprimante pense que cet emplacement est vide. S’il est chargé, tu peux le choisir quand même.'));
    }
    if (opts.emptyBlocks && opts.mode !== 'tooMany' && trays.some(function (t) { return t.empty; })) {
      body.appendChild(ui.el('p', 'muted small', (u1 ? 'Une tête vide ne peut pas être choisie' : 'Un emplacement vide ne peut pas être choisi') + ' : charge ta bobine, règle-la sur l’écran de l’imprimante, puis relis.'));
      body.appendChild(ui.button('Vérifier à nouveau', h.recheck, 'link'));
    }
    if (manual) body.appendChild(ui.button('J’ai changé', h.openManual, 'link'));
    body.appendChild(ui.button('Choisir un autre filament', h.useList, 'link'));
    slot.appendChild(body);
  }

  // Saisie manuelle. opts : { draft (16 lignes), count, error, types, colours, handlers: { manualCount(n), manualSet(i, champ, valeur), manualCancel() } }.
  // Le bouton plein (« Garder ces emplacements ») est dans la ligne d'action. Le panneau se redessine souvent : le formulaire ne bouge
  // que si le nombre ou l'erreur change, pour ne pas fermer une liste ouverte.
  function renderManual(slot, ui, opts) {
    var key = JSON.stringify([opts.count, opts.error || '']), h = opts.handlers;
    if (slot.manualKey === key && slot.querySelector('.manual-form')) return;
    slot.manualKey = key;
    slot.textContent = '';
    var body = ui.el('div', 'project-body canvas-choices manual-form');
    if (opts.error) body.appendChild(ui.el('p', 'project-error', opts.error));
    body.appendChild(ui.el('p', 'muted small', 'Dis-moi ce qui est chargé, tel que c’est sur ta machine. Je m’en souviens ici, sur cet ordinateur, et je te le rappelle la prochaine fois. Tu le sélectionneras toi-même sur l’imprimante. Il me faut au moins la matière de chaque emplacement.'));
    var countRow = ui.el('label', 'canvas-row');
    countRow.appendChild(ui.el('span', 'canvas-colour', 'Combien ?'));
    var count = ui.el('select', 'field canvas-select');
    count.setAttribute('aria-label', 'Nombre d’emplacements');
    for (var n = 1; n <= root.PlyoCanvas.MANUAL_MAX; n++) { var co = ui.el('option', '', String(n)); co.value = String(n); if (n === opts.count) co.selected = true; count.appendChild(co); }
    count.addEventListener('change', function () { h.manualCount(Number(count.value)); });
    countRow.appendChild(count);
    body.appendChild(countRow);
    opts.draft.slice(0, opts.count).forEach(function (d, i) {
      var row = ui.el('div', 'canvas-row manual-row');
      var dot = swatch(ui, d.color);
      row.appendChild(dot);
      row.appendChild(ui.el('span', 'manual-num', String(i + 1)));
      var type = ui.el('select', 'field canvas-select');
      type.setAttribute('aria-label', 'Matière de l’emplacement ' + (i + 1));
      [''].concat(opts.types).forEach(function (t) { var o = ui.el('option', '', t || 'Matière ?'); o.value = t; if (t === d.type) o.selected = true; type.appendChild(o); });
      type.addEventListener('change', function () { h.manualSet(i, 'type', type.value); });
      row.appendChild(type);
      var colour = ui.el('select', 'field canvas-select');
      colour.setAttribute('aria-label', 'Couleur de l’emplacement ' + (i + 1));
      var none = ui.el('option', '', 'Couleur ?'); none.value = ''; colour.appendChild(none);
      opts.colours.forEach(function (c) { var o = ui.el('option', '', c.name); o.value = c.hex; if (c.hex === d.color) o.selected = true; colour.appendChild(o); });
      colour.addEventListener('change', function () { dot.style.background = colour.value; h.manualSet(i, 'color', colour.value); });
      row.appendChild(colour);
      body.appendChild(row);
    });
    body.appendChild(ui.button('Annuler', h.manualCancel, 'link'));
    slot.appendChild(body);
  }

  // Rappel d'une saisie : la question et « Oui » sont dans la ligne d'action.
  function renderRecall(slot, ui, opts) {
    var body = ui.el('div', 'project-body canvas-choices');
    slot.textContent = '';
    var list = ui.el('div', 'printer-actions');
    (opts.trays || []).forEach(function (t) { var tag = ui.el('span', 'manual-tag'); tag.appendChild(swatch(ui, t.color)); tag.appendChild(ui.el('span', '', t.label)); list.appendChild(tag); });
    body.appendChild(list);
    var acts = ui.el('div', 'printer-actions');
    acts.appendChild(ui.button('J’ai changé', opts.handlers.openManual, 'btn ghost sm'));
    body.appendChild(acts);
    body.appendChild(ui.button('Choisir un autre filament', opts.handlers.useList, 'link'));
    slot.appendChild(body);
  }

  root.PlyoCanvasView = { render: render, renderManual: renderManual, renderRecall: renderRecall };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoCanvasView;
})(typeof window !== 'undefined' ? window : globalThis);
