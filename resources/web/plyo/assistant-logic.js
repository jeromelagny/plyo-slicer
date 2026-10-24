// Logique pure du panneau de l'assistant (sans DOM) : titres des conversations, réponses groupées,
// jauge du mois, erreurs et lecture du flux de réponse.
// Chargée par index.html (window.PlyoLogic) et testée par node (tests/assistant-logic.test.mjs).
(function (root) {
  function shortDate(iso) {
    var d = String(iso || '').slice(0, 10).split('-');
    return d.length === 3 ? d[2] + '/' + d[1] : '';
  }

  // Titre d'une conversation : sa première demande, ou « Photo(s) du jj/mm ».
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
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
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
  // Message doux à afficher (« low » vers 80 %, « empty » jauge pleine), une seule fois par mois et par état.
  function noticeKey(kind, g) { return kind + ':' + g.resets_at; }
  function gaugeNotice(g, lastShown) {
    var v = gaugeView(g);
    if (!v || v.state === 'ok') return null;
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
    internal: { text: 'Un souci technique m’a empêché de répondre. Réessaie dans un instant.', action: 'retry' }
  };
  function errorView(code) { return ERRORS[code] || ERRORS.internal; }

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

  var api = { conversationTitle: conversationTitle, allAnswered: allAnswered, combineAnswers: combineAnswers,
    gaugeView: gaugeView, gaugeNotice: gaugeNotice, noticeKey: noticeKey, errorView: errorView, ndjsonReader: ndjsonReader, isSendKey: isSendKey };
  root.PlyoLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
