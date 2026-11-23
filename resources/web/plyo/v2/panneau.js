// Assistant v2 : le panneau (en-tête, barre des étapes, fil avec la carte de l'étape et la discussion, champ de saisie) et
// son dialogue avec le slicer (window.orca) et le service Plyo. Chargé par v2/index.html, lancé par PlyoV2.start().
// Même stockage, même pont et même service que le panneau classique : la conversation, la session et la jauge sont les
// mêmes des deux côtés (conversation-logic.js, ai-client.js).
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};

  V2.start = function () {
    var Logic = root.PlyoLogic, Conv = root.PlyoConversation, Client = root.PlyoAiClient, P = root.PlyoProject, J = root.PlyoJourney;
    var ui = V2.ui, D = V2.discussion, E = V2.etapes;
    var PLYO_API_URL = root.PLYO_API_URL;
    var MAX_HISTORY = 10, MAX_PHOTOS = 6, THUMB_SIDE = 160;
    var IDLE_TIMEOUT_MS = 60000;   // rien reçu depuis une minute : la demande est abandonnée (le service écrit « wait » toutes les 15 s)
    var ANSWER_MAX_MS = 285000;    // au-delà de l'échéance du service (270 s) : une réponse payée n'est jamais jetée ici
    var PHONE_POLL_MS = 3000;
    // Actions de réponse que la v2 sait exécuter : les mêmes que le panneau classique (aperçu d'Orca, tests d'Orca : v2/imprimer.js).
    var CAPABILITIES = Logic.CAPABILITIES.slice();

    var $ = function (id) { return document.getElementById(id); };
    var host = root.orca;
    var thread = $('msgs'), scroller = $('pscroll'), input = $('note'), sendButton = $('c-send'), menu = $('menu');
    if (!host || !host.postMessage) {
      thread.appendChild(D.notice('info', 'Ouvre ce panneau depuis Plyo Slicer : il a besoin du slicer pour fonctionner.'));
      return null;
    }
    function post(m) { host.postMessage(m); }
    function iso() { return new Date().toISOString(); }

    // ---------- État ----------
    var session = null;        // { access_token, refresh_token, expires_at, email }, gardée par le slicer
    var lastValues = null;     // dernier « values » du slicer (réglages, contexte, langue)
    var lastGauge = null;      // dernière jauge reçue du service
    var habits = root.PlyoMachines.emptyHabits();
    var calibHistory = [];
    var tourSignals = null;
    var conv = null;           // conversation du projet affiché
    var busy = false;          // une demande à l'assistant en cours
    var projectSwitched = false; // Orca a ouvert un autre projet pendant la réponse : appliqué à la fin
    var attachments = [];      // photos jointes : [{ media_type, data, preview }]
    var lastAsked = null;      // question restée sans réponse : renvoyée telle quelle, même identifiant
    var afterLogin = null, loginCard = null;
    var opened = null;         // étape faite rouverte d'un clic
    var hold = null;           // étape gardée à l'écran bien que faite (pièce posée : « Envie d'ajuster ? », puis « Continuer »)
    var listeners = {};        // messages du slicer suivis par les écrans des étapes (PlyoV2.panel.on)
    var email = '';            // adresse du compte (menu « Compte »)
    var NOTICE_KEY = 'plyo.gaugeNotice';
    var gaugeState = null, noticeShown = null; // message doux de la jauge : état vu juste avant, repli en mémoire

    var api = Client.createApi({ url: PLYO_API_URL, session: function () { return session; },
      saveSession: function (fresh) { session = fresh; post({ type: 'session_save', session: fresh }); } });

    // ---------- Conversation : la même que celle du panneau classique ----------
    var saveTimer = null, saveTarget = null;
    function saveNow(c) {
      if (!Conv.worthSaving(c)) return;
      c.updated = iso();
      post({ type: 'conv_save', id: c.id, conversation: Conv.savePayload(c) });
    }
    function scheduleSave(c) {
      var target = c || conv;
      if (!Conv.worthSaving(target)) return;
      if (saveTarget && saveTarget !== target) { clearTimeout(saveTimer); saveNow(saveTarget); }
      saveTarget = target;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { saveTarget = null; saveNow(target); }, 400);
    }
    function flushSave() { if (saveTarget) { clearTimeout(saveTimer); saveNow(saveTarget); saveTarget = null; } }
    function record(entry, c) { var target = c || conv; target.entries.push(entry); scheduleSave(target); return entry; }

    function startConversation(project) {
      conv = Conv.create(Conv.newId(), project, iso());
      conv.project.assistant = {}; // réglages que l'assistant posera pour ce projet (les autres modifications sont les tiennes)
      opened = null;
      hold = null;
      clearThread();
      render();
    }
    // Orca a ouvert un autre projet, ou « Nouveau projet » : la conversation d'avant reste enregistrée ; imprimante et
    // bobine du précédent sont proposées, jamais appliquées sans confirmation.
    function newConversation() {
      flushSave();
      openRetryReset();
      unlinkPhone(true);
      attachments = [];
      renderAttachments();
      post({ type: 'project_detach' });
      startConversation(conv && P.hasPrinter(conv.project) ? P.proposeFrom(conv.project) : null);
      // Retouches d'impression faites à la main dans le projet quitté : la question vient une fois le plateau détaché.
      askRetouches(1500);
    }
    function askRetouches(delay) { setTimeout(function () { post({ type: 'retouches_get' }); }, delay || 0); }
    // Conversation enregistrée qui redevient active. `attached` : panneau rouvert (ou bascule) sur la conversation dont le
    // plateau est encore attaché : rien n'est rechargé. Sinon (« Mes pièces récentes », « Mes projets ») son projet 3MF revient
    // sur le plateau, comme dans le panneau classique ; sans pièce, le plateau d'avant est seulement détaché.
    function restoreConversation(id, c, attached) {
      if (!c || !Array.isArray(c.entries) || busy) return;
      flushSave();
      openRetryReset();
      if (!attached) unlinkPhone(true);
      conv = Conv.fromSaved(id, c);
      opened = null;
      hold = null;
      if (attached) { if (P.mayAttach(tourSignals)) post({ type: 'project_attach', conv: id }); }
      else if (P.opensProjectFile(conv.project)) post({ type: 'project_open', conv: id });
      else post({ type: 'project_detach' });
      clearThread();
      conv.entries.forEach(function (entry) { try { renderEntry(entry, true); } catch (e) { /* élément abîmé : ignoré */ } });
      render();
      scrollDown();
    }

    // Ouverture refusée parce qu'Orca est occupé : on le dit une fois et on redemande toutes les 3 s tant que le projet est
    // affiché, une minute au plus (comme le classique, project-logic.js).
    var openRetry = { conv: null, tries: 0, timer: null };
    function openRetryReset() { clearTimeout(openRetry.timer); openRetry = { conv: null, tries: 0, timer: null }; }
    function onProjectOpened(msg) {
      if (!conv || msg.conv !== conv.id) return;
      var again = openRetry.conv === conv.id;
      var step = P.openRetryStep(msg.reason, again ? openRetry.tries : 0);
      if (step === 'done') openRetryReset();
      var text = again && step !== 'give_up' ? '' : step === 'give_up' ? P.openGiveUpText() : msg.reason ? P.projectOpenedText(msg.reason) : '';
      if (text) say(text, msg.reason === 'annule' ? 'info' : 'warn');
      if (step === 'give_up') { openRetryReset(); return; }
      if (step === 'retry') {
        if (!again) openRetry = { conv: conv.id, tries: 0, timer: null };
        openRetry.tries++;
        clearTimeout(openRetry.timer);
        var id = conv.id;
        openRetry.timer = setTimeout(function () { if (conv && conv.id === id) post({ type: 'project_open', conv: id }); }, P.OPEN_RETRY_MS);
        return;
      }
      if (P.restoresAfterOpen(msg.reason) && P.restorable(conv.project)) post({ type: 'project_restore', project: conv.project, discard_unsaved: false });
    }
    // Le plateau de la conversation d'avant n'est pas encore rangé (Orca découpe ou envoie) : dit une fois, redemandé toutes les 3 s.
    var attachRetry = { conv: null, tries: 0, timer: null };
    function onAttachRefused(msg) {
      if (!conv || msg.conv !== conv.id) return;
      if (attachRetry.conv !== conv.id) { attachRetry = { conv: conv.id, tries: 0, timer: null }; if (msg.text) say(msg.text, 'warn'); }
      if (++attachRetry.tries > 20) return;
      clearTimeout(attachRetry.timer);
      var id = conv.id;
      attachRetry.timer = setTimeout(function () { if (conv && conv.id === id && P.mayAttach(tourSignals)) post({ type: 'project_attach', conv: id }); }, 3000);
    }
    // Orca a vidé les réglages de la pièce sans changer de projet : la conversation rouvre son 3MF, ou le plateau lui est rattaché.
    function onProjectDetached(msg) {
      var next = P.afterDetached(msg, conv && conv.id);
      if (next === 'open') post({ type: 'project_open', conv: conv.id });
      else if (next === 'attach' && P.mayAttach(tourSignals)) post({ type: 'project_attach', conv: conv.id });
    }

    // Ouverture du panneau : le plateau encore attaché à une conversation (panneau rouvert, bascule) la rouvre ; sinon le
    // plateau d'avant est détaché, comme dans le panneau classique. Sans réponse du slicer en 1,5 s, on fait de même.
    var resume = { waiting: true, timer: null };
    function onProjectResume(msg) {
      if (!resume.waiting) return;
      resume.waiting = false;
      clearTimeout(resume.timer);
      if (msg.attached && msg.conversation && Array.isArray(msg.conversation.entries)) { restoreConversation(msg.attached, msg.conversation, true); return; }
      post({ type: 'project_detach' });
      render();
    }

    // ---------- Vue ----------
    // Pendant une réponse de l'assistant, la barre ne rouvre pas d'étape (la réponse va au projet affiché).
    function renderBar() { E.renderBar($('stepper'), conv.project, opened, busy ? null : openStep, hold); }
    function render() {
      renderBar();
      var key = opened || hold || E.barKeyOf(conv.project);
      E.renderCard($('stepcard'), key, { project: conv.project, step: J.currentStep(conv.project), revisit: !!opened, held: !opened && !!hold, panel: V2.panel,
        actions: { classic: backToClassic, closeRevisit: function () { openStep(null); } } });
      renderHello();
    }
    function openStep(key) {
      opened = key;
      if (!key) hold = null; // « Revenir à l'étape en cours » : là où en est le projet
      render();
      scroller.scrollTop = 0;
    }
    // Garde une étape à l'écran (`key`), ou la relâche (null) : la carte suit alors le projet.
    function setHold(key) {
      hold = key || null;
      if (hold) opened = null;
      render();
      scroller.scrollTop = 0; // la carte depuis son début : la pièce posée, ou l'étape suivante
    }
    function renderHello() { $('hello').classList.toggle('hidden', thread.children.length > 0); }
    function clearThread() { thread.textContent = ''; dropLoginCard(); renderHello(); }
    function scrollDown() { scroller.scrollTop = scroller.scrollHeight; }
    function addToThread(node) { thread.appendChild(node); renderHello(); scrollDown(); return node; }
    function say(text, kind, actions) { return addToThread(D.notice(kind || 'info', text, actions)); }

    // Une entrée de la conversation dans le fil. `archived` : conversation rouverte (ses questions ne se rejouent pas).
    function renderEntry(entry, archived) {
      if (entry.kind === 'me') {
        addToThread(D.me(entry));
        // Marque « en attente » restée : l'application a été fermée pendant la réponse.
        if (entry.pending && archived && !busy) unansweredCard(entry);
        return;
      }
      if (entry.kind === 'answer') {
        var box = D.answer(entry, { params: lastValues && lastValues.params, archived: archived,
          onAnswer: function (text) { send(text); }, onChange: function () { scheduleSave(); } });
        // Ordres sur le plateau et actions sur la pièce proposés par l'IA (v2/piece.js) ; fiche de réglages à appliquer, actions
        // d'Orca, test de calibration proposé (v2/imprimer.js).
        if (V2.piece && V2.piece.answerExtras) V2.piece.answerExtras(entry, box, archived);
        if (V2.imprimer && V2.imprimer.answerExtras) V2.imprimer.answerExtras(entry, box, archived);
        // « Signaler » : la réponse semble fausse ou inutile (v2/finitions.js, comme le classique).
        if (V2.finitions && V2.finitions.answerFoot) V2.finitions.answerFoot(entry, box);
        addToThread(box);
        return;
      }
      if (entry.kind === 'note') { say(entry.text, entry.tone === 'error' ? 'error' : entry.tone === 'warn' ? 'warn' : 'info'); return; }
      // Fiche d'un réglage (« C'est quoi la rétraction ? ») : gratuite, gardée avec la conversation.
      if (entry.kind === 'fiche' && entry.msg) { addToThread(D.fiche(entry.msg, { archived: archived, explainActions: ficheActions })); return; }
      if (entry.kind === 'model' && entry.msg && entry.msg.name) say('Pièce posée sur le plateau : ' + entry.msg.name + '.');
    }
    function unansweredCard(entry) {
      var view = Logic.unansweredView(entry.pending);
      var id = function () { return Logic.resendRequestId(entry.pending, new Date(), Logic.newRequestId(root.crypto)); };
      var box;
      function settle() { box.remove(); delete entry.pending; scheduleSave(); }
      var acts = [];
      if (!view.photos) acts.push({ label: 'Renvoyer ma question', primary: true, run: function () { var rid = id(); settle(); send(entry.text || '', { photos: [], shown: true, me: entry, requestId: rid }); } });
      else if (entry.text) acts.push({ label: 'Renvoyer sans les photos', primary: true, run: function () { var rid = id(); settle(); send(entry.text, { photos: [], shown: true, me: entry, requestId: rid }); } });
      box = say(view.text, 'warn', acts);
    }

    // ---------- En-tête : jauge, téléphone, menu ----------
    function showLoggedIn(on) { $('gauge').classList.toggle('hidden', !on); }
    // Jauge du mois en pourcentage, comme dans le panneau classique (assistant-logic.js, gaugeView).
    // `quiet` : relevé sans message doux (fenêtre « Mon utilisation », erreur « jauge pleine » déjà affichée).
    function setGauge(g, quiet) {
      var v = Logic.gaugeView(g);
      if (!v) return;
      lastGauge = g;
      var prev = gaugeState;
      gaugeState = v.state;
      if (quiet) { noticeShown = Logic.noticeKey(v.state, g); try { root.localStorage.setItem(NOTICE_KEY, noticeShown); } catch (e) { /* stockage indisponible */ } }
      else setTimeout(function () { gaugeNotice(g, v, prev); }, 0);
      $('gauge-pct').textContent = ui.fr(v.label);
      $('gauge-fill').style.width = Math.max(3, v.pct) + '%';
      $('gauge').classList.toggle('low', v.state === 'low');
      $('gauge').classList.toggle('empty', v.state === 'empty');
      $('gauge').title = ui.fr('Jauge IA : ' + v.label + ' utilisés ce mois-ci. Elle se recharge ' + v.resets + '.');
      $('gauge').setAttribute('aria-label', ui.fr('Jauge IA du mois : ' + v.label + ' utilisés'));
    }
    // Message doux vers 80 %, puis quand la jauge est pleine : une seule fois par mois (comme le classique, assistant-logic.js).
    function gaugeNotice(g, v, prev) {
      var last = noticeShown;
      try { last = root.localStorage.getItem(NOTICE_KEY) || last; } catch (e) { /* stockage indisponible : la mémoire suffit */ }
      var kind = Logic.gaugeNotice(g, last, prev);
      if (!kind || !thread.children.length) return;
      noticeShown = Logic.noticeKey(kind, g);
      try { root.localStorage.setItem(NOTICE_KEY, noticeShown); } catch (e) { /* idem */ }
      say(kind === 'low' ? 'Tu as utilisé **' + v.label + '** de ta jauge ce mois-ci. Elle se recharge ' + v.resets + '.' : 'Ta jauge du mois est pleine. Elle se recharge ' + v.resets + '.', 'warn',
        [{ label: 'Voir mon utilisation', run: function () { if (V2.menu) V2.menu.openUsage(); } }]);
    }
    // Vérifie la session (et la renouvelle au besoin) ; met à jour la jauge. Résout à true si la session est valide.
    function refreshAccount() {
      return api.apiFetch('/api/me', { method: 'GET' })
        .then(function (r) {
          if (r.status === 401) { logout('Ta session a expiré : reconnecte-toi pour continuer.'); return false; }
          if (r.status === 503) { $('gauge-pct').textContent = ui.fr('Indisponible'); return false; }
          return r.ok ? r.json().then(function (me) { email = me && me.email ? String(me.email) : ''; setGauge(me.gauge); return true; }) : false;
        })
        .catch(function () { $('gauge-pct').textContent = ui.fr('Hors ligne'); return false; });
    }
    // Après une annulation, le débit arrive un peu après la fermeture du flux : la jauge est relue deux fois.
    function refreshGaugeSoon() { [2000, 8000].forEach(function (ms) { setTimeout(function () { if (session) refreshAccount(); }, ms); }); }
    function logout(message) {
      unlinkPhone(true);
      session = null;
      post({ type: 'session_clear' });
      showLoggedIn(false);
      if (message) say(message);
    }
    function openLogin() { post({ type: 'login' }); }
    function dropLoginCard() { if (loginCard) { loginCard.remove(); loginCard = null; } }
    // Connexion demandée seulement au premier appel à l'IA : la demande est gardée et repart après la connexion.
    function requireLogin(reason, retry) {
      if (session) return false;
      afterLogin = retry || null;
      dropLoginCard();
      loginCard = addToThread(D.notice('info', reason, [{ label: 'Me connecter', run: openLogin, primary: true }]));
      return true;
    }

    function closeMenu() { menu.classList.add('hidden'); $('btn-more').setAttribute('aria-expanded', 'false'); }
    $('btn-more').addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !open);
      $('btn-more').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    // « Revenir à l'ancien assistant » : ce qui attend d'être enregistré part d'abord ; pas pendant une réponse.
    function backToClassic() {
      closeMenu();
      if (busy) { say('Attends la fin de la réponse (ou annule-la) avant de changer d’assistant.'); return; }
      flushSave();
      post({ type: 'firststeps_set', patch: { ui: 'classique' } });
    }
    $('m-ui').addEventListener('click', backToClassic);

    // ---------- Champ de saisie ----------
    function growNote() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 132) + 'px';
    }
    input.addEventListener('input', growNote);
    input.addEventListener('keydown', function (e) { if (Logic.isSendKey(e)) { e.preventDefault(); send(input.value); } });
    sendButton.addEventListener('click', function () { send(input.value); });
    function setBusy(on) {
      busy = on;
      sendButton.disabled = on;
      renderBar(); // la carte de l'étape n'est pas redessinée : ce que tu y saisis reste
    }
    function clearNoteIfSent(note) { if (input.value.trim() === note) { input.value = ''; growNote(); } }
    // La demande revient dans le champ (texte et photos) sans repartir, jamais par-dessus ce que tu as commencé.
    function restoreDraft(note, photos) {
      if (input.value.trim() || attachments.length) return false;
      input.value = note || '';
      growNote();
      attachments = (photos || []).filter(function (p) { return p && p.preview; }).slice(0, MAX_PHOTOS);
      renderAttachments();
      return true;
    }
    function clearDraftIf(note, photos) {
      if (!input.value.trim() && !attachments.length) return;
      if (!Logic.sameQuestion({ note: note, photos: photos }, { note: input.value, photos: attachments })) return;
      input.value = '';
      growNote();
      attachments = [];
      renderAttachments();
    }

    // Trombone et glisser-déposer : un modèle 3D est posé sur le plateau (étape « Ta pièce », v2/piece.js, comme dans le
    // classique) ; les photos sont jointes à la demande (réduites à 1 600 px, photo-tools.js).
    var fileInput = $('file-input');
    $('c-file').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var all = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = '';
      addFiles(all);
    });
    function addFiles(all) {
      var isModel = function (f) { return root.PlyoFirstSteps.isModelFile(f.name); };
      var models = all.filter(isModel), files = all.filter(function (f) { return !isModel(f) && /^image\//.test(f.type || ''); });
      var other = all.filter(function (f) { return !isModel(f) && !/^image\//.test(f.type || ''); })[0];
      if (other) say(root.PlyoFirstSteps.unreadableFileText(other.name), 'error');
      if (models.length && V2.piece && V2.piece.addModels) V2.piece.addModels(models);
      if (!files.length) return;
      Promise.all(files.map(function (f) { return root.PlyoPhotos.downscale(f).catch(function () { return null; }); })).then(function (list) {
        var ok = list.filter(Boolean);
        if (ok.length < list.length) say('Je n’ai pas pu lire une de tes photos (JPEG, PNG ou WebP). Reprends-la.', 'error');
        ok.forEach(function (a) { if (attachments.length < MAX_PHOTOS) attachments.push(a); });
        if (attachments.length >= MAX_PHOTOS) say(MAX_PHOTOS + ' photos au plus par demande.');
        renderAttachments();
        input.focus();
      });
    }
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) addFiles(files);
    });
    function renderAttachments() {
      var box = $('attached');
      box.textContent = '';
      box.classList.toggle('hidden', !attachments.length);
      attachments.forEach(function (a, i) {
        var item = ui.el('div', 'att');
        var img = ui.el('img');
        img.src = a.preview;
        img.alt = 'Photo ' + (i + 1);
        var remove = ui.button('', function () { attachments.splice(i, 1); renderAttachments(); }, 'att-x', 'x');
        remove.title = ui.fr('Retirer cette photo');
        remove.setAttribute('aria-label', ui.fr('Retirer la photo ' + (i + 1)));
        item.appendChild(img);
        item.appendChild(remove);
        box.appendChild(item);
      });
    }

    // Micro : un appui lance la dictée du système dans le champ, un second l'arrête (rien n'est enregistré par Plyo).
    var dictating = false, dictationTimer = null;
    function setDictating(on) {
      dictating = on;
      clearTimeout(dictationTimer);
      dictationTimer = on ? setTimeout(stopDictation, Logic.DICTATION_SILENCE_MS) : null;
      var mic = $('c-mic'), label = ui.fr(Logic.dictationLabel(on));
      mic.classList.toggle('listen', on);
      mic.setAttribute('aria-pressed', on ? 'true' : 'false');
      mic.title = label;
      mic.setAttribute('aria-label', label);
      input.placeholder = ui.fr(on ? Logic.DICTATION_LISTENING : 'Une question ? Décris-la avec tes mots…');
    }
    function stopDictation() {
      if (!dictating) return;
      setDictating(false);
      post({ type: 'dictation_stop' });
    }
    $('c-mic').addEventListener('mousedown', function (e) { e.preventDefault(); }); // le champ garde le curseur
    $('c-mic').addEventListener('click', function () {
      if (dictating) { stopDictation(); return; }
      input.focus();
      post({ type: 'dictation_start' });
    });
    input.addEventListener('blur', stopDictation);
    sendButton.addEventListener('click', stopDictation);
    input.addEventListener('keydown', function (e) {
      if (!dictating) return;
      if (e.key === 'Escape') setDictating(false);
      else if (Logic.isSendKey(e)) stopDictation();
    });
    input.addEventListener('input', function () { if (dictating) setDictating(true); });
    function onDictation(msg) {
      $('c-mic').classList.toggle('hidden', !msg.available);
      if (msg.started === true) setDictating(true);
      else if (msg.started === false) { setDictating(false); say(Logic.dictationFailText(msg.platform), 'error'); }
    }

    // Téléphone : un lien par conversation ; la fenêtre du QR est celle du slicer. Chaque envoi du téléphone part à l'assistant.
    var phone = { link: null, timer: null, creating: null, collecting: false, queue: [] };
    // Ce que le téléphone doit photographier : un croquis quand « Créer avec l'IA » est ouvert (v2/piece.js, `phoneRoute`),
    // sinon un défaut, envoyé à l'assistant. `phoneRoute` : { purpose() → 'sketch' | 'defect', take(envoi) → true si gardé }.
    // Plusieurs écrans peuvent en avoir un (croquis de l'étape 1, photo d'un test de calibration) : le premier qui demande autre
    // chose qu'un défaut l'emporte.
    var phoneRoutes = [];
    function phoneRoute() { return phoneRoutes.filter(function (r) { return r.purpose() !== 'defect'; })[0] || null; }
    function phonePurpose() { var r = phoneRoute(); return r ? r.purpose() : 'defect'; }
    function phoneLabel() { return conv && conv.project.part && conv.project.part.name ? J.projectTitle(conv.project) : ''; }
    // Le lien vaut pour toute la conversation : sa consigne suit l'usage du moment (comme dans le classique).
    function syncPhonePurpose() {
      var want = phonePurpose(), label = phoneLabel();
      if (!phone.link || !session || (phone.link.purpose === want && (phone.link.label || '') === label)) return;
      phone.link.purpose = want;
      phone.link.label = label;
      api.apiFetch('/api/phone-sessions/' + encodeURIComponent(phone.link.id) + '/purpose', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: want, label: label }) }).catch(function () {});
    }
    function openPhone() {
      if (requireLogin('Les photos du téléphone passent par le service Plyo. Pour ça, connecte-toi : pas de mot de passe, tu reçois un code par e-mail.', openPhone)) return;
      refreshAccount().then(function (valid) {
        if (!valid) { if (session) showError('network', null, openPhone); return; }
        if (!phone.link && !phone.creating) {
          var label = phoneLabel(), purpose = phonePurpose();
          phone.creating = api.apiFetch('/api/phone-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: purpose, label: label }) })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (created) {
              phone.link = { id: created.id, qr_svg: created.qr_svg, purpose: purpose, label: label };
              $('phone-pill').classList.remove('hidden');
              clearInterval(phone.timer);
              phone.timer = setInterval(pollPhone, PHONE_POLL_MS);
              return phone.link;
            });
          phone.creating.then(function () { phone.creating = null; }, function () { phone.creating = null; });
        }
        (phone.link ? Promise.resolve(phone.link) : phone.creating)
          .then(function (link) { syncPhonePurpose(); post({ type: 'phone', link: { id: link.id, qr_svg: link.qr_svg, purpose: link.purpose, label: link.label || '' } }); })
          .catch(function () { showError('network', null, openPhone); });
      });
    }
    function unlinkPhone(close) {
      if (!phone.link) return;
      if (close && session) api.apiFetch('/api/phone-sessions/' + encodeURIComponent(phone.link.id), { method: 'DELETE' }).catch(function () {});
      clearInterval(phone.timer);
      phone.link = null;
      phone.queue = [];
      $('phone-pill').classList.add('hidden');
    }
    function pollPhone() {
      if (!phone.link || phone.collecting || !session) return;
      var id = phone.link.id;
      api.apiFetch('/api/phone-sessions/' + encodeURIComponent(id), { method: 'GET' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (s) {
          if (s.expired || s.status === 'closed') { unlinkPhone(false); say('Le lien avec le téléphone a expiré. Clique sur l’icône du téléphone pour en créer un nouveau.'); return; }
          if (s.pending_batches > 0) return collectBatch(id);
        })
        .catch(function (status) { if (status === 404) unlinkPhone(false); });
    }
    function collectBatch(id) {
      phone.collecting = true;
      return api.apiFetch('/api/phone-sessions/' + encodeURIComponent(id) + '/photos', { method: 'GET' })
        .then(function (r) { return r.status === 200 ? r.json() : null; })
        .then(function (batch) {
          if (!batch) return;
          var missing = Logic.missingPhotosText(batch.missing);
          if (missing) say(missing, 'error');
          if (!batch.images || !batch.images.length) { if (!missing) say('Les photos du téléphone n’ont pas pu être récupérées. Renvoie-les depuis le téléphone.', 'error'); return; }
          var sent = { message: batch.message, photos: batch.images.map(function (img) {
            return { media_type: img.media_type, data: img.data, preview: 'data:' + img.media_type + ';base64,' + img.data };
          }) };
          var route = phoneRoute();
          if (route && route.take(sent)) return; // croquis joint au formulaire « Créer avec l'IA », photo d'un test de calibration
          phone.queue.push(sent);
          drainPhoneQueue();
        })
        .catch(function () { say('Les photos du téléphone n’ont pas pu être récupérées. Renvoie-les depuis le téléphone.', 'error'); })
        .then(function () { phone.collecting = false; });
    }
    function drainPhoneQueue() {
      if (busy || !lastValues || !phone.queue.length) return;
      var next = phone.queue.shift();
      send(next.message, { photos: next.photos, fromPhone: true });
    }
    $('c-phone').addEventListener('click', openPhone);
    $('phone-pill').addEventListener('click', openPhone);

    // ---------- Demande à l'assistant : même service et même flux que le panneau classique ----------
    // Ta demande dans le fil ; le titre de la conversation vient de la première demande.
    function addMe(text, photos, fromPhone) {
      var entry = record(Conv.meEntry(text, fromPhone));
      if (!conv.title) conv.title = Logic.conversationTitle(text, photos.length, iso());
      addToThread(D.me({ text: text, fromPhone: fromPhone, thumbs: photos.map(function (p) { return p.preview; }) }));
      // La conversation garde des vignettes de 160 px, pas les photos entières.
      Promise.all(photos.map(function (p) { return root.PlyoPhotos.scaled(p.preview, THUMB_SIDE, 0.7).catch(function () { return null; }); })).then(function (thumbs) {
        entry.thumbs = thumbs.filter(Boolean);
        scheduleSave();
      });
      return entry;
    }
    // `opts` : { photos (du téléphone), fromPhone, shown (la demande est déjà dans le fil), me, requestId }.
    function send(text, opts) {
      opts = opts || {};
      var note = (text || '').trim();
      if (busy) return;
      var photos = opts.photos || attachments.slice();
      if (!note && !photos.length) { input.focus(); return; }
      if (!lastValues) { say('Je lis encore tes réglages : réessaie dans une seconde.'); return; }
      // « C'est quoi la rétraction ? » : la fiche du réglage répond, gratuitement et sans compte (comme le classique).
      var ficheKey = !opts.photos && !photos.length && !opts.shown ? root.PlyoFirstSteps.matchSettingQuestion(note, root.PLYO_FICHES) : null;
      if (ficheKey) { addMe(note, [], false); clearNoteIfSent(note); explain(ficheKey); return; }
      if (!opts.photos) { attachments = []; renderAttachments(); clearNoteIfSent(note); }
      var me = opts.me || null;
      if (!opts.shown) me = addMe(note, photos, opts.fromPhone);
      // Un identifiant par question : la même question renvoyée telle quelle (après une erreur) garde le sien.
      var requestId = opts.requestId || (lastAsked && Logic.sameQuestion(lastAsked, { note: note, photos: photos }) ? lastAsked.id : Logic.newRequestId(root.crypto));
      lastAsked = null;
      var again = { photos: photos, fromPhone: opts.fromPhone, shown: true, me: me, requestId: requestId };
      if (requireLogin('Pour te répondre, j’envoie ta demande à l’IA : connecte-toi, sans mot de passe (tu reçois un code par e-mail). Ta question est gardée : elle partira dès que tu seras connecté.', function () { send(note, again); })) return;
      ask(note, photos, { id: requestId, me: me });
    }

    // Juste avant l'appel : ce qui est sur le plateau et ce qui a déjà été appliqué sur cette machine.
    var contextWaiter = null;
    function aiContext() {
      return new Promise(function (resolve) {
        var timer = setTimeout(function () { contextWaiter = null; resolve(null); }, 1500);
        contextWaiter = function (msg) { clearTimeout(timer); contextWaiter = null; resolve(msg); };
        post({ type: 'ai_context' });
      });
    }

    function ask(note, photos, req) {
      if (busy) return;
      var target = conv;         // la réponse va dans la conversation de la question, quoi qu'il arrive
      var original = photos;     // photos telles que jointes : remises dans le champ après une erreur
      var controller = new AbortController();
      var idle = null;
      function touch() { clearTimeout(idle); idle = setTimeout(function () { controller.abort('timeout'); }, IDLE_TIMEOUT_MS); }
      touch();
      var cap = setTimeout(function () { controller.abort('timeout'); }, ANSWER_MAX_MS);
      var started = Date.now(), phase = '';
      var wait = D.waiting(Logic.waitingText(0, photos.length > 0, phase), function () { controller.abort('cancel'); });
      projectSwitched = false;
      setBusy(true);
      addToThread(wait.node);
      function sayWaiting() { wait.say(Logic.waitingText(Date.now() - started, photos.length > 0, phase)); }
      var ticker = setInterval(sayWaiting, 5000);
      // La question est « en attente » dans la conversation enregistrée tant que rien n'est revenu.
      if (req.me) { req.me.pending = { id: req.id, at: iso(), photos: photos.length }; scheduleSave(target); }
      function finish() {
        clearTimeout(idle);
        clearTimeout(cap);
        clearInterval(ticker);
        wait.node.remove();
        if (req.me && req.me.pending) { delete req.me.pending; scheduleSave(target); }
        var switched = projectSwitched;
        projectSwitched = false;
        setBusy(false);
        if (switched) newConversation();
        drainPhoneQueue();
        return switched;
      }
      function fail(code, data) {
        var switched = finish();
        lastAsked = { note: note, photos: original, id: req.id };
        if (code === 'cancel') { restoreDraft(note, original); say(Logic.CANCEL_TEXT); refreshGaugeSoon(); return; }
        if (code === 'timeout' || code === 'stream_cut') refreshGaugeSoon(); // flux fermé comme par « Annuler » : même facturation
        if (switched) { restoreDraft(note, original); say(Logic.projectSwitchText(false, false), 'warn'); return; }
        if (code === 'unauthorized') {
          logout();
          requireLogin('Ta session a expiré : reconnecte-toi, ta demande repartira. Pas de mot de passe, tu reçois un code par e-mail.', function () { send(note, { photos: original, shown: true, me: req.me, requestId: req.id }); });
          return;
        }
        restoreDraft(note, original); // rien à retaper : la demande revient dans le champ
        showError(code, data, function () { clearDraftIf(note, original); ask(note, original, req); });
      }
      // Profils au moment de la question : les réglages proposés ne s'appliquent qu'à eux.
      var sentNames = lastValues && lastValues.context ? Logic.namesForApply(null, lastValues.context) : null;
      aiContext().then(function (ctx) {
        var body = Client.diagnoseBody({ values: lastValues, ctx: ctx, history: conv.history.slice(-MAX_HISTORY), project: conv.project,
          projectForAI: root.PlyoThread.forAI(conv.project, J.currentStep(conv.project)),
          note: note, calibrations: calibHistory, level: root.PlyoMachines.levelOf(habits), requestId: req.id, capabilities: CAPABILITIES,
          // Questions d'intention affichées : l'IA peut y répondre d'après la phrase (v2/imprimer.js les reprend).
          intentQuestions: V2.imprimer && V2.imprimer.intentPending ? V2.imprimer.intentPending() : null });
        return Client.diagnose({ apiFetch: api.apiFetch, body: body, photos: photos, signal: controller.signal, touch: touch,
          shrink: function (step) { return root.PlyoPhotos.shrinkAll(original, step).then(function (list) { photos = list; return list; }); },
          onRetry: function () { phase = 'retry'; sayWaiting(); },
          onPartial: function (ev) { wait.live(ev); } });
      }).then(function (r) {
        if (r.error) {
          if (r.error === 'insufficient_credits') setGauge(r.gauge, true);
          fail(r.error, r.data);
          return;
        }
        done(r.final);
      }).catch(function () {
        fail(controller.signal.aborted ? (controller.signal.reason === 'cancel' ? 'cancel' : 'timeout') : 'network');
      });
      function done(a) {
        var switched = finish();
        lastAsked = null;
        // Réponse rejouée (« replayed ») : la même que la première fois, jauge comprise.
        if (a.credits) setGauge(a.credits.gauge);
        Conv.normalizeAnswer(a, sentNames);
        var hist = Conv.exchange(target, note, photos.length, a, MAX_HISTORY);
        var entry = record(Conv.answerEntry(a, photos.length, note, iso()), target);
        // Ligne de l'historique de cette réponse (non enregistrée avec l'entrée) : les ordres faits sur le plateau s'y ajoutent.
        Object.defineProperty(entry, 'hist', { value: hist, enumerable: false, writable: true });
        if (switched) { say(Logic.projectSwitchText(!!(a.commands && a.commands.length), true), 'warn'); return; }
        // Suites d'une réponse neuve (v2/imprimer.js) : journal des pièces, réponses aux questions d'intention, fin d'impression dite.
        if (V2.imprimer && V2.imprimer.afterAnswer && target === conv) V2.imprimer.afterAnswer(a, entry, { photos: photos });
        if (target !== conv) return;
        try { renderEntry(entry, false); }
        catch (e) { say('La réponse est arrivée mais n’a pas pu s’afficher. Rouvre ce projet depuis « Mes projets ».', 'error'); }
        if (V2.imprimer && V2.imprimer.printOutcome) V2.imprimer.printOutcome(a.print_outcome);
      }
    }

    // Erreur : ce qui s'est passé et l'action suivante (assistant-logic.js, errorView). La demande est gardée.
    function showError(code, data, retry) {
      var view = Logic.errorView(code, data);
      var g = code === 'insufficient_credits' ? Logic.gaugeView(lastGauge) : null;
      var text = view.text + (g && g.resets ? ' Elle se recharge ' + g.resets + '.' : '') + (view.more ? ' ' + view.more : '');
      var acts = [];
      if (view.action === 'login') acts.push({ label: 'Me reconnecter', run: openLogin, primary: true });
      // plan_required : les formules (fenêtre de la v2, v2/menu.js) ; jauge pleine : « Mon utilisation ». Logique inchangée.
      else if (view.action === 'plans') acts.push({ label: 'Voir les formules', run: function () { if (V2.menu) V2.menu.openPlans(); }, primary: true });
      else if (view.action === 'credits') acts.push({ label: 'Voir mon utilisation', run: function () { if (V2.menu) V2.menu.openUsage(); }, primary: true });
      else if (view.action === 'photo') acts.push({ label: 'Choisir une autre photo', run: function () { box.remove(); fileInput.click(); }, primary: true });
      else if (view.action === 'edit') acts.push({ label: 'Modifier ma demande', run: function () { box.remove(); input.focus(); }, primary: true });
      else if (view.action === 'retry' && retry) acts.push({ label: 'Réessayer', run: function () { box.remove(); retry(); }, primary: true });
      var box = addToThread(D.notice(view.action === 'none' ? 'info' : 'error', text, acts));
      // Trop de demandes : le bouton attend la fin du délai annoncé, avec le compte à rebours.
      var again = view.wait && box.querySelector('button');
      if (again) {
        var left = view.wait;
        again.disabled = true;
        var tick = function () {
          if (!again.isConnected) return;
          if (left <= 0) { again.disabled = false; again.textContent = ui.fr('Réessayer'); return; }
          again.textContent = ui.fr('Réessayer dans ' + left + ' s');
          left--;
          setTimeout(tick, 1000);
        };
        setTimeout(tick, 0);
      }
      return box;
    }

    $('hello').appendChild(D.hello(function (goal) { send(goal); }));

    // Fiches des réglages (fiches.js, sinon l'aide du slicer) : gratuites. « Montre-moi où il est » ouvre le réglage dans Orca.
    function explain(key) { post({ type: 'explain', key: key }); }
    var ficheActions = {
      show: function (key) { post({ type: 'show_setting', key: key }); },
      ask: function (label) { send('Pour le réglage « ' + label + ' » : quelle valeur me conseilles-tu dans mon cas, et pourquoi ?'); }
    };
    // « Tu regardes : … » : un clic sur un réglage d'Orca (focus_setting) ; « Explique-moi » ouvre sa fiche, gratuite.
    var focusKey = null;
    function showFocus(msg) {
      focusKey = msg.key;
      $('focus-label').textContent = ui.fr(msg.label || msg.key || '');
      $('focus-chip').classList.toggle('hidden', !msg.key);
    }
    $('focus-explain').addEventListener('click', function () { if (focusKey) explain(focusKey); $('focus-chip').classList.add('hidden'); });
    $('focus-close').addEventListener('click', function () { $('focus-chip').classList.add('hidden'); });

    function onExplain(msg) { addToThread(D.fiche(record({ kind: 'fiche', msg: msg }).msg, { archived: false, explainActions: ficheActions })); }

    // ---------- Messages du slicer ----------
    var saveFailedShown = {}, otherInstanceShown = false;
    host.onMessage(function (msg) {
      if (!msg || !msg.type) return;
      if (msg.type === 'session') {
        session = msg.session;
        showLoggedIn(!!session);
        if (session) {
          dropLoginCard();
          refreshAccount();
          if (afterLogin) { var retry = afterLogin; afterLogin = null; retry(); }
        }
      } else if (msg.type === 'values') {
        lastValues = msg;
        post({ type: 'calib_history' }); // l'historique dépend du filament et de l'imprimante en cours
        drainPhoneQueue();
      } else if (msg.type === 'calib_history') {
        calibHistory = Array.isArray(msg.items) ? msg.items : [];
      } else if (msg.type === 'habits') {
        habits = Object.assign(root.PlyoMachines.emptyHabits(), msg.habits || {});
      } else if (msg.type === 'tour_signals') {
        tourSignals = msg;
      } else if (msg.type === 'ai_context') {
        if (contextWaiter) contextWaiter(msg);
      } else if (msg.type === 'project_resume') {
        onProjectResume(msg);
      } else if (msg.type === 'conv_loaded') {
        if (Logic.convLoaded(msg, false, false).restore) restoreConversation(msg.id, msg.conversation);
        else say('Ce projet n’existe plus : il a été supprimé, ou rangé pour faire de la place.', 'error');
      } else if (msg.type === 'project_changed') {
        // Nouveau projet ou projet ouvert dans Orca : la conversation d'avant reste enregistrée. Ce qu'Orca a laissé de côté en
        // changeant de projet : retouches d'impression, filament du fichier (v2/finitions.js).
        if (V2.fenetre) V2.fenetre.close();
        if (!busy) newConversation(); else projectSwitched = true;
        post({ type: 'file_filament_get' });
        askRetouches(300);
      } else if (msg.type === 'conv_save_failed') {
        var why = msg.reason || 'too_big';
        if (!saveFailedShown[why]) { saveFailedShown[why] = true; say(Logic.saveFailedText(why), 'error'); }
      } else if (msg.type === 'other_instance') {
        if (!otherInstanceShown) { otherInstanceShown = true; say(Logic.OTHER_INSTANCE_TEXT, 'error'); }
      } else if (msg.type === 'dictation') {
        onDictation(msg);
      } else if (msg.type === 'project_opened') {
        // Plateau d'un projet rouvert : ce qui n'a pas marché est dit (pas retrouvé, annulé) ; Orca occupé : nouvelle demande.
        onProjectOpened(msg);
      } else if (msg.type === 'project_attach_refused') {
        onAttachRefused(msg);
      } else if (msg.type === 'project_attached') {
        clearTimeout(attachRetry.timer); attachRetry = { conv: null, tries: 0, timer: null };
      } else if (msg.type === 'project_detached') {
        onProjectDetached(msg);
      } else if (msg.type === 'project_file') {
        // Le plateau trop lourd peut être celui de la conversation qu'on vient de quitter : dit aussi.
        if (msg.kept === false) say(P.projectFileText(msg.reason, !(conv && msg.conv === conv.id)), 'warn');
      } else if (msg.type === 'conv_pruned') {
        // Un ancien projet effacé pour faire de la place : toujours dit, jamais en silence.
        (Array.isArray(msg.names) ? msg.names : []).forEach(function (name) { say(Logic.prunedText(name)); });
      } else if (msg.type === 'focus_setting') {
        showFocus(msg);
      } else if (msg.type === 'phone_pick_files') {
        // Fenêtre du QR fermée par « Choisir des photos sur l'ordinateur » : un bouton ici (le choix de fichiers demande un clic).
        var sketch = phonePurpose() === 'sketch';
        var pick = say('Choisis tes photos sur l’ordinateur :', 'info', [{ label: 'Choisir mes photos', primary: true, run: function () {
          pick.remove();
          if (sketch && V2.piece && V2.piece.attachSketch) V2.piece.attachSketch(); else fileInput.click();
        } }]);
      } else if (msg.type === 'phone_batch_ready') {
        pollPhone(); // la fenêtre du QR s'est fermée sur un envoi : on le traite sans attendre
      } else if (msg.type === 'explain') {
        onExplain(msg);
      } else if (msg.type === 'show_setting') {
        if (!msg.ok) say('Je n’ai pas trouvé ce réglage dans les onglets de Plyo.', 'error');
        else if (msg.hidden) say('J’ai ouvert la bonne page. Si tu ne vois pas le réglage, active le bouton « Avancé » en haut des réglages.');
      }
      (listeners[msg.type] || []).forEach(function (fn) { fn(msg); });
    });

    // Ce que les écrans des étapes (lots suivants) utilisent du panneau.
    V2.panel = {
      post: post,
      email: function () { return email; },
      setHabits: function (h) { habits = Object.assign(root.PlyoMachines.emptyHabits(), h || {}); post({ type: 'habits_set', habits: habits }); (listeners.habits || []).forEach(function (fn) { fn({ type: 'habits', habits: habits }); }); },
      logout: function () { logout('Tu es déconnecté. Tes projets restent sur cet ordinateur.'); },
      openLogin: openLogin,
      openStep: openStep,
      askRetouches: askRetouches,
      iso: iso,
      record: record,
      setGauge: setGauge,
      hold: setHold,
      held: function () { return hold; },
      tourSignals: function () { return tourSignals; },
      openPhone: openPhone,
      explain: explain,
      aiContext: aiContext,
      habits: function () { return habits; },
      gauge: function () { return lastGauge; },
      // Photos depuis l'ordinateur pour la prochaine demande, avec une phrase déjà écrite dans le champ (diagnostic d'un raté).
      pickPhotos: function (prefill) { if (prefill && !input.value.trim()) { input.value = prefill; growNote(); } fileInput.click(); },
      prefill: function (text) { input.value = text || ''; growNote(); input.focus(); },
      scrollDown: scrollDown,
      addToThread: addToThread,
      setPhoneRoute: function (route) { if (phoneRoutes.indexOf(route) < 0) phoneRoutes.push(route); syncPhonePurpose(); },
      syncPhone: syncPhonePurpose,
      openConversation: function (id) { if (busy) { say('Attends la fin de la réponse (ou annule-la) avant d’ouvrir un autre projet.'); return; } flushSave(); post({ type: 'conv_load', id: id }); },
      conv: function () { return conv; },
      values: function () { return lastValues; },
      session: function () { return session; },
      apiFetch: api.apiFetch,
      busy: function () { return busy; },
      render: render,
      scheduleSave: scheduleSave,
      send: send,
      say: say,
      requireLogin: requireLogin,
      newConversation: newConversation,
      on: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
    };

    // Écrans des étapes branchés sur le panneau (v2/piece.js…), une fois V2.panel prêt.
    (V2.plugins || []).forEach(function (fn) { fn(V2.panel); });
    startConversation();
    post({ type: 'tour_signals' });
    post({ type: 'project_resume_get' });
    resume.timer = setTimeout(function () { if (resume.waiting) onProjectResume({}); }, 1500);
    // Fermeture du panneau (ou bascule) : ce qui attend d'être enregistré part tout de suite.
    root.addEventListener('pagehide', flushSave);
    root.addEventListener('beforeunload', flushSave);
    post({ type: 'habits_get' });
    showLoggedIn(false);
    post({ type: 'ready' });
    post({ type: 'session_load' });
    return V2.panel;
  };
})(typeof window !== 'undefined' ? window : globalThis);
