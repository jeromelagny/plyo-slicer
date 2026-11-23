// Appels au service Plyo, sans DOM : session renouvelée sur un 401, corps de /api/diagnose, envoi avec ses nouveaux essais
// (409, 413, taille) et lecture du flux NDJSON. Partagé par le panneau classique (index.html) et la v2 (v2/index.html),
// testé par node (tests/ai-client.test.mjs). window.PlyoAiClient.
(function (root) {
  var Logic = root.PlyoLogic || (typeof require !== 'undefined' ? require('./assistant-logic.js') : null);

  // `o` : { url (adresse du service), session() (session en cours ou null), saveSession(fresh) (session renouvelée, à garder),
  // fetch (facultatif, pour les tests ; sinon celui de la page) }.
  function createApi(o) {
    var PLYO_API_URL = o.url;
    function http(path, init) { return (o.fetch || root.fetch.bind(root))(PLYO_API_URL + path, init); }
    function postJson(path, body) {
      return http(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    // Appel authentifié : sur un 401, un seul renouvellement de session puis une nouvelle tentative.
    // Seul un refus du renouvellement (401) renvoie le 401 d'origine, qui déconnecte ; une panne (503)
    // renvoie la réponse du renouvellement, et la session est gardée.
    function apiFetch(path, init) {
      function attempt() {
        var session = o.session();
        var headers = Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + (session ? session.access_token : '') });
        return http(path, Object.assign({}, init, { headers: headers }));
      }
      return attempt().then(function (response) {
        var session = o.session();
        if (response.status !== 401 || !session) return response;
        return postJson('/api/auth/refresh', { refresh_token: session.refresh_token }).then(function (r) {
          if (r.status === 401) return response;
          if (!r.ok) return r;
          return r.json().then(function (fresh) {
            o.saveSession(fresh);
            return attempt();
          });
        });
      });
    }
    return { apiFetch: apiFetch, postJson: postJson };
  }

  // Corps de /api/diagnose. `i` : { values (dernier « values » du slicer), ctx (réponse « ai_context », ou null), history
  // (historique déjà coupé), project (projet de la conversation), projectForAI (PlyoThread.forAI de ce projet et de son étape),
  // note, calibrations, level (PlyoMachines.levelOf), intentQuestions, requestId, capabilities (facultatif : actions que la page
  // sait exécuter ; par défaut celles du panneau classique) }.
  function diagnoseBody(i) {
    var ctx = i.ctx || null, values = i.values, project = i.project || {};
    var body = {
      locale: values.locale || 'fr',
      settings: { params: Logic.diagnoseParams(values.params) },
      context: Logic.aiContext(values.context, ctx && ctx.context),
      history: Logic.historyForAI(i.history || [])
    };
    // La bobine du projet : sans elle le serveur ne propose jamais « Retenir ces réglages ».
    var spoolName = project.filament && project.filament.spool && project.filament.spool.name;
    if (spoolName && typeof spoolName === 'string') body.context = Object.assign({}, body.context, { spool: spoolName.slice(0, 60) });
    if (i.note) body.note = i.note;
    if (i.calibrations && i.calibrations.length) body.calibrations = i.calibrations;
    if (ctx && ctx.plate) body.plate = ctx.plate;
    if (ctx && ctx.memory && ctx.memory.length) body.memory = ctx.memory;
    if (ctx && ctx.limits && Object.keys(ctx.limits).length) body.filament_limits = ctx.limits;
    // Mode catalogue : toutes les valeurs Filament + Impression, pour que l'assistant puisse proposer n'importe quel réglage.
    if (ctx && ctx.snapshot && Object.keys(ctx.snapshot).length) body.snapshot = ctx.snapshot;
    body.explanation_level = i.level || 'detailed';
    if (i.intentQuestions) body.intent_questions = i.intentQuestions;
    // Où en est le projet : l'étape en cours et le fil des étapes et de la discussion.
    if (i.projectForAI) body.project = i.projectForAI;
    body.capabilities = (i.capabilities || Logic.CAPABILITIES).slice();
    // Pièce du projet dessinée par Plyo : une retouche de forme devient « Modifier ma pièce » (au lieu d'un autre logiciel).
    if (project.design && project.design.part) body.capabilities.push('redesign');
    // Le service rend la réponse déjà réglée de ce même identifiant (« replayed ») sans la refaire ni la débiter.
    body.request_id = i.requestId;
    return body;
  }

  // Attente interrompue par l'annulation de la demande.
  function wait(signal, ms) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) { reject(new Error('aborted')); return; }
      var t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(t); reject(new Error('aborted')); });
    });
  }

  // Envoi d'une question à /api/diagnose. Se résout toujours : { final } ou { error, gauge?, data? }.
  // `o` : { apiFetch, body (diagnoseBody), photos ([{ media_type, data, preview }]), signal (AbortSignal : raison « cancel »
  // pour Annuler, autre pour un délai dépassé), touch() (un signe de vie : relance le délai d'inactivité), shrink(step)
  // (photos réduites d'un palier, depuis les images jointes : promesse de la nouvelle liste), onRetry() (même demande encore
  // en cours chez le service : nouvel essai espacé), onPartial(ev) (réponse en cours d'écriture) }.
  function diagnose(o) {
    var body = o.body, signal = o.signal, photos = o.photos || [];
    var touch = o.touch || function () {};
    var limit = Logic.MAX_SEND_BYTES, shrunk = 0, lastBytes = 0, inProgressTries = 0;
    var out = {};              // événements du flux : final ou error
    var streaming = false;     // le flux a commencé : une coupure arrive pendant la réponse
    // Un envoi : taille vérifiée d'abord (au-delà, l'hébergeur refuserait sans que le panneau sache pourquoi), puis
    // nouvel essai espacé si la même demande tourne encore (409), ou réduction des photos si le service la dit trop lourde (413).
    function attempt() {
      if (signal && signal.aborted) return Promise.reject(new Error('aborted'));
      touch();
      if (photos.length) body.images = photos.map(function (p) { return { media_type: p.media_type, data: p.data }; });
      var json = JSON.stringify(body);
      var bytes = Logic.utf8Bytes(json);
      var plan = Logic.sizePlan(bytes, shrunk, photos.length > 0, limit);
      if (plan.tooBig) return Promise.resolve({ error: 'payload_too_large' });
      if (plan.shrink) { shrunk = plan.step; return o.shrink(plan.shrink).then(function (list) { photos = list; return attempt(); }); }
      lastBytes = bytes;
      return o.apiFetch('/api/diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: json, signal: signal }).then(function (response) {
        if (response.status === 409) return response.json().catch(function () { return {}; }).then(function (data) {
          var delay = Logic.inProgressDelay(inProgressTries++);
          if (!delay || (data.error && data.error !== 'request_in_progress')) return { error: data.error || 'request_in_progress', data: data };
          if (o.onRetry) o.onRetry();
          return wait(signal, delay).then(attempt);
        });
        if (response.status === 413 && photos.length) return response.json().catch(function () { return {}; }).then(function (data) {
          limit = Math.min(Logic.limitFrom413(data), lastBytes - 1); // le prochain envoi passe sous la limite du service
          return attempt();
        });
        return receive(response);
      });
    }
    function receive(response) {
      if (response.status === 401) return { error: 'unauthorized' };
      var type = response.headers.get('Content-Type') || '';
      if (type.indexOf('ndjson') < 0 || !response.body)
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (response.ok) return { final: data };
          // Corps sans code (proxy, limite de débit) : le statut HTTP suffit à choisir le message.
          var code = data.error || (response.status === 429 ? 'rate_limited' : response.status === 409 ? 'request_in_progress' : response.status === 413 ? 'payload_too_large' : 'internal');
          return { error: code, gauge: data.gauge, data: Object.assign({}, data, { retry_after: Logic.retryAfter(data, response.headers.get('Retry-After')) }) };
        });
      // Réponse en flux : les textes s'affichent au fur et à mesure, puis la réponse complète remplace le brouillon.
      // Les lignes « wait » (signal de vie du service) ne s'affichent pas : elles relancent seulement le délai d'inactivité.
      streaming = true;
      var reader = response.body.getReader(), decoder = new TextDecoder(), nd = Logic.ndjsonReader();
      function handle(events) {
        events.forEach(function (ev) {
          if (ev.type === 'partial') { if (o.onPartial) o.onPartial(ev); }
          else if (ev.type === 'final') out.final = ev;
          else if (ev.type === 'error') { out.error = ev.error; out.data = ev; }
        });
      }
      function pump() {
        return reader.read().then(function (r) {
          touch();
          if (r.done) { handle(nd.end()); return out.final || out.error ? out : { error: 'incomplete_answer' }; }
          handle(nd.push(decoder.decode(r.value, { stream: true })));
          return pump();
        });
      }
      return pump();
    }
    return attempt().then(function (r) { return r; }, function () {
      // Réponse complète déjà reçue (coupure juste après) : on la garde, elle est payée.
      if (out.final) return { final: out.final };
      return { error: signal && signal.aborted ? (signal.reason === 'cancel' ? 'cancel' : 'timeout') : streaming ? 'stream_cut' : 'network' };
    });
  }

  var api = { createApi: createApi, diagnoseBody: diagnoseBody, diagnose: diagnose, wait: wait };
  root.PlyoAiClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
