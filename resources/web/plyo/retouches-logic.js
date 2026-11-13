// Textes du lot 11 (utilisateur confirmé) : retouches faites à la main dans Orca (UX-31, UX-32, UX-36), filament changé dans
// la liste d'Orca (UX-35) et calibration directe d'une bobine (UX-34). Sans DOM : index.html construit les cartes.
// Chargée par index.html (window.PlyoRetouches) et testée par node (tests/confirme-lot11.test.mjs).
(function (root) {
  var L = root.PlyoLogic || (typeof require !== 'undefined' ? require('./assistant-logic.js') : null);
  // Valeur montrée : virgule décimale, oui / non, « vide » pour une valeur absente ; une valeur à choix d'Orca (« aligned »)
  // par son libellé français du catalogue quand on connaît le réglage (`key`, N5).
  function fmt(v, key) {
    if (v === null || v === undefined || v === '') return 'vide';
    if (typeof v === 'boolean') return v ? 'oui' : 'non';
    if (key && typeof v === 'string' && L) { var label = L.choiceLabel(v, key); if (label !== v) return label; }
    return String(v).replace(/(\d)\.(\d)/g, '$1,$2');
  }
  function lowerFirst(t) { var s = String(t || ''); return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function cleanChanges(changes) {
    return (Array.isArray(changes) ? changes : []).filter(function (c) { return c && typeof c.key === 'string' && c.key; });
  }
  // « débit 0,98 → 0,95, parois 2 → 3 » (trois au plus, puis « et 2 autres réglages »).
  function changeList(changes, onlyAfter) {
    var list = cleanChanges(changes), shown = list.slice(0, 3).map(function (c) {
      var name = lowerFirst(c.label || 'un réglage');
      return onlyAfter ? name + ' ' + fmt(c.after, c.key) : name + ' ' + fmt(c.before, c.key) + ' → ' + fmt(c.after, c.key);
    });
    var rest = list.length - shown.length;
    if (rest > 0) shown.push('et ' + rest + (rest > 1 ? ' autres réglages' : ' autre réglage'));
    return shown.join(', ');
  }
  function labels(changes) {
    var list = cleanChanges(changes), names = list.slice(0, 3).map(function (c) { return c.label || 'un réglage'; });
    return names.join(', ') + (list.length > 3 ? '…' : '');
  }

  // ---------- UX-31 : retouches de l'onglet Impression, au projet suivant ----------
  var KEEP_LABEL = 'Les garder dans mon profil', ONLY_LABEL = 'Seulement pour ce projet';
  function printQuestion(pending) {
    var p = pending || {}, list = cleanChanges(p.changes);
    if (!p.preset || !list.length) return '';
    var where = p.project ? 'le projet « ' + p.project + ' »' : 'ton projet d’avant';
    return 'Tu as retouché ton profil d’impression « ' + (L ? L.shortName(p.preset, false) : p.preset) + ' » (' + labels(list) + ') pendant ' + where + '. Ces retouches restent avec ce projet. ' +
      'Les garder aussi dans ton profil, pour tes prochains projets ?';
  }
  function printDetail(pending) { return 'Ce que tu as changé : ' + changeList((pending || {}).changes) + '.'; }
  var ONLY_NOTE = 'D’accord : ton profil ne change pas. Ces retouches restent dans le projet d’avant (« Mes projets » le rouvre).';

  // ---------- UX-32 : retouches du filament gardées dans la bobine ----------
  function spoolKeptText(spool, changes) {
    var list = cleanChanges(changes);
    if (!list.length) return '';
    return 'Gardé dans ta bobine « ' + (spool || 'en cours') + ' » : ' + changeList(list) + '.';
  }
  function spoolFailText(reason, label, spool) {
    var where = spool ? 'ta bobine « ' + spool + ' »' : 'ta bobine';
    if (reason === 'temperatures')
      return 'Je n’ai pas pu garder ce changement dans ' + where + ' : l’écart entre la température de la première couche et celle des autres couches dépasse ce que Plyo Slicer accepte' +
        (label ? ' (« ' + label + ' »)' : '') + '. Rapproche-les dans l’onglet Filament : je la garde dès que c’est bon.';
    return 'Je n’ai pas pu garder ce changement dans ' + where + ' : Plyo Slicer n’a pas pu écrire son fichier. Ton changement reste dans l’onglet Filament ; je réessaie au prochain changement.';
  }

  // ---------- UX-36 : valeurs du filament d'un fichier ouvert ----------
  var TAKE_FILE_LABEL = 'Prendre ceux du fichier';
  function fileFilamentText(info) {
    var i = info || {}, list = cleanChanges(i.changes);
    if (!list.length) return '';
    return 'Ton fichier avait ses propres réglages de filament (' + changeList(list, true) + ') : j’ai gardé ceux de ta bobine « ' + (i.spool || 'en cours') + ' ».';
  }

  // ---------- UX-35 : filament changé dans la liste d'Orca ----------
  // Le filament d'Orca est-il encore celui du projet ? (même règle que le slicer : un nom suivi de « (Plyo) » ou « — » compte.)
  function sameFilament(projectPreset, orcaPreset) {
    if (!projectPreset || !orcaPreset) return true; // rien à comparer
    if (projectPreset === orcaPreset) return true;
    return orcaPreset.indexOf(projectPreset + ' (Plyo)') === 0 || orcaPreset.indexOf(projectPreset + ' — ') === 0;
  }
  // Nom du filament du projet tel que le panneau le montre : la bobine, sinon le préréglage.
  function projectFilamentName(f) { return f ? (f.spool && f.spool.name) || f.preset || '' : ''; }
  function filamentDivergence(orcaPreset, projectFilament) {
    var from = projectFilamentName(projectFilament);
    return { text: 'Plyo Slicer est passé sur **' + orcaPreset + '**, mais ton projet utilise **' + from + '**.',
      use: 'Utiliser « ' + orcaPreset + ' » pour ce projet', restore: 'Remettre ' + from,
      note: 'Utiliser l’autre filament refait la vérification et la découpe. Ses réglages restent ceux de ce filament dans Plyo Slicer.' };
  }
  // Ce que fait « Utiliser … » selon ce que le slicer dit du filament d'Orca (spool_current) : 'attach' (c'est déjà une bobine),
  // 'name' (il peut le devenir : son nom est demandé), 'none' (il ne peut pas : on propose de choisir une bobine).
  function adoptionPath(current) {
    var c = current || {};
    if (c.spool && c.spool.id) return 'attach';
    return c.adoptable ? 'name' : 'none';
  }
  var ADOPT_NONE = 'Je ne peux pas retenir ce filament comme bobine : je ne retiens qu’un profil de l’utilisateur qui vient d’un profil PLA, PETG, ABS, ASA ou TPU de Plyo Slicer. Choisis plutôt ta bobine à l’étape Filament.';

  // ---------- UX-34 : calibrer cette bobine ----------
  // Trois tests guidés, gratuits à lancer ; seule la lecture de la photo du test utilise la jauge.
  var CALIB_CHOICES = [
    { test: 'flow', label: 'Débit (≈ 20 min par passe)' },
    { test: 'temperature', label: 'Température (≈ 45 min)' },
    { test: 'retraction', label: 'Rétraction (≈ 40 min)' }
  ];
  var CALIB_LINK = 'Calibrer cette bobine';
  function calibIntro(spool) {
    return 'Calibrer ' + (spool ? '« ' + spool + ' »' : 'ta bobine') + ' : je pose le test sur le plateau, tu l’imprimes, puis tu choisis le meilleur. ' +
      'Lancer un test est gratuit ; seule la lecture de la photo du test par l’assistant utilise ta jauge. Le réglage choisi est gardé dans ta bobine.';
  }

  var api = { fmt: fmt, changeList: changeList, KEEP_LABEL: KEEP_LABEL, ONLY_LABEL: ONLY_LABEL, ONLY_NOTE: ONLY_NOTE, printQuestion: printQuestion,
    printDetail: printDetail, spoolKeptText: spoolKeptText, spoolFailText: spoolFailText, TAKE_FILE_LABEL: TAKE_FILE_LABEL, fileFilamentText: fileFilamentText,
    sameFilament: sameFilament, projectFilamentName: projectFilamentName, filamentDivergence: filamentDivergence, adoptionPath: adoptionPath, ADOPT_NONE: ADOPT_NONE,
    CALIB_CHOICES: CALIB_CHOICES, CALIB_LINK: CALIB_LINK, calibIntro: calibIntro };
  root.PlyoRetouches = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
