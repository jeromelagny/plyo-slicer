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
          want('brim', o.name, function () { return { key: 'brim', label: 'Ajouter une bordure de ' + BRIM + ' mm', changes: brimFix(s).changes, objects: [], checked: true }; });
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
    return { text: (settings ? 'Réglages d’avant remis. ' : '') + 'La pièce reste ' + still + ' : fais Cmd + Z (Ctrl + Z sur Windows) dans le slicer pour la remettre.', tone: 'warn' };
  }

  // ---------- Ce qu'Orca dit de la plaque (PlyoOrcaMessages.cpp) ----------
  // Chaque problème : { source, code, level, text, opt_key?, scope?, object_ref?, object_name?, fix? }. Le code vient des types
  // et identifiants d'Orca, jamais de son texte : c'est lui qui choisit l'explication. Le texte d'Orca n'est que montré (entre
  // guillemets) et passé à l'assistant.
  var ASK_LABEL = 'Demander à l’assistant (utilise ta jauge)';
  var ARRANGE_ACT = { kind: 'plate', action: 'arrange', label: 'Ranger le plateau' };
  var SCOPES = { print: true, filament: true }; // réglages que l'assistant peut changer (catalogue Impression et Filament)

  function pieceOf(issue, capital) {
    var n = issue && typeof issue.object_name === 'string' && issue.object_name ? '« ' + issue.object_name + ' »' : '';
    return n || (capital ? 'Ta pièce' : 'ta pièce');
  }
  function decimal(v) { return String(v).replace('.', ','); }

  // Explication Plyo par code : { title?, text, actions }. `p` : la pièce nommée (« … » ou « ta pièce »), `P` : en début de phrase.
  var EXPLAIN = {
    no_layers: function (i, p) { return { text: 'Orca ne trouve aucune couche à imprimer dans ' + p + ' : elle est sans doute trop petite ou trop fine, ou son fichier est abîmé. Regarde sa taille sur le plateau : un modèle dessiné en pouces paraît 25 fois trop petit.', actions: [] }; },
    empty_first_layer: function (i, p) { return { text: 'La première couche de ' + p + ' est vide : la pièce ne pose pas à plat sur le plateau (elle flotte, ou repose sur une pointe).', actions: [
      { kind: 'plate', action: 'orient', label: 'Orienter automatiquement' },
      { kind: 'fix', label: 'Activer les supports', changes: [{ key: 'enable_support', value: true, label: 'Supports' }] }] }; },
    nothing_to_print: function (i, p) { return { text: 'Orca n’a rien trouvé à imprimer : ' + p + ' est sans doute trop petite pour la buse de ton imprimante.', actions: [] }; },
    print_empty: function () { return { text: 'Avec les réglages actuels, ta plaque ne donne rien à imprimer : la pièce est peut-être trop petite ou trop fine.', actions: [] }; },
    prime_tower: function () { return { text: 'La tour de purge (le petit bloc qui nettoie la buse entre deux couleurs) sort du plateau ou touche une zone interdite.', actions: [ARRANGE_ACT] }; },
    PlaceholderParserError: function () { return { text: 'Le G-code de ton imprimante (les commandes de début et de fin, dans les réglages de l’imprimante) contient une erreur. Je ne modifie jamais ces commandes : corrige-les dans l’onglet de l’imprimante, ou reprends son profil d’origine.', actions: [{ kind: 'show_me', target: 'printer', label: 'Montre-moi l’imprimante' }] }; },
    bad_alloc: function () { return { text: 'Ton ordinateur a manqué de mémoire pendant la découpe. Ferme d’autres logiciels, puis découpe à nouveau.', actions: [{ kind: 'slice', label: 'Découper à nouveau' }], noAsk: true }; },
    plate_empty: function () { return { text: 'Il n’y a aucune pièce sur cette plaque.', actions: [{ kind: 'import', label: 'Choisir un fichier' }], noAsk: true }; },
    layer_height_over_nozzle: function (i) {
      var fix = i.fix && SCOPES[i.scope] ? [{ kind: 'fix', label: 'Mettre la hauteur de couche à ' + decimal(i.fix.value) + ' mm', changes: [{ key: i.fix.key, value: i.fix.value, label: 'Hauteur de couche' }] }] : [];
      return { text: 'La hauteur de couche est plus grande que le trou de la buse : la buse ne peut pas déposer une couche aussi épaisse, alors Orca refuse de découper.', actions: fix }; },
    vase_several_objects: function (i) {
      // Avec ce que le mode vase avait imposé (parois, couches du dessus, remplissage…) : sinon la pièce partirait creuse et ouverte.
      var also = i.fix ? leftovers(i.fix.also) : [];
      var label = 'Désactiver le mode vase' + (also.length ? ' et remettre ' + leftoverNames(also) : '');
      var fix = i.fix && SCOPES[i.scope] ? [{ kind: 'fix', label: label, changes: [{ key: i.fix.key, value: i.fix.value, label: 'Mode vase' }].concat(leftoverChanges(also)) }] : [];
      return { text: 'Le mode vase imprime une seule pièce, en un seul trait qui monte en spirale. Avec plusieurs pièces sur la plaque, Orca refuse.', actions: fix }; },
    spiral_mode: function () { return { text: 'Le mode vase ne marche pas avec une pièce de plusieurs couleurs ou matières.', actions: [] }; },
    object_too_tall: function (i, p, P) { return { text: P + ' est trop haute pour ton imprimante : son sommet dépasse la hauteur maximale.', actions: [{ kind: 'plate', action: 'scale_to_fit', label: 'Réduire pour qu’elle tienne' }] }; },
    filament_bed_type: function () { return { text: 'Orca déconseille ce filament sur le type de plateau choisi : pour cette surface, sa température de plateau est à 0.', actions: [{ kind: 'show_me', target: 'filament', label: 'Montre-moi le filament' }] }; },
    collision: function () { return { text: 'Des pièces sont trop proches : la buse ou la tête d’impression les toucherait.', actions: [ARRANGE_ACT] }; },
    collision_by_object: function () { return { text: 'En impression pièce par pièce, la tête de l’imprimante toucherait une pièce déjà imprimée : elles sont trop proches, ou l’une est trop haute.', actions: [ARRANGE_ACT] }; },
    object_outside: function () { return { text: 'Une pièce touche le bord du plateau ou en sort. Orca vérifie la vraie forme du plateau, zones interdites comprises.', actions: [ARRANGE_ACT] }; },
    plate_refused: function () { return { text: 'Orca refuse de découper cette plaque sans me dire pourquoi. Range le plateau, puis découpe à nouveau.', actions: [ARRANGE_ACT] }; },
    toolpath_outside: function () { return { text: 'Une partie du trajet de la buse sort du plateau : souvent la bordure ou la jupe d’une pièce placée trop près du bord.', actions: [ARRANGE_ACT] }; },
    height_outside: function () { return { text: 'Le trajet de la buse monte plus haut que ce que ton imprimante peut atteindre.', actions: [{ kind: 'plate', action: 'scale_to_fit', label: 'Réduire pour que ça tienne' }] }; },
    filament_bed_surface: function () { return { text: 'Un filament de ta plaque ne peut pas être imprimé directement sur la surface de ce plateau.', actions: [{ kind: 'show_me', target: 'filament', label: 'Montre-moi le filament' }] }; },
    nozzle_area: function () { return { text: 'Une partie de la plaque est hors de la zone que peut atteindre l’une des buses.', actions: [ARRANGE_ACT] }; },
    nozzle_height: function () { return { text: 'Une partie de la plaque est trop haute pour l’une des buses.', actions: [] }; },
    not_printable: function () { return { text: 'Orca a découpé ta plaque, mais ne la juge pas imprimable telle quelle.', actions: [] }; },
    empty_layers: function (i, p, P) { return { text: P + ' a des couches vides à certaines hauteurs : des parties sont trop fines, ou le fichier est abîmé. L’impression risque de rater à cet endroit.', actions: [] }; },
    exclusion_area: function () { return { text: 'Un trajet de la buse passe dans une zone interdite du plateau.', actions: [ARRANGE_ACT] }; }
  };
  // « Pièce flottante » : déjà dans la carte « Avant d'imprimer » (risque « support »), avec ses corrections.
  var LEFT_TO_PREFLIGHT = { need_support: true };

  var TITLES = { slicing_error: 'Orca n’a pas pu préparer ta pièce', validate_error: 'Orca refuse de découper cette plaque',
    gcode_check: 'Orca bloque l’impression de cette plaque', validate_warning: 'Orca prévient', step_warning: 'Orca prévient' };

  // Problèmes à montrer en carte : les erreurs d'abord ; les avertissements seulement si `warnings` ; au plus `max` (3).
  function orcaCards(issues, opts) {
    var o = opts || {};
    var list = (Array.isArray(issues) ? issues : []).filter(function (i) {
      return i && typeof i.code === 'string' && !LEFT_TO_PREFLIGHT[i.code] && (i.level === 'error' || o.warnings);
    });
    list.sort(function (a, b) { return (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1); });
    return list.slice(0, o.max || 3);
  }
  function issueKey(i) { return [i.source, i.code, i.object_ref || '', i.text || ''].join('|'); }

  // La question préremplie pour l'assistant : le texte d'Orca tel quel, et la pièce quand elle est connue.
  function askPrompt(issue, explained) {
    var on = issue.object_name ? ' pour « ' + issue.object_name + ' »' : '';
    var said = issue.text ? 'Orca m’affiche ce message' + on + ' : « ' + issue.text + ' ».'
      : 'Orca signale un problème sur ma plaque' + on + (explained ? ' (' + explained + ')' : '') + '.';
    return said + ' Explique-moi simplement ce qui se passe et comment le corriger.';
  }

  // Carte d'un problème : { tone, title, text, quote, actions: [{ kind: fix|show_setting|show_me|plate|slice|import|ask, label, … }] }.
  // Réglage de l'imprimante ou G-code : expliqué, montré, jamais modifié.
  function orcaIssueView(issue) {
    var i = issue || {}, p = pieceOf(i, false), P = pieceOf(i, true);
    var known = EXPLAIN[i.code] ? EXPLAIN[i.code](i, p, P) : null;
    var warn = i.level !== 'error';
    var view = { tone: warn ? 'warn' : 'error', title: TITLES[i.source] || (warn ? 'Orca prévient' : 'Orca a un souci'), text: '', quote: i.text || '', actions: [] };
    if (known) {
      view.text = known.text;
      view.actions = known.actions.filter(function (a) { return a.kind !== 'fix' || a.changes.every(function (c) { return c.key; }); });
    } else {
      // Pas d'explication Plyo : le texte d'Orca est montré comme tel, et l'assistant peut l'expliquer.
      view.text = i.text ? (warn ? 'Orca prévient' : 'Orca dit') + (i.object_name ? ' à propos de ' + p : '') + ' :' : 'Orca signale un problème' + (i.object_name ? ' sur ' + p : '') + ', sans me donner de détail.';
      view.quoteMain = !!i.text;
    }
    if (i.opt_key && !view.actions.some(function (a) { return a.kind === 'fix'; })) {
      view.actions.push({ kind: 'show_setting', key: i.opt_key, label: 'Montre-moi ce réglage' });
      if (i.scope === 'printer') view.note = 'Ce réglage fait partie du profil de l’imprimante : je ne le modifie pas, je te montre où il est.';
    }
    if (!(known && known.noAsk)) view.actions.push({ kind: 'ask', label: ASK_LABEL, prompt: askPrompt(i, known ? known.text.replace(/[.:]$/, '') : '') });
    return view;
  }

  // Erreur d'export (`kind` : FirstSteps::on_export_done) : la phrase vient de Plyo, le texte d'Orca n'est qu'un détail.
  var EXPORT_TEXTS = {
    write: { text: 'Je n’ai pas pu écrire le fichier : le disque est peut-être plein, le dossier protégé, ou un fichier du même nom est ouvert dans un autre logiciel.', actions: [{ kind: 'export', label: 'Choisir un autre dossier' }] },
    gcode_template: { text: 'Le G-code de ton imprimante contient une erreur : le fichier n’a pas pu être préparé. Je ne modifie jamais ces commandes.', actions: [{ kind: 'show_me', target: 'printer', label: 'Montre-moi l’imprimante' }] },
    slicing: { text: 'La découpe a échoué pendant l’export : aucun fichier n’a été écrit.', actions: [{ kind: 'slice', label: 'Découper à nouveau' }] },
    memory: { text: 'Ton ordinateur a manqué de mémoire pendant l’export. Ferme d’autres logiciels, puis exporte à nouveau.', actions: [{ kind: 'export', label: 'Exporter à nouveau' }] },
    other: { text: 'L’export n’a pas abouti : aucun fichier n’a été écrit.', actions: [{ kind: 'export', label: 'Choisir un autre dossier' }] }
  };
  function exportErrorView(msg) {
    var m = msg || {}, t = EXPORT_TEXTS[m.kind] || EXPORT_TEXTS.other;
    var actions = t.actions.slice();
    if (m.kind !== 'slicing' && m.kind !== 'memory')
      actions.push({ kind: 'ask', label: ASK_LABEL, prompt: (m.text ? 'L’export de mon fichier a échoué. Orca dit : « ' + m.text + ' ».' : 'L’export de mon fichier a échoué.') + ' Que faire ?' });
    return { text: t.text, quote: typeof m.text === 'string' ? m.text : '', actions: actions };
  }

  // Découpe sans nouvelle au bout du délai (filet de sécurité) ou arrêtée avant la fin : la suite, jamais « lis le message d'Orca ».
  var SLICE_SLOW = { text: 'La découpe prend plus longtemps que prévu, et Orca ne m’a rien dit. Relance-la ; si rien ne change, demande-moi.',
    actions: [{ kind: 'slice', label: 'Découper à nouveau' }, { kind: 'ask', label: ASK_LABEL, prompt: 'J’ai lancé la découpe de ma plaque il y a deux minutes et rien ne se passe. Que faire ?' }] };
  // Découpe demandée qui ne démarre pas, sans refus lisible : Orca ne redécoupe pas une plaque restée en erreur tant que rien ne change.
  var SLICE_NOT_STARTED = { text: 'Orca n’a pas lancé la découpe. Après une erreur, il attend qu’un réglage ou la pièce change avant de redécouper : corrige ce qui a été signalé, ou demande-moi.',
    actions: [{ kind: 'ask', label: ASK_LABEL, prompt: 'Je clique sur « Découper » mais Orca ne lance pas la découpe de ma plaque. Que faire ?' }] };
  // Même cas juste après un réglage changé par l'assistant : « il attend qu'un réglage change » serait faux.
  var SLICE_NOT_STARTED_AFTER_CHANGE = { text: 'Orca n’a pas relancé la découpe, alors que le réglage vient de changer. Relance-la ; si rien ne se passe, demande-moi.',
    actions: [{ kind: 'slice', label: 'Découper à nouveau' }, { kind: 'ask', label: ASK_LABEL, prompt: 'Je viens de changer un réglage et Orca ne relance pas la découpe de ma plaque. Que faire ?' }] };
  var SLICE_STOPPED = { text: 'La découpe s’est arrêtée avant la fin : un réglage a changé pendant qu’Orca découpait, ou elle a été annulée.',
    actions: [{ kind: 'slice', label: 'Découper à nouveau' }] };

  var api = { preflightRisks: preflightRisks, riskKey: riskKey, preflightPlan: preflightPlan, fixChanges: fixChanges, fixBatch: fixBatch, undoText: undoText,
    leftoverNames: leftoverNames, SLICE_NOT_STARTED_AFTER_CHANGE: SLICE_NOT_STARTED_AFTER_CHANGE,
    orcaCards: orcaCards, orcaIssueView: orcaIssueView, issueKey: issueKey, askPrompt: askPrompt, exportErrorView: exportErrorView,
    SLICE_SLOW: SLICE_SLOW, SLICE_STOPPED: SLICE_STOPPED, SLICE_NOT_STARTED: SLICE_NOT_STARTED, ASK_LABEL: ASK_LABEL };
  root.PlyoPreflight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
