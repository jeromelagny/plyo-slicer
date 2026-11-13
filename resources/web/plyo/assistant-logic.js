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
    return 'Projet du ' + shortDate(isoDate);
  }

  // ---------- Mes projets (lot 8 de l'audit) ----------
  // Jour local d'une date ISO (« 12 novembre ») : une date enregistrée en UTC peut tomber la veille ou le lendemain.
  function localDay(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return dayText(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
  }
  // Une entrée de « Mes projets » : le nom de la pièce (sinon la première question), puis la date et l'étape atteinte, pour
  // qu'un débutant retrouve son projet. `item` : { title, updated, project } (liste du slicer).
  function projectEntry(item) {
    var it = item || {}, p = it.project && typeof it.project === 'object' ? it.project : null;
    var part = p && p.part && typeof p.part.name === 'string' ? p.part.name : '';
    var title = part || String(it.title || '') || 'Projet sans nom';
    var day = localDay(it.updated);
    if (!part) return { title: title, detail: day ? 'Question du ' + day : '', hasPart: false };
    var J = root.PlyoJourney || require('./journey-logic.js');
    var step = J.currentStep(p), send = p.send && typeof p.send === 'object' ? p.send : {};
    var stage;
    if (step === 'resultat') {
      var verdict = p.success ? ', réussi' : send.failed ? ', raté' : '';
      return { title: title, detail: (day ? 'Imprimé le ' + day : 'Imprimé') + verdict, hasPart: true };
    }
    if (step === 'imprimer') stage = 'prêt à imprimer';
    else if (step === 'preparer') stage = 'à préparer';
    else stage = 'à compléter';
    return { title: title, detail: [day, stage].filter(Boolean).join(' · '), hasPart: true };
  }
  // Projet à proposer de reprendre à l'ouverture du panneau : le plus récent qui a une pièce, s'il a moins de 48 h.
  var RESUME_MS = 48 * 3600 * 1000;
  function resumeCandidate(items, nowMs) {
    var list = Array.isArray(items) ? items.slice() : [];
    list.sort(function (a, b) { return String(b && b.updated || '') > String(a && a.updated || '') ? 1 : -1; });
    var pick = list.filter(function (it) { return it && it.id && it.project && it.project.part && it.project.part.name; })[0];
    if (!pick) return null;
    var at = Date.parse(pick.updated);
    return !isNaN(at) && nowMs - at >= 0 && nowMs - at < RESUME_MS ? pick : null;
  }
  // Confirmation avant de supprimer un projet (dans le panneau, jamais une fenêtre du système).
  function deleteQuestion(entry) {
    return entry && entry.hasPart ? 'Supprimer « ' + entry.title + ' » et son plateau ?' : 'Supprimer « ' + (entry && entry.title || 'ce projet') + ' » ?';
  }
  // Un ancien projet retiré pour faire de la place (limite de l'ordinateur) : dit, jamais en silence.
  function prunedText(name) {
    return 'J’ai rangé ton projet le plus ancien, « ' + name + ' », pour faire de la place : il n’est plus dans « Mes projets ». Ce que tu as imprimé reste dans « Mes pièces ».';
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
    return extra > 0 ? 'Ta jauge est agrandie de ' + extra + ' % par une recharge ou un cadeau : ce que tu n’en utilises pas reste le mois suivant.' : '';
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

  // Ce que voit l'utilisateur pour chaque erreur, et l'action proposée : retry (renvoie la même demande, même
  // identifiant), edit (« Modifier ma demande » : texte et photos remis dans le champ, rien n'est renvoyé), credits,
  // login, photo. Une demande qui échouerait de la même façon (à reformuler, trop lourde) n'a jamais « Réessayer ».
  var ERRORS = {
    // `more` : dit après la date de recharge (index.html, showError) ; ce qui reste gratuit sans jauge (aide du panneau).
    insufficient_credits: { text: 'Ta jauge du mois est pleine : je ne peux pas lancer de nouvelle demande pour l’instant.', more: 'En attendant, les étapes, les explications des réglages (le « ? ») et « Montre-moi où il est » restent gratuits.', action: 'credits' },
    unauthorized: { text: 'Ta session a expiré : reconnecte-toi, ta demande est gardée.', action: 'login' },
    network: { text: 'Le service Plyo ne répond pas. Vérifie ta connexion ou réessaie plus tard.', action: 'retry' },
    // Coupure pendant la réponse : le service a pu la finir (gardée 10 minutes par son identifiant) ou s'arrêter en route.
    stream_cut: { text: 'La connexion a été coupée pendant ma réponse. Réessaie : si elle était déjà prête, tu la récupères sans la payer une seconde fois. Sinon, ce que l’IA avait déjà fait peut compter sur ta jauge.', action: 'retry' },
    timeout: { text: 'La réponse prend trop de temps. Réessaie : ta demande est gardée. Ce que l’IA a déjà fait peut compter sur ta jauge.', action: 'retry' },
    upstream_error: { text: 'L’IA est momentanément indisponible. Réessaie dans un instant.', action: 'retry' },
    assistant_unavailable: { text: 'Je n’ai pas pu répondre à cette demande. Essaie de la formuler autrement.', action: 'edit' },
    incomplete_answer: { text: 'Ma réponse a été coupée en route. Réessaie, ça passe en général du premier coup.', action: 'retry' },
    invalid_request: { text: 'La demande n’a pas pu partir : une photo est peut-être trop lourde ou dans un format inconnu (prends du JPEG ou du PNG). Change-la, puis renvoie.', action: 'edit' },
    payload_too_large: { text: 'Tes photos sont trop lourdes ensemble : enlève-en une, puis renvoie.', action: 'edit' },
    auth_unavailable: { text: 'La connexion à ton compte est momentanément indisponible. Réessaie dans un instant.', action: 'retry' },
    config_missing: { text: 'Le service Plyo n’est pas prêt pour le moment. Réessaie un peu plus tard.', action: 'retry' },
    internal: { text: 'Un souci technique m’a empêché de répondre. Réessaie dans un instant.', action: 'retry' },
    // Après plusieurs essais espacés (inProgressDelay) : la même demande, ou une autre de ce compte, tourne encore.
    request_in_progress: { text: 'Une demande est encore en cours chez moi : la tienne n’a pas pu partir. Réessaie dans une minute : tu ne paieras pas deux fois.', action: 'retry' },
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

  // ---------- Une question, un identifiant de demande (plyo-api : request_id, réponses gardées 10 minutes) ----------
  // UUID v4 (forme 8-4-4-4-12 en hexadécimal) : crypto.randomUUID s'il existe, sinon 16 octets de getRandomValues,
  // sinon Math.random (repli : l'identifiant sert à ne pas payer deux fois la même question, pas à la sécurité).
  function formatUuid(bytes) {
    var b = [];
    for (var i = 0; i < 16; i++) b.push((bytes[i] | 0) & 255);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = b.map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function newRequestId(cryptoObj, random) {
    try {
      if (cryptoObj && typeof cryptoObj.randomUUID === 'function') { var u = cryptoObj.randomUUID(); if (UUID_RE.test(u)) return u.toLowerCase(); }
    } catch (e) { /* repli ci-dessous */ }
    var bytes = new Array(16);
    try {
      if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') { var a = cryptoObj.getRandomValues(new Uint8Array(16)); for (var i = 0; i < 16; i++) bytes[i] = a[i]; return formatUuid(bytes); }
    } catch (e2) { /* repli ci-dessous */ }
    var rnd = random || Math.random;
    for (var j = 0; j < 16; j++) bytes[j] = Math.floor(rnd() * 256);
    return formatUuid(bytes);
  }
  // Le service garde une réponse réglée 10 minutes : au-delà, renvoyer la question est une nouvelle demande.
  var REPLY_KEEP_MS = 10 * 60 * 1000;
  // Question restée sans réponse (application fermée pendant la réponse) : même identifiant si l'envoi date de moins de
  // 10 minutes (la réponse est peut-être gardée par le service), sinon un nouveau.
  function resendRequestId(pending, now, fresh) {
    var at = pending && pending.at ? new Date(pending.at).getTime() : NaN;
    var age = now.getTime() - at;
    return pending && UUID_RE.test(pending.id || '') && !isNaN(at) && age >= 0 && age < REPLY_KEEP_MS ? pending.id : fresh;
  }
  // La même question renvoyée telle quelle depuis le champ (« Modifier ma demande » sans rien changer) garde son
  // identifiant ; un mot ou une photo de différence en fait une nouvelle. `a.photos === null` : question rouverte dont
  // les photos d'origine sont perdues (seules les vignettes sont gardées) : le même texte avec des photos rejointes compte.
  function sameQuestion(a, b) {
    if (!a || !b || String(a.note || '').trim() !== String(b.note || '').trim()) return false;
    if (a.photos === null) return !!(b.photos && b.photos.length);
    var pa = a.photos || [], pb = b.photos || [];
    return pa.length === pb.length && pa.every(function (p, i) { return p && pb[i] && p.data === pb[i].data; });
  }
  // Même demande en cours (409 request_in_progress) : nouveaux essais espacés avec le MÊME identifiant ; 0 = abandon.
  // ≈ 2 minutes en tout : assez pour qu'une réponse lancée juste avant finisse, sans laisser attendre sans fin.
  var IN_PROGRESS_DELAYS_S = [3, 5, 10, 15, 20, 30, 30];
  function inProgressDelay(attempt) { return (IN_PROGRESS_DELAYS_S[attempt] || 0) * 1000; }

  // Texte d'attente selon le temps passé : la réponse peut prendre plusieurs minutes (recherches dans le catalogue),
  // l'utilisateur doit voir que ça avance. `phase` : 'retry' quand on récupère une demande déjà en cours.
  function waitingText(elapsedMs, hasPhotos, phase) {
    if (phase === 'retry') return 'Ta demande est déjà en route : j’attends sa réponse…';
    if (elapsedMs < 20000) return hasPhotos ? 'Je regarde ta photo…' : 'Je réfléchis…';
    if (elapsedMs < 60000) return 'Je cherche encore…';
    if (elapsedMs < 150000) return 'Je cherche encore : ça prend un peu plus de temps que d’habitude.';
    return 'Je cherche toujours, c’est une question qui demande du travail. Tu peux annuler si tu préfères.';
  }

  // ---------- Taille de la demande (plyo-api : 4 000 000 octets au plus, 413 payload_too_large) ----------
  // Au-delà de 4,5 Mo, l'hébergeur refuse sans en-têtes CORS : le panneau y verrait une coupure. On mesure donc avant
  // d'envoyer, avec une marge, et on réduit les photos par paliers.
  var MAX_SEND_BYTES = 3800000;
  var SHRINK_STEPS = [{ side: 1280, quality: 0.75 }, { side: 1024, quality: 0.7 }, { side: 800, quality: 0.65 }];
  // Octets UTF-8 d'un texte (le corps JSON, photos en base64 comprises).
  function utf8Bytes(s) {
    s = String(s);
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  // Que faire d'un corps de `bytes` octets, `tried` paliers de réduction déjà faits ? `limit` : plafond (413 : celui du
  // service, avec la même marge). { send } | { shrink: palier } | { tooBig } — sans photo, rien à réduire.
  function sizePlan(bytes, tried, hasPhotos, limit) {
    var max = limit > 0 ? limit : MAX_SEND_BYTES;
    if (bytes <= max) return { send: true };
    if (hasPhotos && tried < SHRINK_STEPS.length) return { shrink: SHRINK_STEPS[tried], step: tried + 1 };
    return { tooBig: true };
  }
  // Plafond de 413 : max_bytes du service moins 5 % (le corps renvoyé doit passer franchement), sinon le nôtre.
  function limitFrom413(data) {
    var max = Number(data && data.max_bytes);
    return max > 0 ? Math.min(MAX_SEND_BYTES, Math.floor(max * 0.95)) : MAX_SEND_BYTES;
  }

  // ---------- Question restée sans réponse (application fermée pendant la réponse) ----------
  function unansweredView(pending) {
    var n = pending && pending.photos > 0 ? pending.photos : 0;
    var text = 'Je n’ai pas pu te répondre : l’application a été fermée pendant que je cherchais.';
    if (n) text += n > 1 ? ' Ta question avait ' + n + ' photos : je n’en garde que les vignettes, rejoins-les avant de la renvoyer.'
      : ' Ta question avait une photo : je n’en garde que la vignette, rejoins-la avant de la renvoyer.';
    return { text: text, photos: n };
  }
  // Projet changé dans Orca pendant une réponse (project_changed) : rien n'est fait sur le nouveau projet.
  function projectSwitchText(hadCommands, answered) {
    if (!answered) return 'Tu as ouvert un autre projet pendant que je cherchais : ta question est restée sans réponse. Je l’ai remise dans le champ : renvoie-la si elle vaut aussi pour ce projet.';
    return 'Tu as ouvert un autre projet pendant que je répondais' + (hadCommands ? ' : je n’ai pas exécuté les ordres prévus pour l’ancien.' : '.') +
      ' Ma réponse est gardée avec l’ancien projet, dans « Mes projets ».';
  }
  var STALE_PROJECT_TEXT = 'Tu as ouvert un autre projet dans Orca : je ne change rien tant que ma réponse n’est pas terminée. Ensuite, je repars sur ce projet.';

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

  // « Annuler » des réglages de préparation après « Oui, c'est réussi » (N4) : ce que le clic défait, dit avant.
  var UNDO_AFTER_SUCCESS = 'Ces réglages ont donné une impression réussie. Les annuler remet ceux d’avant : il faudra découper à nouveau avant de réimprimer. Tu veux vraiment les annuler ?';

  // Ordres exécutés par le slicer : l'outil d'Orca qui fait la même chose (« Comment le faire moi-même »).
  var COMMAND_TOOLS = { rotate: 'rotate', reset_rotation: 'rotate', lay_flat: 'lay_flat', move: 'move', center: 'move', drop: 'move',
    scale: 'scale', scale_to_size: 'scale', cut_height: 'cut' };
  function commandTool(commands) {
    var first = (commands || [])[0];
    return (first && COMMAND_TOOLS[first.op]) || null;
  }
  // Texte d'un ordre sur le plateau (N1) : la phrase de l'IA (`summary`), sinon une phrase de Plyo d'après l'ordre et sa valeur.
  // Le slicer rend ce texte pour chaque ordre fait : une coche n'est jamais sans texte.
  function num(v) { var n = Number(v); return isFinite(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : ''; }
  var COMMAND_TEXTS = {
    scale: function (c) { return num(c.amount) ? 'Pièce mise à ' + num(c.amount) + ' % de sa taille' : 'Pièce redimensionnée'; },
    scale_to_size: function (c) { return num(c.amount) ? 'Pièce redimensionnée à ' + num(c.amount) + ' mm' : 'Pièce redimensionnée'; },
    rotate: function (c) { return num(c.amount) ? 'Pièce tournée de ' + num(c.amount) + '°' : 'Pièce tournée'; },
    lay_flat: function () { return 'Pièce posée à plat'; },
    reset_rotation: function () { return 'Rotation de la pièce remise à zéro'; },
    move: function (c) { return num(c.amount) ? 'Pièce déplacée de ' + num(c.amount) + ' mm' : 'Pièce déplacée'; },
    center: function () { return 'Pièce centrée sur le plateau'; },
    drop: function () { return 'Pièce reposée sur le plateau'; },
    mirror: function () { return 'Pièce retournée en miroir'; },
    set_copies: function (c) { return num(c.amount) ? num(c.amount) + ' exemplaire' + (Number(c.amount) > 1 ? 's' : '') + ' sur le plateau' : 'Nombre d’exemplaires changé'; },
    fill_bed: function () { return 'Plateau rempli d’exemplaires'; },
    delete: function () { return 'Pièce retirée du plateau'; },
    rename: function (c) { return typeof c.text === 'string' && c.text ? 'Pièce renommée « ' + c.text + ' »' : 'Pièce renommée'; },
    printable: function (c) { return Number(c.amount) >= 0.5 ? 'Pièce remise à imprimer' : 'Pièce mise de côté : elle ne sera pas imprimée'; },
    split: function () { return 'Pièce séparée en morceaux'; },
    inch_to_mm: function () { return 'Taille convertie de pouces en millimètres'; },
    cut_height: function (c) { return num(c.amount) ? 'Pièce coupée à ' + num(c.amount) + ' mm de hauteur' : 'Pièce coupée'; },
    object_setting: function () { return 'Réglage changé pour cette pièce'; },
    range_setting: function () { return 'Réglage changé pour une partie de la pièce'; },
    select: function () { return 'Pièce sélectionnée'; },
    orient: function () { return 'Plaque orientée automatiquement'; },
    arrange: function () { return 'Plateau rangé'; },
    scale_to_fit: function () { return 'Pièce réduite pour tenir sur le plateau'; },
    slice: function () { return 'Découpe lancée'; }
  };
  function commandSummary(c) {
    var x = c || {};
    if (typeof x.summary === 'string' && x.summary.trim()) return x.summary;
    return COMMAND_TEXTS[x.op] ? COMMAND_TEXTS[x.op](x) : 'Changement fait sur le plateau';
  }
  // Ce que l'historique de la conversation dit des ordres : faits, refusés, ou seulement demandés (non exécutés).
  function commandsForHistory(a, result) {
    if (!a.commands || !a.commands.length) return '';
    if (!result) return 'demandé : ' + a.commands.map(commandSummary).join(' ');
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
  // Libellés français des valeurs à choix, par réglage (N5) : extraits du catalogue des réglages Filament et Impression
  // (src/plyo/catalog/generate_catalog.py, champs `values` et `values_fr`), pour ne plus montrer « aligned → back ».
  var ENUM_LABELS = {"seam_position":{"nearest":"La plus proche","aligned":"Alignée","aligned_back":"Aligné à l'arrière","back":"Arrière","random":"Aléatoire"},"seam_slope_type":{"none":"Aucun","external":"Contour","all":"Contour et trou"},"enable_arc_fitting":{"disabled":"Désactivé","enabled":"Activé","sparse_infill":"Sparse infill only"},"ironing_type":{"no ironing":"Pas de lissage","top":"Surfaces supérieures","topmost":"Surface la plus élevée","solid":"Toutes les couches pleines"},"ironing_pattern":{"rectilinear":"Rectiligne","concentric":"Concentrique"},"wall_generator":{"classic":"Classique","arachne":"Arachné"},"wall_sequence":{"inner wall/outer wall":"Intérieur/Extérieur","outer wall/inner wall":"Extérieur/Intérieur","inner-outer-inner wall":"Intérieur/Extérieur/Intérieur"},"wall_direction":{"ccw":"Sens inverse des aiguilles d’une montre","cw":"Dans le sens des aiguilles d’une montre"},"enable_extra_bridge_layer":{"disabled":"Désactivé","external_bridge_only":"Pont externe uniquement","internal_bridge_only":"Pont interne uniquement","apply_to_all":"Appliquer à tous"},"dont_filter_internal_bridges":{"disabled":"Filtrer","limited":"Filtrage limité","nofilter":"Pas de filtrage"},"top_surface_pattern":{"monotonic":"Monotone","monotonicline":"Ligne monotone","rectilinear":"Rectiligne","alignedrectilinear":"Rectiligne Aligné","concentric":"Concentrique","spiralinset":"Spirale décalée","hilbertcurve":"Courbe de Hilbert","archimedeanchords":"Spirale d'Archimède","octagramspiral":"Spirale Octagramme"},"top_surface_fill_order":{"default":"Défaut","outward":"Vers l'extérieur","inward":"Vers l'intérieur"},"top_surface_expansion_direction":{"inward_and_outward":"Vers l'intérieur et l'extérieur","inward":"Vers l'intérieur","outward":"Vers l'extérieur"},"center_of_surface_pattern":{"each_surface":"Chaque surface","each_model":"Chaque modèle","each_assembly":"Chaque assemblage"},"sparse_infill_pattern":{"rectilinear":"Rectiligne","alignedrectilinear":"Rectiligne Aligné","zigzag":"Zig Zag","crosszag":"Zig Zag croisé","lockedzag":"Zig Zag verrouillé","line":"Ligne","grid":"Grille","triangles":"Triangles","tri-hexagon":"Tri-hexagone","cubic":"Cubique","adaptivecubic":"Cubique adaptatif","quartercubic":"Quartier Cubique","supportcubic":"Support Cubique","lightning":"Lightning","honeycomb":"Nid d'abeille","3dhoneycomb":"Nid d'abeille 3D","lateral-honeycomb":"Nid d'abeille latéral","lateral-lattice":"Treillis 2D","crosshatch":"Quadrillage","tpmsd":"TPMS-D","tpmsfk":"TPMS-FK","gyroid":"Gyroïde","concentric":"Concentrique","hilbertcurve":"Courbe de Hilbert","archimedeanchords":"Spirale d'Archimède","octagramspiral":"Spirale Octagramme"},"adaptive_infill_mode":{"disabled":"Désactivé","distance_warp":"Déformation selon la distance","smooth_blend":"Fondu lisse","stepped_shells":"Coques étagées","lobes":"Lobes","normal_z":"Normale Z","normal_y":"Normale Y","normal_x":"Normale X"},"adaptive_infill_gradient":{"linear":"Linéaire","quadratic":"Quadratique","exponential":"Exponentiel"},"gap_fill_target":{"everywhere":"Partout","topbottom":"Surfaces supérieure et inférieure","nowhere":"Nulle part"},"ensure_vertical_shell_thickness":{"none":"Aucun","ensure_critical_only":"Critique seulement","ensure_moderate":"Modéré","ensure_all":"Tous"},"support_type":{"normal(auto)":"Normal (auto)","tree(auto)":"Arbre (auto)","normal(manual)":"Normal (manuel)","tree(manual)":"Arbre (manuel)"},"support_style":{"default":"Défaut (Grille/Organique)","grid":"Grille","snug":"Ajusté","organic":"Organique","tree_slim":"Arborescent Fin","tree_strong":"Arborescent Fort","tree_hybrid":"Arborescent Hybride"},"support_ironing_pattern":{"rectilinear":"Rectiligne","concentric":"Concentrique"},"support_base_pattern":{"default":"Défaut","rectilinear":"Rectiligne","rectilinear-grid":"Grille rectiligne","honeycomb":"Nid d'abeille","lightning":"Lightning","hollow":"Creux"},"support_interface_pattern":{"auto":"Défaut","rectilinear":"Rectiligne","concentric":"Concentrique","spiralinset":"Spirale décalée","rectilinear_interlaced":"Rectiligne Entrelacé","grid":"Grille"},"skirt_type":{"combined":"Combiné","perobject":"Par objet"},"draft_shield":{"disabled":"Désactivé","enabled":"Activé"},"brim_type":{"auto_brim":"Auto","outer_only":"Bordure extérieure uniquement","no_brim":"Sans bord"},"slicing_mode":{"regular":"Standard","even_odd":"Pair-impair","close_holes":"Combler les trous"},"print_sequence":{"by layer":"Par couche","by object":"Par objet"},"print_order":{"default":"Défaut","as_obj_list":"En tant que liste d’objets","best_of":"Meilleur de tous (trajet le plus court)","snake":"Serpentin"},"fuzzy_skin":{"none":"Peint uniquement","external":"Contour","hole":"Trou","all":"Contour et trou","allwalls":"Toutes les parois","disabled_fuzzy":"Désactivé"},"fuzzy_skin_mode":{"displacement":"Déplacement","extrusion":"Extrusion","combined":"Combiné"},"fuzzy_skin_noise_type":{"classic":"Classique","perlin":"Perlin","billow":"Billow","ridgedmulti":"Multifractal strié","voronoi":"Voronoi","ripple":"Ripple"},"filament_z_hop_types":{"Auto Lift":"Auto","Normal Lift":"Normal","Slope Lift":"Pente","Spiral Lift":"Spirale"},"filament_retract_lift_enforce":{"All Surfaces":"Toutes les surfaces","Top Only":"Supérieures","Bottom Only":"Inférieures","Top and Bottom":"Supérieures et Inférieures"}};
  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  // `key` (facultatif) : le réglage, pour prendre le libellé de sa liste de choix ; sinon la table commune ci-dessus.
  function choiceLabel(value, key) {
    if (key && has(ENUM_LABELS, key) && has(ENUM_LABELS[key], value)) return ENUM_LABELS[key][value];
    return has(CHOICE_LABELS, value) ? CHOICE_LABELS[value] : value;
  }

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
    return max > 0 && length >= max - 50 ? length + ' / ' + max + ' caractères' : 'Entrée pour envoyer (utilise ta jauge)';
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
    if (r.save_error) return r.save_spool ? 'Appliqué, mais je n’ai pas pu le garder dans ta bobine (' + r.save_error + ') : je réessaie à ta prochaine modification.'
      : 'Appliqué, mais je n’ai pas pu le garder dans ton profil de filament (' + r.save_error + ') : il reste en place sur ce plateau, et Orca te demandera quoi en faire en quittant.';
    var saved = Array.isArray(r.saved) ? r.saved : [];
    // Réglages d'impression du plateau d'une conversation : gardés dans son projet 3MF, pas dans un profil partagé.
    // Sans projet de conversation, ils restent modifiés sur ce plateau (Orca demandera quoi en faire à la fermeture).
    var kept = r.in_project ? 'Réglages de la pièce gardés avec ce projet.'
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
    if (key && has(ENUM_LABELS, key) && has(ENUM_LABELS[key], v)) return ENUM_LABELS[key][v]; // valeur à choix : son libellé français (N5)
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


  // ---------- Lot 6 : contexte envoyé à l'IA, et actions que ce panneau sait exécuter ----------

  // Réglages de la liste blanche envoyés au service : valeur et unité, plus la clé d'Orca réellement utilisée (clé de plateau
  // résolue), le plafond propre à la machine et les choix permis, que le C++ lit déjà (read_params).
  function diagnoseParams(params) {
    return (Array.isArray(params) ? params : []).filter(function (p) { return p && typeof p.id === 'string'; }).map(function (p) {
      var out = { id: p.id, value: p.value, unit: p.unit };
      if (typeof p.key === 'string' && p.key) out.key = p.key;
      if (typeof p.max === 'number' && isFinite(p.max)) out.max = p.max;
      if (Array.isArray(p.values) && p.values.length) out.values = p.values.filter(function (v) { return typeof v === 'string'; }).slice(0, 50);
      return out;
    });
  }

  // Contexte de la demande : noms des préréglages (valeurs lues), plus ce que le slicer a lu juste avant (déjà filtré par le C++,
  // ContextLogic) ; seuls les champs attendus et non vides passent.
  var CONTEXT_EXTRAS = { bed_type: 'string', bed_temp_keys: 'array', filament_type: 'string', filament_vendor: 'string', printer_facts: 'object' };
  function aiContext(base, extras) {
    var out = Object.assign({}, base || {});
    var x = extras && typeof extras === 'object' ? extras : {};
    Object.keys(CONTEXT_EXTRAS).forEach(function (k) {
      var v = x[k], want = CONTEXT_EXTRAS[k];
      if (want === 'string' && typeof v === 'string' && v.trim()) out[k] = v;
      else if (want === 'array' && Array.isArray(v) && v.length) out[k] = v.slice();
      else if (want === 'object' && v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) out[k] = Object.assign({}, v);
    });
    return out;
  }

  // Historique renvoyé à l'IA : chaque réponse qui proposait des réglages dit ce qu'il en est advenu (IA-22).
  var CARDS_TEXT = { applied: 'réglages proposés : appliqués', undone: 'réglages proposés : appliqués puis annulés', proposed: 'réglages proposés : pas appliqués' };
  function historyForAI(history) {
    return (Array.isArray(history) ? history : []).map(function (h) {
      var text = String(h && h.text || '');
      var line = h && h.role === 'assistant' ? CARDS_TEXT[h.cards] : '';
      if (line) text = text.slice(0, 2000 - line.length - 1) + '\n' + line; // la ligne d'état n'est jamais coupée
      return { role: h && h.role === 'assistant' ? 'assistant' : 'user', text: text.slice(0, 2000) };
    });
  }

  // Capacités annoncées au service : seulement ce que ce panneau exécute vraiment (actions ci-dessous).
  var CAPABILITIES = ['show_preview', 'open_calibration'];
  var SHOW_TARGETS = ['printer', 'filament', 'slice', 'print', 'plate', 'preview'];
  var TOOL_TARGETS = ['move', 'rotate', 'scale', 'lay_flat', 'cut', 'paint_supports', 'paint_seam', 'paint_color', 'fuzzy_skin', 'text', 'svg', 'measure',
    'assembly', 'boolean', 'simplify', 'brim_ears'];
  var RAW_TESTS = ['max_flow', 'vfa', 'tolerance'];
  // Une action que ce panneau ne sait pas exécuter (service plus récent, cible inconnue) n'a jamais de bouton.
  function actionSupported(a) {
    if (!a || typeof a.kind !== 'string' || typeof a.label !== 'string' || !a.label.trim()) return false;
    var t = a.target;
    if (a.kind === 'show') return SHOW_TARGETS.indexOf(t) >= 0;
    if (a.kind === 'open_calibration') return RAW_TESTS.indexOf(t) >= 0;
    if (a.kind === 'open_tool') return TOOL_TARGETS.indexOf(t) >= 0;
    if (a.kind === 'show_setting') return typeof t === 'string' && /^[a-z][a-z0-9_]{1,59}$/.test(t);
    return ['orient', 'arrange', 'scale_to_fit', 'slice', 'remember_success'].indexOf(a.kind) >= 0;
  }

  // Tests bruts d'Orca : ce qui va se passer (dit AVANT, avec une confirmation), puis comment lire le test et revenir à sa pièce.
  var RAW_TEST_TEXT = {
    max_flow: {
      name: 'Débit maximal',
      before: 'Ce test ouvre une fenêtre d’Orca et remplace ta plaque par la pièce de test. Ta pièce reste rangée dans ce projet : tu la retrouveras dans « Mes projets ».',
      after: 'Imprime la tour de test. Repère la hauteur juste sous les premiers défauts (la surface passe de brillante à mate, ou se creuse). Ton débit maximal en mm³/s = départ + hauteur mesurée × pas : avec les valeurs proposées par Orca (départ 5, pas 0,5), 19 mm donnent 14,5. Garde 10 à 20 % de moins, et mets-le dans « Vitesse volumétrique maximale » de ton filament. Si tu hésites, envoie-moi une photo de la tour.'
    },
    vfa: {
      name: 'VFA',
      before: 'Ce test ouvre une fenêtre d’Orca et remplace ta plaque par la pièce de test. Ta pièce reste rangée dans ce projet : tu la retrouveras dans « Mes projets ».',
      after: 'Imprime la tour de test : chaque bloc est imprimé plus vite que celui du dessous. Regarde les parois en lumière rasante : les blocs couverts de fines stries verticales régulières montrent les vitesses à éviter pour les parois extérieures. Si tu hésites, envoie-moi une photo de la tour.'
    },
    tolerance: {
      name: 'Test de tolérance Orca',
      before: 'J’ajoute la pièce « Test de tolérance Orca » sur ta plaque, à côté de ta pièce. Rien n’est remplacé.',
      after: 'Imprime la pièce, puis essaie d’enfoncer chaque tige dans son trou : le plus petit jeu où elle entre sans forcer est celui à prévoir dans tes modèles. Pour la retirer de la plaque, clique dessus puis appuie sur la touche Suppr de ton clavier.'
    }
  };
  function rawTestText(target) { return RAW_TEST_TEXT[target] || null; }
  // Réponse du slicer à « open_calibration » : texte, ton, et faut-il proposer de revenir à la pièce d'avant ?
  function rawTestResult(msg) {
    var t = rawTestText(msg && msg.target);
    if (!msg || !msg.ok) return { tone: 'error', text: (msg && msg.text) || 'Je n’ai pas pu ouvrir ce test.', back: false };
    if (!t) return { tone: 'error', text: 'Je ne connais pas ce test.', back: false };
    if (msg.target === 'tolerance') return { tone: 'ok', text: 'La pièce « ' + t.name + ' » est sur ta plaque' + (msg.arranged ? ' ; j’ai organisé la plaque pour qu’elle ne touche pas ta pièce' : '') + '. ' + t.after, back: false };
    if (!msg.replaced) return { tone: 'info', text: 'Tu as fermé la fenêtre d’Orca sans lancer le test : ta plaque n’a pas changé.', back: false };
    return { tone: 'ok', text: 'Le test « ' + t.name + ' » est sur la plaque. ' + t.after + ' Pour retrouver ta pièce ensuite : menu « ⋯ », « Mes projets », puis ton projet.', back: true };
  }
  // Réponse du slicer à « show_preview ».
  function previewText(msg) {
    if (!msg || !msg.ok) return (msg && msg.text) || 'Je n’ai pas pu ouvrir l’aperçu.';
    if (!msg.sliced) return 'J’ai ouvert l’onglet « Aperçu », mais la plaque n’est pas encore découpée : il reste vide. Clique sur « Découper la plaque », puis reviens-y.';
    return 'J’ai ouvert l’onglet « Aperçu » : fais glisser le curseur à droite pour voir les couches une par une. Pour revenir à ta pièce, clique sur l’onglet « Préparer ».';
  }

  // ---------- Enregistrements (lot 12 de l'audit, ROB-16 et ROB-17) ----------
  // Projet non enregistré : la vraie raison donnée par le slicer (`reason` de conv_save_failed), et quoi faire.
  var SAVE_FAILED_TEXT = {
    too_big: 'Ce projet est devenu trop long pour être gardé : commence un nouveau projet depuis le menu « ⋯ ».',
    write_failed: 'Je n’arrive plus à enregistrer ce projet sur ton ordinateur (disque plein, ou dossier protégé). Ce qui est affiché reste là tant que Plyo est ouvert : libère de la place sur le disque, puis continue, j’enregistrerai de nouveau tout seul.',
    invalid: 'Je n’ai pas pu enregistrer ce projet. Continue : ce qui est affiché reste là. Si ce message revient, redémarre Plyo.'
  };
  // Raison inconnue (slicer d'avant le lot 12 : pas de `reason`) : la phrase d'avant, « trop long ».
  function saveFailedText(reason) { return SAVE_FAILED_TEXT[reason] || SAVE_FAILED_TEXT.too_big; }
  // Une autre instance de Plyo utilise déjà le même dossier de données (message other_instance du slicer).
  var OTHER_INSTANCE_TEXT = 'Plyo Slicer est ouvert deux fois sur cet ordinateur. Ferme l’une des deux fenêtres : sinon, ce que tu enregistres ici (projets, réglages notés) peut effacer ce que tu fais dans l’autre.';

  var api = { shortName: shortName, ENUM_LABELS: ENUM_LABELS, UNDO_AFTER_SUCCESS: UNDO_AFTER_SUCCESS, commandSummary: commandSummary, saveFailedText: saveFailedText, OTHER_INSTANCE_TEXT: OTHER_INSTANCE_TEXT, diagnoseParams: diagnoseParams, aiContext: aiContext, historyForAI: historyForAI, CAPABILITIES: CAPABILITIES, actionSupported: actionSupported, rawTestText: rawTestText, rawTestResult: rawTestResult, previewText: previewText,
    changeLine: changeLine, sameSetting: sameSetting, revertPlan: revertPlan, revertText: revertText, batchesOf: batchesOf, mergeCorrections: mergeCorrections, outcomeCard: outcomeCard, reliablePreview: reliablePreview, valueText: valueText, alsoChangedText: alsoChangedText, addedText: addedText, keptText: keptText, restoreLabel: restoreLabel, restoreChanges: restoreChanges, confirmedChanges: confirmedChanges, sheetChange: sheetChange, refusalActions: refusalActions, noteHint: noteHint, journalProblem: journalProblem, exportedText: exportedText, plateRetryDelay: plateRetryDelay, moreBelow: moreBelow, rejectedNote: rejectedNote, namesForApply: namesForApply, imageFilesFromClipboard: imageFilesFromClipboard, manualEditsText: manualEditsText, manualEditsNote: manualEditsNote, splitManualEdits: splitManualEdits, noteWritten: noteWritten, forgetBatch: forgetBatch, savedText: savedText, sheetArchived: sheetArchived, catalogToSuggestions: catalogToSuggestions, defaultChecked: defaultChecked, groupByTab: groupByTab, limitsLine: limitsLine, parseLimits: parseLimits, tempsFromRange: tempsFromRange, gaugeExtraText: gaugeExtraText, gaugeResetText: gaugeResetText, retryAfter: retryAfter, missingPhotosText: missingPhotosText, calibOrder: calibOrder, journalStatus: journalStatus, shortMachine: shortMachine, dayText: dayText, revertChanges: revertChanges, retryPrompt: retryPrompt, plateText: plateText, fr: fr, convLoaded: convLoaded, choiceLabel: choiceLabel, commandTool: commandTool, commandsForHistory: commandsForHistory, firstDueOutcome: firstDueOutcome, newSlice: newSlice, journalGroups: journalGroups, journalOutcome: journalOutcome, reapplyChanges: reapplyChanges, outcomeDue: outcomeDue, outcomeQuestion: outcomeQuestion, outcomePayload: outcomePayload, conversationTitle: conversationTitle, projectEntry: projectEntry, resumeCandidate: resumeCandidate, RESUME_MS: RESUME_MS, deleteQuestion: deleteQuestion, prunedText: prunedText, allAnswered: allAnswered, combineAnswers: combineAnswers,
    newRequestId: newRequestId, formatUuid: formatUuid, resendRequestId: resendRequestId, sameQuestion: sameQuestion, inProgressDelay: inProgressDelay, waitingText: waitingText,
    utf8Bytes: utf8Bytes, sizePlan: sizePlan, limitFrom413: limitFrom413, MAX_SEND_BYTES: MAX_SEND_BYTES, SHRINK_STEPS: SHRINK_STEPS, unansweredView: unansweredView, projectSwitchText: projectSwitchText, STALE_PROJECT_TEXT: STALE_PROJECT_TEXT,
    CANCEL_TEXT: CANCEL_TEXT, offTopicCostNote: offTopicCostNote, gaugeView: gaugeView, gaugeNotice: gaugeNotice, noticeKey: noticeKey, errorView: errorView, ndjsonReader: ndjsonReader, isSendKey: isSendKey };
  root.PlyoLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
