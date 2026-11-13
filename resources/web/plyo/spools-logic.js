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
  // `date` : jour de l'envoi retenu (« AAAA-MM-JJ ») ; l'utilisateur voit quelle impression a été retenue.
  function doneText(name, date) {
    var day = shortDate(date);
    return day ? 'C’est noté : je reprendrai les réglages de ton impression du ' + day + ' pour ' + name + '.' : 'C’est noté : je reprendrai ces réglages pour ' + name + '.';
  }

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

  // ---------- « De quelle marque est ta bobine ? » ----------
  // Les marques viennent du slicer (Brands::groups : profils fournis de la matière, compatibles avec l'imprimante en cours) :
  // [{brand, ranges: [{preset, label, short}]}], la marque de l'imprimante d'abord. Un choix : { kind, brand, range, short,
  // preset } avec kind 'brand' (profil du fabricant), 'brand_only' (marque connue, gamme inconnue : générique), 'other' (marque
  // écrite, sans profil : générique), 'unknown' (« Je ne sais pas » : générique). Seul 'brand' porte un profil (`preset`).
  var BRAND_QUESTION = 'De quelle marque est ta bobine ?';
  var BRAND_HELP = 'Elle est écrite sur l’étiquette. Avec la marque, je pars des réglages prévus par le fabricant.';
  var BRANDS_SHOWN = 6;

  // Marques très répandues chez les débutants, montrées avant les autres (après celle de l'imprimante). Clés en minuscules,
  // sans espaces ni tirets (comme BrandsLogic::norm).
  var COMMON_BRANDS = ['esun', 'sunlu', 'polymaker', 'elegoo', 'overture', 'bambulab', 'creality', 'anycubic', 'prusament', 'geeetech', 'jayo'];
  function brandKey(b) { return String(b || '').toLowerCase().replace(/[\s_-]+/g, ''); }
  // Les plus pertinentes d'abord : la marque de l'imprimante (`printer`, ordre du slicer), puis les marques répandues, puis
  // l'alphabet ; au-delà de BRANDS_SHOWN, les autres derrière un lien : jamais une liste interminable.
  function brandButtons(groups, showAll) {
    var list = Array.isArray(groups) ? groups.filter(function (g) { return g && g.brand && Array.isArray(g.ranges) && g.ranges.length; }) : [];
    if (showAll || list.length <= BRANDS_SHOWN + 1) return { shown: list, hidden: 0 };
    var rank = function (g) { var i = COMMON_BRANDS.indexOf(brandKey(g.brand)); return g.printer ? -1 : i < 0 ? COMMON_BRANDS.length : i; };
    var ordered = list.map(function (g, i) { return { g: g, i: i }; }).sort(function (a, b) { return rank(a.g) - rank(b.g) || a.i - b.i; });
    return { shown: ordered.slice(0, BRANDS_SHOWN).map(function (x) { return x.g; }), hidden: list.length - BRANDS_SHOWN };
  }
  // Même nettoyage que BrandsLogic::clean_brand : caractères interdits → espace, espaces réduits, 60 octets au plus ; '' sous 2 lettres.
  function cleanBrand(text) {
    var s = String(text == null ? '' : text).replace(/[\u0000-\u001f\/\\:*?"<>|]/g, ' ').replace(/ +/g, ' ').trim();
    while (s && new TextEncoder().encode(s).length > 60) s = Array.from(s).slice(0, -1).join('');
    s = s.trim();
    return Array.from(s).length < 2 ? '' : s;
  }
  function brandChoice(group, range) {
    if (!group || !group.brand) return unknownChoice();
    if (!range) return { kind: 'brand_only', brand: group.brand, range: '', short: '', preset: '' };
    return { kind: 'brand', brand: group.brand, range: range.label, short: range.short || range.label, preset: range.preset };
  }
  function otherChoice(text) { var b = cleanBrand(text); return b ? { kind: 'other', brand: b, range: '', short: '', preset: '' } : null; }
  function unknownChoice() { return { kind: 'unknown', brand: '', range: '', short: '', preset: '' }; }
  // Nom proposé pour la bobine, modifiable : la marque et la gamme (« Creality Hyper PLA »), ou la marque et la matière.
  function suggestedName(choice, material) {
    var c = choice || {};
    if (c.kind === 'brand') return cleanName(c.brand + ' ' + (c.short || c.range));
    if (c.kind === 'brand_only' || c.kind === 'other') return cleanName(c.brand + ' ' + (material || ''));
    return '';
  }
  // Ce que dit l'assistant une fois la marque choisie : d'où partent les réglages, en mots simples.
  function brandNote(choice, material) {
    var c = choice || {}, m = material || 'ce filament';
    var common = 'je pars de réglages qui conviennent à la plupart des bobines de ' + m + '. Un test pourra les affiner.';
    if (c.kind === 'brand') return 'Je pars des réglages prévus par ' + c.brand + ' pour sa gamme ' + (c.short || c.range) + '.';
    if (c.kind === 'other') return 'Je n’ai pas de réglages propres à ' + c.brand + ' : ' + common;
    return 'Pas de souci : ' + common;
  }
  function rangeHelp(brand) { return brand + ' fait plusieurs gammes : son nom est sur l’étiquette, à côté de la marque.'; }

  // Nom de la gamme sans la marque devant (« eSUN PLA+ » de eSUN → « PLA+ »), comme BrandsLogic : la fiche ne répète pas la marque.
  function rangeShort(brand, range) {
    var b = String(brand || ''), r = String(range || '');
    return b && r.toLowerCase().indexOf(b.toLowerCase() + ' ') === 0 && r.length > b.length + 1 ? r.slice(b.length + 1).trim() : r;
  }
  // Ligne de la fiche : la marque de la bobine (ou des emplacements) et d'où partent ses réglages ; '' si aucune marque dite.
  function brandLine(project) {
    var p = project || {}, cv = Array.isArray(p.canvas) ? p.canvas : [];
    var named = cv.filter(function (e) { return e && e.brand; });
    if (cv.length) {
      if (!named.length) return '';
      return 'Marque : ' + named.map(function (e) {
        var slot = e.label !== undefined && e.label !== '' ? e.label : e.tray_id + 1;
        return slot + ' ' + e.brand + (e.range ? ' ' + rangeShort(e.brand, e.range) : '');
      }).join(', ');
    }
    var f = p.filament;
    if (!f || f.proposed || !f.brand) return '';
    return 'Marque : ' + f.brand + (f.range ? ' · ' + rangeShort(f.brand, f.range) : '') + (f.brand_profile ? ' · réglages du fabricant' : ' · réglages communs');
  }

  // ---------- Marque d'un emplacement (CFS, Canvas…) ----------
  // Clé d'un emplacement lu.
  function slotKey(t) { return t.canvas_id + ':' + t.tray_id; }
  // Ce que l'emplacement annonce, tel qu'on le dit : « Creality Hyper PLA » (la marque n'est pas répétée si le nom la porte).
  function announced(tray) {
    var b = String(tray && tray.brand || '').trim(), n = String(tray && tray.name || '').trim();
    if (!b || !n) return '';
    return n.toLowerCase().indexOf(b.toLowerCase()) === 0 ? n : b + ' ' + n;
  }
  // Emplacements choisis (mapping) dont l'annonce correspond exactement à un profil (items[clé].match du slicer), sans choix ni
  // « Je ne sais pas » déjà dits : [{ key, slot, said, match }].
  function slotOffers(mapping, trays, items, choices, dismissed) {
    var out = [];
    (mapping || []).forEach(function (m) {
      var tray = (trays || []).filter(function (t) { return t.canvas_id === m.canvas_id && t.tray_id === m.tray_id; })[0];
      if (!tray) return;
      var key = slotKey(tray), it = items && items[key];
      if (!it || !it.match || !it.match.preset || (choices && choices[key]) || (dismissed && dismissed[key])) return;
      if (out.some(function (o) { return o.key === key; })) return;
      out.push({ key: key, slot: tray.slot, said: announced(tray), match: it.match });
    });
    return out;
  }
  // La question, une seule pour tous les emplacements reconnus (une plaque à quatre couleurs n'est pas quatre interrogatoires).
  function slotQuestion(offers, words) {
    var w = words || { your: 'ta machine', the: 'l’emplacement' }, who = w.your.charAt(0).toUpperCase() + w.your.slice(1);
    if (!offers || !offers.length) return '';
    if (offers.length === 1) return who + ' annonce « ' + offers[0].said + ' » à ' + w.the + ' ' + offers[0].slot + ' : c’est bien cette bobine ?';
    return who + ' annonce ces bobines : ' + offers.map(function (o) { return '« ' + o.said + ' » à ' + w.the + ' ' + o.slot; }).join(', ') + '. C’est bien elles ?';
  }
  // Ce qu'affiche la ligne d'un emplacement : sa marque choisie, ou les réglages communs.
  function slotBrandText(choice) {
    var c = choice || {};
    if (c.kind === 'brand') return 'Marque : ' + c.brand + ' ' + (c.short || c.range);
    if (c.kind === 'brand_only' || c.kind === 'other') return 'Marque : ' + c.brand + ' · réglages communs';
    return 'Marque : non précisée · réglages communs';
  }

  // Attente de la liste des marques avant de montrer quand même le champ libre et « Je ne sais pas ».
  var BRANDS_WAIT_MS = 4000;
  // « Laquelle ? » : certaines marques ont des dizaines de gammes (une par couleur chez FilAr, 24 chez Polymaker). On en montre
  // huit, puis « Voir les autres gammes (n) » : { shown, hidden }.
  var RANGES_SHOWN = 8;
  function rangeButtons(ranges, all) {
    var list = Array.isArray(ranges) ? ranges : [];
    if (all || list.length <= RANGES_SHOWN + 1) return { shown: list, hidden: 0 };
    return { shown: list.slice(0, RANGES_SHOWN), hidden: list.length - RANGES_SHOWN };
  }
  var api = { RANGES_SHOWN: RANGES_SHOWN, rangeButtons: rangeButtons, BRANDS_WAIT_MS: BRANDS_WAIT_MS, NAME_HELP: NAME_HELP, nameError: nameError, nameErrorText: nameErrorText, cleanName: cleanName, shortDate: shortDate, choiceRows: choiceRows,
    resumeText: resumeText, restoreLabel: restoreLabel, doneText: doneText, adoptQuestion: adoptQuestion, offersAdopt: offersAdopt, declineAdopt: declineAdopt,
    needsSpool: needsSpool, isFilamentQuestion: isFilamentQuestion,
    BRAND_QUESTION: BRAND_QUESTION, BRAND_HELP: BRAND_HELP, BRANDS_SHOWN: BRANDS_SHOWN, brandButtons: brandButtons, cleanBrand: cleanBrand, brandChoice: brandChoice,
    otherChoice: otherChoice, unknownChoice: unknownChoice, suggestedName: suggestedName, brandNote: brandNote, rangeHelp: rangeHelp, brandLine: brandLine,
    slotKey: slotKey, announced: announced, slotOffers: slotOffers, slotQuestion: slotQuestion, slotBrandText: slotBrandText };
  root.PlyoSpools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
