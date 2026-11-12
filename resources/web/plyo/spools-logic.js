// Logique pure de « Quelle bobine ? » (sans DOM) : nom de bobine obligatoire, liste des bobines de la machine, phrases de
// reprise et de réussite, préréglage de l'utilisateur à retenir. Les bobines vivent côté slicer (PlyoSpools, bobines.json).
// Chargée par index.html (window.PlyoSpools) et testée par node (tests/spools-logic.test.mjs).
(function (root) {
  var NAME_HELP = 'Regarde l’étiquette de ta bobine : écris la marque et le type, par exemple « Sunlu PLA+ noir » ou « eSun PETG blanc ».';
  var MIN_CHARS = 3;

  // Même nettoyage que SpoolsLogic::clean_name : caractères interdits dans un nom de fichier → espace, espaces réduits.
  function cleanName(text) { return String(text == null ? '' : text).replace(/[\/\\:*?"<>|\t\r\n]/g, ' ').replace(/ +/g, ' ').trim(); }

  // '' (bon nom), 'vide' ou 'court'.
  function nameError(text) {
    var n = Array.from(cleanName(text)).length;
    if (n === 0) return 'vide';
    return n < MIN_CHARS ? 'court' : '';
  }
  function nameErrorText(code) {
    if (code === 'vide') return 'Écris le nom de ta bobine : il me sert à la retrouver la prochaine fois.';
    if (code === 'court') return 'Ce nom est trop court : écris au moins 3 lettres.';
    return '';
  }

  // « 2026-11-11 » → « 11/11 » ; '' si illisible.
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] : '';
  }

  // Bobines de la machine (Spools::list, la dernière réussite d'abord) → lignes du choix, avec leur dernier résultat.
  function choiceRows(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(function (s) { return s && typeof s.id === 'string' && s.id && typeof s.name === 'string' && s.name; }).map(function (s) {
      var day = shortDate(s.last_ok_at);
      var detail = s.last_outcome === 'bad' ? 'dernière impression ratée' : day ? '✓ réussie le ' + day : 'à essayer';
      return { id: s.id, label: s.name, detail: detail, name: s.name, material: s.material || '' };
    });
  }

  // Phrase dite après le choix d'une bobine connue (spool_chosen.success). Si son préréglage a changé depuis la dernière
  // impression réussie, on ne prétend pas la reprendre : on dit ce qui avait marché, et un bouton propose d'y revenir.
  function resumeText(name, success) {
    var s = success || {};
    if (!s.available) return '';
    if (!s.differs) return 'Je reprends tes réglages de la dernière impression réussie avec ' + name + '.';
    var day = shortDate(s.date);
    return 'Tes réglages pour ' + name + ' ont changé depuis ta dernière impression réussie' + (day ? ', le ' + day : '') +
      (s.summary ? ' (elle avait : ' + s.summary + ')' : '') + '. Je garde ceux d’aujourd’hui.';
  }
  function restoreLabel(date) {
    var day = shortDate(date);
    return day ? 'Revenir aux réglages réussis du ' + day : 'Revenir aux réglages réussis';
  }
  function doneText(name) { return 'C’est noté : je reprendrai ces réglages pour ' + name + '.'; }

  // Préréglage de l'utilisateur choisi dans Orca, hors registre : proposé une fois, plus jamais après un « non ».
  function adoptQuestion(preset) { return 'Faire de « ' + preset + ' » une bobine que je retiens ?'; }
  function offersAdopt(habits, preset) {
    if (!preset) return false;
    var no = habits && Array.isArray(habits.spool_declined) ? habits.spool_declined : [];
    return no.indexOf(preset) < 0;
  }
  function declineAdopt(habits, preset) {
    var h = JSON.parse(JSON.stringify(habits || {}));
    if (!Array.isArray(h.spool_declined)) h.spool_declined = [];
    if (preset && h.spool_declined.indexOf(preset) < 0) h.spool_declined.push(preset);
    return h;
  }

  // Le projet attend-il encore sa bobine ? Machine choisie, filament 1 sans bobine. Les emplacements (Canvas, CFS, IFS, U1)
  // gardent leur choix : la v1 ne demande pas de bobine pour eux.
  function needsSpool(project) {
    var p = project || {};
    if (!p.printer || p.printer.proposed || !p.printer.preset) return false;
    if (Array.isArray(p.canvas) && p.canvas.length) return false;
    var f = p.filament;
    return !(f && !f.proposed && f.spool && f.spool.id);
  }

  // Question de l'assistant (mode écrit) qui porte sur la matière du filament.
  var MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];
  function isFilamentQuestion(q) {
    if (!q || typeof q !== 'object') return false;
    if (/filament|matière|bobine/i.test(String(q.text || ''))) return true;
    var choices = Array.isArray(q.choices) ? q.choices : [];
    return choices.filter(function (c) { return MATERIALS.indexOf(String(c).trim().toUpperCase()) >= 0; }).length >= 2;
  }

  var api = { NAME_HELP: NAME_HELP, nameError: nameError, nameErrorText: nameErrorText, cleanName: cleanName, shortDate: shortDate, choiceRows: choiceRows,
    resumeText: resumeText, restoreLabel: restoreLabel, doneText: doneText, adoptQuestion: adoptQuestion, offersAdopt: offersAdopt, declineAdopt: declineAdopt,
    needsSpool: needsSpool, isFilamentQuestion: isFilamentQuestion };
  root.PlyoSpools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
