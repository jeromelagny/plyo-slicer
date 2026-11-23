// Conversation d'un projet, sans DOM : création, reprise d'une conversation enregistrée, ce que le slicer enregistre, et
// l'échange question-réponse gardé pour l'IA. Partagé par le panneau classique (index.html) et la v2 (v2/index.html) : les
// deux pages lisent et écrivent les mêmes conversations. Testé par node (tests/ai-client.test.mjs). window.PlyoConversation.
(function (root) {
  var Logic = root.PlyoLogic || (typeof require !== 'undefined' ? require('./assistant-logic.js') : null);
  var P = root.PlyoProject || (typeof require !== 'undefined' ? require('./project-logic.js') : null);

  function newId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

  // Conversation neuve : { id, title, updated, entries, history, project }.
  function create(id, project, nowIso) {
    return { id: id, title: '', updated: nowIso, entries: [], history: [], project: project || P.emptyProject() };
  }

  // Conversation enregistrée (conv_load, project_resume) redevenue active.
  function fromSaved(id, c) {
    var conv = { id: id, title: c.title || '', updated: c.updated || '', entries: c.entries, history: Array.isArray(c.history) ? c.history : [],
      project: c.project && typeof c.project === 'object' ? c.project : P.emptyProject() };
    if (P.nextStep(conv.project) === 'ready' && conv.project.part && !conv.project.adapted) conv.project.adapted = conv.project.part.name; // ancienne conversation : jamais réadaptée
    return conv;
  }

  // Une conversation vaut d'être gardée dès qu'elle a des échanges ou une pièce : un simple lancement n'enregistre rien.
  function partName(c) { return c && c.project && c.project.part && c.project.part.name || ''; }
  function worthSaving(c) { return !!c && (c.entries.length > 0 || !!partName(c)); }
  // Ce que le slicer enregistre (message conv_save) ; le nom de la pièce sert de titre.
  function savePayload(c) { return { title: c.title || partName(c), updated: c.updated, entries: c.entries, history: c.history, project: c.project }; }

  // Ta demande dans la conversation (les vignettes des photos sont ajoutées ensuite).
  function meEntry(text, fromPhone) { return { kind: 'me', text: text, thumbs: [], fromPhone: !!fromPhone }; }

  // Réponse complète du service, prête à garder : les réglages du catalogue rejoignent les suggestions, avec les profils
  // du moment de la question (les réglages proposés ne s'appliquent qu'à eux).
  function normalizeAnswer(a, names) {
    a.suggestions = (a.suggestions || []).concat(Logic.catalogToSuggestions(a.changes));
    if (names) a.names = names;
    return a;
  }

  // Ce que l'assistant a répondu, pour le renvoyer dans l'historique au tour suivant.
  function summaryForHistory(a, commandsResult) {
    var parts = [a.message];
    var orders = Logic.commandsForHistory(a, commandsResult || null);
    if (orders) parts.push(orders);
    a.questions.forEach(function (q) { parts.push(q.text + ' (' + q.choices.join(' / ') + ')'); });
    a.suggestions.forEach(function (s) { parts.push('suggestion: ' + s.id + ' ' + (s.delta !== null ? 'delta ' + s.delta : '= ' + s.value)); });
    return parts.join('\n').slice(0, 2000);
  }

  // L'échange entre dans l'historique envoyé à l'IA (`max` derniers messages). Renvoie la ligne de la réponse : « proposed »
  // devient « applied » ou « undone » quand ses réglages sont appliqués ou annulés (historyForAI le dit à l'IA).
  function exchange(conv, note, photoCount, a, max) {
    // 2 000 caractères au plus : au-delà, l'API refuserait toutes les demandes suivantes de la conversation.
    conv.history.push({ role: 'user', text: ((photoCount ? '(' + photoCount + ' photo(s) envoyée(s)) ' : '') + note).slice(0, 2000) });
    var hist = { role: 'assistant', text: summaryForHistory(a) };
    if (a.suggestions.length) hist.cards = 'proposed';
    conv.history.push(hist);
    conv.history = conv.history.slice(-max);
    return hist;
  }

  function answerEntry(a, photoCount, note, nowIso) {
    return { kind: 'answer', data: a, photoCount: photoCount, question: note, date: nowIso, applied: false };
  }

  var api = { newId: newId, create: create, fromSaved: fromSaved, partName: partName, worthSaving: worthSaving, savePayload: savePayload,
    meEntry: meEntry, normalizeAnswer: normalizeAnswer, summaryForHistory: summaryForHistory, exchange: exchange, answerEntry: answerEntry };
  root.PlyoConversation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
