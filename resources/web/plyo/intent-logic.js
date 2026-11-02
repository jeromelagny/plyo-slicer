// Questions d'intention (« à quoi va servir ta pièce ? ») et leur traduction en réglages d'impression, sans IA ni DOM.
// Chargée par index.html (window.PlyoIntent) et testée par node (tests/intent-logic.test.mjs).
// Réponses : { use, pref, speed }. La table donne une valeur ABSOLUE à chaque réglage géré, dans chaque intention : appliquer une
// intention après une autre remet tous ces réglages à des valeurs connues. Seulement des réglages d'impression (jamais la
// température, le débit ni l'avance de pression, souvent calibrés).
(function (root) {
  var USE = {
    id: 'use', text: 'À quoi va servir ta pièce ?',
    choices: [{ id: 'deco', label: 'Décoration' }, { id: 'daily', label: 'Objet du quotidien' }, { id: 'strong', label: 'Pièce qui force' },
      { id: 'flex', label: 'Souple / à plier' }, { id: 'test', label: 'Test rapide' }]
  };
  var PREF = {
    deco: { id: 'pref', text: 'On la regarde surtout…', choices: [{ id: 'top', label: 'Par le dessus' }, { id: 'sides', label: 'Par les côtés' }, { id: 'all', label: 'De partout' }] },
    daily: { id: 'pref', text: 'Elle doit surtout être…', choices: [{ id: 'light', label: 'Légère' }, { id: 'balanced', label: 'Équilibrée' }, { id: 'sturdy', label: 'Robuste' }] },
    strong: { id: 'pref', text: 'Elle va subir…', choices: [{ id: 'light', label: 'Une petite charge' }, { id: 'heavy', label: 'Une grosse charge' }, { id: 'shocks', label: 'Des chocs' }] },
    flex: { id: 'pref', text: 'Souple jusqu’où ? Tu préfères qu’elle soit…', choices: [{ id: 'softer', label: 'Plus souple' }, { id: 'balanced', label: 'Équilibrée' }, { id: 'tougher', label: 'Plus résistante' }] }
  };
  var SPEED = { id: 'speed', text: 'Tu es pressé ?', choices: [{ id: 'fast', label: 'Vite' }, { id: 'normal', label: 'Normal' }, { id: 'fine', label: 'Soigné' }] };

  function nextQuestion(answers) {
    var a = answers || {};
    if (!a.use) return USE;
    if (a.use === 'test') return null;
    if (!a.pref) return PREF[a.use];
    if (!a.speed) return SPEED;
    return null;
  }

  // « Je ne sais pas » : des exemples concrets, chacun menant à une réponse, et la réponse la plus sûre.
  var IDK = {
    use: { options: [
      { label: 'La porter, la plier un peu', sub: 'Comme un bracelet ou une bague souple', answer: 'flex' },
      { label: 'La regarder, la poser', sub: 'Une décoration, un cadeau, une figurine', answer: 'deco' },
      { label: 'M’en servir tous les jours', sub: 'Une boîte, un crochet, un rangement', answer: 'daily' },
      { label: 'Elle doit tenir un effort', sub: 'Une fixation, un support, un engrenage', answer: 'strong' },
      { label: 'Juste voir si ça marche', sub: 'Un premier essai, vite fait', answer: 'test' }], safe: 'daily' },
    deco: { options: [{ label: 'Elle sera posée à plat', sub: 'On voit le dessus', answer: 'top' }, { label: 'Elle sera debout', sub: 'On voit les côtés', answer: 'sides' }], safe: 'all' },
    daily: { options: [{ label: 'On la manipule doucement', answer: 'light' }, { label: 'Elle peut tomber, être serrée', answer: 'sturdy' }], safe: 'balanced' },
    strong: { options: [{ label: 'Elle tient quelque chose de léger', sub: 'Un câble, un outil', answer: 'light' }, { label: 'Elle porte du poids', sub: 'Une étagère, un vélo', answer: 'heavy' }, { label: 'Elle peut prendre des coups', answer: 'shocks' }], safe: 'heavy' },
    flex: { options: [{ label: 'Elle doit beaucoup plier', answer: 'softer' }, { label: 'Elle doit surtout durer', answer: 'tougher' }], safe: 'balanced' },
    speed: { options: [{ label: 'J’en ai besoin aujourd’hui', answer: 'fast' }, { label: 'C’est pour offrir ou exposer', answer: 'fine' }], safe: 'normal' }
  };
  function idkOptions(questionId, answers) {
    var key = questionId === 'pref' ? (answers && answers.use) : questionId;
    return IDK[key] || { options: [], safe: '' };
  }

  function guessUse(name) {
    var n = String(name || '').toLowerCase();
    if (!n) return null;
    if (/ring|bague|bracelet|flex|soft|souple/.test(n)) return 'flex';
    if (/vase|figurine|statue|deco|bust|sculpt/.test(n)) return 'deco';
    if (/gear|engrenage|bracket|mount|hook|crochet|clip|hinge|charniere/.test(n)) return 'strong';
    if (/test|calib|benchy|cube/.test(n)) return 'test';
    return null;
  }

  // Structure de la pièce selon l'usage : parois, remplissage (%), motif, couches pleines dessus et dessous, bordure (mm).
  var TABLE = {
    deco: { top: [2, 10, 'grid', 5, 3, 0], sides: [3, 10, 'grid', 4, 3, 0], all: [3, 10, 'grid', 5, 3, 0] },
    daily: { light: [2, 15, 'grid', 4, 3, 0], balanced: [3, 20, 'gyroid', 4, 4, 0], sturdy: [4, 30, 'gyroid', 5, 4, 0] },
    strong: { light: [4, 30, 'gyroid', 5, 5, 0], heavy: [5, 50, 'cubic', 6, 5, 0], shocks: [4, 40, 'gyroid', 5, 5, 0] },
    flex: { softer: [2, 10, 'gyroid', 3, 3, 5], balanced: [2, 20, 'gyroid', 3, 3, 5], tougher: [3, 25, 'gyroid', 4, 3, 5] },
    test: { any: [2, 10, 'grid', 3, 3, 0] }
  };
  var LAYER = { fast: 0.28, normal: 0.2, fine: 0.12 };
  var LABELS = { layer_height: 'Hauteur de couche', wall_loops: 'Parois', sparse_infill_density: 'Remplissage', sparse_infill_pattern: 'Motif de remplissage',
    top_shell_layers: 'Couches pleines du dessus', bottom_shell_layers: 'Couches pleines du dessous', brim_width: 'Bordure' };

  function settingsFor(answers, filamentType) {
    var a = answers || {}, rows = TABLE[a.use] || TABLE.daily;
    var r = a.use === 'test' ? rows.any : rows[a.pref] || rows[Object.keys(rows)[1] || Object.keys(rows)[0]];
    var layer = a.use === 'test' ? LAYER.fast : LAYER[a.speed] || LAYER.normal;
    void filamentType; // la structure ne dépend pas du filament ; il sert à l'avertissement du résumé
    var out = [
      { key: 'layer_height', value: layer }, { key: 'wall_loops', value: r[0] }, { key: 'sparse_infill_density', value: r[1] + '%' },
      { key: 'sparse_infill_pattern', value: r[2] }, { key: 'top_shell_layers', value: r[3] }, { key: 'bottom_shell_layers', value: r[4] },
      { key: 'brim_width', value: r[5] }
    ];
    return out.map(function (c) { c.label = LABELS[c.key]; return c; });
  }

  // Un réglage modifié à la main par l'utilisateur est gardé (et signalé dans le résumé).
  function keepManual(changes, manualKeys) {
    var manual = manualKeys || [];
    return { apply: changes.filter(function (c) { return manual.indexOf(c.key) < 0; }), kept: changes.filter(function (c) { return manual.indexOf(c.key) >= 0; }) };
  }

  var USE_TEXT = { deco: 'une décoration', daily: 'un objet du quotidien', strong: 'une pièce qui force', flex: 'une pièce souple', test: 'un test rapide' };
  var PREF_TEXT = { top: 'vue du dessus', sides: 'vue de côté', all: 'vue de partout', light: 'légère', balanced: 'équilibrée', sturdy: 'robuste',
    heavy: 'qui porte du poids', shocks: 'qui encaisse les chocs', softer: 'plus souple', tougher: 'plus résistante' };
  var SPEED_TEXT = { fast: 'vite', normal: 'sans te presser', fine: 'avec soin' };

  function summary(answers, filamentType) {
    var a = answers || {}, set = {};
    settingsFor(a, filamentType).forEach(function (c) { set[c.key] = c.value; });
    var parts = [USE_TEXT[a.use] || 'ta pièce'];
    if (a.pref && PREF_TEXT[a.pref]) parts.push(PREF_TEXT[a.pref]);
    var sentence = 'Pour ' + parts.join(', ') + (a.use === 'test' ? '' : ', ' + (SPEED_TEXT[a.speed] || SPEED_TEXT.normal)) + ', je vais :';
    var bullets = [];
    var walls = set.wall_loops, fill = parseInt(set.sparse_infill_density, 10);
    bullets.push(walls >= 4 ? 'faire des parois épaisses' : walls <= 2 ? 'garder des parois fines' : 'faire des parois moyennes');
    bullets.push(fill >= 30 ? 'remplir fortement l’intérieur' : fill <= 10 ? 'remplir peu l’intérieur, pour aller vite' : 'remplir modérément l’intérieur');
    if (set.sparse_infill_pattern === 'gyroid') bullets.push('utiliser un motif intérieur qui répartit les efforts');
    bullets.push(set.layer_height <= 0.12 ? 'imprimer en couches fines, pour un beau rendu' : set.layer_height >= 0.28 ? 'imprimer en couches épaisses, pour aller vite' : 'imprimer en couches normales');
    if (set.brim_width > 0) bullets.push('ajouter une bordure pour qu’elle ne se décolle pas');
    var warning = '';
    if (a.use === 'flex' && filamentType && filamentType !== 'TPU')
      warning = 'Avec du ' + filamentType + ', la pièce restera assez rigide : pour vraiment plier, le TPU (filament souple) est fait pour ça. Je règle au mieux pour le filament en place.';
    return { sentence: sentence, bullets: bullets, warning: warning };
  }

  // Niveau d'explication deviné d'après les messages de l'utilisateur : « short » s'il emploie au moins deux termes techniques.
  var TECH = /\b(brim|infill|gyroid|cubic|lightning|r[ée]traction|retract|d[ée]bit|flow|pressure advance|\bpa\b|seam|couture|overhang|porte-?[àa]-?faux|layer height|hauteur de couche|z-?offset|p[ée]rim[èe]tre|wall|paroi|mm\/s|mouse ears|bridge|pont|ironing|lissage|support (arbre|tree)|tree support|first layer|premi[èe]re couche|petg|asa|abs|tpu)\b/gi;
  function detectLevel(texts) {
    var all = Array.isArray(texts) ? texts.join(' ') : '';
    return (all.match(TECH) || []).length >= 2 ? 'short' : 'detailed';
  }

  var api = { detectLevel: detectLevel, QUESTIONS: { use: USE, pref: PREF, speed: SPEED }, nextQuestion: nextQuestion, idkOptions: idkOptions, guessUse: guessUse,
    settingsFor: settingsFor, keepManual: keepManual, summary: summary, MANAGED_KEYS: Object.keys(LABELS) };
  root.PlyoIntent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
