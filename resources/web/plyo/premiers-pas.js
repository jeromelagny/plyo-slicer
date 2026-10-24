// Logique pure des premiers pas (sans DOM) : questions de définition, jugement d'une valeur, avancée du parcours.
// Chargée par index.html (window.PlyoFirstSteps) et testée par node (tests/premiers-pas.test.mjs).
(function (root) {
  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’`]/g, "'").replace(/[?!.,;:«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Formes d'une simple demande de définition : « c'est quoi X », « à quoi sert X », « X, ça sert à quoi »…
  var PREFIXES = [/^c'est quoi /, /^c est quoi /, /^qu'est-ce que /, /^qu'est ce que /, /^qu est ce que /, /^a quoi sert /,
    /^a quoi servent /, /^explique-moi /, /^explique moi /, /^explique /, /^que veut dire /, /^definition de /, /^definition /];
  var SUFFIXES = [/ c'est quoi$/, / ca sert a quoi$/, / sert a quoi$/, / ca veut dire quoi$/];
  var ARTICLE = /^(le |la |les |l'|un |une |du |de la |des |ce |cette )/;

  function subjectOf(text) {
    var t = normalize(text);
    for (var i = 0; i < PREFIXES.length; i++) if (PREFIXES[i].test(t)) return t.replace(PREFIXES[i], '');
    for (var j = 0; j < SUFFIXES.length; j++) if (SUFFIXES[j].test(t)) return t.replace(SUFFIXES[j], '');
    return null;
  }

  // Clé de la fiche si le texte ne demande que la définition d'un réglage connu, sinon null (la question part à l'IA).
  function matchSettingQuestion(text, fiches) {
    var subject = subjectOf(text);
    if (subject === null) return null;
    subject = subject.replace(ARTICLE, '').trim();
    if (!subject) return null;
    for (var key in fiches) {
      var names = [fiches[key].label].concat(fiches[key].aliases || []);
      for (var n = 0; n < names.length; n++) {
        if (normalize(names[n]).replace(ARTICLE, '') === subject) return key;
      }
    }
    return null;
  }

  function frNumber(v) { return String(Math.round(v * 1000) / 1000).replace('.', ','); }

  // Repères hors ligne : plage sûre de l'assistant (liste blanche) et valeur d'origine du profil.
  function judgeValue(o) {
    var hasRange = typeof o.min === 'number' && typeof o.max === 'number' && typeof o.value === 'number';
    var hasSystem = typeof o.systemValue === 'number' && typeof o.value === 'number';
    var inRange = hasRange ? o.value >= o.min - 1e-9 && o.value <= o.max + 1e-9 : null;
    var changed = hasSystem ? Math.abs(o.value - o.systemValue) > 1e-9 : null;
    var parts = [];
    if (changed === false) parts.push('C’est le réglage d’origine de ton profil.');
    if (changed === true) parts.push('Tu l’as changé : d’origine, c’était ' + frNumber(o.systemValue) + '.');
    if (inRange === true) parts.push('La valeur est dans une plage sûre.');
    if (inRange === false) parts.push('Attention : la valeur sort de la plage habituelle (' + frNumber(o.min) + ' à ' + frNumber(o.max) + ').');
    return { inRange: inRange, changed: changed, text: parts.join(' ') };
  }

  var TOUR_STEPS = ['model', 'presets', 'slice', 'print', 'after'];

  // Avance automatique quand l'étape est faite ; les autres étapes avancent au clic « Suivant ».
  function nextTourStep(step, signals) {
    if (step === 'model' && signals && signals.objects > 0) return 'presets';
    if (step === 'slice' && signals && signals.sliced) return 'print';
    return step;
  }

  // Modèle 3D joint dans le panneau (le reste, photos comprises, suit le chemin des images).
  function isModelFile(name) { return /\.(stl|3mf|obj|step|stp|amf)$/i.test(String(name || '')); }

  function dims(v) { return v.map(function (n) { return Math.round(n); }).join(' × ') + ' mm'; }

  // Message affiché une fois le modèle posé : { text, warn } (warn : il ne tient pas sur le plateau).
  function modelAddedText(m) {
    if (m.fits) return { warn: false, text: '« ' + m.name + ' » est sur le plateau (' + dims(m.size_mm) + ').' };
    return { warn: true, text: '« ' + m.name + ' » est trop grand pour ton plateau : il mesure ' + dims(m.size_mm) +
      ', et ton imprimante peut imprimer jusqu’à ' + dims(m.bed_mm) + '. Je peux le réduire pour qu’il tienne, ou tu peux le couper en morceaux avec l’outil `Couper`.' };
  }

  var api = { matchSettingQuestion: matchSettingQuestion, judgeValue: judgeValue, TOUR_STEPS: TOUR_STEPS, nextTourStep: nextTourStep,
    isModelFile: isModelFile, modelAddedText: modelAddedText };
  root.PlyoFirstSteps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
