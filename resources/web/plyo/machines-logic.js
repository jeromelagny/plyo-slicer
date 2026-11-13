// Logique pure des machines (imprimantes) et des habitudes de filament, sans DOM.
// Chargée par index.html (window.PlyoMachines) et testée par node (tests/machines-logic.test.mjs).
// Une « machine » = un regroupement des profils d'imprimante qui désignent la même imprimante reliée (PlyoJourney.groupPrinters).
// Habitudes : { machines: { [profil]: { filament: {type, nozzle_temp, bed_temp} } }, hidden: [profil], last: profil }.
(function (root) {
  var J = root.PlyoJourney || (typeof require !== 'undefined' ? require('./journey-logic.js') : null);

  function emptyHabits() { return { machines: {}, hidden: [], last: '', intent_skips: 0 }; }
  function clone(h) {
    var src = h && typeof h === 'object' ? h : {};
    var out = { machines: src.machines && typeof src.machines === 'object' && !Array.isArray(src.machines) ? JSON.parse(JSON.stringify(src.machines)) : {},
      hidden: Array.isArray(src.hidden) ? src.hidden.filter(function (x) { return typeof x === 'string'; }) : [], last: typeof src.last === 'string' ? src.last : '' };
    if (src.level === 'short' || src.level === 'detailed') out.level = src.level;
    if (src.level_manual === true) out.level_manual = true;
    if (src.level_hold === true) out.level_hold = true;
    out.intent_skips = typeof src.intent_skips === 'number' ? src.intent_skips : 0;
    if (src.ask_intent === false) out.ask_intent = false;
    // Gardés tels quels (le slicer les vérifie à l'enregistrement : ProjectLogic::sanitize_habits) : sans eux, une habitude
    // notée ensuite (filament, niveau…) effacerait la réponse aux questions sur la pièce, les bobines refusées et les plateaux.
    ['last_intent', 'beds'].forEach(function (k) { if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) out[k] = JSON.parse(JSON.stringify(src[k])); });
    if (Array.isArray(src.spool_declined)) out.spool_declined = src.spool_declined.slice();
    return out;
  }

  // Que demander au début d'une impression ? `printers` : liste du slicer ; `ctx` : { orcaPreset, lastPreset, hidden }.
  // setup = rien de reconnu (aucune reliée, et zéro ou plusieurs non reliées : la liste répond) ; auto = une seule (choisie sans
  // question, `changer` reste dans la fiche), reliée ou non ; confirm = plusieurs reliées (confirmation en un toucher).
  function machineQuestion(printers, ctx) {
    var c = ctx || {}, hidden = c.hidden || [], visible = function (m) { return hidden.indexOf(m.preset) < 0; };
    var groups = J.groupPrinters(printers), machines = groups.main.filter(visible);
    if (!machines.length) {
      var others = groups.others.filter(visible);
      return others.length === 1 ? { mode: 'auto', machine: others[0] } : { mode: 'setup', machine: null };
    }
    if (machines.length === 1) return { mode: 'auto', machine: machines[0] };
    var pick = function (preset) { return machines.filter(function (m) { return m.preset === preset; })[0]; };
    return { mode: 'confirm', machine: pick(c.orcaPreset) || pick(c.lastPreset) || machines[0] };
  }

  function habitFor(habits, preset) {
    var m = habits && habits.machines && typeof habits.machines === 'object' ? habits.machines[preset] : null;
    return m && m.filament && m.filament.type ? { type: m.filament.type, nozzle_temp: m.filament.nozzle_temp, bed_temp: m.filament.bed_temp, spool: typeof m.filament.spool === 'string' ? m.filament.spool : '' } : null;
  }

  function rememberFilament(habits, preset, filament) {
    var h = clone(habits);
    if (!preset || !filament || !filament.type) return h;
    h.machines[preset] = { filament: { type: filament.type, nozzle_temp: filament.nozzle_temp, bed_temp: filament.bed_temp } };
    if (filament.spool && typeof filament.spool.name === 'string' && filament.spool.name) h.machines[preset].filament.spool = filament.spool.name.slice(0, 60);
    h.last = preset;
    return h;
  }

  // Une machine en remplace une autre : elle reprend ses habitudes de filament ; l'ancienne reste intacte.
  function replaceMachine(habits, from, to) {
    var h = clone(habits), f = habitFor(h, from);
    if (!f || !to) return h;
    h.machines[to] = { filament: f };
    return h;
  }
  function hideMachine(habits, preset) { var h = clone(habits); if (preset && h.hidden.indexOf(preset) < 0) h.hidden.push(preset); return h; }
  function unhideMachine(habits, preset) { var h = clone(habits); h.hidden = h.hidden.filter(function (x) { return x !== preset; }); return h; }

  // La liste sans les machines masquées (tous les profils d'une machine masquée disparaissent ; rien n'est supprimé dans Orca).
  function visiblePrinters(printers, hidden) {
    var list = Array.isArray(printers) ? printers : [], hide = hidden || [];
    var hiddenLabels = J.groupPrinters(list).main.filter(function (m) { return hide.indexOf(m.preset) >= 0; }).map(function (m) { return m.label.toLowerCase(); });
    return list.filter(function (p) { return hiddenLabels.indexOf(J.machineLabel(p).toLowerCase()) < 0; });
  }

  // Une machine trouvée sur le réseau est-elle déjà dans la liste ? (adresse de connexion, avec ou sans port)
  function isKnownHost(printers, ip) {
    if (!ip || !Array.isArray(printers)) return false;
    return printers.some(function (p) { return p && p.host && String(p.host).split(':')[0] === ip; });
  }

  // Pièce trop grande pour la machine choisie : une autre machine reliée dont le plateau (mm) l'accepte, sinon null.
  // `size` : [x, y, z] de la pièce ; un plateau accepte la pièce à plat, dans un sens ou dans l'autre, et la hauteur si elle est connue.
  function machineThatFits(printers, currentPreset, size) {
    if (!Array.isArray(printers) || !Array.isArray(size)) return null;
    var fits = function (bed) { return Array.isArray(bed) && ((size[0] <= bed[0] && size[1] <= bed[1]) || (size[1] <= bed[0] && size[0] <= bed[1])) && !(bed[2] > 0 && size[2] > bed[2]); };
    var current = printers.filter(function (p) { return p.preset === currentPreset; })[0];
    if (current && fits(current.bed_mm)) return null;
    var found = printers.filter(function (p) { return p.preset !== currentPreset && p.linked && fits(p.bed_mm); })[0];
    return found ? { preset: found.preset, label: J.machineLabel(found) } : null;
  }

  // Niveau d'explication : « detailed » par défaut ; deviné tant que l'utilisateur ne l'a pas choisi lui-même.
  function levelOf(habits) { return habits && habits.level === 'short' ? 'short' : 'detailed'; }
  // Supposition (jamais au-dessus d'un choix fait à la main dans le menu) : « short » quand le vocabulaire le montre ; retour à
  // « detailed » quand l'utilisateur demande ce qu'est un terme (`definition`), et alors plus de passage automatique en court
  // (`level_hold`) : son vocabulaire d'avant ne le ferait pas remonter au message suivant.
  function guessLevel(habits, level, definition) {
    var h = clone(habits);
    if (h.level_manual) return h;
    if (definition) { if (h.level === 'short') { h.level = 'detailed'; h.level_hold = true; } return h; }
    if (level === 'short' && !h.level_hold) h.level = 'short';
    return h;
  }
  // Ce que la supposition a changé, pour le dire : 'up' (passé en court), 'down' (revenu au détaillé), '' sinon.
  function levelChange(before, after) {
    var a = levelOf(before), b = levelOf(after);
    return a === b ? '' : b === 'short' ? 'up' : 'down';
  }
  function chooseLevel(habits, level) { var h = clone(habits); h.level = level === 'short' ? 'short' : 'detailed'; h.level_manual = true; delete h.level_hold; return h; }

  // Questions d'intention : passées (skipped = true) ou répondues ; après trois projets passés de suite, on propose d'arrêter.
  function askIntent(habits) { return !(habits && habits.ask_intent === false); }
  function noteIntent(habits, skipped) { var h = clone(habits); h.intent_skips = skipped ? Math.min(100, (h.intent_skips || 0) + 1) : 0; return h; }
  function offerStopAsking(habits) { return askIntent(habits) && !!habits && (habits.intent_skips || 0) >= 3; }
  function stopAsking(habits, stop) { var h = clone(habits); if (stop) h.ask_intent = false; else { delete h.ask_intent; h.intent_skips = 0; } return h; }

  // Recherche dans le catalogue d'Orca (modèles installables) : chaque mot doit apparaître. Une marque seule (« Creality »)
  // montre tous ses modèles, triés, pour qu'on retrouve le sien en faisant défiler ; sinon les 8 premiers résultats.
  function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\-_]+/g, ' '); }
  function searchModels(catalog, query) {
    var words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length || !Array.isArray(catalog)) return [];
    var found = catalog.filter(function (m) {
      var hay = fold(m.vendor + ' ' + m.model);
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    var brandOnly = words.length && fold(query).trim() && found.length && found.every(function (m) { return fold(m.vendor) === fold(query).trim(); });
    if (!brandOnly) return found.slice(0, 8);
    return found.slice().sort(function (a, b) { return a.model.localeCompare(b.model, 'fr', { numeric: true }); });
  }

  // Phrase dite quand une machine vient d'être reliée : ce que Plyo vérifiera après un envoi (PlyoPrinterStatus.cpp lit
  // l'état des Creality et des Klipper/Moonraker ; les autres connexions ne disent pas encore si l'impression a démarré).
  var WATCHED = ['crealityprint', 'moonraker'];
  function linkSummary(hostType) {
    return WATCHED.indexOf(hostType) >= 0 ? 'Après chaque envoi, je vérifie qu’elle démarre bien.'
      : 'Après un envoi, regarde son écran : je ne sais pas encore vérifier qu’elle démarre.';
  }

  // ---------- Taille de buse (installation d'une imprimante, « Changer de buse » de la fiche) ----------
  // « 0.4 » ou 0.4 → « 0,4 mm » ; '' si ce n'est pas une taille.
  function nozzleText(n) {
    var v = typeof n === 'number' ? n : parseFloat(String(n == null ? '' : n));
    return isFinite(v) && v > 0 ? String(Math.round(v * 1000) / 1000).replace('.', ',') + ' mm' : '';
  }
  // Tailles proposées par le profil du modèle (« 0.4 », « 0.6 »…). Une seule : installée sans question (`auto`). Plusieurs : la
  // question, 0,4 mm d'abord et marquée comme la plus courante, puis les autres de la plus fine à la plus grosse.
  // `current` (« Changer de buse ») : la buse du profil en cours, signalée dans la liste.
  function nozzleChoice(nozzles, current) {
    var list = (Array.isArray(nozzles) ? nozzles : []).map(String).filter(function (n, i, all) { return nozzleText(n) && all.indexOf(n) === i; });
    if (list.length <= 1) return { auto: list[0] || '' };
    var common = list.indexOf('0.4') >= 0;
    var rest = list.filter(function (n) { return n !== '0.4'; }).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
    var order = common ? ['0.4'].concat(rest) : rest;
    var changing = typeof current === 'string' && current !== '';
    return {
      title: changing ? 'Quelle buse est montée sur ton imprimante ?' : 'Quelle taille de buse ?',
      text: 'La buse est la petite pièce en métal d’où sort le fil fondu. ' + (common
        ? 'Si tu n’as jamais changé la buse de ton imprimante, garde 0,4 mm : c’est celle livrée avec presque toutes les imprimantes.'
        : 'Si tu ne sais pas, garde celle livrée avec ton imprimante : sa notice l’indique.'),
      help: changing ? 'Changer de buse refait la préparation : filament, vérification et découpe.'
        : 'Pas sûr ? La taille est souvent gravée sur la buse elle-même, par exemple « 0.4 ». Tu pourras la changer plus tard.',
      choices: order.map(function (n) {
        return { value: n, common: n === '0.4', current: changing && n === current,
          label: nozzleText(n) + (n === '0.4' ? ' (la plus courante)' : '') + (changing && n === current ? ' · en place aujourd’hui' : '') };
      })
    };
  }
  // « Changer de buse » dans la fiche : seulement pour un profil fourni avec le slicer (une autre buse = une autre variante du même
  // modèle, installée comme à l'installation), d'un modèle à plusieurs tailles, et qui est bien l'imprimante du projet.
  // `machine` : message « values » du slicer (PrinterSetup::current_model). Un profil à soi (« Ma K1C », relié) : non.
  function nozzleChangeOffer(machine, projectPreset, orcaPrinter) {
    var m = machine && typeof machine === 'object' ? machine : null;
    if (!m || m.system !== true || !projectPreset || projectPreset !== orcaPrinter) return null;
    if (!Array.isArray(m.nozzles) || m.nozzles.length < 2 || !m.vendor || !m.model) return null;
    return { vendor: m.vendor, model: m.model, nozzles: m.nozzles.slice(), current: typeof m.nozzle === 'string' ? m.nozzle : '' };
  }

  // ---------- Type de plateau (question de l'étape Machine) ----------
  // Noms simples et de quoi reconnaître chaque plaque, pour les valeurs d'Orca (curr_bed_type). Les noms partent de la traduction
  // française du slicer (« Plaque PEI texturée », « Plaque lisse haute température »…).
  var BEDS = {
    'Cool Plate': { name: 'Plaque lisse basse température (Cool Plate)', look: 'Lisse au toucher. « Cool Plate » est écrit dessus.' },
    'Engineering Plate': { name: 'Plaque Engineering', look: 'Lisse au toucher. « Engineering Plate » est écrit dessus.' },
    'High Temp Plate': { name: 'Plaque lisse haute température', look: 'Lisse et brillante au toucher. On l’appelle souvent « PEI lisse ».' },
    'Textured PEI Plate': { name: 'Plaque PEI texturée', look: 'Rugueuse au toucher, comme un papier de verre très fin. Le dessous de tes pièces en sort granuleux.' },
    'Textured Cool Plate': { name: 'Plaque Cool Plate texturée', look: 'Rugueuse au toucher. « Textured Cool Plate » est écrit dessus.' },
    'Supertack Plate': { name: 'Plaque Cool Plate SuperTack', look: '« SuperTack » est écrit dessus.' }
  };
  var BED_UNKNOWN = 'unknown';
  function bedName(value, label) { return BEDS[value] ? BEDS[value].name : String(label || value || ''); }
  // Les types proposés par le slicer pour l'imprimante en cours (`bed` du message « values ») ; [] s'il n'y a pas de choix.
  function bedTypes(bed) {
    var t = bed && Array.isArray(bed.types) ? bed.types.filter(function (x) { return x && typeof x.value === 'string' && x.value; }) : [];
    return t.length >= 2 ? t : [];
  }
  function bedAnswer(habits, preset) {
    var b = habits && habits.beds && typeof habits.beds === 'object' ? habits.beds[preset] : '';
    return typeof b === 'string' ? b : '';
  }
  // Réponse retenue pour une imprimante : un type d'Orca, ou « unknown » (« Je ne sais pas »). Rien n'est appliqué ici.
  function rememberBed(habits, preset, value) {
    var h = clone(habits);
    if (!preset || !(value === BED_UNKNOWN || BEDS[value])) return h;
    h.beds = h.beds && typeof h.beds === 'object' ? h.beds : {};
    h.beds[preset] = value;
    return h;
  }
  // Faut-il poser la question ? ctx : { preset (imprimante du projet, choisie), orcaPrinter (celle que lit le slicer), habits,
  // editing (« Changer » de la fiche), shown (déjà montrée pendant cette session) }. Jamais pour une imprimante à un seul type.
  function bedAsks(bed, ctx) {
    var c = ctx || {};
    if (!bedTypes(bed).length || !c.preset || c.preset !== c.orcaPrinter) return false;
    return !!c.editing || !!c.shown || !bedAnswer(c.habits, c.preset);
  }
  function bedQuestion(bed) {
    var current = bed && bed.current;
    return {
      title: 'Quel plateau est posé sur ton imprimante ?',
      text: 'C’est la plaque sur laquelle ta pièce s’imprime. Je règle sa température d’après ta réponse.',
      help: 'Son nom est souvent écrit dessus, dans un coin ou au dos. Passe la main dessus : lisse ou rugueuse, ça aide à la reconnaître.',
      choices: bedTypes(bed).map(function (t) {
        return { value: t.value, name: bedName(t.value, t.label), look: BEDS[t.value] ? BEDS[t.value].look : '', current: t.value === current };
      }),
      unknown: 'Je ne sais pas'
    };
  }
  function bedUnknownText(bed) {
    return 'D’accord, je garde « ' + bedName(bed && bed.current) + ' », le réglage actuel. Pour vérifier : retire la plaque (elle est souvent aimantée et se soulève par un coin), '
      + 'regarde le nom écrit dessus ou au dos, et passe la main dessus : rugueuse, elle est texturée ; lisse, elle est lisse. Tu pourras changer depuis ta fiche, en haut.';
  }
  function bedChosenText(value, before, changed) {
    return changed ? 'C’est noté : ton plateau est « ' + bedName(value) + ' ». Je l’ai réglé dans Plyo Slicer, la température du plateau suit.'
      : 'C’est noté : ton plateau est « ' + bedName(value) + ' ». C’était déjà le réglage de Plyo Slicer.';
  }
  function bedRevertLabel(before) { return 'Remettre « ' + bedName(before) + ' »'; }
  // Ligne de la fiche ({ text: « Plateau : Plaque PEI texturée », note? }), null sans choix ; `note` : la plaque en cours a son
  // propre type.
  function bedRow(bed) {
    if (!bedTypes(bed).length || !bed.current) return null;
    var row = { text: 'Plateau : ' + bedName(bed.current) };
    if (bed.plate && bed.plate !== bed.current)
      row.note = 'Cette plaque a son propre type de plateau dans Plyo Slicer, « ' + bedName(bed.plate) + ' » : c’est lui qui compte pour elle.';
    return row;
  }

  var api = { nozzleText: nozzleText, nozzleChoice: nozzleChoice, nozzleChangeOffer: nozzleChangeOffer, BEDS: BEDS, BED_UNKNOWN: BED_UNKNOWN, bedName: bedName, bedTypes: bedTypes,
    bedAnswer: bedAnswer, rememberBed: rememberBed, bedAsks: bedAsks, bedQuestion: bedQuestion, bedUnknownText: bedUnknownText, bedChosenText: bedChosenText,
    bedRevertLabel: bedRevertLabel, bedRow: bedRow, levelOf: levelOf, guessLevel: guessLevel, levelChange: levelChange, chooseLevel: chooseLevel, askIntent: askIntent, noteIntent: noteIntent,
    offerStopAsking: offerStopAsking, stopAsking: stopAsking, machineThatFits: machineThatFits, visiblePrinters: visiblePrinters, isKnownHost: isKnownHost, machineQuestion: machineQuestion, habitFor: habitFor, rememberFilament: rememberFilament, replaceMachine: replaceMachine,
    hideMachine: hideMachine, unhideMachine: unhideMachine, emptyHabits: emptyHabits, searchModels: searchModels, linkSummary: linkSummary };
  root.PlyoMachines = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
