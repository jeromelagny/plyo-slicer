// « Crée-moi une pièce » dans l'étape Pièce : décrire, répondre aux questions, voir la pièce posée, la retoucher.
// Pas d'état propre : index.html garde l'état (designUI) et fait les appels ; ici, les textes, la demande au service et le
// rendu. Un écran, peu de choix : un bouton principal, au plus un choix secondaire. Chargé par index.html (window.PlyoDesignFlow).
(function (root) {
  var TEXT = {
    entry: 'Je n’ai pas de fichier : crée-moi une pièce',
    title: 'Décris ta pièce',
    help: 'Dis ce qu’elle doit faire et ses dimensions si tu les connais. Par exemple : « une entretoise de 12 mm pour une vis M4 », « une boîte de 6 × 4 × 3 cm avec couvercle ».',
    scope: 'Je dessine des pièces simples : supports, boîtes, entretoises, crochets, plaques percées… Pas de figurines ni de personnages.',
    field: 'Ta pièce',
    go: 'Créer ma pièce',
    busy: 'Je dessine ta pièce…',
    retouchTitle: 'Qu’est-ce que je change ?',
    retouchHelp: 'Par exemple : « plus épaisse de 2 mm », « ajoute un trou de 5 mm au centre », « 10 % plus grande ».',
    retouchGo: 'Modifier ma pièce',
    placed: 'Ta pièce est sur le plateau',
    change: 'Changer quelque chose',
    assumed: 'supposé : vérifie',
    check: 'Vérifie la cote principale sur ta première impression.',
    cost: 'Utilise ta jauge, comme une question à l’assistant.',
    login: 'Me connecter pour créer une pièce',
    attach: 'Joindre un croquis ou une photo',
    attached: 'Image jointe',
    remove: 'retirer',
    // 403 plan_required de /api/design : la formule gratuite n'ouvre pas les pièces sur mesure.
    planRequired: 'Les pièces sur mesure font partie de Plyo+.',
    plans: 'Voir les formules'
  };
  var MAX_IMAGES = 2;

  // Corps de la demande à /api/design (DesignRequestSchema) : la conversation de conception reste en texte, la pièce en
  // cours seulement pour une retouche.
  function request(state, opts) {
    var o = opts || {};
    var body = { locale: o.locale || 'fr', text: String(state.text || '').trim().slice(0, 2000), conversation: (state.conversation || []).slice(-20), current: state.retouch && state.part ? state.part : null };
    // Croquis ou photo (cotes, objet à tenir) : deux au plus, déjà réduits par le panneau.
    var imgs = (state.images || []).filter(function (i) { return i && /^image\/(jpeg|png|webp)$/.test(i.media_type) && typeof i.data === 'string' && i.data; }).slice(0, MAX_IMAGES);
    if (imgs.length) body.images = imgs.map(function (i) { return { media_type: i.media_type, data: i.data }; });
    if (o.bed && o.bed.length === 3) body.bed = o.bed;
    if (o.material) body.material = String(o.material).slice(0, 40);
    if (o.requestId) body.request_id = o.requestId;
    return body;
  }

  // Réponses aux questions → une phrase, ajoutée à la conversation comme le ferait l'utilisateur.
  function answersText(questions, answers) {
    return (questions || []).map(function (q, i) { return q.text + ' ' + (answers && answers[i] ? answers[i] : ''); }).join(' · ');
  }

  // Cotes de la carte : « hauteur 12 mm », « trou 4,4 mm (supposé : vérifie) ».
  function dimensionLines(part) {
    return (part && Array.isArray(part.dimensions) ? part.dimensions : []).map(function (d) {
      return d.label + ' ' + String(d.value_mm).replace('.', ',') + ' mm' + (d.assumed ? ' (' + TEXT.assumed + ')' : '');
    });
  }

  // Nom de fichier sûr pour model_add (lettres, chiffres, espaces, tirets), terminé par .stl.
  function fileName(part) {
    var base = String(part && part.name || 'Pièce').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _×x-]/g, '').replace(/×/g, 'x').trim().slice(0, 50);
    return (base || 'Piece') + '.stl';
  }

  // ui : { el, button, icon } ; st : designUI ; h : { input(text), submit(), answer(i, choice), cancel(), retouch(), login(), plans() }.
  function render(slot, ui, st, h) {
    slot.textContent = '';
    var box = ui.el('div', 'project-body design-box');
    if (st.busy) {
      var wait = ui.el('p', 'thinking-line');
      wait.appendChild(ui.el('span', '', TEXT.busy));
      var dots = ui.el('span', 'thinking');
      for (var d = 0; d < 3; d++) dots.appendChild(ui.el('i'));
      wait.appendChild(dots);
      box.appendChild(wait);
      slot.appendChild(box);
      return;
    }
    if (st.questions && st.questions.length) {
      if (st.message) box.appendChild(ui.el('p', 'small', st.message));
      box.appendChild(ui.el('p', 'pick-hint', 'Clique sur ta réponse :'));
      st.questions.forEach(function (q, i) {
        box.appendChild(ui.el('p', 'intent-q', q.text));
        var row = ui.el('div', 'printer-actions');
        q.choices.forEach(function (c) { row.appendChild(ui.button(c, function () { h.answer(i, c); }, 'btn ghost sm' + (st.answers && st.answers[i] === c ? ' on' : ''))); });
        box.appendChild(row);
      });
      slot.appendChild(box);
      return;
    }
    box.appendChild(ui.el('p', 'intent-q', st.retouch ? TEXT.retouchTitle : TEXT.title));
    box.appendChild(ui.el('p', 'muted small', st.retouch ? TEXT.retouchHelp : TEXT.help));
    if (!st.retouch) box.appendChild(ui.el('p', 'muted small', TEXT.scope));
    if (st.message) box.appendChild(ui.el('p', st.failed ? 'project-error' : 'small', st.message));
    var input = ui.el('textarea', 'field design-text');
    input.rows = 3;
    input.maxLength = 2000;
    input.value = st.text || '';
    input.setAttribute('aria-label', TEXT.field);
    input.dataset.spoolName = '1'; // le panneau ne redessine pas sous les doigts
    input.addEventListener('input', function () { h.input(input.value); });
    box.appendChild(input);
    // Images jointes : leur nom et « retirer ».
    (st.images || []).forEach(function (img, i) {
      var row = ui.el('div', 'project-row project-sub');
      row.appendChild(ui.el('span', 'muted small', '🖼 ' + (img.name || TEXT.attached)));
      row.appendChild(ui.button(TEXT.remove, function () { h.removeImage(i); }, 'link'));
      box.appendChild(row);
    });
    if ((st.images || []).length < MAX_IMAGES && h.attach) box.appendChild(ui.button(TEXT.attach, h.attach, 'link', 'clip'));
    var acts = ui.el('div', 'printer-actions');
    if (st.needsLogin) acts.appendChild(ui.button(TEXT.login, h.login, 'btn sm main-choice', 'login'));
    else if (st.planRequired && h.plans) acts.appendChild(ui.button(TEXT.plans, h.plans, 'btn sm main-choice'));
    else acts.appendChild(ui.button(st.retouch ? TEXT.retouchGo : TEXT.go, h.submit, 'btn sm main-choice', 'wand'));
    acts.appendChild(ui.button('Annuler', h.cancel, 'link'));
    box.appendChild(acts);
    box.appendChild(ui.el('p', 'muted small', TEXT.cost));
    slot.appendChild(box);
    if (!input.value) setTimeout(function () { input.focus(); }, 0);
  }

  // Pièce retouchée alors que le projet était déjà préparé, imprimé ou réussi : c'est une nouvelle pièce à imprimer, le
  // parcours repart de « Préparer » (découper à nouveau). Avant la préparation, rien à refaire.
  function redoesPreparation(step, retouch) { return !!retouch && (step === 'preparer' || step === 'imprimer' || step === 'resultat'); }
  var REDO_TEXT = 'Ta pièce a changé : découpe-la à nouveau pour l’imprimer.';

  var api = { TEXT: TEXT, MAX_IMAGES: MAX_IMAGES, REDO_TEXT: REDO_TEXT, redoesPreparation: redoesPreparation, request: request, answersText: answersText, dimensionLines: dimensionLines, fileName: fileName, render: render };
  root.PlyoDesignFlow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
