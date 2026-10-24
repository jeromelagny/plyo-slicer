// Texte enrichi des réponses de l'assistant : paragraphes, listes « - » et « 1. », **gras**, `libellé d'Orca`.
// parseRich ne produit que des données ; le panneau les affiche avec textContent, jamais en HTML.
// Chargé par index.html (window.PlyoRichText) et testé par node (tests/rich-text.test.mjs).
(function (root) {
  // Morceaux d'une ligne : texte, gras, libellé de l'interface. Un marqueur sans fermeture reste du texte.
  function inlines(line) {
    var out = [];
    var text = '';
    var i = 0;
    function flush() { if (text) { out.push({ t: 'text', v: text }); text = ''; } }
    while (i < line.length) {
      var bold = line.slice(i, i + 2) === '**';
      var mark = bold ? '**' : line[i] === '`' ? '`' : null;
      if (mark) {
        var end = line.indexOf(mark, i + mark.length);
        if (end > i + mark.length) {
          flush();
          out.push({ t: bold ? 'bold' : 'ui', v: line.slice(i + mark.length, end) });
          i = end + mark.length;
          continue;
        }
      }
      text += line[i];
      i++;
    }
    flush();
    return out;
  }

  var BULLET = /^\s*[-•]\s+(.*)$/;
  var NUMBER = /^\s*\d{1,2}[.)]\s+(.*)$/;

  function parseRich(source) {
    var blocks = [];
    var current = null;
    String(source || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { current = null; return; }
      var b = BULLET.exec(line), n = b ? null : NUMBER.exec(line);
      var type = b ? 'ul' : n ? 'ol' : 'p';
      if (!current || current.type !== type) {
        current = type === 'p' ? { type: 'p', lines: [] } : { type: type, items: [] };
        blocks.push(current);
      }
      if (type === 'p') current.lines.push(inlines(line.trim()));
      else current.items.push(inlines((b || n)[1]));
    });
    return blocks;
  }

  var api = { parseRich: parseRich };
  root.PlyoRichText = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
