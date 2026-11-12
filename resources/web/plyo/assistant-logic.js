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
    network: { text: 'Le service Plyo ne répond pas. Vérifie ta connexion ou réessaie plus tard.', action: 'retry' },
    timeout: { text: 'La réponse prend trop de temps. Réessaie : ta demande est gardée. Ce que l’IA a déjà fait peut compter sur ta jauge.', action: 'retry' },
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
  // Annuler ferme le flux : le service facture l'usage déjà publié par l'IA, sans ligne « final » (plyo-api, diagnose/route.ts).
  var CANCEL_TEXT = 'Demande annulée. Ce que l’IA a déjà fait peut compter sur ta jauge.';
  // Hors-sujet au-delà du quota gratuit du jour : débité, sans aucun autre signe que la jauge qui bouge.
  function offTopicCostNote(a) {
    return a && a.status === 'off_topic' && a.credits && a.credits.charged > 0 ? 'Cette réponse compte sur ta jauge.' : '';
  }
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

  // Un changement noté (mémoire, journal) tel qu'on le montre : « Température de buse : 220 → 210 °C », « Taux de
  // remplissage : 15 % → 20 % », « Supports activés : non → oui ». Le libellé et l'unité notés avec le changement d'abord
  // (lot 4), sinon ceux de la liste des réglages lus (`labelOf(id)` → { label, unit }), jamais une clé brute si on les connaît.
  function changeLine(c, labelOf) {
    var id = c.key || c.id, p = (labelOf && labelOf(c.id)) || {};
    var label = c.label || p.label || id, unit = c.unit || p.unit || '';
    if (typeof c.before === 'number' && typeof c.after === 'number')
      return label + ' : ' + frValue(c.before) + ' → ' + frValue(c.after) + (unit ? ' ' + unit : /temp/.test(String(id)) ? ' °C' : '');
    var show = function (v) { return typeof v === 'string' && !/^-?\d/.test(v) ? choiceLabel(v) : valueText(v, id) + (unit && typeof v === 'number' ? ' ' + unit : ''); };
    return label + ' : ' + show(c.before) + ' → ' + show(c.after);
  }

  // `labelOf(id)` → { label, unit } du réglage (lus dans le slicer), ou undefined.
  function outcomeQuestion(item, labelOf) {
    var changes = (item.changes || []).filter(function (c) { return c && (c.id || c.key); }).map(function (c) { return changeLine(c, labelOf); });
    var day = shortDate(item.at || item.date);
    var text = (day ? 'Le ' + day + ', on' : 'On') + ' a changé des réglages' + (item.why ? ' pour « ' + item.why + ' »' : '') +
      '. Ta dernière impression avec ces réglages, ça a marché ?';
    return { title: 'Ça a marché ?', text: text, changes: changes };
  }

  // « Ça n'a pas marché » : remettre les valeurs d'avant, mais seulement là où la valeur essayée est encore en
  // place (un réglage changé à la main depuis n'est pas écrasé). `params` absent : tout est remis.
  // `snapshot` (relevé du catalogue, clé d'Orca → valeur) donné : les lots du catalogue sont traités aussi (revertPlan).
  function revertChanges(item, params, snapshot) {
    if (snapshot !== undefined) return revertPlan(item, params, snapshot).changes;
    return ((item && item.changes) || []).filter(function (c) {
      if (!params) return true;
      var p = params.find(function (x) { return x.id === c.id; });
      if (!p) return false;
      return typeof p.value === 'number' && typeof c.after === 'number' ? Math.abs(p.value - c.after) < 1e-6 : p.value === c.after;
    }).map(function (c) { return { id: c.id, value: c.before }; });
  }

  // Même réglage, même valeur ? Le relevé du catalogue et la mémoire peuvent écrire autrement la même chose : « 20% » et 20,
  // 0,2 et 0.2000001. Un booléen ne vaut qu'un booléen ; « 20% » et « 20 » (un texte sans %) ne sont pas la même chose.
  function sameSetting(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
    function read(v) {
      if (typeof v === 'number') return { n: v, pct: null };
      var m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(%?)\s*$/.exec(String(v));
      return m ? { n: Number(m[1].replace(',', '.')), pct: !!m[2] } : { s: String(v).trim() };
    }
    var x = read(a), y = read(b);
    if (x.s !== undefined || y.s !== undefined) return x.s !== undefined && x.s === y.s;
    return Math.abs(x.n - y.n) < 1e-6 && (x.pct === null || y.pct === null || x.pct === y.pct);
  }
  function hasKey(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  // Changement de l'ancienne liste des réglages (`id` comme « nozzle_temp », valeurs en nombre ou choix) : il se remet par
  // un lot de cette liste. Tout le reste est un réglage du catalogue (clé d'Orca), remis par un lot du catalogue.
  function whitelistParam(c, params) {
    if (c.key || !Array.isArray(params)) return null;
    var p = params.find(function (x) { return x.id === c.id; });
    if (!p) return null;
    return typeof c.after === 'number' || typeof c.after === 'boolean' || Array.isArray(p.values) ? p : null;
  }
  // Plan du retour arrière d'une correction : `changes` (le lot à envoyer : { key, value, label, confirmed } pour le catalogue,
  // { id, value } pour l'ancienne liste), `changed` (réglages retouchés depuis : laissés tels quels, avec leur valeur
  // d'aujourd'hui), `unread` (valeur actuelle illisible : rien n'est remis sans vérifier).
  function revertPlan(item, params, snapshot) {
    var out = { changes: [], changed: [], unread: [] };
    ((item && item.changes) || []).forEach(function (c) {
      if (!c || !(c.key || c.id)) return;
      var id = c.key || c.id, wl = whitelistParam(c, params);
      var label = c.label || (wl && wl.label) || id;
      if (wl && (typeof wl.value === 'number' && typeof c.after === 'number' ? Math.abs(wl.value - c.after) < 1e-6 : wl.value === c.after)) {
        out.changes.push({ id: c.id, value: c.before });
        return;
      }
      if (hasKey(snapshot, id)) {
        if (!sameSetting(snapshot[id], c.after)) out.changed.push({ key: id, label: label, value: snapshot[id] });
        // Valeur d'avant inconnue (« nil » d'Orca) : rien à remettre pour ce réglage.
        else if (c.before !== null && c.before !== undefined) out.changes.push({ key: id, value: c.before, label: label, confirmed: true });
        return;
      }
      if (wl) out.changed.push({ key: id, label: label, value: wl.value });
      else out.unread.push({ key: id, label: label });
    });
    return out;
  }
  // Ce que dit la carte « Ça n'a pas marché » : toujours vrai, et les réglages retouchés depuis sont nommés.
  function revertText(plan) {
    var p = plan || { changes: [], changed: [], unread: [] };
    var named = listOf(p.changed.slice(0, 4).map(function (k) { return k.label + ' (' + valueText(k.value, k.key) + ')'; })
      .concat(p.changed.length > 4 ? [(p.changed.length - 4) + ' autre' + (p.changed.length > 5 ? 's' : '')] : []));
    var lead = 'C’est noté, je ne te reproposerai pas ces réglages.';
    if (p.changes.length && !p.changed.length) return lead + ' Ils sont encore appliqués : tu peux remettre ceux d’avant, puis on cherche une autre piste.';
    if (p.changes.length) return lead + ' Tu as retouché depuis : ' + named + '. Je n’y touche pas ; je peux remettre les autres comme avant.';
    if (p.changed.length) return lead + ' Tes réglages ont déjà changé depuis : ' + named + '. On peut chercher une autre piste.';
    if (p.unread.length) return lead + ' Je n’arrive pas à relire tes réglages actuels : je ne remets rien sans vérifier.';
    return lead + ' On peut chercher une autre piste.';
  }
  // Lots à envoyer pour une liste mêlant réglages du catalogue (`key`) et de l'ancienne liste (`id`) : le slicer lit un lot
  // dans un seul mode (celui du premier changement). Le catalogue d'abord.
  function batchesOf(list) {
    var items = Array.isArray(list) ? list.filter(Boolean) : [];
    return [items.filter(function (c) { return c.key; }), items.filter(function (c) { return !c.key; })].filter(function (b) { return b.length; });
  }
  // Plusieurs corrections pour la même impression (de la plus récente à la plus ancienne) : une seule, dont chaque réglage
  // part de sa valeur avant la plus ancienne et va à sa valeur après la plus récente.
  function mergeCorrections(items) {
    var list = (Array.isArray(items) ? items : []).filter(function (it) { return it && Array.isArray(it.changes); });
    if (!list.length) return null;
    var byId = {}, order = [];
    list.slice().reverse().forEach(function (it) {
      it.changes.forEach(function (c) {
        if (!c || !(c.key || c.id)) return;
        var id = c.key || c.id;
        if (!byId[id]) { byId[id] = JSON.parse(JSON.stringify(c)); order.push(id); }
        else { var keep = byId[id].before; byId[id] = JSON.parse(JSON.stringify(c)); byId[id].before = keep; }
      });
    });
    var first = list[0];
    return { machine: first.machine, at: first.at, conv: first.conv, why: first.why || '', defect: first.defect || '', printer: first.printer, filament: first.filament,
      changes: order.map(function (id) { return byId[id]; }).filter(function (c) { return !sameSetting(c.before, c.after) || typeof c.before !== typeof c.after; }) };
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
  // Une seule question par impression (UX-22). Une correction rattachée à une impression (`printed` : son projet est passé à
  // l'étape Résultat) a sa question dans ce projet : la carte se tait quand ce projet est ouvert et que son étape Résultat
  // pose la question (`openAsks`) ; projet fermé, la carte invite à l'ouvrir (`open`). Sans impression rattachée (impression
  // lancée depuis Orca, pas encore imprimé), la carte pose la question elle-même. null : rien à demander.
  function outcomeCard(items, now, openConv, openAsks) {
    var due = (items || []).filter(function (it) {
      return outcomeDue(it, now) && !(it.printed && it.conv && it.conv === openConv && openAsks);
    });
    if (!due.length) return null;
    var it = due[0];
    return { item: it, open: !!(it.printed && it.conv && it.conv !== openConv) };
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
    if (!e.changes || !e.changes.length) return e.outcome === 'ok' ? { label: 'Réussi', tone: 'ok' } : { label: 'Sans réglage', tone: '' };
    return e.outcome === 'ok' ? { label: 'Réussi', tone: 'ok' } : e.outcome === 'bad' ? { label: 'Pas réglé', tone: 'bad' } : { label: 'En attente', tone: 'warn' };
  }

  // Ligne d'une fiche : le défaut vu par l'IA, sinon ce qu'il s'est passé (pièce notée à l'export ou à « réussi », sans question).
  function journalProblem(e) {
    if (e.problem) return e.problem;
    if (e.defect) return 'Question à l’assistant';
    return e.outcome === 'ok' ? 'Imprimée, réussie' : 'Fichier préparé pour l’impression';
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
  // et jamais s'ils n'ont pas réglé le problème. `params` (réglages lus de l'ancienne liste) donné : un réglage du catalogue
  // part dans un lot du catalogue ({ key, value, label, confirmed : le bouton annonce ces valeurs }).
  function reapplyChanges(e, context, params) {
    if (!e.changes || !e.changes.length || e.outcome === 'bad' || !context) return null;
    // Orca passe sur la copie « (Plyo) » juste après une application : c'est le même profil.
    var base = (root.PlyoJourney || require('./journey-logic.js')).baseName;
    if (base(context.printer) !== base(e.printer) || base(context.filament) !== base(e.filament)) return null;
    var out = e.changes.filter(function (c) { return c && (c.key || c.id) && c.after !== null && c.after !== undefined; }).map(function (c) {
      if (c.key || (Array.isArray(params) && !whitelistParam(c, params))) return { key: c.key || c.id, value: c.after, label: c.label || c.key || c.id, confirmed: true };
      return { id: c.id, value: c.after };
    });
    return out.length ? out : null;
  }
  // Réglages réussis : ce que la remise va changer, dit avant le clic. Les températures et le débit d'abord.
  var MAIN_SETTING = /temperature|temp|flow_ratio|volumetric|pressure_advance|retraction|fan/;
  function reliablePreview(info) {
    var list = (info && Array.isArray(info.changes) ? info.changes : []).filter(function (c) { return c && c.key; });
    var count = info && typeof info.count === 'number' ? info.count : list.length;
    if (!count) return 'Tes réglages du filament sont déjà ceux de ta dernière impression réussie.';
    var main = list.filter(function (c) { return MAIN_SETTING.test(c.key); }).concat(list.filter(function (c) { return !MAIN_SETTING.test(c.key); })).slice(0, 3);
    var more = count - main.length;
    return 'Ça remet ' + count + ' réglage' + (count > 1 ? 's' : '') + ' du filament comme lors de ta dernière impression réussie : ' +
      listOf(main.map(function (c) { return (c.label || c.key) + ' (' + valueText(c.before, c.key) + ' → ' + valueText(c.after, c.key) + ')'; })
        .concat(more > 0 ? [more + ' autre' + (more > 1 ? 's' : '')] : [])) + '.';
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

  // Sous le champ de question : le rappel d'Entrée, et le compteur à l'approche de la limite (le texte ne s'allonge plus au-delà).
  function noteHint(length, max) {
    return max > 0 && length >= max - 50 ? length + ' / ' + max + ' caractères' : 'Entrée pour envoyer';
  }

  // Fin réelle d'un export : où est le fichier, et la suite. Sans nom (renommé par Orca), le dossier seul.
  function exportedText(msg, note) {
    var where = (msg.file ? '« ' + msg.file + ' »' : 'Le fichier') + ' est enregistré dans ' + (msg.folder || 'le dossier choisi') + '.';
    return where + ' Copie-le sur ta clé USB ou ta carte SD, puis lance-le depuis l’écran de ton imprimante.' + (note ? ' ' + note : '');
  }

  // Une action refusée vaut d'être relancée seule : Orca range encore le plateau (busy), ou la réduction n'a rien changé parce que la
  // vue revenait d'une plaque refusée (un second essai réduit, vu en simulation). 0 : on s'arrête, le refus est affiché.
  function plateRetryDelay(msg, tries) {
    if (!msg || msg.ok) return 0;
    if (msg.reason === 'busy' && msg.kind !== 'undo' && tries < 20) return 500;
    if (msg.reason === 'no_effect' && msg.kind === 'scale_to_fit' && tries < 1) return 600;
    return 0;
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

  // Limites du fabricant (fiche technique du filament) : phrase d'état, et lecture des quatre champs de saisie.
  function limitsLine(l) {
    var has = function (a, b) { return l && typeof l[a] === 'number' && typeof l[b] === 'number'; };
    var nozzle = has('nozzle_min', 'nozzle_max'), bed = has('bed_min', 'bed_max');
    if (!nozzle && !bed) return 'Limites du fabricant à renseigner';
    return 'Fabricant : buse ' + (nozzle ? l.nozzle_min + '–' + l.nozzle_max + ' °C' : 'à renseigner') + ', plateau ' + (bed ? l.bed_min + '–' + l.bed_max + ' °C' : 'à renseigner');
  }
  var LIMIT_TOP = { nozzle_min: 400, nozzle_max: 400, bed_min: 150, bed_max: 150 };
  function parseLimits(raw) {
    var limits = {};
    for (var key in LIMIT_TOP) {
      var text = raw && raw[key] != null ? String(raw[key]).trim() : '';
      if (!text) continue;
      var n = Number(text.replace(',', '.'));
      if (!isFinite(n) || n < 0 || n > LIMIT_TOP[key]) return { ok: false, text: 'Une température n’est pas valable (0 à ' + LIMIT_TOP[key] + ' °C).' };
      limits[key] = n;
    }
    if (limits.nozzle_min > limits.nozzle_max || limits.bed_min > limits.bed_max) return { ok: false, text: 'Le minimum doit rester sous le maximum.' };
    return { ok: true, limits: limits };
  }

  // Températures à appliquer d'après la plage de l'étiquette de la bobine : la valeur actuelle si elle y est déjà,
  // sinon le milieu de la plage arrondi à 5 °C (ou la borne connue). null : rien à changer pour cette température.
  function tempsFromRange(current, limits) {
    var c = current || {}, l = limits || {};
    function pick(now, min, max) {
      var hasMin = typeof min === 'number', hasMax = typeof max === 'number';
      if (!hasMin && !hasMax) return null;
      if (typeof now === 'number' && (!hasMin || now >= min) && (!hasMax || now <= max)) return now;
      if (hasMin && hasMax) return Math.round((min + max) / 2 / 5) * 5;
      return hasMin ? min : max;
    }
    return { nozzle: pick(c.nozzle, l.nozzle_min, l.nozzle_max), bed: pick(c.bed, l.bed_min, l.bed_max) };
  }

  // Réglages du catalogue (mode catalogue de l'API) : ils prennent la forme des propositions de la fiche, avec de quoi
  // les afficher sans dépendre de la liste des réglages lus. `confirm` : réglage sensible ; `beyond` : hors plage du fabricant.
  function catalogToSuggestions(changes) {
    if (!Array.isArray(changes)) return [];
    return changes.filter(function (c) { return c && typeof c.key === 'string'; }).map(function (c) {
      return { id: c.key, delta: null, value: c.value, reason: c.reason || '', catalog: true, label: c.title_fr || c.key, tab: c.tab_fr || '', unit: c.unit || '', before: c.before === undefined ? null : c.before, beforeText: c.before_fr || '', valueText: c.value_fr || '', confirm: !!c.needs_confirmation, beyond: !!c.beyond_manufacturer };
    });
  }
  function defaultChecked(s) { return !(s && (s.confirm || s.beyond)); }
  function groupByTab(list) {
    var groups = [], index = {};
    (list || []).forEach(function (s) {
      var tab = s.tab || '';
      if (!(tab in index)) { index[tab] = groups.length; groups.push({ tab: tab, items: [] }); }
      groups[index[tab]].items.push(s);
    });
    return groups;
  }

  // Modifications manuelles non enregistrées, enregistrées avec le lot de l'assistant : phrase de la fiche.
  function plainValue(v) { return typeof v === 'boolean' ? (v ? 'oui' : 'non') : v === null || v === undefined ? '—' : String(v); }
  function manualEditsText(list) {
    if (!Array.isArray(list) || !list.length) return '';
    function listed(items) {
      var shown = items.slice(0, 6).map(function (e) { return (e.title || e.key || '?') + ' (' + plainValue(e.before) + ' → ' + plainValue(e.after) + ')'; });
      var more = items.length - shown.length;
      return shown.join(', ') + (more > 0 ? ' et ' + more + ' autre' + (more > 1 ? 's' : '') : '') + '.';
    }
    // Les réglages de la pièce (impression) ne vont jamais dans un profil partagé : ils restent sur le plateau.
    var piece = list.filter(function (e) { return e && e.preset === 'print'; });
    var saved = list.filter(function (e) { return e && e.preset !== 'print'; });
    var out = [];
    if (saved.length) out.push('J’enregistre aussi tes modifications manuelles : ' + listed(saved));
    if (piece.length) out.push('Tes modifications manuelles de la pièce restent en place : ' + listed(piece));
    return out.join(' ');
  }
  // Réglages posés par l'assistant pour le projet de la conversation (`project.assistant`) : clé « print/wall_loops » → les
  // dernières valeurs écrites, telles qu'Orca les écrit (`written` d'un lot appliqué), avec leur lot (`batch`). Une
  // annulation retire les valeurs de son lot. Gardé avec la conversation : il tient après une réouverture.
  var WROTE_MAX = 5, WROTE_KEYS = 300;
  function noteWritten(record, written, batch) {
    var out = JSON.parse(JSON.stringify(record && typeof record === 'object' ? record : {}));
    (Array.isArray(written) ? written : []).forEach(function (w) {
      if (!w || typeof w.key !== 'string' || !w.key || typeof w.value !== 'string' || (w.scope !== 'print' && w.scope !== 'filament')) return;
      var id = w.scope + '/' + w.key;
      if (!out[id] && Object.keys(out).length >= WROTE_KEYS) return;
      out[id] = (out[id] || []).concat([{ v: w.value, b: String(batch) }]).slice(-WROTE_MAX);
    });
    return out;
  }
  function forgetBatch(record, batch) {
    var out = {};
    Object.keys(record && typeof record === 'object' ? record : {}).forEach(function (id) {
      var kept = (Array.isArray(record[id]) ? record[id] : []).filter(function (e) { return e && e.b !== String(batch); });
      if (kept.length) out[id] = kept;
    });
    return out;
  }
  // La valeur actuelle (`now`, Profiles::manual_edits) est-elle celle que l'assistant a écrite en dernier ?
  function assistantWrote(record, item) {
    var list = record && item && record[item.preset + '/' + item.key];
    return Array.isArray(list) && list.length > 0 && typeof item.now === 'string' && list[list.length - 1].v === item.now;
  }
  // Modifications non enregistrées → ce que l'utilisateur a changé lui-même (`mine`) ; celles que l'assistant a posées pour ce
  // projet sont écartées. `known` faux : relevé absent (conversation plus ancienne), on ne peut pas savoir qui les a faites.
  function splitManualEdits(items, record) {
    var list = Array.isArray(items) ? items.filter(function (e) { return e && e.key; }) : [];
    var known = !!record && typeof record === 'object' && !Array.isArray(record);
    if (!known) return { known: false, mine: list, assistant: [] };
    return { known: true, mine: list.filter(function (e) { return !assistantWrote(record, e); }), assistant: list.filter(function (e) { return assistantWrote(record, e); }) };
  }
  // Phrase de la fiche : seules les vraies modifications de l'utilisateur sont dites « tes modifications manuelles » ; les
  // réglages posés par l'assistant ne sont pas répétés ; sans relevé, une formulation neutre et vraie.
  function manualEditsNote(items, record) {
    var split = splitManualEdits(items, record);
    if (split.known) return manualEditsText(split.mine);
    function listed(list) {
      var shown = list.slice(0, 6).map(function (e) { return (e.title || e.key || '?') + ' (' + plainValue(e.before) + ' → ' + plainValue(e.after) + ')'; });
      var more = list.length - shown.length;
      return shown.join(', ') + (more > 0 ? ' et ' + more + ' autre' + (more > 1 ? 's' : '') : '') + '.';
    }
    var piece = split.mine.filter(function (e) { return e.preset === 'print'; });
    var saved = split.mine.filter(function (e) { return e.preset !== 'print'; });
    var out = [];
    if (saved.length) out.push('J’enregistre aussi les autres réglages modifiés du filament : ' + listed(saved));
    if (piece.length) out.push('Réglages de ce projet qui diffèrent du profil, gardés tels quels : ' + listed(piece));
    return out.join(' ');
  }
  // Ce que l'assistant dit après avoir enregistré (ou tenté d'enregistrer) le profil.
  function savedText(result) {
    var r = result || {};
    // Écart de températures qu'Orca refuserait : Plyo n'enregistre pas plutôt que d'ouvrir sa fenêtre.
    if (r.save_error === 'temperatures') return 'Appliqué. Je n’ai pas enregistré le filament : sa première couche et les couches suivantes auraient un écart de température qu’Orca refuse. Rapproche ces deux températures et je l’enregistrerai.';
    if (r.save_error) return 'Appliqué, mais je n’ai pas pu enregistrer le profil (' + r.save_error + '). Enregistre-le toi-même si tu veux le garder.';
    var saved = Array.isArray(r.saved) ? r.saved : [];
    // Réglages d'impression du plateau d'une conversation : gardés dans son projet 3MF, pas dans un profil partagé.
    // Sans projet de conversation, ils restent modifiés sur ce plateau (Orca demandera quoi en faire à la fermeture).
    var kept = r.in_project ? 'Gardé avec le projet de cette conversation.'
      : r.print_edited ? 'Réglages de la pièce appliqués à ce plateau seulement : ton profil d’impression ne change pas.' : '';
    if (!saved.length) return kept;
    return saved.map(function (s) {
      return s.created ? 'Enregistré dans une copie à toi, « ' + s.name + ' » : « ' + s.from + ' » est un profil d’Orca, qui ne se modifie pas.' : 'Enregistré dans le profil « ' + s.name + ' ».';
    }).concat(kept ? [kept] : []).join(' ');
  }

  // ---------- Réglages appliqués : état vrai et annulation (lot 3 de l'audit) ----------
  // Valeur d'un réglage telle qu'on la montre : oui/non, virgule décimale, « 15 % », « °C » pour une température.
  function valueText(v, key) {
    if (typeof v === 'boolean') return v ? 'oui' : 'non';
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000).replace('.', ',') + (/temp/.test(String(key || '')) ? ' °C' : '');
    return String(v).replace(/^(-?\d+(?:\.\d+)?)%$/, '$1 %').replace(/^(-?\d+)\.(\d+)/, '$1,$2');
  }
  function listOf(items) {
    return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' et ' + items[items.length - 1];
  }
  // Réglages qu'Orca a changés en plus du lot (relus après l'écriture) : ils sont annulés avec lui.
  function alsoChangedText(list) {
    var items = (Array.isArray(list) ? list : []).filter(function (a) { return a && a.key; });
    if (!items.length) return '';
    return 'Orca a aussi réglé : ' + listOf(items.map(function (a) { return (a.label || a.key) + ' (' + valueText(a.before, a.key) + ' → ' + valueText(a.after, a.key) + ')'; })) + '. « Annuler » les remet aussi.';
  }
  // Réglages ajoutés par Plyo pour qu'Orca n'ait rien à changer (mode vase, première couche…).
  function addedText(applied) {
    var items = (Array.isArray(applied) ? applied : []).filter(function (a) { return a && a.added; });
    if (!items.length) return '';
    return 'J’ai aussi réglé, pour que ça tienne : ' + listOf(items.map(function (a) { return (a.label || a.id) + ' → ' + valueText(a.after, a.id) + ' (' + a.added + ')'; })) + '.';
  }
  // Réglages retouchés à la main depuis le lot : l'annulation les a laissés tels quels.
  function keptText(kept) {
    var items = (Array.isArray(kept) ? kept : []).filter(function (k) { return k && k.key; });
    if (!items.length) return '';
    return 'J’ai laissé tels quels les réglages que tu as retouchés depuis : ' + listOf(items.map(function (k) { return (k.label || k.key) + ' (' + valueText(k.value, k.key) + ')'; })) + '.';
  }
  // Annulation refusée : un bouton par valeur d'avant (« Remettre … à … »).
  function restoreLabel(r) { return 'Remettre ' + (r.label || r.key) + ' à ' + valueText(r.value, r.key); }
  // Le lot qui remet ces valeurs : un lot du catalogue comme un autre, confirmé par le clic sur le bouton qui les annonce.
  function restoreChanges(list) {
    return (Array.isArray(list) ? list : []).filter(function (r) { return r && r.key; }).map(function (r) { return { key: r.key, value: r.value, label: r.label || r.key, confirmed: true }; });
  }
  // Lot dont les valeurs ont été annoncées par le bouton cliqué (questions d'intention, carte d'Orca) : chaque changement du
  // catalogue porte la confirmation que le slicer exige pour un grand écart ou un réglage sensible.
  function confirmedChanges(changes) {
    return (Array.isArray(changes) ? changes : []).map(function (c) { var o = {}; Object.keys(c || {}).forEach(function (k) { o[k] = c[k]; }); if (o.key) o.confirmed = true; return o; });
  }
  // Changement d'une ligne de la fiche de l'IA. Confirmé seulement si l'utilisateur l'a cochée lui-même (une ligne décochée
  // d'office : réglage sensible, hors plage ou grand écart) ou s'il a confirmé ce réglage après un refus (`confirmedKeys`).
  function sheetChange(s, confirmedKeys) {
    if (!s || !s.catalog) return s && s.delta !== null && s.delta !== undefined ? { id: s.id, delta: s.delta } : { id: s && s.id, value: s && s.value };
    var byHand = !defaultChecked(s) || (Array.isArray(confirmedKeys) && confirmedKeys.indexOf(s.id) >= 0);
    var out = { key: s.id, value: s.value, label: s.label, confirmed_outside_range: !!s.beyond && byHand, confirmed: byHand };
    if (s.unit) out.unit = s.unit; // gardée dans la mémoire avec le libellé (« Ça a marché ? », « Mes pièces »)
    return out;
  }
  // Issue d'un lot refusé : réessayer (fenêtre d'Orca ouverte, valeur remise par Orca), confirmer (grand écart ou réglage
  // sensible pas coché à la main), et montrer le réglage en cause.
  function refusalActions(result) {
    var r = result || {}, out = [];
    if (r.code === 'needs_confirmation' && r.key) out.push({ kind: 'confirm', key: r.key, label: 'Je confirme, applique quand même' });
    if (r.code === 'orca_dialog' || r.code === 'orca_refused') out.push({ kind: 'retry', label: 'Réessayer' });
    if (r.key) out.push({ kind: 'show', key: r.key, label: 'Montre-moi ce réglage' });
    return out;
  }

  // Fiche de réglages d'une réponse : archivée (relevé figé) ou applicable. Une conversation rouverte redevient active :
  // ses fiches non appliquées s'appliquent de nouveau ; une fiche déjà appliquée reste le relevé de ce jour-là.
  function sheetArchived(archived, reopened, applied) { return !!archived && !(reopened && !applied); }

  // Images collées dans le champ de saisie (capture d'écran, copie d'une image) : les éléments « fichier » de type image.
  function imageFilesFromClipboard(items) {
    var files = [];
    Array.prototype.slice.call(items || []).forEach(function (it) {
      if (it && it.kind === 'file' && typeof it.type === 'string' && it.type.indexOf('image/') === 0) {
        var file = it.getAsFile();
        if (file) files.push(file);
      }
    });
    return files;
  }

  // Profils sur lesquels les réglages ont été proposés : ceux de la demande, pas ceux du moment où l'on clique « Appliquer »
  // (l'utilisateur a pu en changer entre-temps). Le slicer refuse le lot si ce ne sont plus les profils en cours.
  function namesForApply(entryData, lastContext) {
    var n = (entryData && entryData.names) || lastContext || {};
    return { process: n.process || '', filament: n.filament || '', printer: n.printer || '' };
  }

  // Mode catalogue : des réglages envisagés par l'assistant ont été écartés par les contrôles (trop loin de la valeur actuelle,
  // hors limites). Le message de l'IA ne le sait pas : on le dit pour qu'une annonce absente de la fiche ne surprenne pas.
  function rejectedNote(a) {
    var n = a && Array.isArray(a.changes) ? a.rejected_count || 0 : 0;
    if (n < 1) return '';
    return 'J’ai écarté ' + n + ' réglage' + (n > 1 ? 's' : '') + ' que j’avais envisagé' + (n > 1 ? 's' : '') + ' : ' + (n > 1 ? 'ils s’éloignaient' : 'il s’éloignait') + ' trop de ta valeur actuelle ou ' + (n > 1 ? 'sortaient' : 'sortait') + ' des limites. Ce que le message annonce peut donc ne pas être dans la fiche ; redemande-moi par petites étapes si besoin.';
  }

  // Le bas de la réponse dépasse-t-il nettement le bas de la zone visible (plus de 24 px) ? Alors on invite à défiler.
  // `box` et `port` : { bottom } de getBoundingClientRect() ; null si la réponse n'est plus à l'écran.
  function moreBelow(box, port) {
    if (!box || !port) return false;
    return box.bottom - port.bottom > 24;
  }

  var api = { changeLine: changeLine, sameSetting: sameSetting, revertPlan: revertPlan, revertText: revertText, batchesOf: batchesOf, mergeCorrections: mergeCorrections, outcomeCard: outcomeCard, reliablePreview: reliablePreview, valueText: valueText, alsoChangedText: alsoChangedText, addedText: addedText, keptText: keptText, restoreLabel: restoreLabel, restoreChanges: restoreChanges, confirmedChanges: confirmedChanges, sheetChange: sheetChange, refusalActions: refusalActions, noteHint: noteHint, journalProblem: journalProblem, exportedText: exportedText, plateRetryDelay: plateRetryDelay, moreBelow: moreBelow, rejectedNote: rejectedNote, namesForApply: namesForApply, imageFilesFromClipboard: imageFilesFromClipboard, manualEditsText: manualEditsText, manualEditsNote: manualEditsNote, splitManualEdits: splitManualEdits, noteWritten: noteWritten, forgetBatch: forgetBatch, savedText: savedText, sheetArchived: sheetArchived, catalogToSuggestions: catalogToSuggestions, defaultChecked: defaultChecked, groupByTab: groupByTab, limitsLine: limitsLine, parseLimits: parseLimits, tempsFromRange: tempsFromRange, gaugeExtraText: gaugeExtraText, gaugeResetText: gaugeResetText, retryAfter: retryAfter, missingPhotosText: missingPhotosText, calibOrder: calibOrder, journalStatus: journalStatus, shortMachine: shortMachine, dayText: dayText, revertChanges: revertChanges, retryPrompt: retryPrompt, plateText: plateText, fr: fr, convLoaded: convLoaded, choiceLabel: choiceLabel, commandTool: commandTool, commandsForHistory: commandsForHistory, firstDueOutcome: firstDueOutcome, newSlice: newSlice, journalGroups: journalGroups, journalOutcome: journalOutcome, reapplyChanges: reapplyChanges, outcomeDue: outcomeDue, outcomeQuestion: outcomeQuestion, outcomePayload: outcomePayload, conversationTitle: conversationTitle, allAnswered: allAnswered, combineAnswers: combineAnswers,
    CANCEL_TEXT: CANCEL_TEXT, offTopicCostNote: offTopicCostNote, gaugeView: gaugeView, gaugeNotice: gaugeNotice, noticeKey: noticeKey, errorView: errorView, ndjsonReader: ndjsonReader, isSendKey: isSendKey };
  root.PlyoLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
