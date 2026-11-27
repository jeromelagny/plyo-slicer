// Fil du projet : ce qui s'est passé, quel que soit l'onglet (Étapes ou discussion), gardé avec le projet (project.thread)
// et transmis à l'assistant avec chaque question, pour que les deux onglets parlent du même projet.
// Pas d'état propre : index.html appelle add() aux moments importants. Chargé par index.html (window.PlyoThread).
(function (root) {
  var MAX = 30, MAX_TEXT = 200;
  var FROM = { etapes: 1, discussion: 1, slicer: 1 };
  var STEP_LABELS = { machine: 'Machine', piece: 'Pièce', filament: 'Filament', preparer: 'Préparer', imprimer: 'Imprimer', resultat: 'Résultat' };

  // Heure locale « AAAA-MM-JJTHH:MM:SS » (celle que voit l'utilisateur, pas le temps universel).
  function localIso(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT); }

  // Ajoute un événement { at (ISO), from, text } ; le même texte juste après lui-même n'est pas répété. 30 au plus (les plus
  // anciens partent). Rend vrai si le fil a changé.
  function add(project, from, text, now) {
    if (!project || typeof project !== 'object') return false;
    var t = clean(text);
    if (!t) return false;
    var list = Array.isArray(project.thread) ? project.thread : [];
    var last = list[list.length - 1];
    if (last && last.text === t) return false;
    list.push({ at: localIso(now || new Date()), from: FROM[from] ? from : 'etapes', text: t });
    project.thread = list.slice(-MAX);
    return true;
  }

  // Ce que l'assistant reçoit : l'étape en cours et le fil (heure locale « HH:MM », d'où ça vient, quoi).
  function forAI(project, step) {
    var list = project && Array.isArray(project.thread) ? project.thread : [];
    return {
      step: STEP_LABELS[step] ? step : 'machine',
      thread: list.slice(-MAX).map(function (e) { return { at: String(e.at || '').slice(11, 16), from: FROM[e.from] ? e.from : 'etapes', text: clean(e.text) }; }).filter(function (e) { return e.text; })
    };
  }

  // Réglages d'un lot appliqué, en une phrase : « Réglages changés (discussion) : Température de la buse 220 → 215, … ».
  function appliedText(applied, from) {
    var items = (Array.isArray(applied) ? applied : []).filter(function (a) { return a && (a.label || a.id); });
    if (!items.length) return '';
    var said = items.slice(0, 4).map(function (a) {
      var v = function (x) { return x === true ? 'oui' : x === false ? 'non' : String(x).replace('.', ','); };
      return (a.label || a.id) + (a.before !== undefined && a.after !== undefined ? ' ' + v(a.before) + ' → ' + v(a.after) : '');
    });
    return 'Réglages changés' + (from === 'discussion' ? ' depuis la discussion' : '') + ' : ' + said.join(', ') + (items.length > 4 ? ' et ' + (items.length - 4) + ' autres' : '') + '.';
  }

  // Ce que la discussion a appris de l'impression (print_outcome de l'assistant) → les gestes de l'onglet Étapes à rejouer,
  // dans l'ordre, et la phrase dite dans la discussion. Seulement aux étapes Imprimer et Résultat, jamais deux fois.
  var OUTCOME_SAID = { started: 'C’est noté dans tes étapes : ton impression est lancée.', success: 'C’est noté dans tes étapes : impression réussie. Je retiens ces réglages.', failed: 'C’est noté dans tes étapes : impression ratée. Montre-moi une photo du défaut, je te propose quoi changer.' };
  function outcomeMoves(step, outcome, already) {
    if (!OUTCOME_SAID[outcome] || (step !== 'imprimer' && step !== 'resultat')) return { moves: [], text: '' };
    var moves = step === 'imprimer' ? ['started'] : [];
    if (outcome === 'success' && !already.success) moves.push('success');
    if (outcome === 'failed' && !already.failed) moves.push('failed');
    if (!moves.length) return { moves: [], text: '' };
    return { moves: moves, text: OUTCOME_SAID[outcome] };
  }

  var api = { MAX: MAX, STEP_LABELS: STEP_LABELS, add: add, forAI: forAI, appliedText: appliedText, outcomeMoves: outcomeMoves };
  root.PlyoThread = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
