// Rendu de la fiche « Mon projet » (imprimante, filament avec températures, pièce) en tête du panneau.
// Pas d'état propre : index.html lui donne le projet et les gestes (handlers) ; la logique des étapes est dans project-logic.js.
// Chargé par index.html (window.PlyoProjectCard).
(function (root) {
  var MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];
  var MATERIAL_WORDS = 'PLA : le plus courant et le plus facile. PETG : plus solide, supporte mieux la chaleur.';

  // ui : { el, button, icon, rich } (les aides du panneau).
  // ctx : { project, printers (liste ou null), reachable {preset: bool}, error {printer?, filament?}, editing, compact, handlers }.
  // handlers : { pickPrinter(preset, name), keepProposed(), setupPrinter(), pickSpool(row), toggleNewSpool(), pickMaterial(type),
  //              typeSpoolName(text), createSpool(), setTemps(nozzle, bed), importPart(), change(line), expand() }
  // ctx.spools : lignes de PlyoSpools.choiceRows (null tant que le slicer ne les a pas données) ; ctx.newSpool : voir renderNewSpool.
  // Aucun bouton plein ici : la ligne d'action (journey-view.js) porte le bouton plein de l'étape. Quand elle n'en a pas, le
  // bouton marqué « main-choice » (au plus un par écran) prend l'aspect plein (index.html, CSS).
  function projectOf(ctx) { return ctx.project || root.PlyoProject.emptyProject(); }

  // La fiche : seulement ce qui est déjà choisi (rien au tout début), ou une seule ligne quand `compact`.
  // ctx.nozzleMm : buse lue par le slicer sur la machine du projet ; ctx.bed : ligne du plateau (PlyoMachines.bedRow) ou null ;
  // ctx.nozzleChange : « Changer de buse » est possible (h.changeNozzle) ; h.changeBed rouvre la question du plateau.
  // ctx.colours : ligne « Couleurs » (PlyoColours.ficheText), rouverte par h.changeColours ; '' : pas de ligne.
  function renderFiche(slot, ui, ctx) {
    var project = projectOf(ctx), h = ctx.handlers, extra = { nozzleMm: ctx.nozzleMm }, rows = root.PlyoJourney.filledRows(project, extra);
    slot.textContent = '';
    if (!rows.length) return;
    var card = ui.el('div', 'project' + (ctx.compact ? ' compact' : ''));
    if (ctx.compact) {
      // Une ligne coupée par des points de suspension (N6) : le texte entier au survol et pour les lecteurs d'écran.
      // Avec la typographie du bouton (« 0,4 mm » insécable) : le texte au survol est exactement celui affiché.
      var typo = root.PlyoLogic && root.PlyoLogic.fr ? root.PlyoLogic.fr : String;
      var sum = typo(root.PlyoJourney.ficheSummary(project, { nozzleMm: ctx.nozzleMm, noPart: ctx.noPart })), line = ui.button(sum, h.expand, 'link project-summary');
      line.title = sum;
      line.setAttribute('aria-label', sum + ' : afficher le détail');
      card.appendChild(line);
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
      // Sous la machine : changer de buse (profil fourni à plusieurs tailles) et le plateau posé dessus (imprimante à plusieurs types).
      if (row.line === 'printer' && ctx.nozzleChange && h.changeNozzle) {
        var nz = ui.el('div', 'project-row project-sub');
        nz.appendChild(ui.button('Changer de buse', h.changeNozzle, 'link'));
        card.appendChild(nz);
      }
      if (row.line === 'printer' && ctx.bed) {
        var bed = ui.el('div', 'project-row project-sub');
        var bl = ui.el('div', 'project-label');
        bl.appendChild(ui.el('span', 'muted small', ctx.bed.text));
        bed.appendChild(bl);
        if (h.changeBed) bed.appendChild(ui.button('changer', h.changeBed, 'link'));
        card.appendChild(bed);
        if (ctx.bed.note) card.appendChild(ui.el('p', 'muted small', ctx.bed.note));
      }
      // Sous le filament : quelle bobine imprime chaque pièce (carte « Couleurs », lot 20), rouverte par « changer ».
      if (row.line === 'filament' && ctx.colours && h.changeColours) {
        var co = ui.el('div', 'project-row project-sub');
        var cl = ui.el('div', 'project-label');
        cl.appendChild(ui.el('span', 'muted small', ctx.colours));
        co.appendChild(cl);
        co.appendChild(ui.button('changer', h.changeColours, 'link'));
        card.appendChild(co);
      }
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
    if (ctx.foldable && h.fold) card.appendChild(ui.button('Replier', h.fold, 'link fiche-fold')); // dépliée d'un clic : se replie d'un clic
    slot.appendChild(card);
  }

  // Températures de la fiche : rappel (débutant), lien vers la plage de l'étiquette de la bobine, et ce formulaire une fois ouvert.
  // ctx.spool : { open, limits (plage connue ou null), error }. Enregistrer garde la plage (limites du fabricant) et règle
  // les températures dedans (h.setSpoolRange). Une seule entrée par écran : à l'étape Filament, le lien est dans l'étape
  // (ctx.spoolLinkInStep), pas dans la fiche.
  var LABEL_LINK = 'Entrer celles de l’étiquette';
  function renderSpool(card, ui, fi, ctx) {
    var h = ctx.handlers, sp = ctx.spool || {};
    var wrap = ui.el('div', 'project-spool');
    // La marque de la bobine (ou des emplacements) et d'où partent ses réglages.
    var brand = root.PlyoSpools ? root.PlyoSpools.brandLine(projectOf(ctx)) : '';
    if (brand) wrap.appendChild(ui.el('p', 'muted small', brand));
    if (ctx.beginner && (fi.nozzle_temp != null || fi.bed_temp != null))
      wrap.appendChild(ui.el('p', 'muted small', 'Buse ' + (fi.nozzle_temp != null ? fi.nozzle_temp + ' °C' : '?') + ' · plateau ' + (fi.bed_temp != null ? fi.bed_temp + ' °C' : '?')));
    if (!sp.open && !ctx.spoolLinkInStep) wrap.appendChild(ui.button('Températures de l’étiquette', h.toggleSpool, 'link'));
    // Tests guidés de cette bobine (UX-34), lancés directement : seule la lecture de la photo utilise la jauge.
    if (fi.spool && fi.spool.id && h.calibrate) wrap.appendChild(ui.button('Calibrer cette bobine', h.calibrate, 'link'));
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
    // Sans action à faire, la phrase n'aide que le confirmé (le débutant choisit sa bobine dans la liste, juste dessous).
    if (ctx.noSlots && ctx.beginner === false) body.appendChild(ui.el('p', 'muted small', 'Je ne lis pas les emplacements de ta machine pour l’instant : choisis ta bobine ici. À l’envoi, regarde la fenêtre de Plyo Slicer et l’écran de l’imprimante.'));
    if (ctx.slotRemark) body.appendChild(ui.el('p', 'muted small', ctx.slotRemark));
  }
  // Pas de question par défaut : le profil ne permet pas de reconnaître une machine à une bobine. Un lien discret, après les bobines.
  function renderManualLink(body, ui, ctx) {
    if (ctx.manualLink) body.appendChild(ui.button(ctx.beginner !== false ? 'Ma machine a plusieurs bobines à la fois (AMS, CFS…)' : 'Ma machine a plusieurs bobines (AMS, CFS…)', ctx.handlers.openManual, 'link'));
  }

  // « De quelle marque est ta bobine ? » : pour une nouvelle bobine (étape Filament) et pour un emplacement (CFS, Canvas…).
  // ctx : { brands (null : le slicer cherche ; [] : aucune marque fournie pour cette imprimante et cette matière ; sinon
  // [{brand, ranges}]), state : { showAll, picked (marque à plusieurs gammes : « Laquelle ? »), other (champ libre ouvert),
  // otherText, error }, field (aria-label du champ libre), handlers : { pick(choix), pickGroup(marque), back(), showAll(),
  // openOther(), typeOther(texte), confirmOther(), cancel? } }. Toujours une issue : « Je ne sais pas ».
  function renderBrandPicker(body, ui, ctx) {
    var S = root.PlyoSpools, st = ctx.state || {}, h = ctx.handlers, groups = ctx.brands;
    var box = ui.el('div', 'brand-ask');
    var links = ui.el('div', 'printer-actions');
    if (st.picked) {
      var g = st.picked;
      box.appendChild(ui.el('p', 'intent-q', 'Laquelle ?'));
      box.appendChild(ui.el('p', 'muted small', S.rangeHelp(g.brand)));
      var ranges = ui.el('div', 'printer-actions');
      var rv = S.rangeButtons(g.ranges, st.showAll);
      rv.shown.forEach(function (r) { ranges.appendChild(ui.button(r.short || r.label, function () { h.pick(S.brandChoice(g, r)); }, 'btn ghost sm')); });
      if (rv.hidden) ranges.appendChild(ui.button('Voir les autres gammes (' + rv.hidden + ')', h.showAll, 'link'));
      box.appendChild(ranges);
      links.appendChild(ui.button('Je ne sais pas', function () { h.pick(S.brandChoice(g, null)); }, 'btn ghost sm'));
      links.appendChild(ui.button('Une autre marque', h.back, 'link'));
      box.appendChild(links);
      body.appendChild(box);
      return;
    }
    box.appendChild(ui.el('p', 'intent-q', S.BRAND_QUESTION));
    var none = Array.isArray(groups) && !S.brandButtons(groups, true).shown.length;
    box.appendChild(ui.el('p', 'muted small', none ? 'Elle est écrite sur l’étiquette. Écris-la, ou passe : je pars de réglages qui conviennent à la plupart des bobines.' : S.BRAND_HELP));
    if (groups === null || groups === undefined) box.appendChild(ui.el('p', 'muted small', 'Je cherche les marques…'));
    else if (!none) {
      box.appendChild(ui.el('p', 'pick-hint', 'Clique sur ta réponse :'));
      var view = S.brandButtons(groups, st.showAll), acts = ui.el('div', 'printer-actions');
      view.shown.forEach(function (gr) {
        acts.appendChild(ui.button(gr.brand, function () { if (gr.ranges.length === 1) h.pick(S.brandChoice(gr, gr.ranges[0])); else h.pickGroup(gr); }, 'btn ghost sm'));
      });
      if (view.hidden) acts.appendChild(ui.button('Voir les autres marques (' + view.hidden + ')', h.showAll, 'link'));
      box.appendChild(acts);
    }
    // Champ libre : « Autre marque », ou d'emblée quand aucune marque n'a de profil (pas de liste vide).
    if (st.other || none) {
      var lab = ui.el('label', 'temp-field spool-name');
      lab.appendChild(ui.el('span', 'muted small', 'Marque de ta bobine'));
      var input = ui.el('input', 'field');
      input.type = 'text';
      input.maxLength = 60;
      input.value = st.otherText || '';
      input.setAttribute('aria-label', ctx.field || 'Marque de ta bobine');
      input.dataset.spoolName = '1'; // le panneau ne redessine pas sous les doigts
      input.addEventListener('input', function () { h.typeOther(input.value); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); h.confirmOther(); } });
      lab.appendChild(input);
      box.appendChild(lab);
      if (st.error) box.appendChild(ui.el('p', 'project-error', st.error));
      var go = ui.el('div', 'printer-actions');
      go.appendChild(ui.button('Continuer', h.confirmOther, 'btn ghost sm', 'check'));
      box.appendChild(go);
      if (st.other && !none) setTimeout(function () { if (!input.value) input.focus(); }, 0);
    } else links.appendChild(ui.button('Autre marque', h.openOther, 'btn ghost sm'));
    links.appendChild(ui.button('Je ne sais pas', function () { h.pick(S.unknownChoice()); }, 'btn ghost sm'));
    if (h.cancel) links.appendChild(ui.button('Annuler', h.cancel, 'link'));
    box.appendChild(links);
    body.appendChild(box);
  }

  // La marque d'une nouvelle bobine, une fois la matière choisie. Vrai si la question est posée (le nom attend sa réponse).
  // Sinon : la réponse rappelée en une ligne (d'où partent les réglages, « changer »), ou, pour le confirmé, un lien discret.
  function renderSpoolBrand(box, ui, ctx, closable) {
    var h = ctx.handlers, ns = ctx.newSpool || {}, S = root.PlyoSpools;
    if (!ns.material || !h.brandPick) return false;
    if (!ns.choice && (ctx.beginner !== false || ns.brandOpen)) {
      renderBrandPicker(box, ui, { brands: ns.brands, state: ns.picker, handlers: { pick: h.brandPick, pickGroup: h.brandPickGroup, back: h.brandBack,
        showAll: h.brandShowAll, openOther: h.brandOpenOther, typeOther: h.brandTypeOther, confirmOther: h.brandConfirmOther, cancel: ns.brandOpen ? h.brandClose : null } });
      if (closable) box.appendChild(ui.button('Annuler', h.toggleNewSpool, 'link'));
      return true;
    }
    if (ns.choice) {
      var said = ui.el('div', 'project-row project-sub');
      said.appendChild(ui.el('span', 'muted small', S.brandNote(ns.choice, ns.material)));
      said.appendChild(ui.button('changer', h.brandReset, 'link'));
      box.appendChild(said);
    } else box.appendChild(ui.button('Choisir la marque (réglages du fabricant)', h.brandOpen, 'link'));
    return false;
  }

  // Une nouvelle bobine : sa matière (puces), puis sa marque (BrandsLogic, côté slicer), puis son nom, obligatoire, prérempli
  // d'après la marque et toujours avec l'aide (où regarder, un exemple).
  // ctx.newSpool : { open, material, name, error ('vide'|'court'|texte du slicer), focus, brands (voir renderBrandPicker),
  // picker (son état), choice (choix fait, ou null), brandOpen (le confirmé a ouvert la question) }. ctx.beginner : la question
  // de la marque vient avant le nom ; pour le confirmé, elle reste à un clic (« Choisir la marque »).
  function renderNewSpool(body, ui, ctx, closable) {
    var h = ctx.handlers, ns = ctx.newSpool || {}, S = root.PlyoSpools;
    var box = ui.el('div', 'new-spool');
    box.appendChild(ui.el('p', 'intent-q', 'Une nouvelle bobine'));
    if (ns.material && h.resetMaterial && ctx.beginner !== false) {
      // Une question à la fois : la matière répondue se replie en une ligne, la suivante prend la place.
      var mat = ui.el('div', 'project-row project-sub');
      mat.appendChild(ui.el('span', 'muted small', '✓ Matière : ' + ns.material));
      mat.appendChild(ui.button('changer', h.resetMaterial, 'link'));
      box.appendChild(mat);
    } else {
      box.appendChild(ui.el('p', 'muted small', 'Sa matière est écrite sur l’étiquette. Pas sûr ? C’est presque toujours du PLA.'));
      if (!ns.material) box.appendChild(ui.el('p', 'pick-hint', 'Clique sur ta réponse :'));
      var kinds = ui.el('div', 'printer-actions');
      // Débutant : PLA et PETG d'abord, avec un mot sur chacun ; ABS, ASA et TPU derrière « Autres matières ».
      var few = ctx.beginner !== false && h.moreMaterials && !ns.allMaterials && MATERIALS.slice(0, 2).indexOf(ns.material || 'PLA') >= 0;
      (few ? MATERIALS.slice(0, 2) : MATERIALS).forEach(function (k) {
        kinds.appendChild(ui.button(k, function () { h.pickMaterial(k); }, 'btn ghost sm' + (ns.material === k ? ' on' : '')));
      });
      if (few) kinds.appendChild(ui.button('Autres matières', h.moreMaterials, 'btn ghost sm'));
      box.appendChild(kinds);
      if (few) box.appendChild(ui.el('p', 'muted small', MATERIAL_WORDS));
    }
    if (renderSpoolBrand(box, ui, ctx, closable)) { body.appendChild(box); return; } // la marque avant le nom
    if (ns.material) {
      var lab = ui.el('label', 'temp-field spool-name');
      lab.appendChild(ui.el('span', 'muted small', 'Nom de ta bobine'));
      // Pourquoi un nom : sans cette phrase, la question paraît administrative.
      box.appendChild(ui.el('p', 'small', 'Donne-lui un nom : je retiens ce qui marche avec elle, et la prochaine fois tu n’auras rien à refaire.'));
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
      // Nom prérempli d'après la marque : on suggère d'y ajouter la couleur, pour distinguer tes bobines.
      box.appendChild(ui.el('p', 'muted small', ns.choice && S.suggestedName(ns.choice, ns.material) ? 'Tu peux ajouter la couleur, par exemple « ' + S.suggestedName(ns.choice, ns.material) + ' noir ».' : root.PlyoSpools.NAME_HELP));
      if (ns.error) box.appendChild(ui.el('p', 'project-error', S.nameErrorText(ns.error) || ns.error));
      var acts = ui.el('div', 'printer-actions');
      acts.appendChild(ui.button('C’est ma bobine', h.createSpool, 'btn ghost sm main-choice', 'check'));
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
    var ns0 = ctx.newSpool || {}, pk0 = ns0.picker || {};
    var key = JSON.stringify([step, project.filament, ctx.editing, ctx.spools, ns0.open, ns0.material, ns0.error, ctx.error, ctx.showKinds, ctx.noCanvas, ctx.noSlots, ctx.manualLink, ctx.slotRemark, ctx.relink,
      ns0.brands, ns0.choice, ns0.brandOpen, ns0.allMaterials, pk0.showAll, pk0.picked && pk0.picked.brand, pk0.other, pk0.error, ctx.beginner]);
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
        body.appendChild(ui.button('Une autre machine', h.toggleList, 'btn ghost sm'));
      } else if (list === null || list === undefined) body.appendChild(ui.el('p', 'muted small', 'Je cherche tes imprimantes…'));
      else {
        var groups = root.PlyoJourney.groupPrinters(list);
        var acts = ui.el('div', 'printer-actions');
        var add = function (p) {
          var label = p.label + (p.linked ? (ctx.reachable && ctx.reachable[p.preset] === true ? ' ● connectée' : ' · reliée') : '');
          acts.appendChild(ui.button(label, function () { h.pickPrinter(p.preset, p.label); }, 'btn ghost sm'));
        };
        groups.main.forEach(add);
        if (!groups.main.length && !groups.others.length) body.appendChild(ui.el('p', 'muted small', 'Aucune imprimante pour l’instant : clique sur « Ma machine n’est pas dans la liste », juste au-dessus.'));
        // Machines non reliées (carte SD, clé USB) : visibles comme les autres tant qu'il y en a peu, sinon repliées.
        if (groups.others.length && (groups.others.length <= 3 || ctx.showOthers)) groups.others.forEach(add);
        else if (groups.others.length) acts.appendChild(ui.button('Autres machines installées (' + groups.others.length + ')', h.toggleOthers, 'link'));
        body.appendChild(acts);
      }
    } else if (wantsFilament && proposedFilament && !ctx.showKinds) {
      // « Sunlu PLA+ noir, comme la dernière fois ? » : le bouton « Oui » est dans la ligne d'action.
      renderSlotNotes(body, ui, ctx);
      body.appendChild(ui.button('Une autre bobine', h.toggleKinds, 'btn ghost sm'));
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
            var pick = ui.button(r.label + ' · ' + r.detail, function () { h.pickSpool(r); }, 'btn ghost sm' + (on ? ' on' : ''));
            if (r.colour) { var dot = ui.el('span', 'swatch'); dot.style.background = r.colour; pick.insertBefore(dot, pick.firstChild); }
            list.appendChild(pick);
          });
          body.appendChild(list);
        }
        // Aucune bobine encore : la nouvelle bobine est déjà ouverte.
        if (ns.open || !rows.length) renderNewSpool(body, ui, ctx, rows.length > 0);
        else body.appendChild(ui.button('Une nouvelle bobine', h.toggleNewSpool, 'btn ghost sm', 'plus'));
      }
      if (fi) {
        if (!(ctx.spool && ctx.spool.open)) {
          body.appendChild(ui.el('p', 'muted small', 'Ton étiquette indique d’autres températures ?'));
          body.appendChild(ui.button(LABEL_LINK, h.toggleSpool, 'link'));
        }
        if (ctx.editing === 'filament') body.appendChild(ui.button('Garder cette bobine', h.cancelEdit, 'link'));
      }
      // Venu de « Choisir ma bobine » avant l'étape Filament : on peut revenir sans choisir.
      if (ctx.editing === 'filament' && !fi) body.appendChild(ui.button('Annuler', h.cancelEdit, 'link'));
      renderManualLink(body, ui, ctx);
    } else {
      body.appendChild(ui.el('p', 'muted small', 'Glisse ici le fichier 3D de ta pièce (STL ou 3MF), ou choisis-le sur ton ordinateur. Un 3MF d’un autre créateur sera adapté à ta machine et à ton filament.'));
      var pacts = ui.el('div', 'printer-actions');
      pacts.appendChild(ui.button('Choisir un fichier', h.importPart, 'btn ghost sm main-choice', 'folder'));
      // Pas de fichier : l'assistant dessine une pièce simple (« Crée-moi une pièce »), le choix secondaire de l'écran.
      if (h.designOpen) pacts.appendChild(ui.button('Je n’ai pas de fichier : crée-moi une pièce', h.designOpen, 'btn ghost sm', 'wand'));
      body.appendChild(pacts);
      // Un débutant n'a souvent aucun fichier : le petit bateau de test fourni avec le slicer se pose comme une pièce choisie
      // (un essai, d'où un simple lien sous les deux choix).
      body.appendChild(ui.button('Pas encore de fichier ? Essaie avec le petit bateau de test', h.samplePart, h.designOpen ? 'link' : 'btn ghost sm'));
      if (ctx.oldPart) {
        body.appendChild(ui.el('p', 'muted small', '« ' + ctx.oldPart + ' », la pièce de ton projet précédent, est encore sur le plateau de Plyo Slicer. Si tu choisis un fichier, elle sera retirée, et tu pourras annuler.'));
        body.appendChild(ui.button('Garder cette pièce', h.keepOldPart, 'link'));
      }
    }
    slot.appendChild(body);
  }

  // Question de l'étape Machine, une fois l'imprimante choisie : « Quel plateau est posé sur ton imprimante ? ». Pas une fenêtre :
  // une carte dans l'étape, qu'on peut laisser. ctx : { question (PlyoMachines.bedQuestion) ou null, editing, waiting, handlers :
  // { pickBed(value), unknownBed(), cancelBed() } }. Le type d'aujourd'hui est signalé ; aucun bouton plein (une seule action
  // pleine par étape, dans la ligne d'action).
  function renderBedQuestion(slot, ui, ctx) {
    slot.textContent = '';
    var q = ctx && ctx.question, h = ctx && ctx.handlers;
    if (!q || !q.choices || !q.choices.length) return;
    var box = ui.el('div', 'card bed-ask');
    box.appendChild(ui.el('p', 'intent-q', q.title));
    box.appendChild(ui.el('p', 'small', q.text));
    box.appendChild(ui.el('p', 'muted small', q.help));
    box.appendChild(ui.el('p', 'pick-hint', 'Clique sur ta réponse :'));
    var list = ui.el('div', 'bed-choices');
    q.choices.forEach(function (c) {
      var item = ui.el('div', 'bed-choice');
      var b = ui.button(c.name + (c.current ? ' · réglé aujourd’hui' : ''), function () { h.pickBed(c.value); }, 'btn ghost sm' + (c.current ? ' on' : ''));
      b.disabled = !!ctx.waiting;
      item.appendChild(b);
      if (c.look) item.appendChild(ui.el('span', 'muted small', c.look));
      list.appendChild(item);
    });
    box.appendChild(list);
    var acts = ui.el('div', 'printer-actions');
    var unknown = ui.button(q.unknown, h.unknownBed, 'btn ghost sm');
    unknown.disabled = !!ctx.waiting;
    acts.appendChild(unknown);
    if (ctx.editing) acts.appendChild(ui.button('Annuler', h.cancelBed, 'link'));
    box.appendChild(acts);
    slot.appendChild(box);
  }

  root.PlyoProjectCard = { renderBedQuestion: renderBedQuestion, renderFiche: renderFiche, renderChoices: renderChoices, renderSpoolEditor: renderSpoolEditor, renderBrandPicker: renderBrandPicker, MATERIALS: MATERIALS, LABEL_LINK: LABEL_LINK };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlyoProjectCard;
})(typeof window !== 'undefined' ? window : globalThis);
