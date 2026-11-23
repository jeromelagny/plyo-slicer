// Assistant v2 : petits outils de vue (éléments, boutons, icônes, texte enrichi de l'IA). Chargé par v2/index.html.
// Tout texte passe par textContent (jamais de HTML venu de l'IA) ; les icônes sont des tracés SVG fixes.
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var fr = function (t) { return root.PlyoLogic ? root.PlyoLogic.fr(t) : String(t); };
  var SVG = 'http://www.w3.org/2000/svg';

  // Tracés des icônes de la maquette (docs/plyo/maquette-assistant-plyo.html).
  var ICONS = {
    menu: ['M4 7h16M4 12h16M4 17h16'],
    phone: ['M9.5 2.5h5a2.5 2.5 0 012.5 2.5v14a2.5 2.5 0 01-2.5 2.5h-5A2.5 2.5 0 017 19V5a2.5 2.5 0 012.5-2.5z', 'M11 18.5h2'],
    clip: ['M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8'],
    mic: ['M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z', 'M5.5 11a6.5 6.5 0 0013 0M12 17.5V21'],
    up: ['M12 19V5M6 11l6-6 6 6'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    x: ['M6 6l12 12M18 6L6 18'],
    undo: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 010 11H11'],
    info: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 11v5M12 7.5v.5'],
    alert: ['M12 3.5l9.5 16.5h-19z', 'M12 10v4.5M12 17.2v.3'],
    cube: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5M12 12v9'],
    printer: ['M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z', 'M4 8h16M8 14h8M12 8v6'],
    spool: ['M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17z', 'M12 15a3 3 0 100-6 3 3 0 000 6z', 'M12 3.5v5M12 15.5v5'],
    spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z'],
    upload: ['M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3'],
    folder: ['M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z'],
    grid: ['M5.5 4h4A1.5 1.5 0 0111 5.5v4A1.5 1.5 0 019.5 11h-4A1.5 1.5 0 014 9.5v-4A1.5 1.5 0 015.5 4z', 'M14.5 4h4A1.5 1.5 0 0120 5.5v4a1.5 1.5 0 01-1.5 1.5h-4A1.5 1.5 0 0113 9.5v-4A1.5 1.5 0 0114.5 4z',
      'M5.5 13h4a1.5 1.5 0 011.5 1.5v4A1.5 1.5 0 019.5 20h-4A1.5 1.5 0 014 18.5v-4A1.5 1.5 0 015.5 13z', 'M14.5 13h4a1.5 1.5 0 011.5 1.5v4a1.5 1.5 0 01-1.5 1.5h-4a1.5 1.5 0 01-1.5-1.5v-4a1.5 1.5 0 011.5-1.5z'],
    boat: ['M3 15h18l-2.5 4.5h-13zM8 15V9h7v6M11 9V5h3v4'],
    right: ['M9 6l6 6-6 6'],
    plus: ['M12 5v14M5 12h14'],
    rotate: ['M20 12a8 8 0 11-2.3-5.6M20 4v4.5h-4.5'],
    scale: ['M4 20L20 4M14 4h6v6M10 20H4v-6'],
    flat: ['M3 20h18M7 16l5-10 5 10z'],
    copy: ['M10 8h8a2 2 0 012 2v8a2 2 0 01-2 2h-8a2 2 0 01-2-2v-8a2 2 0 012-2z', 'M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3'],
    cut: ['M6 20.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18 20.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z', 'M7.8 16.2L18 4M16.2 16.2L6 4']
  };

  function icon(name, size) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('class', 'i');
    s.setAttribute('width', String(size || 20));
    s.setAttribute('height', String(size || 20));
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }
  function txt(text) { return document.createTextNode(fr(text)); }
  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = fr(text);
    return e;
  }
  function button(label, onClick, className, iconName) {
    var b = el('button', className || 'btn');
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName, 16));
    if (label) b.appendChild(txt(label));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  // Texte enrichi de l'IA (paragraphes, listes, gras, libellés d'Orca), construit en texte (rich-text.js).
  function rich(text, className) {
    var wrap = el('div', 'rich' + (className ? ' ' + className : ''));
    function fill(parent, parts) {
      parts.forEach(function (part) {
        if (part.t === 'bold') parent.appendChild(el('strong', '', part.v));
        else if (part.t === 'ui') parent.appendChild(el('span', 'ui', part.v));
        else parent.appendChild(txt(part.v));
      });
    }
    root.PlyoRichText.parseRich(fr(text)).forEach(function (block) {
      if (block.type === 'p') {
        var p = el('p');
        block.lines.forEach(function (line, i) { if (i) p.appendChild(el('br')); fill(p, line); });
        wrap.appendChild(p);
      } else {
        var list = el(block.type);
        block.items.forEach(function (item) { var li = el('li'); fill(li, item); list.appendChild(li); });
        wrap.appendChild(list);
      }
    });
    return wrap;
  }

  V2.ui = { icon: icon, txt: txt, el: el, button: button, rich: rich, fr: fr, ICONS: ICONS };
})(typeof window !== 'undefined' ? window : globalThis);
