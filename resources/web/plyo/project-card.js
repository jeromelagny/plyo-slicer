// Rendu de la fiche « Mon projet » (imprimante, filament avec températures, pièce) en tête du panneau.
// Pas d'état propre : index.html lui donne le projet et les gestes (handlers) ; la logique des étapes est dans project-logic.js.
// Chargé par index.html (window.PlyoProjectCard).
(function (root) {
  var MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];

  // ui : { el, button, icon, rich } (les aides du panneau).
  // ctx : { project, printers (liste ou null), reachable {preset: bool}, error {printer?, filament?}, editing, compact, handlers }.
  // handlers : { pickPrinter(preset, name), keepProposed(), setupPrinter(), pickFilament(type), setTemps(nozzle, bed),
  //              importPart(), change(line), expand() }
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
    var icons = { printer: 'wifi', filament: 'palette', part: 'cube' };
    rows.forEach(function (row) {
      var r = ui.el('div', 'project-row');
      var left = ui.el('div', 'project-label');
      left.appendChild(ui.icon(icons[row.line], 14));
      left.appendChild(ui.el('span', '', row.text));
      if (row.line === 'printer' && ctx.reachable && ctx.reachable[project.printer.preset] === true) left.appendChild(ui.el('span', 'project-ok', '● connectée'));
      r.appendChild(left);
      if (row.line !== 'part') r.appendChild(ui.button('changer', function () { h.change(row.line); }, 'link'));
      card.appendChild(r);
      if (row.line === 'filament') {
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
    });
    slot.appendChild(card);
  }

  // Le contenu des étapes 1 à 3 (imprimante, filament, pièce) : des choix qui s'appliquent tout de suite.
  function renderChoices(slot, ui, ctx) {
    var P = root.PlyoProject, project = projectOf(ctx), step = P.nextStep(project), h = ctx.handlers;
    slot.textContent = '';
    var fi = project.filament && !project.filament.proposed ? project.filament : null;
    var proposedFilament = project.filament && project.filament.proposed ? project.filament : null;
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
        if (!groups.main.length && !groups.others.length) body.appendChild(ui.el('p', 'muted small', 'Aucune imprimante configurée : utilise le lien juste au-dessus pour ajouter la tienne.'));
        if (groups.others.length) {
          acts.appendChild(ui.button('Autres profils (' + groups.others.length + ')', h.toggleOthers, 'link'));
          if (ctx.showOthers) groups.others.forEach(add);
        }
        body.appendChild(acts);
      }
    } else if (wantsFilament && proposedFilament && !ctx.showKinds) {
      // « PLA, comme la dernière fois ? » : le bouton « Oui » est dans la ligne d'action.
      body.appendChild(ui.button('Autre matière', h.toggleKinds, 'link'));
    } else if (wantsFilament) {
      if (ctx.error && ctx.error.filament) body.appendChild(ui.el('p', 'project-error', ctx.error.filament));
      body.appendChild(ui.el('p', 'muted small', 'Regarde ta bobine : la matière est écrite dessus. Pas sûr ? C’est presque toujours du PLA.'));
      var kinds = ui.el('div', 'printer-actions');
      MATERIALS.forEach(function (k) {
        kinds.appendChild(ui.button(k, function () { h.pickFilament(k); }, 'btn ghost sm' + (fi && fi.type === k ? ' on' : '')));
      });
      body.appendChild(kinds);
      if (fi) body.appendChild(ui.el('p', 'muted small', 'Les températures sont celles conseillées pour ce filament. Change-les dans la fiche si l’étiquette de ta bobine indique autre chose.'));
    } else {
      body.appendChild(ui.el('p', 'muted small', 'Glisse ton fichier STL ou 3MF ici, ou choisis-le sur ton ordinateur. Un 3MF d’un autre créateur sera adapté à ta machine et à ton filament.'));
      var pacts = ui.el('div', 'printer-actions');
      pacts.appendChild(ui.button('Choisir un fichier', h.importPart, 'btn ghost sm', 'folder'));
      body.appendChild(pacts);
    }
    slot.appendChild(body);
  }

  root.PlyoProjectCard = { renderFiche: renderFiche, renderChoices: renderChoices, MATERIALS: MATERIALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoProjectCard;
})(typeof window !== 'undefined' ? window : globalThis);
