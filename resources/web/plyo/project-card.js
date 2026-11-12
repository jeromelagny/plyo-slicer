// Rendu de la fiche « Mon projet » (imprimante, filament avec températures, pièce) en tête du panneau.
// Pas d'état propre : index.html lui donne le projet et les gestes (handlers) ; la logique des étapes est dans project-logic.js.
// Chargé par index.html (window.PlyoProjectCard).
(function (root) {
  var MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];

  // ui : { el, button, icon, rich } (les aides du panneau).
  // ctx : { project, printers (liste ou null), reachable {preset: bool}, error {printer?, filament?}, editing, compact, handlers }.
  // handlers : { pickPrinter(preset, name), keepProposed(), setupPrinter(), pickSpool(row), toggleNewSpool(), pickMaterial(type),
  //              typeSpoolName(text), createSpool(), setTemps(nozzle, bed), importPart(), change(line), expand() }
  // ctx.spools : lignes de PlyoSpools.choiceRows (null tant que le slicer ne les a pas données) ; ctx.newSpool : voir renderNewSpool.
  // Aucun bouton plein ici : le seul bouton plein d'une étape est celui de la ligne d'action (journey-view.js).
  function projectOf(ctx) { return ctx.project || root.PlyoProject.emptyProject(); }

  // La fiche : seulement ce qui est déjà choisi (rien au tout début), ou une seule ligne quand `compact`.
  function renderFiche(slot, ui, ctx) {
    var project = projectOf(ctx), h = ctx.handlers, rows = root.PlyoJourney.filledRows(project);
    slot.textContent = '';
    if (!rows.length) return;
    var card = ui.el('div', 'project' + (ctx.compact ? ' compact' : ''));
    if (ctx.compact) {
      card.appendChild(ui.button(root.PlyoJourney.ficheSummary(project), h.expand, 'link project-summary'));
      slot.appendChild(card);
      return;
    }
    // Le Wi-Fi seulement pour une machine reliée : les autres passent par un fichier.
    var icons = { printer: ctx.linked ? 'wifi' : 'printer', filament: 'palette', part: 'cube' };
    rows.forEach(function (row) {
      var r = ui.el('div', 'project-row');
      var left = ui.el('div', 'project-label');
      left.appendChild(ui.icon(icons[row.line], 14));
      if (row.swatch) { var dot = ui.el('span', 'swatch'); dot.style.background = row.swatch; left.appendChild(dot); }
      left.appendChild(ui.el('span', '', row.text));
      if (row.line === 'printer' && ctx.reachable && ctx.reachable[project.printer.preset] === true) left.appendChild(ui.el('span', 'project-ok', '● connectée'));
      r.appendChild(left);
      if (row.line !== 'part') r.appendChild(ui.button('changer', function () { h.change(row.line); }, 'link'));
      card.appendChild(r);
      // Températures modifiables à la main : réservées aux confirmés (un débutant les change sans le vouloir).
      if (row.line === 'filament' && !ctx.beginner) {
        var fi = project.filament, temps = ui.el('div', 'temp-row project-temps');
        var field = function (label, value) {
          var wrap = ui.el('label', 'temp-field');
          wrap.appendChild(ui.el('span', 'muted small', label));
          var input = ui.el('input', 'field');
          input.type = 'text';
          input.inputMode = 'numeric';
          input.value = value === null || value === undefined ? '' : String(value);
          input.setAttribute('aria-label', label);
          input.addEventListener('change', function () { h.setTemps(nIn.value, bIn.value); });
          wrap.appendChild(input);
          temps.appendChild(wrap);
          return input;
        };
        var nIn = field('Buse (°C)', fi.nozzle_temp);
        var bIn = field('Plateau (°C)', fi.bed_temp);
        card.appendChild(temps);
      }
      if (row.line === 'filament') renderSpool(card, ui, project.filament, ctx);
    });
    slot.appendChild(card);
  }

  // Températures de la fiche : rappel (débutant), lien vers la plage de l'étiquette de la bobine, et ce formulaire une fois ouvert.
  // ctx.spool : { open, limits (plage connue ou null), error }. Enregistrer garde la plage (limites du fabricant) et règle
  // les températures dedans (h.setSpoolRange).
  function renderSpool(card, ui, fi, ctx) {
    var h = ctx.handlers, sp = ctx.spool || {};
    var wrap = ui.el('div', 'project-spool');
    if (ctx.beginner && (fi.nozzle_temp != null || fi.bed_temp != null))
      wrap.appendChild(ui.el('p', 'muted small', 'Buse ' + (fi.nozzle_temp != null ? fi.nozzle_temp + ' °C' : '?') + ' · plateau ' + (fi.bed_temp != null ? fi.bed_temp + ' °C' : '?')));
    if (!sp.open) wrap.appendChild(ui.button('Ma bobine indique d’autres températures', h.toggleSpool, 'link'));
    card.appendChild(wrap);
  }

  // Formulaire de la plage de la bobine, dans le corps de l'onglet Étapes (la fiche en tête n'a pas la place).
  function renderSpoolEditor(slot, ui, ctx) {
    var h = ctx.handlers, sp = ctx.spool || {};
    if (!sp.open) { slot.textContent = ''; return; }
    // Le panneau se redessine souvent (signaux, redimensionnement) : le formulaire ouvert ne bouge pas tant que ce qu'il montre
    // ne change pas, et ce que tu as déjà saisi est gardé quand il change.
    var key = JSON.stringify([sp.limits || null, sp.error || '']);
    var typed = {}, wasOpen = !!slot.firstChild;
    if (wasOpen && slot.spoolKey === key) return;
    slot.querySelectorAll('input').forEach(function (i) { typed[i.getAttribute('aria-label')] = i.value; });
    slot.spoolKey = key;
    slot.textContent = '';
    var wrap = ui.el('div', 'card project-spool');
    wrap.appendChild(ui.el('h3', '', 'Températures de ta bobine'));
    wrap.appendChild(ui.el('p', 'small', 'Recopie les températures écrites sur l’étiquette de ta bobine (souvent une plage, par exemple 190–220 °C). Laisse vide ce qui n’y est pas.'));
    var l = sp.limits || {}, inputs = {}, grid = ui.el('div', 'spool-grid');
    [['nozzle_min', 'Buse min (°C)'], ['nozzle_max', 'Buse max (°C)'], ['bed_min', 'Plateau min (°C)'], ['bed_max', 'Plateau max (°C)']].forEach(function (f) {
      var lab = ui.el('label', 'temp-field');
      lab.appendChild(ui.el('span', 'muted small', f[1]));
      var input = ui.el('input', 'field');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.value = typed[f[1]] || (typeof l[f[0]] === 'number' ? String(l[f[0]]) : '');
      input.setAttribute('aria-label', f[1]);
      inputs[f[0]] = input;
      lab.appendChild(input);
      grid.appendChild(lab);
    });
    wrap.appendChild(grid);
    if (sp.error) wrap.appendChild(ui.el('p', 'project-error', sp.error));
    var acts = ui.el('div', 'printer-actions');
    acts.appendChild(ui.button('Utiliser ces températures', function () {
      var raw = {};
      Object.keys(inputs).forEach(function (k) { raw[k] = inputs[k].value; });
      h.setSpoolRange(raw);
    }, 'btn ghost sm'));
    acts.appendChild(ui.button('Annuler', h.toggleSpool, 'link'));
    wrap.appendChild(acts);
    slot.appendChild(wrap);
    if (!wasOpen) setTimeout(function () { inputs.nozzle_min.focus(); }, 0);
  }

  // Liaison faite sans le numéro de série ni le code (AD5X reliée avant) : aucune répartition possible tant qu'elle n'est pas refaite.
  // La série n'est connue qu'après une recherche sur le réseau : « Relier à nouveau » commence par là.
  function renderSlotNotes(body, ui, ctx) {
    if (ctx.relink) {
      body.appendChild(ui.el('p', 'muted small', 'Ta machine a été reliée sans son numéro de série ni son code d’accès : je ne lis pas ses emplacements. Allume-la, et je la cherche sur le réseau pour la relier.'));
      body.appendChild(ui.button('Relier à nouveau', ctx.handlers.setupPrinter, 'link'));
    }
    if (ctx.noSlots) body.appendChild(ui.el('p', 'muted small', 'Je ne lis pas les emplacements de ta machine pour l’instant : choisis ta bobine ici. À l’envoi, regarde la fenêtre d’Orca et l’écran de l’imprimante.'));
    if (ctx.slotRemark) body.appendChild(ui.el('p', 'muted small', ctx.slotRemark));
  }
  // Pas de question par défaut : le profil ne permet pas de reconnaître une machine à une bobine. Un lien discret, après les bobines.
  function renderManualLink(body, ui, ctx) {
    if (ctx.manualLink) body.appendChild(ui.button('Ma machine a plusieurs bobines (AMS, CFS…)', ctx.handlers.openManual, 'link'));
  }

  // Une nouvelle bobine : sa matière (puces), puis son nom, obligatoire et toujours avec l'aide (où regarder, un exemple).
  // ctx.newSpool : { open, material, name, error ('vide'|'court'|texte du slicer), focus }.
  function renderNewSpool(body, ui, ctx, closable) {
    var h = ctx.handlers, ns = ctx.newSpool || {}, S = root.PlyoSpools;
    var box = ui.el('div', 'new-spool');
    box.appendChild(ui.el('p', 'intent-q', 'Une nouvelle bobine'));
    box.appendChild(ui.el('p', 'muted small', 'Sa matière est écrite sur l’étiquette. Pas sûr ? C’est presque toujours du PLA.'));
    var kinds = ui.el('div', 'printer-actions');
    MATERIALS.forEach(function (k) {
      kinds.appendChild(ui.button(k, function () { h.pickMaterial(k); }, 'btn ghost sm' + (ns.material === k ? ' on' : '')));
    });
    box.appendChild(kinds);
    if (ns.material) {
      var lab = ui.el('label', 'temp-field spool-name');
      lab.appendChild(ui.el('span', 'muted small', 'Nom de ta bobine'));
      var input = ui.el('input', 'field');
      input.type = 'text';
      input.maxLength = 60;
      input.value = ns.name || '';
      input.setAttribute('aria-label', 'Nom de ta bobine');
      input.dataset.spoolName = '1';
      input.addEventListener('input', function () { h.typeSpoolName(input.value); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); h.createSpool(); } });
      lab.appendChild(input);
      box.appendChild(lab);
      box.appendChild(ui.el('p', 'muted small', root.PlyoSpools.NAME_HELP));
      if (ns.error) box.appendChild(ui.el('p', 'project-error', S.nameErrorText(ns.error) || ns.error));
      var acts = ui.el('div', 'printer-actions');
      acts.appendChild(ui.button('C’est ma bobine', h.createSpool, 'btn ghost sm', 'check'));
      if (closable) acts.appendChild(ui.button('Annuler', h.toggleNewSpool, 'link'));
      box.appendChild(acts);
      if (ns.focus) { ns.focus = false; setTimeout(function () { input.focus(); }, 0); }
    } else if (closable) box.appendChild(ui.button('Annuler', h.toggleNewSpool, 'link'));
    body.appendChild(box);
  }

  // Le contenu des étapes 1 à 3 (imprimante, filament, pièce) : des choix qui s'appliquent tout de suite.
  function renderChoices(slot, ui, ctx) {
    var P = root.PlyoProject, project = projectOf(ctx), step = P.nextStep(project), h = ctx.handlers;
    // Le panneau se redessine souvent (signaux, redimensionnement) : le nom de bobine en cours de saisie garde le curseur
    // tant que rien de ce qui est montré ne change.
    var ns0 = ctx.newSpool || {}, key = JSON.stringify([step, project.filament, ctx.editing, ctx.spools, ns0.open, ns0.material, ns0.error, ctx.error, ctx.showKinds, ctx.noCanvas, ctx.noSlots, ctx.manualLink, ctx.slotRemark, ctx.relink]);
    var active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && active.dataset && active.dataset.spoolName && slot.contains(active) && slot.choicesKey === key) return;
    slot.choicesKey = key;
    slot.textContent = '';
    var fi = project.filament && !project.filament.proposed ? project.filament : null;
    var proposedFilament = project.filament && project.filament.proposed && project.filament.spool ? project.filament : null; // projet ancien : pas de bobine à reproposer
    var wantsFilament = step === 'filament' || ctx.editing === 'filament';
    if (step !== 'printer' && !wantsFilament && step !== 'part') return;
    var body = ui.el('div', 'project-body');
    if (step === 'printer') {
      var proposed = project.printer && project.printer.proposed ? project.printer : null;
      if (ctx.error && ctx.error.printer) body.appendChild(ui.el('p', 'project-error', ctx.error.printer));
      var list = ctx.printers;
      if (proposed && !ctx.showList) {
        // Une machine proposée (celle d'Orca ou la dernière utilisée) : le bouton « Oui » est dans la ligne d'action.
        body.appendChild(ui.button('Une autre machine', h.toggleList, 'link'));
      } else if (list === null || list === undefined) body.appendChild(ui.el('p', 'muted small', 'Je cherche tes imprimantes…'));
      else {
        var groups = root.PlyoJourney.groupPrinters(list);
        var acts = ui.el('div', 'printer-actions');
        var add = function (p) {
          var label = p.label + (p.linked ? (ctx.reachable && ctx.reachable[p.preset] === true ? ' ● connectée' : ' · reliée') : '');
          acts.appendChild(ui.button(label, function () { h.pickPrinter(p.preset, p.label); }, 'btn ghost sm'));
        };
        groups.main.forEach(add);
        if (!groups.main.length && !groups.others.length) body.appendChild(ui.el('p', 'muted small', 'Aucune imprimante pour l’instant : ajoute la tienne avec le lien en haut à droite.'));
        // Machines non reliées (carte SD, clé USB) : visibles comme les autres tant qu'il y en a peu, sinon repliées.
        if (groups.others.length && (groups.others.length <= 3 || ctx.showOthers)) groups.others.forEach(add);
        else if (groups.others.length) acts.appendChild(ui.button('Autres machines installées (' + groups.others.length + ')', h.toggleOthers, 'link'));
        body.appendChild(acts);
      }
      body.appendChild(ui.button('Mes machines…', h.openMachines, 'link'));
    } else if (wantsFilament && proposedFilament && !ctx.showKinds) {
      // « Sunlu PLA+ noir, comme la dernière fois ? » : le bouton « Oui » est dans la ligne d'action.
      renderSlotNotes(body, ui, ctx);
      body.appendChild(ui.button('Une autre bobine', h.toggleKinds, 'link'));
      renderManualLink(body, ui, ctx);
    } else if (wantsFilament) {
      // « Quelle bobine ? » : les bobines de cette machine (la dernière réussie d'abord), puis « Une nouvelle bobine ».
      if (ctx.error && ctx.error.filament) body.appendChild(ui.el('p', 'project-error', ctx.error.filament));
      if (ctx.noCanvas) body.appendChild(ui.el('p', 'muted small', 'Je ne lis pas ton Canvas pour l’instant : choisis ta bobine ici, l’imprimante choisira l’emplacement.'));
      renderSlotNotes(body, ui, ctx);
      var rows = ctx.spools, ns = ctx.newSpool || {};
      if (!Array.isArray(rows)) body.appendChild(ui.el('p', 'muted small', 'Je cherche tes bobines…'));
      else {
        if (rows.length) {
          var list = ui.el('div', 'printer-actions spool-list');
          rows.forEach(function (r) {
            var on = fi && fi.spool && fi.spool.id === r.id;
            list.appendChild(ui.button(r.label + ' · ' + r.detail, function () { h.pickSpool(r); }, 'btn ghost sm' + (on ? ' on' : '')));
          });
          body.appendChild(list);
        }
        // Aucune bobine encore : la nouvelle bobine est déjà ouverte.
        if (ns.open || !rows.length) renderNewSpool(body, ui, ctx, rows.length > 0);
        else body.appendChild(ui.button('Une nouvelle bobine', h.toggleNewSpool, 'btn ghost sm', 'plus'));
      }
      if (fi) {
        body.appendChild(ui.el('p', 'muted small', 'Si l’étiquette de ta bobine indique d’autres températures que celles en place, entre-les :'));
        body.appendChild(ui.button('Ma bobine indique d’autres températures', h.toggleSpool, 'link'));
        if (ctx.editing === 'filament') body.appendChild(ui.button('Garder cette bobine', h.cancelEdit, 'link'));
      }
      // Venu de « Choisir ma bobine » avant l'étape Filament : on peut revenir sans choisir.
      if (ctx.editing === 'filament' && !fi) body.appendChild(ui.button('Annuler', h.cancelEdit, 'link'));
      renderManualLink(body, ui, ctx);
    } else {
      body.appendChild(ui.el('p', 'muted small', 'Glisse ton fichier STL ou 3MF ici, ou choisis-le sur ton ordinateur. Un 3MF d’un autre créateur sera adapté à ta machine et à ton filament.'));
      var pacts = ui.el('div', 'printer-actions');
      pacts.appendChild(ui.button('Choisir un fichier', h.importPart, 'btn ghost sm', 'folder'));
      body.appendChild(pacts);
      // Un débutant n'a souvent aucun fichier : le petit bateau de test fourni avec le slicer se pose comme une pièce choisie.
      body.appendChild(ui.button('Pas encore de fichier ? Essaie avec le petit bateau de test', h.samplePart, 'link'));
      if (ctx.oldPart) {
        body.appendChild(ui.el('p', 'muted small', '« ' + ctx.oldPart + ' », la pièce de ton projet précédent, est encore sur le plateau d’Orca. Si tu choisis un fichier, elle sera retirée, et tu pourras annuler.'));
        body.appendChild(ui.button('Garder cette pièce', h.keepOldPart, 'link'));
      }
    }
    slot.appendChild(body);
  }

  root.PlyoProjectCard = { renderFiche: renderFiche, renderChoices: renderChoices, renderSpoolEditor: renderSpoolEditor, MATERIALS: MATERIALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoProjectCard;
})(typeof window !== 'undefined' ? window : globalThis);
