// Assistant v2 : les fenêtres du panneau (maquette : « modal »), ouvertes par le menu, la jauge ou un message. Une seule à la
// fois, par-dessus le panneau ; Échap, la croix, « Fermer » ou un clic à côté la ferment. Vue seulement : chaque fenêtre est
// remplie par celui qui l'ouvre (v2/menu.js…). Les fenêtres du slicer (QR du téléphone, connexion par code) restent les siennes.
(function (root) {
  var V2 = root.PlyoV2 = root.PlyoV2 || {};
  var ui = V2.ui;
  var current = null; // { node, body, onClose, back }

  function close() {
    if (!current) return;
    var c = current;
    current = null;
    c.node.remove();
    if (c.onClose) c.onClose();
    if (c.back && c.back.focus) c.back.focus();
  }

  // `o` : { title, sub, wide, fill(body, close), foot (éléments du pied, sinon « Fermer »), onClose }. Rend le corps.
  function open(o) {
    close();
    var ov = ui.el('div', 'ov');
    ov.id = 'fenetre';
    var m = ui.el('div', 'modal' + (o.wide ? ' wide' : ''));
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    var head = ui.el('div', 'mhead');
    var title = ui.el('h3', '', o.title);
    title.id = 'fenetre-titre';
    m.setAttribute('aria-labelledby', 'fenetre-titre');
    head.appendChild(title);
    var x = ui.button('', close, 'iconbtn mx', 'x');
    x.title = ui.fr('Fermer');
    x.setAttribute('aria-label', ui.fr('Fermer'));
    head.appendChild(x);
    m.appendChild(head);
    if (o.sub) m.appendChild(ui.el('p', 'sub', o.sub));
    var body = ui.el('div', 'mbody');
    m.appendChild(body);
    var foot = ui.el('div', 'mfoot');
    (o.foot || [ui.button('Fermer', close, 'btn sm')]).forEach(function (n) { if (n) foot.appendChild(n); });
    m.appendChild(foot);
    ov.appendChild(m);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    current = { node: ov, body: body, onClose: o.onClose || null, back: document.activeElement };
    if (o.fill) o.fill(body, close);
    x.focus();
    return body;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // Ligne d'une liste de fenêtre (maquette « li ») : icône, titre, détail, boutons [{ label, run, main }].
  function row(o) {
    var li = ui.el('div', 'li' + (o.current ? ' cur' : ''));
    if (o.icon) { var ic = ui.el('span', 'lic'); ic.appendChild(ui.icon(o.icon, 18)); li.appendChild(ic); }
    if (o.swatch) { var sw = ui.el('span', 'cyl small'); sw.style.background = o.swatch; li.appendChild(sw); }
    var mid = ui.el('div', 'grow');
    mid.appendChild(ui.el('strong', '', o.title));
    if (o.sub) mid.appendChild(ui.el('small', '', o.sub));
    li.appendChild(mid);
    (o.acts || []).forEach(function (a) { if (a) li.appendChild(ui.button(a.label, a.run, 'btn sm' + (a.main ? ' main' : ''), a.icon)); });
    return li;
  }
  // Liste vide : une phrase, et l'action qui la remplit.
  function empty(text, action) {
    var box = ui.el('div', 'note');
    box.appendChild(ui.icon('info', 18));
    var body = ui.el('div', 'note-body');
    body.appendChild(ui.rich(text));
    if (action) { var acts = ui.el('div', 'acts'); acts.appendChild(ui.button(action.label, action.run, 'btn sm')); body.appendChild(acts); }
    box.appendChild(body);
    return box;
  }

  V2.fenetre = { open: open, close: close, row: row, empty: empty, isOpen: function () { return !!current; }, body: function () { return current ? current.body : null; } };
})(typeof window !== 'undefined' ? window : globalThis);
