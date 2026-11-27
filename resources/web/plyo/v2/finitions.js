// Assistant v2 (lot 5) : ce que le panneau classique fait en marge du parcours, repris dans la discussion de la v2.
// - « Signaler » sous une réponse de l'IA (/api/feedback, gratuit) ;
// - « Ça n'a pas aidé ? Récupérer mes N crédits » sous une réponse payée (/api/refunds, une fois par demande) ;
// - retouches faites à la main dans Orca : retouches d'impression laissées avec le projet d'avant (print_retouches,
//   confirmé seulement), retouche du filament gardée dans la bobine (spool_kept), valeurs du filament d'un fichier ouvert
//   non reprises (file_filament) — mêmes textes que le classique (retouches-logic.js) ;
// - « J'ai adapté ce fichier à ton projet » : les réglages du 3MF repris, ceux écartés, et « Annuler ».
// Mêmes messages au slicer que le classique : retouches_get, retouches_keep, retouches_dismiss, retouches_undo,
// spool_kept_undo, file_filament_get, file_filament_take, undo.
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var ui = V2.ui;
  var R = root.PlyoRetouches;
  var Logic = root.PlyoLogic;
  var panel = null, level = '';
  var rt = { card: null, asked: '', printUndo: null, spoolUndo: null, spoolToken: 0, fileTake: null };

  function say(text, kind, acts) { return panel.say(text, kind, acts); }
  function undoLink(run) { return ui.button('Annuler', run, 'link', 'undo'); }
  function append(box, node) { box.body.appendChild(node); return node; }

  // ---------- « Ça n'a pas aidé ? » ----------
  // Un clic rend les crédits de la demande (plyo-api, refund_usage) ; la jauge est remise à jour.
  function refundLink(entry, a, foot) {
    var offer = Logic.refundOffer(entry, a);
    if (!offer) return null;
    var link = ui.button(offer.label, null, 'link muted', 'undo');
    link.title = ui.fr('La réponse ne t’a pas aidé ? Tes crédits te sont rendus, au plus 3 fois par mois.');
    var line = null;
    function done(text, ok) {
      link.remove();
      if (line) line.remove();
      line = ui.el('span', 'done-line' + (ok ? ' ok' : ''), text);
      foot.insertBefore(line, foot.firstChild);
    }
    link.addEventListener('click', function () {
      link.disabled = true;
      panel.apiFetch('/api/refunds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: entry.requestId }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); })
        .then(function (r) {
          if (r.ok || r.data.error === 'already_refunded') {
            entry.refunded = true;
            panel.scheduleSave();
            if (r.data.gauge) panel.setGauge(r.data.gauge, true);
            done(Logic.refundDoneText(r.ok ? r.data.refunded : offer.charged), true);
            return;
          }
          var code = r.status === 401 ? 'unauthorized' : r.data.error;
          // Refus définitif (limite du mois, trop ancienne, rien à rendre) : le lien disparaît ; panne : il revient.
          if (code === 'refund_limit' || code === 'refund_too_old' || code === 'usage_not_found' || code === 'nothing_to_refund') { done(Logic.refundErrorText(code, panel.gauge()), false); return; }
          link.disabled = false;
          done(Logic.refundErrorText(code, panel.gauge()), false);
          foot.insertBefore(link, line.nextSibling);
        })
        .catch(function () { link.disabled = false; done(Logic.refundErrorText('network'), false); foot.insertBefore(link, line.nextSibling); });
    });
    foot.appendChild(link);
    return link;
  }

  // ---------- « Signaler » ----------
  function answerFoot(entry, box) {
    var a = entry.data || {};
    if (!panel.session() || a.status === 'off_topic') return;
    var foot = ui.el('div', 'ai-foot');
    refundLink(entry, a, foot);
    if (entry.flagged) { if (foot.children.length) box.appendChild(foot); return; }
    var link = ui.button('Signaler', null, 'link muted', 'flag');
    link.title = ui.fr('Cette réponse te semble fausse ou inutile ? Dis-le-nous : c’est gratuit, et ça sert à corriger l’assistant.');
    link.addEventListener('click', function () {
      var form = ui.el('div', 'feedback');
      var input = ui.el('textarea', 'field');
      input.maxLength = 1000;
      input.rows = 2;
      input.placeholder = ui.fr('Qu’est-ce qui ne va pas dans cette réponse ? (facultatif)');
      input.setAttribute('aria-label', ui.fr('Ce qui ne va pas'));
      var acts = ui.el('div', 'acts');
      var go = ui.button('Envoyer le signalement', function () {
        go.disabled = true;
        var v = panel.values();
        panel.apiFetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          verdict: 'bad', comment: input.value.trim() || undefined, question: (entry.question || '').slice(0, 2000), locale: (v && v.locale) || 'fr',
          answer: { status: a.status, defect: a.defect, message: a.message, suggestions: a.suggestions, actions: a.actions || [] },
          context: v && v.context ? { printer: v.context.printer, filament: v.context.filament } : undefined
        }) })
          .then(function (r) { return r.ok ? null : Promise.reject(); })
          .then(function () { form.remove(); foot.appendChild(ui.el('span', 'done-line ok', 'Merci, c’est noté : on s’en sert pour corriger l’assistant.')); entry.flagged = true; panel.scheduleSave(); })
          .catch(function () { go.disabled = false; go.textContent = ui.fr('Réessayer l’envoi'); });
      }, 'btn sm');
      acts.appendChild(go);
      acts.appendChild(ui.button('Laisser tomber', function () { form.remove(); foot.appendChild(link); }, 'link'));
      form.appendChild(input);
      form.appendChild(acts);
      link.remove();
      foot.appendChild(form);
      input.focus();
    });
    foot.appendChild(link);
    box.appendChild(foot);
  }

  // ---------- Retouches d'impression laissées avec le projet d'avant (UX-31) ----------
  // Débutant : jamais de question (retouches_dismiss, comme le classique) ; confirmé : une carte, posée une fois.
  function onPrintRetouches(msg) {
    var p = msg.pending || {}, text = R.printQuestion(p), key = JSON.stringify([p.preset, p.project, (p.changes || []).length]);
    if (rt.card) { rt.card.remove(); rt.card = null; }
    if (!text) return;
    if (level !== 'expert' || rt.asked === key) { panel.post({ type: 'retouches_dismiss' }); return; }
    rt.asked = key;
    var box = say('**Une question sur ton projet d’avant**\n' + text, 'info');
    box.classList.add('retouches-card');
    var fold = ui.el('details', 'fold-detail');
    fold.appendChild(ui.el('summary', '', 'Voir les réglages'));
    fold.appendChild(ui.el('p', 'hint', R.printDetail(p)));
    append(box, fold);
    var err = append(box, ui.el('p', 'err hidden'));
    var acts = append(box, ui.el('div', 'acts'));
    var keep = ui.button(R.KEEP_LABEL, function () { keep.disabled = only.disabled = true; err.classList.add('hidden'); panel.post({ type: 'retouches_keep' }); }, 'btn sm main', 'check');
    var only = ui.button(R.ONLY_LABEL, function () {
      panel.post({ type: 'retouches_dismiss' });
      box.remove(); rt.card = null;
      say(R.ONLY_NOTE);
    }, 'link');
    acts.appendChild(keep);
    acts.appendChild(only);
    box.keep = keep; box.only = only; box.err = err;
    rt.card = box;
  }
  function onPrintRetouchesKept(msg) {
    var box = rt.card;
    if (!msg.ok) {
      if (msg.gone && box) { box.remove(); rt.card = null; say(msg.text); return; }
      if (box) { box.keep.disabled = box.only.disabled = false; box.err.textContent = ui.fr(msg.text || 'Je n’ai pas pu garder ces retouches.'); box.err.classList.remove('hidden'); }
      else say(msg.text || 'Je n’ai pas pu garder ces retouches.', 'error');
      return;
    }
    if (box) { box.remove(); rt.card = null; }
    var line = say(msg.text);
    if (/a déjà ces réglages/.test(msg.text || '')) return; // rien d'écrit : rien à annuler
    var undo = undoLink(function () { undo.disabled = true; panel.post({ type: 'retouches_undo' }); });
    append(line, undo);
    rt.printUndo = undo;
  }
  function onPrintRetouchesUndone(msg) {
    if (!msg.ok) { if (rt.printUndo) rt.printUndo.disabled = false; say(msg.text || 'Je n’ai pas pu annuler.', 'error'); return; }
    if (rt.printUndo) rt.printUndo.remove();
    rt.printUndo = null;
    say(msg.text);
  }

  // ---------- Retouche du filament gardée dans la bobine (UX-32), avec « Annuler » (la plus récente seulement) ----------
  function onSpoolKept(msg) {
    var text = R.spoolKeptText(msg.spool, msg.changes);
    if (!text) return;
    if (rt.spoolUndo) rt.spoolUndo.remove();
    var line = say(text), token = msg.token;
    var undo = undoLink(function () { undo.disabled = true; panel.post({ type: 'spool_kept_undo', token: token }); });
    append(line, undo);
    rt.spoolUndo = undo; rt.spoolToken = token;
  }
  function onSpoolKeptUndone(msg) {
    var undo = msg.token === rt.spoolToken ? rt.spoolUndo : null;
    if (!msg.ok) { if (undo) undo.disabled = false; say(msg.text || 'Je n’ai pas pu annuler.', 'error'); return; }
    if (undo) undo.remove();
    rt.spoolUndo = null;
    say(msg.text);
  }
  function onSpoolKeepFailed(msg) {
    var line = say(R.spoolFailText(msg.reason, msg.label, msg.spool), 'warn');
    if (msg.key) append(line, ui.button('Montre-moi où il est', function () { panel.post({ type: 'show_setting', key: msg.key }); }, 'link'));
  }

  // ---------- Fichier ouvert dont les valeurs du filament ne sont pas reprises (UX-36) ----------
  function onFileFilament(msg) {
    var text = R.fileFilamentText(msg.info);
    if (!text) return;
    var line = say(text);
    var take = ui.button(R.TAKE_FILE_LABEL, function () { take.disabled = true; rt.fileTake = take; panel.post({ type: 'file_filament_take' }); }, 'link');
    append(line, take);
  }
  function onFileFilamentTaken(msg) {
    var take = rt.fileTake;
    if (!msg.ok) { if (take) take.disabled = false; say(msg.text || 'Je n’ai pas pu reprendre ces réglages.', 'error'); return; }
    if (take) take.remove();
    var line = say(msg.text);
    if (!msg.undo_id) return;
    var undoId = msg.undo_id;
    var b = undoLink(function () {
      b.disabled = true;
      V2.imprimer.ask({ type: 'undo', undo_id: undoId }, function (ok, t) { if (!ok) { b.disabled = false; say(t, 'error'); return; } b.remove(); say('Réglages de ta bobine remis.'); });
    });
    append(line, b);
  }

  // ---------- « J'ai adapté ce fichier à ton projet » (3MF d'un autre créateur), avec « Annuler » ----------
  var adaptedShown = {};
  function adaptationCard(a) {
    var adapted = Array.isArray(a.adapted) ? a.adapted : [], dropped = Array.isArray(a.dropped) ? a.dropped : [];
    if (!adapted.length && !dropped.length && !a.error) return;
    var key = a.undo_id || JSON.stringify([adapted.length, dropped.length, a.error || '']);
    if (adaptedShown[key]) return;
    adaptedShown[key] = true;
    var text = a.error ? 'Je n’ai pas pu adapter les réglages de ce fichier à ton projet : ' + a.error
      : adapted.length ? 'J’ai adapté ce fichier à ton imprimante et à ton filament : ' + adapted.length + ' réglage' + (adapted.length > 1 ? 's' : '') + ' changé' + (adapted.length > 1 ? 's' : '') + '.'
      : 'Les réglages de ce fichier conviennent déjà à ton projet.';
    var box = say(text, a.error ? 'warn' : 'info');
    box.classList.add('adapted');
    if (adapted.length) {
      var list = ui.el('ul', 'hint');
      adapted.forEach(function (c) { list.appendChild(ui.el('li', '', c.label + ' : ' + String(c.before).replace('.', ',') + ' → ' + String(c.after).replace('.', ','))); });
      append(box, list);
    }
    if (dropped.length) append(box, ui.el('p', 'hint', 'Écartés (hors des limites sûres) : ' + dropped.map(function (d) { return d.label; }).join(', ') + '.'));
    if (adapted.length && a.undo_id) {
      var undo = ui.button('Annuler', function () {
        undo.disabled = true;
        V2.imprimer.ask({ type: 'undo', undo_id: a.undo_id }, function (ok, t) {
          if (!ok) { undo.disabled = false; say(t, 'error'); return; }
          box.body.textContent = '';
          box.body.appendChild(ui.rich('Annulé : j’ai remis les réglages d’avant.'));
        });
      }, 'btn sm', 'undo');
      append(box, undo);
    }
  }

  function plug(pn) {
    panel = pn;
    pn.on('firststeps', function (msg) { level = (msg.state || {}).level || ''; });
    pn.on('print_retouches', onPrintRetouches);
    pn.on('print_retouches_kept', onPrintRetouchesKept);
    pn.on('print_retouches_undone', onPrintRetouchesUndone);
    pn.on('spool_kept', onSpoolKept);
    pn.on('spool_kept_undone', onSpoolKeptUndone);
    pn.on('spool_keep_failed', onSpoolKeepFailed);
    pn.on('file_filament', onFileFilament);
    pn.on('file_filament_taken', onFileFilamentTaken);
    pn.on('model_adapted', function (msg) { if (msg.adaptation) adaptationCard(msg.adaptation); });
    pn.on('model_added', function (msg) { if (msg.ok !== false && msg.adaptation) adaptationCard(msg.adaptation); });
    pn.askRetouches(2500); // retouches d'impression laissées à la dernière fermeture d'Orca (UX-31)
  }
  (V2.plugins = V2.plugins || []).push(plug);

  V2.finitions = { answerFoot: answerFoot };
})(typeof window !== 'undefined' ? window : globalThis);
