// Logique pure du panneau de l'assistant (sans DOM) : titres des conversations, réponses groupées,
// jauge du mois, erreurs et lecture du flux de réponse.
// Chargée par index.html (window.PlyoLogic) et testée par node (tests/assistant-logic.test.mjs).
(function (root) {
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  // La seule façon d'écrire un jour dans le panneau : « 24 octobre », « 1er novembre » (date locale, sans fuseau).
  function dayText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m || +m[2] < 1 || +m[2] > 12) return '';
    var day = +m[3];
    return (day === 1 ? '1er' : day) + ' ' + MONTHS[+m[2] - 1];
  }
  var shortDate = dayText;

  // Titre d'une conversation : sa première demande, ou « Photo(s) du 24 octobre ».
  function conversationTitle(text, photoCount, isoDate) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t) return t.length > 48 ? t.slice(0, 47) + '…' : t;
    if (photoCount > 1) return 'Photos du ' + shortDate(isoDate);
    if (photoCount === 1) return 'Photo du ' + shortDate(isoDate);
    return 'Conversation du ' + shortDate(isoDate);
  }

  // Questions de l'IA : toutes répondues avant l'envoi, puis une seule demande.
  function allAnswered(questions, picks) {
    return questions.every(function (_, i) { return typeof picks[i] === 'string' && picks[i] !== ''; });
  }
  // Le service accepte 500 caractères : chaque question est raccourcie d'autant qu'il faut, les réponses restent entières.
  var NOTE_MAX = 500;
  function combineAnswers(questions, picks) {
    var answers = questions.map(function (_, i) { return ' → ' + picks[i]; });
    var room = NOTE_MAX - (questions.length - 1) - answers.reduce(function (n, a) { return n + a.length; }, 0);
    var each = Math.max(10, Math.floor(room / Math.max(1, questions.length)));
    return questions.map(function (q, i) {
      var t = q.text.length > each ? q.text.slice(0, each - 1) + '…' : q.text;
      return t + answers[i];
    }).join('\n').slice(0, NOTE_MAX);
  }

  // Entrée envoie ; Maj + Entrée va à la ligne ; rien pendant une saisie composée (japonais, chinois…), où le
  // navigateur peut annoncer la touche avec le code 229 même après la fin de la composition.
  function isSendKey(e) {
    return e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229;
  }

  // Jauge d'utilisation du mois : un pourcentage, jamais de tokens ni de crédits par message.
  var PLAN_NAMES = { gratuit: 'Gratuit', plus: 'Plyo+', pro: 'Pro' };
  function resetText(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var day = d.getUTCDate();
    return 'le ' + (day === 1 ? '1er' : day) + ' ' + MONTHS[d.getUTCMonth()];
  }
  function gaugeView(g) {
    if (!g || typeof g.used_pct !== 'number') return null;
    var pct = Math.max(0, Math.min(100, Math.round(g.used_pct)));
    return {
      pct: pct,
      label: pct + ' %',
      state: ['ok', 'low', 'empty'].indexOf(g.state) >= 0 ? g.state : 'ok',
      plan: PLAN_NAMES[g.plan] || 'Gratuit',
      resets: resetText(g.resets_at)
    };
  }
  // Une seule jauge : les crédits ajoutés (recharges, offerts) l'agrandissent ; la part incluse dans la formule se
  // renouvelle chaque mois, les crédits ajoutés non utilisés restent.
  function gaugeExtraText(g) {
    var extra = g && typeof g.extra_pct === 'number' ? Math.round(g.extra_pct) : 0;
    return extra > 0 ? 'Ta jauge est agrandie de ' + extra + ' % par des crédits ajoutés : ce que tu n’en utilises pas reste le mois suivant.' : '';
  }
  function gaugeResetText(g) {
    var when = resetText(g && g.resets_at);
    return gaugeExtraText(g) ? 'La part incluse dans ta formule se renouvelle ' + when + '.' : 'Se recharge ' + when + '.';
  }
  // Message doux à afficher (« low » vers 80 %, « empty » jauge pleine), une seule fois par mois et par état.
  function noticeKey(kind, g) { return kind + ':' + g.resets_at; }
  // `prev` (si fourni) : l'état vu juste avant dans la session. On ne prévient qu'au passage d'un seuil, jamais au
  // premier relevé ni sous chaque réponse quand la jauge était déjà haute (le stockage du panneau peut manquer).
  function gaugeNotice(g, lastShown, prev) {
    var v = gaugeView(g);
    if (!v || v.state === 'ok') return null;
    if (arguments.length >= 3 && (!prev || prev === v.state)) return null;
    return lastShown === noticeKey(v.state, g) ? null : v.state;
  }

  // Ce que voit l'utilisateur pour chaque erreur, et l'action proposée (retry, credits, login).
  var ERRORS = {
    insufficient_credits: { text: 'Ta jauge du mois est pleine : je ne peux pas lancer de nouvelle demande pour l’instant.', action: 'credits' },
    unauthorized: { text: 'Ta session a expiré : reconnecte-toi, ta demande est gardée.', action: 'login' },
    network: { text: 'Je n’arrive pas à joindre le service Plyo. Vérifie ta connexion à Internet, puis réessaie.', action: 'retry' },
    timeout: { text: 'La réponse prend trop de temps. Réessaie : ta demande est gardée.', action: 'retry' },
    upstream_error: { text: 'L’IA est momentanément indisponible. Réessaie dans un instant.', action: 'retry' },
    assistant_unavailable: { text: 'Je n’ai pas pu répondre à cette demande. Essaie de la formuler autrement.', action: 'retry' },
    incomplete_answer: { text: 'Ma réponse a été coupée en route. Réessaie, ça passe en général du premier coup.', action: 'retry' },
    invalid_request: { text: 'La demande n’a pas pu partir : une photo est peut-être trop lourde ou dans un format inconnu (prends du JPEG ou du PNG).', action: 'retry' },
    auth_unavailable: { text: 'La connexion à ton compte est momentanément indisponible. Réessaie dans un instant.', action: 'retry' },
    config_missing: { text: 'Le service Plyo n’est pas prêt pour le moment. Réessaie un peu plus tard.', action: 'retry' },
    internal: { text: 'Un souci technique m’a empêché de répondre. Réessaie dans un instant.', action: 'retry' },
    request_in_progress: { text: 'Une autre demande est déjà en cours : attends sa réponse.', action: 'none' },
    invalid_image: { text: 'Cette photo n’est pas lisible (JPEG, PNG ou WebP) : reprends-la.', action: 'photo' }
  };
  // `data` : le corps de l'erreur (rate_limited porte retry_after, en secondes). `wait` : secondes avant de réessayer.
  function errorView(code, data) {
    if (code === 'rate_limited') {
      var wait = retryAfter(data, null);
      return { text: 'Trop de demandes d’un coup : réessaie dans ' + (wait ? wait + ' s.' : 'un instant.'), action: 'retry', wait: wait };
    }
    return ERRORS[code] || ERRORS.internal;
  }
  // Délai demandé par le service : champ retry_after, sinon en-tête Retry-After (secondes) ; 0 s'il manque.
  function retryAfter(data, header) {
    var v = Number(data && data.retry_after);
    if (!(v > 0)) v = Number(header);
    return v > 0 ? Math.ceil(v) : 0;
  }
  // Envoi du téléphone incomplet (champ `missing` de la récupération des photos).
  function missingPhotosText(n) {
    if (!(n > 0)) return '';
    return n > 1 ? n + ' photos n’ont pas pu être récupérées : renvoie-les depuis ton téléphone.'
      : '1 photo n’a pas pu être récupérée : renvoie-la depuis ton téléphone.';
  }

  // Flux NDJSON reçu par morceaux : une ligne JSON par événement ; une ligne illisible est ignorée.
  function ndjsonReader() {
    var buffer = '';
    function parse(line) { try { return line.trim() ? [JSON.parse(line)] : []; } catch (e) { return []; } }
    return {
      push: function (chunk) {
        buffer += chunk;
        var lines = buffer.split('\n');
        buffer = lines.pop();
        return lines.reduce(function (out, l) { return out.concat(parse(l)); }, []);
      },
      end: function () { var rest = buffer; buffer = ''; return parse(rest); }
    };
  }

  // « Ça a marché ? » : on ne demande qu'au moins 30 minutes après l'application des réglages.
  var OUTCOME_DELAY_MS = 30 * 60 * 1000;
  function outcomeDue(item, now) {
    if (!item || !item.at) return false;
    var at = new Date(item.at).getTime();
    return !isNaN(at) && now.getTime() - at >= OUTCOME_DELAY_MS;
  }

  function frValue(v) { return typeof v === 'number' ? String(v).replace('.', ',') : String(v); }

  // `labelOf(id)` → { label, unit } du réglage (lus dans le slicer), ou undefined.
  function outcomeQuestion(item, labelOf) {
    var changes = (item.changes || []).map(function (c) {
      var p = labelOf(c.id) || { label: c.id, unit: '' };
      return p.label + ' : ' + frValue(c.before) + ' → ' + frValue(c.after) + (p.unit ? ' ' + p.unit : '');
    });
    var day = shortDate(item.at || item.date);
    var text = (day ? 'Le ' + day + ', on' : 'On') + ' a changé des réglages' + (item.why ? ' pour « ' + item.why + ' »' : '') +
      '. Ta dernière impression avec ces réglages, ça a marché ?';
    return { title: 'Ça a marché ?', text: text, changes: changes };
  }

  // « Ça n'a pas marché » : remettre les valeurs d'avant, mais seulement là où la valeur essayée est encore en
  // place (un réglage changé à la main depuis n'est pas écrasé). `params` absent : tout est remis.
  function revertChanges(item, params) {
    return ((item && item.changes) || []).filter(function (c) {
      if (!params) return true;
      var p = params.find(function (x) { return x.id === c.id; });
      if (!p) return false;
      return typeof p.value === 'number' && typeof c.after === 'number' ? Math.abs(p.value - c.after) < 1e-6 : p.value === c.after;
    }).map(function (c) { return { id: c.id, value: c.before }; });
  }

  // Demande préremplie de « Chercher une autre piste » : l'IA repart du problème et de ce que l'utilisateur a vu.
  function retryPrompt(item, note) {
    return 'Les réglages essayés' + (item.why ? ' pour « ' + item.why + ' »' : '') + ' n’ont pas marché' +
      (note ? ' (' + note + ')' : '') + '. Qu’est-ce que je peux essayer d’autre ?';
  }

  // Résultat partagé (si l'utilisateur l'a accepté) : rien d'autre que le défaut, les changements, les profils et le résultat.
  function outcomePayload(item, outcome) {
    var parts = String(item.machine || '').split(' | ');
    // Noms de profils coupés à 100 caractères : le service refuse au-delà.
    return { defect: item.defect || 'unknown', changes: item.changes, printer: String(item.printer || parts[0] || '').slice(0, 100),
      filament: String(item.filament || parts[1] || '').slice(0, 100), outcome: outcome };
  }

  // Plus récente des entrées en attente de résultat qui est due (une entrée toute fraîche ne masque pas les autres).
  function firstDueOutcome(items, now) {
    var due = (items || []).filter(function (it) { return outcomeDue(it, now); });
    return due.length ? due[0] : null;
  }

  // Nouveau découpage : la signature du résultat (temps, poids, nombre de pièces) change. `prev` vaut null au
  // premier signal (point de départ, rien à signaler) ; « none » quand la plaque n'est pas découpée.
  function newSlice(prev, signals) {
    var sig = signals && signals.sliced ? [signals.time_s, signals.weight_g, signals.objects].join('|') : 'none';
    return { fire: prev !== null && sig !== 'none' && sig !== prev, sig: sig };
  }

  // Journal des pièces : une fiche par pièce (ou groupe de pièces de la plaque), la plus récente d'abord.
  function journalGroups(events) {
    var groups = {};
    (events || []).forEach(function (e) {
      var part = (e.parts || []).join(' + ') || 'Pièce sans nom';
      (groups[part] = groups[part] || { part: part, updated: '', events: [] }).events.push(e);
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.events.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      g.updated = g.events[0].at;
      return g;
    }).sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
  }

  function journalOutcome(e) {
    if (!e.changes || !e.changes.length) return 'Aucun réglage appliqué';
    return e.outcome === 'ok' ? 'A marché' : e.outcome === 'bad' ? 'N’a pas réglé le problème' : 'Résultat pas encore donné';
  }

  // Statut affiché en pastille dans « Mes pièces ».
  function journalStatus(e) {
    if (!e.changes || !e.changes.length) return { label: 'Sans réglage', tone: '' };
    return e.outcome === 'ok' ? { label: 'Réussi', tone: 'ok' } : e.outcome === 'bad' ? { label: 'Pas réglé', tone: 'bad' } : { label: 'En attente', tone: 'warn' };
  }

  // Nom court de la machine pour une liste étroite : « Bambu Lab A1 0.4 nozzle » + « Bambu PLA Basic » →
  // « A1 · PLA Basic ». Marque, buse, projet 3MF et suffixe « @BBL A1 » retirés ; un nom inconnu reste entier.
  var BRANDS = /^(bambu lab|bambu|creality|original prusa|prusa research|prusa|elegoo|anycubic|qidi|sovol|artillery|flashforge|voron|generic|polymaker|esun|sunlu)\s+/i;
  function shortName(name, nozzle) {
    var n = String(name || '').replace(/\([^()]*\.3mf\)$/i, '').replace(/\s*@.*$/, '').trim();
    if (nozzle) n = n.replace(/\s+\d+(\.\d+)?\s*nozzle$/i, '');
    var short = n.replace(BRANDS, '').trim();
    return short || n;
  }
  function shortMachine(printer, filament) {
    return [shortName(printer, true), shortName(filament, false)].filter(Boolean).join(' · ');
  }

  // Réglages à réappliquer (valeurs d'après), seulement pour l'imprimante et le filament où ils ont été trouvés,
  // et jamais s'ils n'ont pas réglé le problème.
  function reapplyChanges(e, context) {
    if (!e.changes || !e.changes.length || e.outcome === 'bad' || !context || context.printer !== e.printer || context.filament !== e.filament) return null;
    return e.changes.map(function (c) { return { id: c.id, value: c.after }; });
  }

  // Ordres exécutés par le slicer : l'outil d'Orca qui fait la même chose (« Comment le faire moi-même »).
  var COMMAND_TOOLS = { rotate: 'rotate', reset_rotation: 'rotate', lay_flat: 'lay_flat', move: 'move', center: 'move', drop: 'move',
    scale: 'scale', scale_to_size: 'scale', cut_height: 'cut' };
  function commandTool(commands) {
    var first = (commands || [])[0];
    return (first && COMMAND_TOOLS[first.op]) || null;
  }
  // Ce que l'historique de la conversation dit des ordres : faits, refusés, ou seulement demandés (non exécutés).
  function commandsForHistory(a, result) {
    if (!a.commands || !a.commands.length) return '';
    if (!result) return 'demandé : ' + a.commands.map(function (c) { return c.summary; }).join(' ');
    var lines = (result.done || []).map(function (d) { return 'fait : ' + d; });
    if (result.text) lines.push('non fait : ' + result.text);
    return lines.join('\n');
  }

  // Libellés de l'interface française d'Orca pour les réglages à choix (mêmes que plyo-api/src/lib/whitelist.ts).
  var CHOICE_LABELS = {
    'normal(auto)': 'Normal (auto)', 'tree(auto)': 'Arbre (auto)', 'normal(manual)': 'Normal (manuel)', 'tree(manual)': 'Arbre (manuel)',
    default: 'Défaut', grid: 'Grille', snug: 'Ajusté', organic: 'Organique', tree_slim: 'Arborescent Fin', tree_strong: 'Arborescent Fort', tree_hybrid: 'Arborescent Hybride',
    'no ironing': 'Pas de lissage', top: 'Surfaces supérieures', topmost: 'Surface la plus élevée', solid: 'Toutes les couches pleines',
    auto_brim: 'Auto', outer_only: 'Bordure extérieure uniquement', no_brim: 'Sans bord'
  };
  function choiceLabel(value) { return Object.prototype.hasOwnProperty.call(CHOICE_LABELS, value) ? CHOICE_LABELS[value] : value; }

  // Typographie française de tout texte affiché : sans espaces insécables, « ? » et « : » partent seuls en début
  // de ligne. Fine (U+202F) avant ? ! ; ; normale (U+00A0) avant : et dans « ». Heures (18:00) et adresses
  // (https://, ?b=1) restent intactes : la ponctuation doit être suivie d'une espace ou de la fin du texte.
  // Un nombre reste aussi collé à son unité (« 235 °C ») et le jour à son mois (« 1er novembre »).
  function fr(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/([A-Za-zÀ-ÿ])'(?=[A-Za-zÀ-ÿ])/g, '$1’')
      .replace(/(\S)[ \u00A0\u202F]?([?!;]+)(?=$|[\s»)\].,…"’])/g, '$1\u202F$2')
      .replace(/(\S)[ \u00A0\u202F]?:(?=$|\s)/g, '$1\u00A0:')
      .replace(/«[ \u00A0\u202F]?/g, '«\u00A0')
      .replace(/[ \u00A0\u202F]?»/g, '\u00A0»')
      .replace(/(\d) (?=(°C|°|mm²|mm|%|g|min|h|s|Mo|€)(?![A-Za-zÀ-ÿ0-9]))/g, '$1\u00A0')
      .replace(/(\b\d{1,2}|1er) (?=(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b)/g, '$1\u00A0');
  }

  // Le slicer parle toujours de « les pièces » : avec une seule pièce sur le plateau, le panneau dit « la pièce ».
  var SINGULAR = {
    scale_to_fit: 'J’ai réduit la pièce pour qu’elle tienne sur le plateau.',
    arrange: 'Je range la pièce sur le plateau.'
  };
  function plateText(msg, count) {
    return msg.ok && count === 1 && SINGULAR[msg.kind] ? SINGULAR[msg.kind] : msg.text;
  }

  // Étages d'une tour de calibration (reçus du bas vers le haut) montrés comme on tient la tour : le haut en
  // premier. Les tests à plat (carrés, lignes) gardent l'ordre reçu.
  function calibOrder(sections, tower) {
    var list = (sections || []).map(function (s) { return Object.assign({}, s, { where: '' }); });
    if (!tower || !list.length) return list;
    list.reverse();
    if (list.length > 1) { list[0].where = 'En haut'; list[list.length - 1].where = 'En bas'; }
    return list;
  }

  // Réponse du slicer à « conv_load » : rouvrir, donner la suite prévue, ou dire que ça n'a pas marché.
  // `auto` : réouverture au lancement, dont l'échec reste silencieux (l'accueil suffit).
  function convLoaded(msg, hasFollowUp, auto) {
    var ok = !!(msg && msg.conversation);
    return { restore: ok, followUp: ok && !!hasFollowUp, error: !ok && !auto };
  }

  var api = { gaugeExtraText: gaugeExtraText, gaugeResetText: gaugeResetText, retryAfter: retryAfter, missingPhotosText: missingPhotosText, calibOrder: calibOrder, journalStatus: journalStatus, shortMachine: shortMachine, dayText: dayText, revertChanges: revertChanges, retryPrompt: retryPrompt, plateText: plateText, fr: fr, convLoaded: convLoaded, choiceLabel: choiceLabel, commandTool: commandTool, commandsForHistory: commandsForHistory, firstDueOutcome: firstDueOutcome, newSlice: newSlice, journalGroups: journalGroups, journalOutcome: journalOutcome, reapplyChanges: reapplyChanges, outcomeDue: outcomeDue, outcomeQuestion: outcomeQuestion, outcomePayload: outcomePayload, conversationTitle: conversationTitle, allAnswered: allAnswered, combineAnswers: combineAnswers,
    gaugeView: gaugeView, gaugeNotice: gaugeNotice, noticeKey: noticeKey, errorView: errorView, ndjsonReader: ndjsonReader, isSendKey: isSendKey };
  root.PlyoLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
