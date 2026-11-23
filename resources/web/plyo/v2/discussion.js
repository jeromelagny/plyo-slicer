// Assistant v2 : la discussion avec l'assistant, sous la carte de l'étape, dans le même fil. Vue seulement : les demandes
// partent de v2/panneau.js (même service et même flux que le panneau classique, ai-client.js). Chargé par v2/index.html.
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var Logic = root.PlyoLogic;
  var ui = V2.ui;

  // Objectifs proposés quand la discussion est vide (les mêmes que dans le panneau classique).
  var GOALS = ['Je veux une surface du dessus bien lisse', 'Je veux imprimer plus vite', 'Je veux une pièce plus solide',
    'Quels supports pour une figurine ?', 'Je veux plus de détails'];

  function hello(onPick) {
    var box = ui.el('div', 'hello');
    box.appendChild(ui.el('h3', '', 'Une question ? Demande avec tes mots'));
    var chips = ui.el('div', 'chips');
    GOALS.forEach(function (g) { chips.appendChild(ui.button(g, function () { onPick(g); }, 'chip')); });
    box.appendChild(chips);
    return box;
  }

  // Ta demande : vignettes des photos, texte, « envoyé depuis le téléphone ».
  function me(entry) {
    var box = ui.el('div', 'msg me');
    if (entry.thumbs && entry.thumbs.length) {
      var grid = ui.el('div', 'thumbs');
      entry.thumbs.forEach(function (src) { var i = ui.el('img'); i.src = src; i.alt = ''; grid.appendChild(i); });
      box.appendChild(grid);
    }
    if (entry.text) box.appendChild(ui.el('div', 'text', entry.text));
    if (entry.fromPhone) { var f = ui.el('span', 'from'); f.appendChild(ui.icon('phone', 12)); f.appendChild(ui.txt('Envoyé depuis le téléphone')); box.appendChild(f); }
    return box;
  }

  function who(suffix) {
    var w = ui.el('div', 'who');
    w.appendChild(ui.el('i', '', 'P'));
    w.appendChild(ui.txt('Assistant' + (suffix ? ' · ' + suffix : '')));
    return w;
  }

  // Réglages proposés par une réponse, avec leur valeur visée (lecture des réglages du slicer, jamais en dur).
  function suggestionList(a, params) {
    var list = ui.el('ul', 'proposed');
    a.suggestions.forEach(function (s) {
      var p = (params || []).filter(function (x) { return x.id === s.id; })[0];
      var label = s.label || (p && p.label) || s.id;
      var after = s.valueText || (s.delta !== null && s.delta !== undefined && p && typeof p.value === 'number' ? Logic.valueText(p.value + s.delta, p.key) : Logic.valueText(s.value, p && p.key));
      list.appendChild(ui.el('li', '', label + ' → ' + after));
    });
    return list;
  }

  // Questions de l'assistant : un choix par question, puis « Envoyer mes réponses ». `onAnswer(texte)` envoie la réponse.
  function questions(entry, archived, onAnswer, onChange) {
    var qs = entry.data.questions, picks = entry.answers || {};
    var wrap = ui.el('div', 'questions');
    var send = ui.button('Envoyer mes réponses', null, 'btn sm');
    qs.forEach(function (q, i) {
      wrap.appendChild(ui.el('p', 'q', q.text));
      var row = ui.el('div', 'chips');
      q.choices.forEach(function (c) {
        var chip = ui.button(c, null, 'chip' + (picks[i] === c ? ' sel' : ''));
        chip.disabled = archived || !!entry.answered;
        chip.addEventListener('click', function () {
          picks[i] = c;
          row.querySelectorAll('.chip').forEach(function (b) { b.classList.toggle('sel', b === chip); });
          send.disabled = !Logic.allAnswered(qs, picks);
        });
        row.appendChild(chip);
      });
      wrap.appendChild(row);
    });
    if (!archived && !entry.answered) {
      send.disabled = !Logic.allAnswered(qs, picks);
      send.addEventListener('click', function () {
        entry.answered = true;
        entry.answers = picks;
        if (onChange) onChange();
        wrap.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        onAnswer(Logic.combineAnswers(qs, picks));
      });
      var acts = ui.el('div', 'acts');
      acts.appendChild(send);
      wrap.appendChild(acts);
    }
    return wrap;
  }

  // Réponse de l'assistant (entrée « answer » de la conversation). `o` : { params (réglages lus), archived, onAnswer,
  // onChange (l'entrée a changé : à enregistrer) }.
  function answer(entry, o) {
    var a = entry.data;
    var box = ui.el('div', 'msg ai');
    box.appendChild(who(entry.photoCount ? 'd’après ' + (entry.photoCount > 1 ? 'tes ' + entry.photoCount + ' photos' : 'ta photo') : ''));
    if (a.status !== 'question' && a.status !== 'off_topic' && a.defect && a.defect.name) {
      box.appendChild(ui.el('h4', '', a.defect.name));
      if (a.defect.explanation) box.appendChild(ui.rich(a.defect.explanation));
    }
    if (a.message) box.appendChild(ui.rich(a.message));
    if (a.suggestions && a.suggestions.length) {
      var sheet = ui.el('div', 'sheet');
      sheet.appendChild(ui.el('p', 'sheet-title', entry.applied ? 'Réglages appliqués' : 'Réglages proposés'));
      sheet.appendChild(suggestionList(a, o.params));
      box.appendChild(sheet);
    }
    var cost = Logic.offTopicCostNote(a);
    if (cost) box.appendChild(ui.el('p', 'small muted', cost));
    var dropped = Logic.rejectedNote(a);
    if (dropped) box.appendChild(ui.el('p', 'small muted', dropped));
    if (a.questions && a.questions.length) box.appendChild(questions(entry, !!o.archived, o.onAnswer, o.onChange));
    return box;
  }

  // Attente de la réponse : les trois points et le texte qui change avec le temps, puis le brouillon de la réponse pendant
  // que l'IA l'écrit ; « Annuler » reste à portée de main.
  function waiting(text, onCancel) {
    var box = ui.el('div', 'msg ai waiting');
    var row = ui.el('div', 'typing');
    row.setAttribute('role', 'status');
    for (var i = 0; i < 3; i++) row.appendChild(ui.el('i'));
    var label = ui.el('span', 'wait-text', text);
    row.appendChild(label);
    row.appendChild(ui.button('Annuler', onCancel, 'link'));
    box.appendChild(row);
    var draft = null;
    return {
      node: box,
      say: function (t) { label.textContent = ui.fr(t); },
      // Réponse en cours d'écriture (événement « partial » du flux).
      live: function (p) {
        if (!draft) {
          row.classList.add('hidden');
          draft = { title: ui.el('h4'), explanation: ui.el('div'), message: ui.el('div') };
          box.appendChild(who());
          box.appendChild(draft.title);
          box.appendChild(draft.explanation);
          box.appendChild(draft.message);
          var stop = ui.button('Arrêter', onCancel, 'link');
          stop.classList.add('stop');
          box.appendChild(stop);
        }
        draft.title.textContent = ui.fr(p.name || '');
        draft.explanation.textContent = '';
        if (p.explanation) draft.explanation.appendChild(ui.rich(p.explanation));
        draft.message.textContent = '';
        if (p.message) draft.message.appendChild(ui.rich(p.message));
      }
    };
  }

  // Message du panneau dans le fil (erreur, connexion, information), avec ses boutons : [{ label, run, primary }].
  function notice(kind, text, actions) {
    var box = ui.el('div', 'notice ' + (kind || 'info'));
    box.appendChild(ui.icon(kind === 'error' || kind === 'warn' ? 'alert' : 'info', 18));
    var body = ui.el('div', 'notice-body');
    body.appendChild(ui.rich(text));
    if (actions && actions.length) {
      var acts = ui.el('div', 'acts');
      actions.forEach(function (a) { acts.appendChild(ui.button(a.label, a.run, a.primary ? 'btn sm main' : 'btn sm')); });
      body.appendChild(acts);
    }
    box.appendChild(body);
    box.body = body;
    return box;
  }

  V2.discussion = { GOALS: GOALS, hello: hello, me: me, answer: answer, waiting: waiting, notice: notice };
})(typeof window !== 'undefined' ? window : globalThis);
