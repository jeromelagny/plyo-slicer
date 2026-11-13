// Rendu de « Mes machines » (tiroir), du bandeau « nouvelle machine trouvée » et de la carte « Orca est passé sur… ».
// Pas d'état propre : index.html donne les données et les gestes. Aucun bouton plein ici (décisions ponctuelles, boutons discrets).
// Chargé par index.html (window.PlyoMachinesView).
(function (root) {
  // ui : { el, button, icon }. opts : { printers, habits, handlers : { add(), hide(preset), show(preset), copyHabits(from, to) } }.
  function renderDrawer(body, ui, opts) {
    var J = root.PlyoJourney, M = root.PlyoMachines, hidden = (opts.habits && opts.habits.hidden) || [];
    body.textContent = '';
    // Machines reliées au réseau, puis celles installées sans liaison (on imprime par carte SD ou clé USB) : toutes comptent.
    var grouped = J.groupPrinters(opts.printers), groups = grouped.main.concat(grouped.others);
    if (!groups.length) body.appendChild(ui.el('p', 'muted', 'Aucune imprimante pour l’instant. Ajoute la tienne ci-dessous.'));
    groups.forEach(function (m) {
      var isHidden = hidden.indexOf(m.preset) >= 0;
      var card = ui.el('div', 'machine-row' + (isHidden ? ' off' : ''));
      var head = ui.el('div', 'row-acts');
      head.appendChild(ui.el('b', '', m.label + (isHidden ? ' (masquée)' : '')));
      head.appendChild(isHidden ? ui.button('Afficher', function () { opts.handlers.show(m.preset); }, 'link')
        : ui.button('Retirer de la liste', function () { opts.handlers.hide(m.preset); }, 'link'));
      card.appendChild(head);
      if (!m.linked) card.appendChild(ui.el('p', 'muted small', 'Non reliée : tu imprimes par carte SD ou clé USB.'));
      var fil = M.habitFor(opts.habits, m.preset);
      card.appendChild(ui.el('p', 'muted small', fil ? 'Dernière bobine : ' + (fil.spool || fil.type) + (fil.nozzle_temp != null ? ' · ' + fil.nozzle_temp + '/' + fil.bed_temp + ' °C' : '') : 'Pas encore de bobine retenue.'));
      var others = groups.filter(function (o) { return o.preset !== m.preset && M.habitFor(opts.habits, o.preset); });
      others.forEach(function (o) {
        card.appendChild(ui.button('Reprendre les habitudes de « ' + o.label + ' »', function () { opts.handlers.copyHabits(o.preset, m.preset); }, 'link'));
      });
      body.appendChild(card);
    });
    body.appendChild(ui.el('p', 'muted small', 'Retirer une machine la cache seulement : ses profils et sa connexion restent dans Plyo Slicer.'));
    var acts = ui.el('div', 'printer-actions');
    acts.appendChild(ui.button('Ajouter une machine', opts.handlers.add, 'btn ghost sm', 'plus'));
    body.appendChild(acts);
  }

  // Bandeau discret « J'ai trouvé une nouvelle machine ». ui.alertBox(kind, text, icon) rend { body }.
  function renderNewMachine(slot, ui, opts) {
    slot.textContent = '';
    var box = ui.alertBox('info', 'J’ai trouvé une nouvelle imprimante sur ton réseau : **' + (opts.name || 'imprimante') + '**.', 'wifi');
    var acts = ui.el('div', 'printer-actions');
    acts.appendChild(ui.button('L’ajouter', opts.handlers.add, 'btn ghost sm', 'plus'));
    acts.appendChild(ui.button('Pas maintenant', opts.handlers.dismiss, 'link'));
    box.body.appendChild(acts);
    slot.appendChild(box);
  }

  // Orca a changé de profil d'imprimante alors que le projet en avait un autre.
  function renderDivergence(slot, ui, opts) {
    slot.textContent = '';
    var box = ui.alertBox('warn', 'Plyo Slicer est passé sur **' + opts.to + '**, mais ton projet est sur **' + opts.from + '**.', 'alert');
    box.body.appendChild(ui.el('p', 'muted small', 'Utiliser ' + opts.to + ' refait la préparation : filament, vérification et découpe.'));
    var acts = ui.el('div', 'printer-actions');
    acts.appendChild(ui.button('Utiliser ' + opts.to, opts.handlers.useNew, 'btn ghost sm'));
    acts.appendChild(ui.button('Remettre ' + opts.from, opts.handlers.restore, 'btn ghost sm'));
    box.body.appendChild(acts);
    slot.appendChild(box);
  }

  root.PlyoMachinesView = { renderDrawer: renderDrawer, renderNewMachine: renderNewMachine, renderDivergence: renderDivergence };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoMachinesView;
})(typeof window !== 'undefined' ? window : globalThis);
