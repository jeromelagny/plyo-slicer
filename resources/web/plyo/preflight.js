// Vérification avant impression : à partir des mesures du plateau (PlyoPreflight.cpp), les risques à signaler,
// chacun avec ses corrections en un clic. Aucun appel à l'IA.
(function (root) {
  var ORDER = ['fit', 'support', 'tall', 'contact'];
  var BRIM = 5; // mm, largeur proposée

  function hasBrim(s) {
    return s.brim_type !== 'no_brim' && (s.brim_type === 'auto_brim' || Number(s.brim_width) > 0);
  }

  function brimFix(s) {
    var changes = s.brim_type === 'no_brim' ? [{ id: 'brim_type', value: 'outer_only' }] : [];
    return { label: 'Ajouter une bordure', changes: changes.concat([{ id: 'brim_width', value: BRIM }]) };
  }

  var ORIENT = { label: 'Orienter automatiquement', action: 'orient' };

  function names(list) {
    var q = list.map(function (n) { return '« ' + n + ' »'; });
    if (q.length === 1) return q[0];
    if (q.length === 2) return q[0] + ' et ' + q[1];
    var rest = q.length - 2;
    return q[0] + ', ' + q[1] + ' et ' + rest + ' autre' + (rest > 1 ? 's pièces' : ' pièce');
  }

  // Textes au singulier et au pluriel : [une pièce, plusieurs pièces].
  var TEXTS = {
    fit: [' dépasse du plateau.', ' dépassent du plateau.'],
    support: [' a des parties dans le vide : sans supports, elles risquent de s’effondrer.',
      ' ont des parties dans le vide : sans supports, elles risquent de s’effondrer.'],
    tall: [' est haute et fine : sans bordure, elle risque de basculer pendant l’impression.',
      ' sont hautes et fines : sans bordure, elles risquent de basculer pendant l’impression.'],
    contact: [' touche peu le plateau : sans bordure, elle risque de se décoller.',
      ' touchent peu le plateau : sans bordure, elles risquent de se décoller.']
  };

  function kindOf(o, s) {
    var kinds = [];
    if (o.fits === false) kinds.push('fit');
    if (o.needs_support === true && !s.support) kinds.push('support');
    if (!hasBrim(s)) {
      var foot = Math.min(o.foot[0], o.foot[1]);
      if (o.height >= 30 && o.height >= 3 * foot) kinds.push('tall');
      else if (o.contact_mm2 < Math.max(25, 0.1 * o.foot[0] * o.foot[1])) kinds.push('contact');
    }
    return kinds;
  }

  function valid(o) {
    return o && typeof o.name === 'string' && typeof o.height === 'number' && typeof o.contact_mm2 === 'number' &&
      Array.isArray(o.foot) && o.foot.length === 2;
  }

  function preflightRisks(data) {
    if (!data || !data.settings || !Array.isArray(data.objects)) return [];
    var s = data.settings;
    var byKind = {};
    data.objects.filter(valid).forEach(function (o) {
      kindOf(o, s).forEach(function (k) { (byKind[k] = byKind[k] || []).push(o.name); });
    });
    return ORDER.filter(function (k) { return byKind[k]; }).map(function (k) {
      var list = byKind[k];
      var fixes = k === 'fit' ? [{ label: 'Réduire pour que ça tienne', action: 'scale_to_fit' }]
        : k === 'support' ? [{ label: 'Activer les supports', changes: [{ id: 'support', value: true }] }, ORIENT]
        : k === 'tall' ? [brimFix(s)]
        : [brimFix(s), ORIENT];
      return { kind: k, objects: list, text: names(list) + TEXTS[k][list.length > 1 ? 1 : 0], fixes: fixes };
    });
  }

  function riskKey(r) { return r.kind + ':' + r.objects.join('|'); }

  var api = { preflightRisks: preflightRisks, riskKey: riskKey };
  root.PlyoPreflight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
