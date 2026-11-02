// Rendu de la fiche « Mon projet » (imprimante, filament avec températures, pièce) en tête du panneau.
// Pas d'état propre : index.html lui donne le projet et les gestes (handlers) ; la logique des étapes est dans project-logic.js.
// Chargé par index.html (window.PlyoProjectCard).
(function (root) {
  var MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];

  // ui : { el, button, icon, rich } (les aides du panneau).
  // ctx : { project, printers (liste ou null), reachable {preset: bool}, error {printer?, filament?}, handlers }.
  // handlers : { pickPrinter(preset), keepProposed(), setupPrinter(), pickFilament(type), setTemps(nozzle, bed),
  //              importPart(), change(line) }
  function render(slot, ui, ctx) {
    var P = root.PlyoProject, project = ctx.project || P.emptyProject(), step = P.nextStep(project), h = ctx.handlers;
    slot.textContent = '';
    var card = ui.el('div', 'project');
    card.appendChild(ui.el('div', 'project-title', 'Mon projet'));

    function row(name, iconName, line, summary, hint, actionLabel) {
      var r = ui.el('div', 'project-row' + (step === line ? ' current' : ''));
      var left = ui.el('div', 'project-label');
      left.appendChild(ui.icon(iconName, 14));
      var text = ui.el('span', summary ? '' : 'project-missing');
      text.appendChild(document.createTextNode(summary || hint));
      left.appendChild(text);
      r.appendChild(left);
      if (actionLabel) r.appendChild(ui.button(actionLabel, function () { h.change(line); }, 'link'));
      card.appendChild(r);
      return r;
    }

    // --- Imprimante ---
    var pr = project.printer && !project.printer.proposed ? project.printer : null;
    var prRow = row('printer', 'wifi', 'printer', pr ? (pr.name || pr.preset) : '', 'Quelle imprimante ?', pr ? 'changer' : '');
    if (pr && ctx.reachable && ctx.reachable[pr.preset] === true) {
      var ok = ui.el('span', 'project-ok', '● connectée');
      prRow.firstChild.appendChild(ok);
    }
    if (step === 'printer') {
      var body = ui.el('div', 'project-body');
      var proposed = project.printer && project.printer.proposed ? project.printer : null;
      if (ctx.error && ctx.error.printer) body.appendChild(ui.el('p', 'project-error', ctx.error.printer));
      if (proposed) {
        body.appendChild(ui.el('p', 'muted small', 'Comme ton projet précédent ?'));
        var keep = ui.el('div', 'printer-actions');
        keep.appendChild(ui.button('Garder ' + (proposed.name || proposed.preset), h.keepProposed, 'btn sm'));
        body.appendChild(keep);
      }
      var list = ctx.printers;
      if (list === null || list === undefined) body.appendChild(ui.el('p', 'muted small', 'Je cherche tes imprimantes…'));
      else {
        if (list.length) body.appendChild(ui.el('p', 'muted small', 'Tes imprimantes déjà configurées :'));
        var acts = ui.el('div', 'printer-actions');
        list.forEach(function (p) {
          var label = p.name + (p.linked ? (ctx.reachable && ctx.reachable[p.preset] === true ? ' ● connectée' : ' · reliée') : '');
          acts.appendChild(ui.button(label, function () { h.pickPrinter(p.preset, p.name); }, 'btn ghost sm'));
        });
        acts.appendChild(ui.button('Ma machine n’est pas dans la liste', h.setupPrinter, 'btn sm', 'wifi'));
        body.appendChild(acts);
      }
      card.appendChild(body);
    }

    // --- Filament ---
    var fi = project.filament && !project.filament.proposed ? project.filament : null;
    var fiRow = row('filament', 'palette', 'filament', fi ? fi.type : '', 'Quel filament ?', fi ? 'changer' : '');
    if (fi) {
      var temps = ui.el('div', 'temp-row project-temps');
      function field(label, value, onDone) {
        var wrap = ui.el('label', 'temp-field');
        wrap.appendChild(ui.el('span', 'muted small', label));
        var input = ui.el('input', 'field');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.value = value === null || value === undefined ? '' : String(value);
        input.setAttribute('aria-label', label);
        input.addEventListener('change', onDone);
        wrap.appendChild(input);
        temps.appendChild(wrap);
        return input;
      }
      var nIn = field('Buse (°C)', fi.nozzle_temp, function () { h.setTemps(nIn.value, bIn.value); });
      var bIn = field('Plateau (°C)', fi.bed_temp, function () { h.setTemps(nIn.value, bIn.value); });
      card.appendChild(temps);
      card.appendChild(ui.el('p', 'muted small project-hint', 'Valeurs conseillées pour ce filament. Change-les si l’étiquette de ta bobine indique autre chose.'));
    }
    if (step === 'filament' || (ctx.editing === 'filament')) {
      var fb = ui.el('div', 'project-body');
      if (ctx.error && ctx.error.filament) fb.appendChild(ui.el('p', 'project-error', ctx.error.filament));
      fb.appendChild(ui.el('p', 'muted small', 'Regarde ta bobine : la matière est écrite dessus. Pas sûr ? C’est presque toujours du PLA.'));
      var kinds = ui.el('div', 'printer-actions');
      MATERIALS.forEach(function (k) {
        kinds.appendChild(ui.button(k, function () { h.pickFilament(k); }, fi && fi.type === k ? 'btn sm' : 'btn ghost sm'));
      });
      fb.appendChild(kinds);
      card.appendChild(fb);
    }
    void fiRow;

    // --- Pièce ---
    var pa = project.part && project.part.name ? project.part : null;
    row('part', 'cube', 'part', pa ? pa.name : '', 'Aucune pièce : ajoute ton fichier', '');
    if (step === 'part') {
      var pb = ui.el('div', 'project-body');
      pb.appendChild(ui.el('p', 'muted small', 'Glisse ton fichier STL ou 3MF ici, ou clique sur le bouton.'));
      var pacts = ui.el('div', 'printer-actions');
      pacts.appendChild(ui.button('Importer ma pièce', h.importPart, 'btn sm', 'folder'));
      pb.appendChild(pacts);
      card.appendChild(pb);
    }
    slot.appendChild(card);
  }

  root.PlyoProjectCard = { render: render, MATERIALS: MATERIALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoProjectCard;
})(typeof window !== 'undefined' ? window : globalThis);
