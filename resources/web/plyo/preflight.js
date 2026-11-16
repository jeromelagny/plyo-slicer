// Vérification avant impression : à partir des mesures du plateau (PlyoPreflight.cpp), les risques à signaler,
// chacun avec ses corrections en un clic. Aucun appel à l'IA.
(function (root) {
  var ORDER = ['conflict', 'open_top', 'fit', 'support', 'tall', 'contact'];
  var BRIM = 5; // mm, largeur proposée

  function hasBrim(s) {
    return s.brim_type !== 'no_brim' && (s.brim_type === 'auto_brim' || Number(s.brim_width) > 0);
  }

  function brimFix(s) {
    var changes = s.brim_type === 'no_brim' ? [{ id: 'brim_type', value: 'outer_only' }] : [];
    return { label: 'Ajouter une bordure', changes: changes.concat([{ id: 'brim_width', value: BRIM }]) };
  }

  // Réglages que le mode vase impose, nommés simplement (« Désactiver le mode vase et remettre parois et remplissage »).
  var VASE_NOUNS = { wall_loops: 'parois', top_shell_layers: 'couches du dessus', sparse_infill_density: 'remplissage', detect_thin_wall: 'parois fines',
    enable_support: 'supports', overhang_reverse: 'surplombs inversés', enable_wrapping_detection: 'détection d’enroulement' };
  function listFr(items) { return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' et ' + items[items.length - 1]; }
  // Réglages laissés par le mode vase (PlyoSettingsBridge::spiral_leftovers) : [{key, label, value, now}], les valides seulement.
  function leftovers(list) { return (Array.isArray(list) ? list : []).filter(function (c) { return c && typeof c.key === 'string' && c.key && c.value !== undefined && c.value !== null; }); }
  function leftoverNames(list) {
    var seen = [];
    leftovers(list).forEach(function (c) { var n = VASE_NOUNS[c.key] || String(c.label || c.key).toLowerCase(); if (seen.indexOf(n) < 0) seen.push(n); });
    return listFr(seen);
  }
  function leftoverChanges(list) { return leftovers(list).map(function (c) { return { key: c.key, value: c.value, label: c.label || c.key }; }); }

  // Hors mode vase, aucune couche pleine au-dessus : le dessus de la pièce resterait ouvert (souvent un reste du mode vase).
  // 0 % de remplissage seul peut être voulu : il n'est dit qu'avec un dessus ouvert.
  function openTop(s) { return s.spiral_mode === false && s.top_shell_layers !== undefined && s.top_shell_layers !== null && Number(s.top_shell_layers) === 0; }
  function emptyInside(s) { return parseFloat(s.sparse_infill_density) === 0; }

  var ORIENT = { label: 'Orienter automatiquement', action: 'orient' };
  var ARRANGE = { label: 'Ranger le plateau', action: 'arrange' };

  // Conflit trouvé par la découpe d'Orca : deux objets (ou un objet et la tour de purge) dont les trajets se croisent.
  function conflictNames(data) {
    var c = data && data.conflict;
    if (!c) return null;
    var list = [c.a, c.b].filter(function (n) { return typeof n === 'string' && n; });
    return list.length ? list : ['Ta plaque'];
  }
  var CONFLICT_TEXT = ' se chevauchent : la buse les heurterait à l’impression.';

  function names(list) {
    var q = list.map(function (n) { return '« ' + n + ' »'; });
    if (q.length === 1) return q[0];
    if (q.length === 2) return q[0] + ' et ' + q[1];
    var rest = q.length - 2;
    return q[0] + ', ' + q[1] + ' et ' + rest + ' autre' + (rest > 1 ? 's pièces' : ' pièce');
  }

  // Textes au singulier et au pluriel : [une pièce, plusieurs pièces].
  var TEXTS = {
    open_top: [' n’aurait pas de dessus : aucune couche pleine n’est prévue au-dessus, elle resterait ouverte.',
      ' n’auraient pas de dessus : aucune couche pleine n’est prévue au-dessus, elles resteraient ouvertes.'],
    open_top_empty: [' n’aurait pas de dessus et serait vide dedans : aucune couche pleine au-dessus et 0 % de remplissage.',
      ' n’auraient pas de dessus et seraient vides dedans : aucune couche pleine au-dessus et 0 % de remplissage.'],
    fit: [' dépasse du plateau.', ' dépassent du plateau.'],
    support: [' a des parties dans le vide : sans supports, elles risquent de s’effondrer.',
      ' ont des parties dans le vide : sans supports, elles risquent de s’effondrer.'],
    tall: [' est haute et fine : sans bordure, elle risque de basculer pendant l’impression.',
      ' sont hautes et fines : sans bordure, elles risquent de basculer pendant l’impression.'],
    contact: [' touche peu le plateau : sans bordure, elle risque de se décoller.',
      ' touchent peu le plateau : sans bordure, elles risquent de se décoller.']
  };

  function kindOf(o, s) {
    var kinds = [];
    if (openTop(s)) kinds.push('open_top');
    if (o.fits === false) kinds.push('fit');
    if (o.needs_support === true && !s.support) kinds.push('support');
    if (!hasBrim(s)) {
      var foot = Math.min(o.foot[0], o.foot[1]);
      if (o.height >= 30 && o.height >= 3 * foot) kinds.push('tall');
      else if (o.contact_mm2 < Math.max(25, 0.1 * o.foot[0] * o.foot[1])) kinds.push('contact');
    }
    return kinds;
  }

  function valid(o) {
    return o && typeof o.name === 'string' && typeof o.height === 'number' && typeof o.contact_mm2 === 'number' &&
      Array.isArray(o.foot) && o.foot.length === 2;
  }

  function preflightRisks(data) {
    if (!data || !data.settings || !Array.isArray(data.objects)) return [];
    var s = data.settings;
    var byKind = {};
    data.objects.filter(valid).forEach(function (o) {
      kindOf(o, s).forEach(function (k) { (byKind[k] = byKind[k] || []).push(o.name); });
    });
    if (conflictNames(data)) byKind.conflict = conflictNames(data);
    return ORDER.filter(function (k) { return byKind[k]; }).map(function (k) {
      var list = byKind[k];
      if (k === 'conflict') return { kind: k, objects: list, text: names(list) + CONFLICT_TEXT, fixes: [{ label: ARRANGE.label, action: ARRANGE.action }] };
      if (k === 'open_top') return { kind: k, objects: list, text: names(list) + TEXTS[emptyInside(s) ? 'open_top_empty' : 'open_top'][list.length > 1 ? 1 : 0],
        fixes: restoreFix(s) ? [restoreFix(s)] : [] };
      var fixes = k === 'fit' ? [{ label: 'Réduire pour que ça tienne', action: 'scale_to_fit' }]
        : k === 'support' ? [{ label: 'Activer les supports', changes: [{ id: 'support', value: true }] }, ORIENT]
        : k === 'tall' ? [brimFix(s)]
        : [brimFix(s), ORIENT];
      return { kind: k, objects: list, text: names(list) + TEXTS[k][list.length > 1 ? 1 : 0], fixes: fixes };
    });
  }

  function riskKey(r) { return r.kind + ':' + r.objects.join('|'); }

  // Carte « Avant d'imprimer » : les soucis rangés par pièce (on lit sa pièce, pas une liste de risques), puis
  // une seule liste de corrections sans doublon, cochées comme la fiche de réglages. L'orientation est une autre
  // façon d'éviter supports et décollement : proposée, mais pas cochée d'office.
  var ISSUES = {
    open_top: 'Pas de dessus : aucune couche pleine n’est prévue au-dessus, elle resterait ouverte.',
    open_top_empty: 'Pas de dessus et vide dedans : aucune couche pleine au-dessus et 0 % de remplissage.',
    fit: 'Dépasse du plateau.',
    support: 'Des parties dans le vide : sans supports, elles risquent de s’effondrer.',
    tall: 'Haute et fine : sans bordure, elle risque de basculer.',
    contact: 'Touche peu le plateau : sans bordure, elle risque de se décoller.'
  };
  var FIX_ORDER = ['restore', 'fit', 'support', 'brim', 'orient', 'arrange'];
  // Remettre les réglages du profil que le mode vase avait changés (catalogue, une ligne cochée vaut confirmation).
  function restoreFix(s) {
    var list = leftovers(s && s.vase_leftovers);
    if (!list.length) return null;
    return { key: 'restore', label: 'Remettre ' + leftoverNames(list) + ' comme dans le profil', keyChanges: leftoverChanges(list) };
  }

  function preflightPlan(data) {
    var plan = { parts: [], fixes: [], count: 0 };
    if (!data || !data.settings || !Array.isArray(data.objects)) return plan;
    var s = data.settings;
    var fixes = {}, involved = {};
    function want(key, objName, make) {
      var f = fixes[key] = fixes[key] || make();
      if (f.objects.indexOf(objName) < 0) f.objects.push(objName);
    }
    var clash = conflictNames(data);
    if (clash) {
      plan.parts.push({ name: clash.join(' et '), issues: ['Ces pièces se chevauchent : la buse les heurterait à l’impression.'] });
      clash.forEach(function (n) { involved[n] = true; want('arrange', n, function () { return { key: 'arrange', label: ARRANGE.label, action: ARRANGE.action, objects: [], checked: true }; }); });
    }
    data.objects.filter(valid).forEach(function (o) {
      var kinds = kindOf(o, s);
      if (!kinds.length) return;
      involved[o.name] = true;
      plan.parts.push({ name: o.name, issues: kinds.map(function (k) { return k === 'open_top' && emptyInside(s) ? ISSUES.open_top_empty : ISSUES[k]; }) });
      kinds.forEach(function (k) {
        if (k === 'open_top' && restoreFix(s)) want('restore', o.name, function () { var f = restoreFix(s); return { key: 'restore', label: f.label, keyChanges: f.keyChanges, objects: [], checked: true }; });
        if (k === 'fit') want('fit', o.name, function () { return { key: 'fit', label: 'Réduire pour que tout tienne sur le plateau', action: 'scale_to_fit', objects: [], checked: true }; });
        if (k === 'support') want('support', o.name, function () { return { key: 'support', label: 'Activer les supports', changes: [{ id: 'support', value: true }], objects: [], checked: true }; });
        if (k === 'tall' || k === 'contact')
          want('brim', o.name, function () { return { key: 'brim', label: 'Ajouter une bordure de ' + BRIM + ' mm (un fin rebord collé autour, qui l’empêche de se décoller)', changes: brimFix(s).changes, objects: [], checked: true }; });
        if (k === 'support' || k === 'contact')
          want('orient', o.name, function () { return { key: 'orient', label: ORIENT.label, action: ORIENT.action, objects: [], checked: false }; });
      });
    });
    plan.fixes = FIX_ORDER.filter(function (k) { return fixes[k]; }).map(function (k) { return fixes[k]; });
    plan.count = Object.keys(involved).length;
    return plan;
  }

  // Réglages des corrections cochées, réunis pour un seul message « apply » (une seule étape à annuler).
  function fixChanges(fixes) {
    return fixes.reduce(function (all, f) { return f.changes ? all.concat(f.changes) : all; }, []);
  }
  // Le même envoi quand une correction porte sur des réglages du catalogue (`keyChanges`, ex. remettre ceux du mode vase) :
  // tout part en mode catalogue (une seule étape à annuler), les réglages historiques traduits en clés d'Orca, chaque ligne
  // cochée valant confirmation. { catalog, changes }.
  var LEGACY_KEYS = { support: 'enable_support', brim_type: 'brim_type', brim_width: 'brim_width' };
  function fixBatch(fixes) {
    var keyed = (fixes || []).reduce(function (all, f) { return f.keyChanges ? all.concat(f.keyChanges) : all; }, []);
    var legacy = fixChanges(fixes || []);
    if (!keyed.length) return { catalog: false, changes: legacy };
    var out = keyed.slice();
    legacy.forEach(function (c) { if (LEGACY_KEYS[c.id]) out.push({ key: LEGACY_KEYS[c.id], value: c.value, label: c.id }); });
    return { catalog: true, changes: out.map(function (c) { return { key: c.key, value: c.value, label: c.label, confirmed: true }; }) };
  }

  // « Annuler » après « Tout corriger » : ce qui est revenu et ce qui reste en place. `settings` : les réglages d'avant sont
  // remis ; `undone` : nombre d'actions défaites sur le plateau ; `left` : celles qui restent (orient, arrange, scale_to_fit),
  // qu'Orca ne laisse plus défaire d'ici parce que le plateau a changé depuis. { text, tone }.
  var LEFT = { orient: 'tournée', arrange: 'rangée', scale_to_fit: 'réduite' };
  function undoText(settings, undone, left) {
    var kinds = (left || []).filter(function (k, i, all) { return LEFT[k] && all.indexOf(k) === i; }).map(function (k) { return LEFT[k]; });
    var back = settings && undone ? 'Réglages d’avant remis, et la pièce est revenue comme avant.' : settings ? 'Réglages d’avant remis.' : undone ? 'La pièce est revenue comme avant.' : '';
    if (!kinds.length) return { text: back, tone: '' };
    var still = kinds.length > 1 ? kinds.slice(0, -1).join(', ') + ' et ' + kinds[kinds.length - 1] : kinds[0];
    return { text: (settings ? 'Réglages d’avant remis. ' : '') + 'La pièce reste ' + still + ' : fais Cmd + Z (Ctrl + Z sur Windows) dans la fenêtre de Plyo pour la remettre.', tone: 'warn' };
  }

  // ---------- Ce qu'Orca dit de la plaque (PlyoOrcaMessages.cpp) ----------
  // Chaque problème : { source, code, level, text, opt_key?, scope?, object_ref?, object_name?, fix? }. Le code vient des types
  // et identifiants d'Orca, jamais de son texte : c'est lui qui choisit l'explication. Le texte d'Orca n'est que montré (entre
  // guillemets) et passé à l'assistant.
  var ASK_LABEL = 'Demander à l’assistant (utilise ta jauge)';
  // Sans compte (N7) : le bouton le dit ; la question est gardée et part après la connexion (afterLogin, index.html).
  var ASK_LOGIN_LABEL = 'Me connecter pour demander à l’assistant';
  var ARRANGE_ACT = { kind: 'plate', action: 'arrange', label: 'Ranger le plateau' };
  var SCALE_ACT = { kind: 'plate', action: 'scale_to_fit', label: 'Réduire pour que ça tienne' };
  var FILAMENT_ACT = { kind: 'show_me', target: 'filament', label: 'Montre-moi le filament' };
  var PRINTER_ACT = { kind: 'show_me', target: 'printer', label: 'Montre-moi l’imprimante' };
  var SCOPES = { print: true, filament: true }; // réglages que l'assistant peut changer (catalogue Impression et Filament)

  function pieceOf(issue, capital) {
    var n = issue && typeof issue.object_name === 'string' && issue.object_name ? '« ' + issue.object_name + ' »' : '';
    return n || (capital ? 'Ta pièce' : 'ta pièce');
  }
  function decimal(v) { return String(v).replace('.', ','); }

  // Explication Plyo par code : { title?, text, actions }. `p` : la pièce nommée (« … » ou « ta pièce »), `P` : en début de phrase.
  var EXPLAIN = {
    no_layers: function (i, p) { return { text: 'Plyo Slicer ne trouve aucune couche à imprimer dans ' + p + ' : elle est sans doute trop petite ou trop fine, ou son fichier est abîmé. Regarde sa taille sur le plateau : un modèle dessiné en pouces paraît 25 fois trop petit.', actions: [] }; },
    empty_first_layer: function (i, p) { return { text: 'La première couche de ' + p + ' est vide : la pièce ne pose pas à plat sur le plateau (elle flotte, ou repose sur une pointe).', actions: [
      { kind: 'plate', action: 'orient', label: 'Orienter automatiquement' },
      { kind: 'fix', label: 'Activer les supports', changes: [{ key: 'enable_support', value: true, label: 'Supports' }] }] }; },
    nothing_to_print: function (i, p) { return { text: 'Plyo Slicer n’a rien trouvé à imprimer : ' + p + ' est sans doute trop petite pour la buse de ton imprimante.', actions: [] }; },
    print_empty: function () { return { text: 'Avec les réglages actuels, ta plaque ne donne rien à imprimer : la pièce est peut-être trop petite ou trop fine.', actions: [] }; },
    prime_tower: function () { return { text: 'La tour de purge (le petit bloc qui nettoie la buse entre deux couleurs) sort du plateau ou touche une zone interdite.', actions: [ARRANGE_ACT] }; },
    PlaceholderParserError: function () { return { text: 'Le G-code de ton imprimante (les commandes de début et de fin, dans les réglages de l’imprimante) contient une erreur. Je ne modifie jamais ces commandes : corrige-les dans l’onglet de l’imprimante, ou reprends son profil d’origine.', actions: [{ kind: 'show_me', target: 'printer', label: 'Montre-moi l’imprimante' }] }; },
    bad_alloc: function () { return { text: 'Ton ordinateur a manqué de mémoire pendant la découpe. Ferme d’autres logiciels, puis découpe à nouveau.', actions: [{ kind: 'slice', label: 'Découper à nouveau' }], noAsk: true }; },
    plate_empty: function () { return { text: 'Il n’y a aucune pièce sur cette plaque.', actions: [{ kind: 'import', label: 'Choisir un fichier' }], noAsk: true }; },
    layer_height_over_nozzle: function (i) {
      var fix = i.fix && SCOPES[i.scope] ? [{ kind: 'fix', label: 'Mettre la hauteur de couche à ' + decimal(i.fix.value) + ' mm', changes: [{ key: i.fix.key, value: i.fix.value, label: 'Hauteur de couche' }] }] : [];
      return { text: 'La hauteur de couche est plus grande que le trou de la buse : la buse ne peut pas déposer une couche aussi épaisse, alors Plyo Slicer refuse de découper.', actions: fix }; },
    vase_several_objects: function (i) {
      // Avec ce que le mode vase avait imposé (parois, couches du dessus, remplissage…) : sinon la pièce partirait creuse et ouverte.
      var also = i.fix ? leftovers(i.fix.also) : [];
      var label = 'Désactiver le mode vase' + (also.length ? ' et remettre ' + leftoverNames(also) : '');
      // `short` et `also` : le même libellé en deux morceaux, pour un bouton court avec, dessous, ce qui est remis en plus.
      var fix = i.fix && SCOPES[i.scope] ? [{ kind: 'fix', label: label, short: 'Désactiver le mode vase', also: also.length ? leftoverNames(also) : '',
        changes: [{ key: i.fix.key, value: i.fix.value, label: 'Mode vase' }].concat(leftoverChanges(also)) }] : [];
      return { text: 'Le mode vase imprime une seule pièce, en un seul trait qui monte en spirale. Avec plusieurs pièces sur la plaque, Plyo Slicer refuse.', actions: fix }; },
    motion_capped: function () { return { text: 'Ta machine limite elle-même la vitesse de certains mouvements, et Plyo Slicer s’y adapte tout seul. Rien à faire : ta pièce s’imprime normalement.', actions: [], noAsk: true }; },
    spiral_mode: function () { return { text: 'Le mode vase ne marche pas avec une pièce de plusieurs couleurs ou matières.', actions: [] }; },
    object_too_tall: function (i, p, P) { return { text: P + ' est trop haute pour ton imprimante : son sommet dépasse la hauteur maximale.', actions: [{ kind: 'plate', action: 'scale_to_fit', label: 'Réduire pour qu’elle tienne' }] }; },
    filament_bed_type: function () { return { text: 'Plyo Slicer déconseille ce filament sur le type de plateau choisi : pour cette surface, sa température de plateau est à 0.', actions: [{ kind: 'show_me', target: 'filament', label: 'Montre-moi le filament' }] }; },
    collision: function () { return { text: 'Des pièces sont trop proches : la buse ou la tête d’impression les toucherait.', actions: [ARRANGE_ACT] }; },
    collision_by_object: function () { return { text: 'En impression pièce par pièce, la tête de l’imprimante toucherait une pièce déjà imprimée : elles sont trop proches, ou l’une est trop haute.', actions: [ARRANGE_ACT] }; },
    object_outside: function () { return { text: 'Une pièce dépasse du plateau : elle déborde sur un bord, ou elle est plus haute que ce que ton imprimante peut atteindre. Plyo Slicer vérifie la vraie forme du plateau, zones interdites comprises.',
      actions: [ARRANGE_ACT, SCALE_ACT] }; },
    plate_refused: function () { return { text: 'Plyo Slicer refuse de découper cette plaque sans me dire pourquoi. Range le plateau, puis découpe à nouveau.', actions: [ARRANGE_ACT] }; },
    toolpath_outside: function () { return { text: 'Une partie du trajet de la buse sort du plateau : souvent la bordure (rebord collé autour de la pièce) ou la jupe (contour tracé autour d’elle) d’une pièce placée trop près du bord.', actions: [ARRANGE_ACT] }; },
    height_outside: function () { return { text: 'Le trajet de la buse monte plus haut que ce que ton imprimante peut atteindre.', actions: [{ kind: 'plate', action: 'scale_to_fit', label: 'Réduire pour que ça tienne' }] }; },
    filament_bed_surface: function () { return { text: 'Un filament de ta plaque ne peut pas être imprimé directement sur la surface de ce plateau.', actions: [{ kind: 'show_me', target: 'filament', label: 'Montre-moi le filament' }] }; },
    nozzle_area: function () { return { text: 'Une partie de la plaque est hors de la zone que peut atteindre l’une des buses.', actions: [ARRANGE_ACT] }; },
    nozzle_height: function () { return { text: 'Une partie de la plaque est trop haute pour l’une des buses.', actions: [] }; },
    not_printable: function () { return { text: 'Plyo Slicer a découpé ta plaque, mais ne la juge pas imprimable telle quelle.', actions: [] }; },
    empty_layers: function (i, p, P) { return { text: P + ' a des couches vides à certaines hauteurs : des parties sont trop fines, ou le fichier est abîmé. L’impression risque de rater à cet endroit.', actions: [] }; },
    exclusion_area: function () { return { text: 'Un trajet de la buse passe dans une zone interdite du plateau.', actions: [ARRANGE_ACT] }; },
    // N7 : avertissements et refus courants d'Orca qui n'avaient pas d'explication (identifiants, jamais le texte d'Orca).
    filaments_temp: function () { return { text: 'Les filaments de ta plaque demandent des températures de buse trop différentes : imprimés ensemble, l’un risque de boucher la buse ou de mal coller.', actions: [{ kind: 'show_me', target: 'filament', label: 'Montre-moi le filament' }] }; },
    skirt_brim: function () { return { text: 'Plyo Slicer n’a pas pu tracer la bordure (rebord collé autour de la pièce) ou la jupe (contour tracé autour d’elle) : la pièce est peut-être trop près du bord du plateau.', actions: [ARRANGE_ACT] }; },
    precise_seam: function (i, p) { return { text: 'Une zone ajoutée sur ' + p + ' pour placer la couture (l’endroit où chaque tour de paroi commence) n’a pas d’effet : la couture risque d’être ailleurs. Seul l’aspect change, pas la solidité.', actions: [] }; },
    support_base_pattern: function () { return { text: 'Le motif choisi pour la base des supports ne va pas avec ce type de supports : Plyo Slicer en prend un autre tout seul.', actions: [] }; },
    precise_outer_wall: function () { return { text: 'L’option « Parois précises » ne marche pas avec l’ordre des parois choisi : Plyo Slicer l’ignore et imprime sans elle.', actions: [] }; },
    adaptive_layer_height: function () { return { text: 'La tour de purge (le petit bloc qui nettoie la buse entre deux couleurs) ne marche pas avec la hauteur de couche adaptative : toutes les pièces doivent avoir la même hauteur de couche.', actions: [] }; },
    enable_prime_tower: function (i) { return { text: 'La tour de purge (le petit bloc qui nettoie la buse entre deux couleurs) ne va pas avec tes réglages actuels' +
      (i.level === 'error' ? ' : en impression pièce par pièce, Plyo Slicer ne sait pas la faire.' : '.'), actions: [] }; },
    // ERR-11 : bulles d'Orca sur la plaque et la pièce (source « notification »), reconnues par leur type, jamais par leur texte.
    plate_warning: function () { return { text: 'Plyo Slicer signale un point à surveiller sur le plateau. Je cite son message juste en dessous : le plus souvent, ranger le plateau suffit.', actions: [ARRANGE_ACT] }; },
    flushing_volume_zero: function () { return { text: 'Quand ta plaque change de couleur, la buse jette un peu de filament (la purge) pour repartir avec une couleur propre. Ici, certains volumes de purge sont à 0 : les couleurs risquent de se mélanger sur ta pièce. Pour les régler, clique sur « Volume de purge » dans la bulle de Plyo Slicer, ou sur le bouton « Volumes de purge » au-dessus de la liste des filaments.', actions: [FILAMENT_ACT] }; },
    nozzle_filament: function () { return { text: 'Un filament de ta plaque ne va pas avec la buse de ton imprimante : par exemple un filament chargé de fibres, qui use vite une buse en laiton. L’impression peut rater, ou abîmer la buse.', actions: [FILAMENT_ACT, PRINTER_ACT] }; },
    pla_petg_mix: function () { return { text: 'Ta plaque mélange du PLA et du PETG. Ces deux matières collent mal l’une sur l’autre : dans une même pièce, les couches risquent de se séparer. Pour des supports faciles à détacher, c’est au contraire voulu.', actions: [FILAMENT_ACT] }; },
    mixed_filament_single_nozzle: function () { return { text: 'Ta plaque utilise un filament « mélangé » (deux couleurs qui alternent) sur une imprimante à une seule buse : elle va changer très souvent de filament et purger à chaque fois. L’impression sera plus longue et utilisera plus de filament.', actions: [FILAMENT_ACT] }; },
    mixed_filament_broken: function () { return { text: 'Un filament « mélangé » de ta liste renvoie à un filament supprimé, ou mélange des matières qui ne vont pas ensemble. Ouvre la liste des filaments pour le corriger avant de découper.', actions: [FILAMENT_ACT] }; },
    filament_unprintable: function () { return { text: 'Un des filaments de ta plaque ne peut pas être imprimé par cette imprimante telle qu’elle est réglée (matière qu’elle ne gère pas, ou filament placé sur une buse qui ne peut pas l’imprimer). Choisis un autre filament pour cette pièce.', actions: [FILAMENT_ACT] }; },
    extruder_unprintable: function () { return { text: 'Ton imprimante a deux buses, et une pièce est placée là où la buse prévue pour son filament ne peut pas aller. Range le plateau, ou change le filament de cette pièce.', actions: [ARRANGE_ACT, FILAMENT_ACT] }; },
    plugin_missing: function () { return { text: 'Le profil choisi a besoin d’une extension de Plyo Slicer (un module ajouté au logiciel) qui n’est pas installée ou pas activée. Tant qu’elle manque, le logiciel ne découpe pas. Sa bulle d’alerte propose de la régler ; sinon, choisis un autre profil d’imprimante.', actions: [PRINTER_ACT] }; },
    mesh_errors: function (i, p, P) { return { text: P + ' a un maillage abîmé : sa surface a des trous ou des faces mal raccordées. Plyo Slicer s’en sort souvent, mais des couches peuvent manquer à l’impression. Pour la réparer : clic droit sur la pièce, puis « Réparer le modèle » (Fix Model).', actions: [{ kind: 'show_me', target: 'plate', label: 'Montre-moi le plateau' }] }; },
    simplify_suggestion: function () { return { text: 'Ta pièce a énormément de petites facettes : Plyo Slicer propose de la simplifier pour travailler plus vite. Ce n’est pas obligatoire.', actions: [] }; },
    unknown_font: function () { return { text: 'Le texte ajouté sur ta pièce utilise une police absente de cet ordinateur : Plyo Slicer l’a remplacée par une police proche. Le texte peut avoir un aspect un peu différent.', actions: [] }; },
    project_load_warning: function () { return { text: 'En ouvrant ce projet, Plyo Slicer n’a pas pu reprendre certains réglages du fichier tels quels (valeur refusée, réglage ignoré, ou emplacement de filament changé). Je cite son message juste en dessous : vérifie le filament et l’imprimante avant d’imprimer.', actions: [FILAMENT_ACT, PRINTER_ACT] }; },
    preview_only: function () { return { text: 'Tu as ouvert un fichier G-code : Plyo Slicer le montre seulement en aperçu, il ne peut ni le modifier ni le redécouper. Pour changer des réglages, ouvre le modèle 3D (STL ou 3MF).', actions: [{ kind: 'import', label: 'Choisir un fichier' }] }; },
    repair_removed_paint: function () { return { text: 'Pour réparer la pièce, Plyo Slicer a dû retirer les supports peints à la main et la couleur peinte. Si tu en avais besoin, annule la réparation avec Cmd + Z (Ctrl + Z sur Windows) dans sa fenêtre principale.', actions: [] }; }
  };
  // Ce que change une bulle d'Orca dont l'effet n'est pas celui de son niveau (N7) ; sinon impactOf dit bloquant ou non.
  var NOTICE_IMPACT = {
    prime_tower: 'Plyo Slicer ne bloque pas encore, mais la découpe risque d’échouer tant que la tour dépasse.',
    preview_only: 'Rien n’est abîmé : avec ce fichier, seul l’aperçu est possible.',
    unknown: 'Je ne sais pas si ça bloque : découpe ta plaque, et si Plyo Slicer refuse, je te dirai pourquoi.'
  };
  // Ce que le problème change pour l'impression, dit juste après l'explication (N7) : bloquant ou non.
  function impactOf(i) {
    if (i.source === 'notification' && NOTICE_IMPACT[i.code] && (i.code !== 'unknown' || i.level === 'error')) return NOTICE_IMPACT[i.code];
    if (i.level !== 'error') return 'Ce n’est pas bloquant : tu peux imprimer quand même.';
    if (i.source === 'gcode_check') return 'C’est bloquant : Plyo Slicer ne laissera pas imprimer cette plaque tant que ce n’est pas réglé.';
    return 'C’est bloquant : tant que ce n’est pas réglé, Plyo Slicer ne découpera pas ta plaque, et rien ne peut partir à l’imprimante.';
  }
  // Au moins une suite gratuite et sans compte, adaptée (N7). Avertissement : voir l'aperçu, ou continuer (il n'est pas
  // bloquant : « Continuer quand même » ferme la carte, sans contourner aucun refus). Erreur : annuler les derniers réglages
  // appliqués s'il y en a, sinon découper à nouveau ; contrôle du G-code : l'aperçu montre où.
  var FREE = { fix: true, plate: true, slice: true, import: true, export: true, show_me: true, show_setting: true, preview: true };
  var PREVIEW_ACT = { kind: 'preview', label: 'Voir l’aperçu' };
  var UNDO_LAST_ACT = { kind: 'undo_last', label: 'Annuler les derniers réglages de l’assistant' };
  function freeActions(i, actions, ctx) {
    var repairs = actions.some(function (a) { return a.kind === 'fix' || a.kind === 'plate'; });
    var free = actions.some(function (a) { return FREE[a.kind]; });
    var out = [];
    if (!repairs && ctx.canUndo) out.push(UNDO_LAST_ACT);
    if (i.level !== 'error') return out.concat([PREVIEW_ACT, { kind: 'dismiss', label: 'Continuer quand même' }]);
    if (i.source === 'gcode_check') out.push(PREVIEW_ACT);
    else if (!free && !out.length) out.push({ kind: 'slice', label: 'Découper à nouveau' });
    return out;
  }
  // « Pièce flottante » : déjà dans la carte « Avant d'imprimer » (risque « support »), avec ses corrections.
  var LEFT_TO_PREFLIGHT = { need_support: true };
  // Rien à faire : Orca bride déjà le réglage à la limite de la machine (motion_capped). Pas de carte, donc pas d'alerte
  // jaune à côté de « Aucun risque détecté » ; l'explication reste pour l'assistant (EXPLAIN).
  var QUIET = { motion_capped: true };

  var TITLES = { slicing_error: 'Plyo Slicer n’a pas pu préparer ta pièce', validate_error: 'Plyo Slicer refuse de découper cette plaque',
    gcode_check: 'Plyo Slicer bloque l’impression de cette plaque', validate_warning: 'Plyo Slicer prévient', step_warning: 'Plyo Slicer prévient' };
  // Bulle d'Orca : une erreur reconnue l'empêche de découper ; une erreur inconnue ou un avertissement n'est qu'un signalement.
  function titleOf(i, warn) {
    if (i.source === 'notification') return warn ? 'Plyo Slicer prévient' : i.code === 'unknown' ? 'Plyo Slicer a un souci' : 'Plyo Slicer refuse de découper cette plaque';
    return TITLES[i.source] || (warn ? 'Plyo Slicer prévient' : 'Plyo Slicer a un souci');
  }

  // Problèmes à montrer en carte : les erreurs d'abord ; les avertissements seulement si `warnings` ; au plus `max` (3).
  function orcaCards(issues, opts) {
    var o = opts || {};
    var list = (Array.isArray(issues) ? issues : []).filter(function (i) {
      return i && typeof i.code === 'string' && !LEFT_TO_PREFLIGHT[i.code] && !QUIET[i.code] && (i.level === 'error' || o.warnings);
    });
    list.sort(function (a, b) { return (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1); });
    return list.slice(0, o.max || 3);
  }
  function issueKey(i) { return [i.source, i.code, i.object_ref || '', i.text || ''].join('|'); }

  // Bulles d'Orca expliquées (tour_signals.notices, codes lus toutes les 2 s) : `added` à demander en détail (orca_issues,
  // purpose « notices »), `gone` dont la carte n'a plus lieu d'être (Orca a fermé sa bulle). { added, gone }.
  function noticeChange(before, now) {
    var a = Array.isArray(before) ? before : [], b = (Array.isArray(now) ? now : []).filter(function (c) { return typeof c === 'string' && c; });
    return { added: b.filter(function (c) { return a.indexOf(c) < 0; }), gone: a.filter(function (c) { return b.indexOf(c) < 0; }) };
  }
  // Réponse à « notices » : les problèmes de la liste dont le code vient d'apparaître, pas encore montrés (`known` : issueKey).
  function noticeIssues(issues, added, known) {
    var k = known || {};
    return (Array.isArray(issues) ? issues : []).filter(function (i) { return i && (added || []).indexOf(i.code) >= 0 && !k[issueKey(i)]; });
  }

  // La question préremplie pour l'assistant : le texte d'Orca tel quel, et la pièce quand elle est connue.
  function askPrompt(issue, explained) {
    var on = issue.object_name ? ' pour « ' + issue.object_name + ' »' : '';
    var said = issue.text ? 'Plyo Slicer m’affiche ce message' + on + ' : « ' + issue.text + ' ».'
      : 'Plyo Slicer signale un problème sur ma plaque' + on + (explained ? ' (' + explained + ')' : '') + '.';
    return said + ' Explique-moi simplement ce qui se passe et comment le corriger.';
  }

  // Carte d'un problème : { tone, title, text, impact, quote, quoteMain, actions: [{ kind: fix|show_setting|show_me|plate|slice|import|
  // preview|undo_last|dismiss|ask, label, … }] }. D'abord ce qui se passe, puis ce que ça change (bloquant ou non) ; le texte d'Orca
  // n'est qu'une citation secondaire. Toujours une suite gratuite. Réglage de l'imprimante ou G-code : expliqué, montré, jamais modifié.
  // ctx : { canUndo } (un lot appliqué peut être annulé).
  function orcaIssueView(issue, ctx) {
    var i = issue || {}, c = ctx || {}, p = pieceOf(i, false), P = pieceOf(i, true);
    var known = EXPLAIN[i.code] ? EXPLAIN[i.code](i, p, P) : null;
    var warn = i.level !== 'error';
    // `explained` : Plyo a sa propre explication ; le texte d'Orca peut alors être replié (il propose parfois une autre piste).
    var view = { tone: warn ? 'warn' : 'error', title: titleOf(i, warn), text: '', impact: impactOf(i), quote: i.text || '', quoteMain: false, explained: !!known, actions: [] };
    if (known) {
      view.text = known.text;
      view.actions = known.actions.filter(function (a) { return a.kind !== 'fix' || a.changes.every(function (c) { return c.key; }); });
    } else if (warn && c.novice) {
      // Débutant, avertissement sans explication Plyo : ce qu'il change d'abord (rien de bloquant), deux suites au plus, et le
      // texte d'Orca replié (jamais « je ne sais pas expliquer » en premier).
      view.text = 'Plyo Slicer signale un point à surveiller' + (i.object_name ? ' sur ' + p : '') + '. Ce n’est pas bloquant : tu peux continuer, ou me demander ce que ça veut dire.';
      view.impact = '';
      view.explained = true;
      view.actions = [{ kind: 'dismiss', label: 'Continuer' }, { kind: 'ask', label: ASK_LABEL, prompt: askPrompt(i, '') }];
      return view;
    } else {
      // Pas d'explication Plyo : on le dit simplement ; le texte d'Orca (parfois en anglais) reste un détail cité.
      var on = i.object_name ? ' sur ' + p : '';
      view.text = (warn ? 'Plyo Slicer signale un point à surveiller' + on : 'Plyo Slicer a trouvé un problème' + on) +
        (i.text ? ', que je ne sais pas encore expliquer.' : ', sans me donner de détail.');
    }
    if (i.opt_key && !view.actions.some(function (a) { return a.kind === 'fix'; })) {
      view.actions.push({ kind: 'show_setting', key: i.opt_key, label: 'Montre-moi ce réglage' });
      if (i.scope === 'printer') view.note = 'Ce réglage fait partie du profil de l’imprimante : je ne le modifie pas, je te montre où il est.';
    }
    view.actions = view.actions.concat(freeActions(i, view.actions, c));
    if (!(known && known.noAsk)) view.actions.push({ kind: 'ask', label: ASK_LABEL, prompt: askPrompt(i, known ? known.text.replace(/[.:]$/, '') : '') });
    return view;
  }

  // Erreur d'export (`kind` : FirstSteps::on_export_done) : la phrase vient de Plyo, le texte d'Orca n'est qu'un détail.
  var EXPORT_TEXTS = {
    write: { text: 'Je n’ai pas pu écrire le fichier : le disque est peut-être plein, le dossier protégé, ou un fichier du même nom est ouvert dans un autre logiciel.', actions: [{ kind: 'export', label: 'Choisir un autre dossier' }] },
    gcode_template: { text: 'Le G-code de ton imprimante (ses commandes de début et de fin) contient une erreur : le fichier n’a pas pu être préparé. Je ne modifie jamais ces commandes.', actions: [{ kind: 'show_me', target: 'printer', label: 'Montre-moi l’imprimante' }] },
    slicing: { text: 'La découpe a échoué pendant l’export : aucun fichier n’a été écrit.', actions: [{ kind: 'slice', label: 'Découper à nouveau' }] },
    memory: { text: 'Ton ordinateur a manqué de mémoire pendant l’export. Ferme d’autres logiciels, puis exporte à nouveau.', actions: [{ kind: 'export', label: 'Exporter à nouveau' }] },
    other: { text: 'L’export n’a pas abouti : aucun fichier n’a été écrit.', actions: [{ kind: 'export', label: 'Choisir un autre dossier' }] }
  };
  function exportErrorView(msg) {
    var m = msg || {}, t = EXPORT_TEXTS[m.kind] || EXPORT_TEXTS.other;
    var actions = t.actions.slice();
    if (m.kind !== 'slicing' && m.kind !== 'memory')
      actions.push({ kind: 'ask', label: ASK_LABEL, prompt: (m.text ? 'L’export de mon fichier a échoué. Plyo Slicer dit : « ' + m.text + ' ».' : 'L’export de mon fichier a échoué.') + ' Que faire ?' });
    return { text: t.text, quote: typeof m.text === 'string' ? m.text : '', actions: actions };
  }

  // Découpe sans nouvelle au bout du délai (filet de sécurité) ou arrêtée avant la fin : la suite, jamais « lis le message d'Orca ».
  var SLICE_SLOW = { text: 'La découpe prend plus longtemps que prévu, et Plyo Slicer ne m’a rien dit. Relance-la ; si rien ne change, demande-moi.',
    actions: [{ kind: 'slice', label: 'Découper à nouveau' }, { kind: 'ask', label: ASK_LABEL, prompt: 'J’ai lancé la découpe de ma plaque il y a deux minutes et rien ne se passe. Que faire ?' }] };
  // Découpe demandée qui ne démarre pas, sans refus lisible : Orca ne redécoupe pas une plaque restée en erreur tant que rien ne change.
  var SLICE_NOT_STARTED = { text: 'Plyo Slicer n’a pas lancé la découpe. Après une erreur, il attend qu’un réglage ou la pièce change avant de redécouper : corrige ce qui a été signalé, ou demande-moi.',
    actions: [{ kind: 'ask', label: ASK_LABEL, prompt: 'Je clique sur « Découper » mais Plyo Slicer ne lance pas la découpe de ma plaque. Que faire ?' }] };
  // Même cas juste après un réglage changé par l'assistant : « il attend qu'un réglage change » serait faux.
  var SLICE_NOT_STARTED_AFTER_CHANGE = { text: 'Plyo Slicer n’a pas relancé la découpe, alors que le réglage vient de changer. Relance-la ; si rien ne se passe, demande-moi.',
    actions: [{ kind: 'slice', label: 'Découper à nouveau' }, { kind: 'ask', label: ASK_LABEL, prompt: 'Je viens de changer un réglage et Plyo Slicer ne relance pas la découpe de ma plaque. Que faire ?' }] };
  var SLICE_STOPPED = { text: 'La découpe s’est arrêtée avant la fin : un réglage a changé pendant que Plyo Slicer découpait, ou elle a été annulée.',
    actions: [{ kind: 'slice', label: 'Découper à nouveau' }] };

  // ---------- Envoi à l'imprimante et fenêtres d'Orca (PlyoSend.cpp, PlyoOrcaWindows.cpp, lot 10) ----------
  // La phrase vient du code de l'échec (code HTTP, étape atteinte : jamais le texte d'Orca) ; le texte d'Orca, déjà sans
  // adresse ni chemin, n'est que cité et passé à l'assistant. `n` : le nom de l'imprimante du projet.
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  var SEND_TEXTS = {
    waiting: 'Plyo Slicer te demande de confirmer : vérifie le nom de ton imprimante, puis valide.',
    device: 'Plyo Slicer ouvre la fenêtre d’envoi de ton imprimante : choisis-la, puis valide. Dis-moi ensuite quand l’impression a démarré.',
    closed: 'Tu as fermé la fenêtre d’envoi : rien n’est parti.',
    notStarted: 'Plyo Slicer n’a pas lancé l’envoi, sans me dire pourquoi : rien n’est parti. Découpe à nouveau la plaque, puis réessaie.',
    notReady: 'Plyo Slicer ne laisse pas encore envoyer cette plaque, sans me dire pourquoi : découpe-la à nouveau, puis réessaie.',
    sending: function (n) { return 'J’envoie le fichier à ' + n + '…'; },
    progress: function (n, p) { return 'J’envoie le fichier à ' + n + '… ' + p + ' %'; },
    arrived: function (n) { return 'Le fichier est arrivé sur ' + n + '.'; },
    cancelled: function (n) { return 'L’envoi a été annulé dans la file de Plyo Slicer : le fichier n’est pas arrivé sur ' + n + '.'; },
    silent: function (n) { return cap(n) + ' ne répond pas encore. Si elle est éteinte ou hors du Wi-Fi, l’envoi va échouer : vérifie-la.'; }
  };
  var UPLOAD_TEXTS = {
    unreachable: function (n) { return 'Je n’arrive pas à joindre ' + n + ' : elle est peut-être éteinte, en veille, ou plus sur le même Wi-Fi que cet ordinateur. Rien n’est parti.'; },
    auth: function (n) { return cap(n) + ' refuse la connexion : le code d’accès (ou la clé d’API) enregistré dans Plyo n’est plus le bon. Rien n’est parti.'; },
    no_space: function (n) { return cap(n) + ' a refusé le fichier : sa mémoire ou sa carte est sans doute pleine, ou le fichier est trop gros. Fais de la place sur l’imprimante, ou passe par une carte SD ou une clé USB.'; },
    file_refused: function (n) { return cap(n) + ' a refusé le fichier : elle n’accepte peut-être pas ce type de fichier, ou un fichier du même nom est en cours d’impression.'; },
    not_printer: function (n) { return 'À l’adresse enregistrée, ce n’est pas ' + n + ' qui répond, ou pas comme prévu : son adresse a peut-être changé.'; },
    server_error: function (n) { return cap(n) + ' a reçu la demande, mais a répondu par une erreur. Réessaie ; si ça recommence, redémarre-la.'; },
    interrupted: function (n) { return 'La liaison avec ' + n + ' s’est coupée pendant l’envoi : le fichier n’est pas arrivé en entier. Vérifie son Wi-Fi, puis réessaie.'; },
    // Erreur sans code après « 100 % » (Elegoo CC2, par exemple) : le fichier est arrivé, c'est le démarrage qui n'est pas confirmé.
    no_confirmation: function (n) { return 'Le fichier est bien arrivé sur ' + n + ', mais elle n’a pas confirmé le démarrage de l’impression. Regarde son écran : si elle imprime, dis-le-moi ; sinon, lance le fichier depuis son écran, ou réessaie l’envoi.'; },
    before_send: function () { return 'Plyo Slicer a refusé de lancer l’envoi, sans une raison que je sache expliquer. Rien n’est parti : réessaie, ou exporte le fichier pour une carte SD ou une clé USB.'; },
    unknown: function () { return 'Plyo Slicer n’a pas pu envoyer le fichier, et je ne reconnais pas la raison. Rien n’est parti : réessaie, ou exporte le fichier pour une carte SD ou une clé USB.'; }
  };
  // Suites proposées, dans l'ordre : la plus utile d'abord.
  var UPLOAD_ACTIONS = {
    unreachable: ['retry', 'link', 'export'], auth: ['link', 'retry', 'export'], no_space: ['export', 'retry'],
    file_refused: ['export', 'retry'], not_printer: ['link', 'export'], server_error: ['retry', 'export'],
    interrupted: ['retry', 'link', 'export'], no_confirmation: ['printing', 'retry', 'link'], before_send: ['retry', 'link', 'export'], unknown: ['retry', 'link', 'export']
  };
  var SEND_LABELS = { printing: 'Elle imprime', retry: 'Réessayer l’envoi', link: 'Vérifier la liaison de mon imprimante', export: 'Exporter le fichier pour une carte SD ou une clé USB',
    connexion: 'Ouvrir la fenêtre Connexion', retest: 'Tester à nouveau', search: 'Chercher mon imprimante sur le Wi-Fi', import: 'Choisir un autre fichier' };
  function acts(keys) { return keys.map(function (k) { return { kind: k, label: SEND_LABELS[k] }; }); }

  // Carte « L'envoi à … n'a pas abouti ». failure : { code, step, http, host_type, text }. { tone, title, text, quote, quoteMain, actions }.
  function uploadFailureView(failure, printerName) {
    var f = failure || {}, n = printerName || 'ton imprimante';
    var code = UPLOAD_TEXTS[f.code] ? f.code : 'unknown';
    var quote = typeof f.text === 'string' ? f.text : '';
    // Fichier arrivé, démarrage non confirmé : le titre ne dit pas « n'a pas abouti » (le texte dit que le fichier est là).
    var title = code === 'no_confirmation' ? 'Démarrage non confirmé sur ' + n : 'L’envoi à ' + n + ' n’a pas abouti';
    // Le texte d'Orca (souvent en anglais pour un échec réseau) n'est qu'un détail cité sous la phrase de Plyo (N7).
    var view = { tone: code === 'no_confirmation' ? 'warn' : 'error', title: title, text: UPLOAD_TEXTS[code](n), quote: quote,
      quoteMain: false, actions: acts(UPLOAD_ACTIONS[code]) };
    view.actions.push({ kind: 'ask', label: ASK_LABEL, prompt: (code === 'no_confirmation' ? 'Mon fichier est arrivé sur mon imprimante, mais elle n’a pas confirmé le démarrage de l’impression.' : 'L’envoi de mon fichier à mon imprimante n’a pas abouti.') +
      (quote ? ' Plyo Slicer dit : « ' + quote + ' ».' : '') + ' Explique-moi simplement ce qui se passe et quoi faire.' });
    return view;
  }

  // Résultat de « Vérifier la liaison » (printer_link_rechecked : { code, http, text }). { tone, text, quote, actions }.
  var RECHECK = {
    ok: function (n) { return { tone: 'ok', text: cap(n) + ' répond, et la liaison enregistrée fonctionne : réessaie l’envoi.', actions: ['retry'] }; },
    auth: function (n) { return { tone: 'warn', text: cap(n) + ' répond, mais refuse le code d’accès (ou la clé d’API) enregistré. Corrige-le dans la fenêtre « Connexion » de Plyo Slicer, puis réessaie.', actions: ['connexion', 'retry'] }; },
    unreachable: function (n) { return { tone: 'warn', text: 'Je n’arrive toujours pas à joindre ' + n + '. Vérifie qu’elle est allumée, que son écran est actif, et qu’elle est sur le même Wi-Fi que cet ordinateur.', actions: ['retest', 'search'] }; },
    not_printer: function (n) { return { tone: 'warn', text: 'À l’adresse enregistrée, ce n’est pas ' + n + ' qui répond : cherche-la à nouveau sur le Wi-Fi pour la relier.', actions: ['search', 'connexion'] }; },
    error: function (n) { return { tone: 'warn', text: cap(n) + ' répond, mais pas comme prévu. Vérifie sa connexion dans la fenêtre « Connexion » de Plyo Slicer.', actions: ['connexion', 'retry'] }; },
    not_local: function () { return { tone: 'warn', text: 'L’adresse enregistrée n’est pas sur ton réseau local : je ne la teste pas d’ici. Vérifie-la dans la fenêtre « Connexion » de Plyo Slicer.', actions: ['connexion'] }; },
    none: function () { return { tone: 'warn', text: 'Ton imprimante n’est plus reliée à Plyo : cherche-la sur le Wi-Fi pour la relier à nouveau.', actions: ['search'] }; }
  };
  function linkRecheckView(result, printerName) {
    var r = result || {}, n = printerName || 'ton imprimante';
    var v = (RECHECK[r.code] || RECHECK.error)(n);
    return { tone: v.tone, text: v.text, quote: r.code === 'error' && typeof r.text === 'string' ? r.text : '', actions: acts(v.actions) };
  }

  // Fenêtre de message d'Orca (orca_dialog : { phase, kind, title, text, during, covered }). Pendant qu'elle est ouverte : une
  // ligne discrète. Une erreur fermée, qu'aucune autre carte n'explique (covered), devient une carte qui cite son texte.
  function dialogWaitText(d) {
    return d && d.during === 'model_add' && d.kind === 'question' ? 'Plyo Slicer te demande comment ouvrir ce fichier : réponds dans sa fenêtre.'
      : 'Plyo Slicer attend ta réponse dans sa fenêtre.';
  }
  function dialogCardWanted(d) { return !!d && d.phase === 'closed' && d.kind === 'error' && !d.covered; }
  function dialogView(d) {
    var x = d || {}, quote = typeof x.text === 'string' ? x.text : '';
    var addModel = x.during === 'model_add';
    // N7 : ce qui se passe et la suite d'abord, gratuite ; le texte de la fenêtre n'est qu'une citation.
    var view = { tone: 'error', title: addModel ? 'Plyo Slicer n’a pas pu ajouter ta pièce' : 'Plyo Slicer a affiché une erreur',
      text: addModel ? 'Plyo Slicer n’a pas pu ouvrir ce fichier, pour une raison que je ne sais pas encore expliquer. Rien n’a été ajouté au plateau : essaie un autre fichier (STL ou 3MF).'
        : 'Plyo Slicer a affiché une erreur que je ne sais pas encore expliquer. Refais ce que tu étais en train de faire ; si c’était une découpe, découpe à nouveau ta plaque.',
      quote: quote, quoteMain: false, actions: addModel ? acts(['import']) : [{ kind: 'slice', label: 'Découper à nouveau' }] };
    view.actions.push({ kind: 'ask', label: ASK_LABEL, prompt: (quote ? 'Plyo Slicer m’a affiché ce message d’erreur : « ' + quote + ' ».' : 'Plyo Slicer m’a affiché une erreur sans détail.') +
      (addModel ? ' C’était en ajoutant un fichier 3D.' : '') + ' Explique-moi simplement ce qui se passe et comment le corriger.' });
    return view;
  }

  // Ajout d'une pièce refusé (ERR-14) : les messages qu'Orca a montrés pendant l'ajout, cités sous « Orca n'a pas pu ouvrir … »,
  // et la question préremplie pour l'assistant (sans le nom du fichier).
  function modelDialogQuoted(d) { return !!d && d.phase === 'closed' && d.during === 'model_add' && !!d.text && d.kind !== 'question'; }
  function modelFailPrompt(quotes) {
    var q = (quotes || []).filter(Boolean);
    return 'Plyo Slicer n’a pas pu ouvrir mon fichier 3D.' + (q.length ? ' Il m’a affiché : ' + q.map(function (t) { return '« ' + t + ' »'; }).join(' ') + '.' : '') +
      ' Explique-moi simplement pourquoi et comment obtenir un fichier qui marche.';
  }

  var api = { preflightRisks: preflightRisks, riskKey: riskKey, preflightPlan: preflightPlan, fixChanges: fixChanges, fixBatch: fixBatch, undoText: undoText,
    leftoverNames: leftoverNames, SLICE_NOT_STARTED_AFTER_CHANGE: SLICE_NOT_STARTED_AFTER_CHANGE,
    orcaCards: orcaCards, orcaIssueView: orcaIssueView, issueKey: issueKey, askPrompt: askPrompt, exportErrorView: exportErrorView,
    noticeChange: noticeChange, noticeIssues: noticeIssues,
    SLICE_SLOW: SLICE_SLOW, SLICE_STOPPED: SLICE_STOPPED, SLICE_NOT_STARTED: SLICE_NOT_STARTED, ASK_LABEL: ASK_LABEL, ASK_LOGIN_LABEL: ASK_LOGIN_LABEL, impactOf: impactOf,
    SEND_TEXTS: SEND_TEXTS, uploadFailureView: uploadFailureView, linkRecheckView: linkRecheckView, dialogWaitText: dialogWaitText,
    dialogCardWanted: dialogCardWanted, dialogView: dialogView, modelDialogQuoted: modelDialogQuoted, modelFailPrompt: modelFailPrompt };
  root.PlyoPreflight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
