// Fiches « Explique-moi ce réglage » : explications de base, gratuites et hors ligne.
// Clé = clé de configuration d'Orca (PrintConfig.cpp). Ton : tutoiement, sans jargon, rassurant.
// what : à quoi ça sert ; high / low : ce qu'on voit sur la pièce si c'est trop haut / trop bas ;
// touch : faut-il y toucher. aliases : mots qu'un débutant emploie (sans article).
(function (root) {
  var bedTemp = {
    label: 'Température du plateau',
    aliases: ['température du plateau', 'température plateau', 'chauffe du plateau', 'plateau chauffant'],
    what: 'La chaleur du plateau. Elle aide la première couche à bien coller pendant toute l’impression.',
    high: 'Le bas de la pièce peut s’écraser ou faire une « patte d’éléphant » (bord qui déborde), et le PLA peut se ramollir.',
    low: 'La pièce colle mal, se décolle en cours de route ou ses coins se soulèvent.',
    touch: 'Garde la valeur de ton filament. Si ça décolle, nettoie d’abord le plateau (eau savonneuse ou alcool) avant de monter de 5 °C.'
  };
  // Une fiche par type de plateau (Orca a une clé par type) ; seule la première porte les mots du débutant.
  function copy(base, label, keepAliases) { var o = {}; for (var k in base) o[k] = base[k]; o.label = label; o.aliases = keepAliases ? base.aliases : []; return o; }

  var FICHES = {
    nozzle_temperature: {
      label: 'Température de buse',
      aliases: ['température de buse', 'température buse', 'température d’impression', 'température', 'chauffe de la buse'],
      what: 'La chaleur à laquelle le filament fond dans la buse. Chaque filament a sa plage (souvent écrite sur la bobine).',
      high: 'Des fils fins entre les parties de la pièce, des surplombs qui coulent, une surface brillante ou baveuse.',
      low: 'Des couches qui se séparent facilement, une pièce fragile, un filament qui a du mal à sortir (clics).',
      touch: 'La valeur du profil de ton filament est un bon départ. Le test « tour de température » trouve la meilleure pour ta bobine.'
    },
    nozzle_temperature_initial_layer: {
      label: 'Température de buse (première couche)',
      aliases: ['température première couche', 'température de la première couche'],
      what: 'La température de la buse pour la toute première couche, souvent un peu plus chaude pour mieux coller.',
      high: 'Une première couche écrasée ou baveuse.',
      low: 'Une première couche qui accroche mal au plateau.',
      touch: 'En général, laisse-la telle quelle : elle suit le profil de ton filament.'
    },
    hot_plate_temp: copy(bedTemp, 'Température du plateau (plateau lisse PEI)', true),
    textured_plate_temp: copy(bedTemp, 'Température du plateau (plateau texturé PEI)'),
    cool_plate_temp: copy(bedTemp, 'Température du plateau (plateau froid)'),
    eng_plate_temp: copy(bedTemp, 'Température du plateau (plateau ingénierie)'),
    layer_height: {
      label: 'Hauteur de couche',
      aliases: ['hauteur de couche', 'épaisseur de couche', 'couche', 'résolution'],
      what: 'L’épaisseur de chaque couche de plastique. Plus fine = plus détaillé mais plus long.',
      high: 'Les marches entre les couches se voient plus, surtout sur les courbes et les pentes douces.',
      low: 'L’impression devient beaucoup plus longue, pour un gain souvent peu visible.',
      touch: '0,2 mm (avec une buse de 0,4 mm) est le bon réglage pour la plupart des pièces. Descends à 0,12–0,16 mm pour une figurine détaillée.'
    },
    outer_wall_speed: {
      label: 'Vitesse des parois externes',
      aliases: ['vitesse des parois externes', 'vitesse paroi externe', 'vitesse extérieure', 'vitesse'],
      what: 'La vitesse à laquelle la buse trace le contour visible de ta pièce.',
      high: 'Une surface moins nette, des vibrations visibles (vaguelettes après les coins).',
      low: 'Une impression plus longue, sans souci de qualité.',
      touch: 'Laisse la valeur du profil. Si tu vois des vaguelettes sur les faces, baisse-la un peu.'
    },
    filament_retraction_length: {
      label: 'Longueur de rétraction',
      aliases: ['rétraction', 'longueur de rétraction', 'retrait du filament'],
      what: 'Quand la buse se déplace sans imprimer, elle recule un peu le filament pour éviter qu’il coule. C’est la longueur de ce recul.',
      high: 'Des petits trous ou des manques après les déplacements, voire un bouchon dans la tête.',
      low: 'Des fils comme des toiles d’araignée entre les parties de la pièce.',
      touch: 'Laisse le réglage de ton profil. En cas de fils, le test « tour de rétraction » trouve la bonne valeur.'
    },
    brim_width: {
      label: 'Largeur de bordure',
      aliases: ['bordure', 'brim', 'largeur de bordure', 'collerette'],
      what: 'Une fine collerette imprimée autour du bas de la pièce pour l’aider à tenir sur le plateau. Elle s’enlève à la main après.',
      high: 'Plus de plastique à retirer et un petit temps en plus, rien de grave.',
      low: 'Une pièce haute, fine ou avec peu de surface au sol risque de se décoller.',
      touch: 'Mets 5 mm si ta pièce est haute, fine ou a des coins qui se soulèvent. Sinon 0 suffit.'
    },
    enable_support: {
      label: 'Supports',
      aliases: ['support', 'supports', 'échafaudage'],
      what: 'Des structures temporaires imprimées sous les parties qui seraient sinon dans le vide. On les retire après.',
      high: 'Activés sans besoin : plus de temps, de plastique et des marques là où ils touchent la pièce.',
      low: 'Désactivés alors qu’il en faut : les parties en l’air s’affaissent ou partent en spaghettis.',
      touch: 'Active-les si ta pièce a des parties en surplomb (plus de 45° environ) ou des ponts longs.'
    },
    ironing_type: {
      label: 'Lissage',
      aliases: ['lissage', 'ironing', 'repassage'],
      what: 'Après la dernière couche du dessus, la buse repasse dessus en poussant très peu de plastique pour la rendre lisse.',
      high: 'Activé partout : temps en plus pour un effet invisible sur les surfaces non plates.',
      low: 'Désactivé : le dessus garde des lignes visibles.',
      touch: 'Active-le « surfaces du dessus » pour les pièces au dessus plat et visible. Le test de lissage trouve les bons réglages.'
    },
    ironing_speed: {
      label: 'Vitesse de lissage',
      aliases: ['vitesse de lissage'],
      what: 'La vitesse de la buse pendant le lissage.',
      high: 'Un lissage moins efficace, des traces restent.',
      low: 'Plus long, et parfois un dessus légèrement brûlé ou trop chargé.',
      touch: 'Laisse la valeur du profil sauf si le test de lissage montre mieux.'
    },
    ironing_flow: {
      label: 'Débit de lissage',
      aliases: ['débit de lissage'],
      what: 'La petite quantité de plastique poussée pendant le lissage, en pourcentage d’une couche normale.',
      high: 'Des bourrelets ou un dessus rugueux, du plastique en trop.',
      low: 'Les petits creux entre les lignes ne se remplissent pas.',
      touch: 'Entre 10 et 20 % en général. Le test de lissage te montre la bonne valeur.'
    },
    ironing_spacing: {
      label: 'Espacement du lissage',
      aliases: ['espacement du lissage', 'écart de lissage'],
      what: 'La distance entre deux passages de lissage.',
      high: 'Des bandes visibles, la surface n’est pas lissée partout.',
      low: 'Beaucoup plus long, et la surface peut devenir trop chargée.',
      touch: 'Autour de 0,1 à 0,15 mm. Le test de lissage te guide.'
    },
    support_type: {
      label: 'Type de support',
      aliases: ['type de support', 'support arborescent', 'support arbre'],
      what: 'La forme des supports : « normaux » (grille sous la pièce) ou « arborescents » (des branches qui montent vers les zones à soutenir).',
      high: 'Normaux : solides mais plus durs à retirer et plus de marques.',
      low: 'Arborescents : moins de plastique et plus faciles à enlever, mais un peu plus longs à calculer.',
      touch: 'Les arborescents « auto » conviennent à la plupart des figurines et formes organiques.'
    },
    support_style: {
      label: 'Style de support',
      aliases: ['style de support'],
      what: 'La variante de construction des supports, selon leur type.',
      high: 'Un style trop solide colle plus à la pièce.',
      low: 'Un style trop léger peut céder pendant l’impression.',
      touch: 'Laisse « par défaut », sauf conseil précis.'
    },
    support_on_build_plate_only: {
      label: 'Supports sur le plateau uniquement',
      aliases: ['supports sur le plateau uniquement', 'support plateau seulement'],
      what: 'Si c’est coché, les supports ne partent que du plateau, jamais de la pièce elle-même.',
      high: 'Coché : moins de marques sur la pièce, mais certaines zones restent sans support.',
      low: 'Décoché : tout est soutenu, mais des supports peuvent s’appuyer sur ta pièce et laisser des traces.',
      touch: 'Coche-le si les supports qui s’appuient sur la pièce te gênent.'
    },
    support_threshold_angle: {
      label: 'Angle de déclenchement des supports',
      aliases: ['angle de support', 'angle de déclenchement', 'seuil des supports'],
      what: 'À partir de quelle pente une partie en surplomb reçoit un support.',
      high: 'Des supports partout, même là où la pièce tiendrait seule.',
      low: 'Des surplombs pas soutenus qui s’affaissent.',
      touch: 'Autour de 30° est un bon réglage. Monte-le si des surplombs coulent.'
    },
    wall_loops: {
      label: 'Nombre de parois',
      aliases: ['parois', 'nombre de parois', 'murs', 'périmètres', 'épaisseur des murs'],
      what: 'Le nombre de contours tracés pour former l’enveloppe de la pièce. C’est surtout ça qui la rend solide.',
      high: 'Plus long et plus de plastique, pour une pièce très solide.',
      low: 'Une pièce fragile, et le remplissage peut se voir à travers.',
      touch: '2 ou 3 suffisent pour une déco. Pour une pièce qui doit résister, passe à 4.'
    },
    sparse_infill_density: {
      label: 'Taux de remplissage',
      aliases: ['remplissage', 'taux de remplissage', 'infill', 'densité'],
      what: 'La quantité de plastique à l’intérieur de la pièce, en pourcentage. L’intérieur est une sorte de nid d’abeille.',
      high: 'Plus long et plus lourd, avec un gain de solidité modeste au-delà de 30–40 %.',
      low: 'Une pièce légère mais fragile ; le dessus peut se creuser.',
      touch: '15 % pour une déco, 25–40 % pour une pièce utile. Ajouter des parois renforce souvent mieux.'
    },
    top_shell_layers: {
      label: 'Couches pleines (dessus)',
      aliases: ['couches du dessus', 'couches pleines du dessus', 'dessus'],
      what: 'Le nombre de couches pleines qui ferment le dessus de la pièce.',
      high: 'Un peu plus long, sans inconvénient visible.',
      low: 'Le dessus peut avoir des trous ou laisser voir le remplissage.',
      touch: 'Laisse la valeur du profil. Si le dessus a des trous, ajoute une ou deux couches.'
    },
    bottom_shell_layers: {
      label: 'Couches pleines (dessous)',
      aliases: ['couches du dessous', 'couches pleines du dessous', 'dessous'],
      what: 'Le nombre de couches pleines qui forment le fond de la pièce.',
      high: 'Un peu plus long.',
      low: 'Un fond fragile ou ajouré.',
      touch: 'Laisse la valeur du profil.'
    },
    sparse_infill_pattern: {
      label: 'Motif de remplissage',
      aliases: ['motif de remplissage', 'type de remplissage', 'gyroïde', 'grille'],
      what: 'La forme du nid d’abeille intérieur : grille, gyroïde, nid d’abeille…',
      high: 'Certains motifs sont plus longs à imprimer.',
      low: 'Certains motifs rapides sont moins solides dans certaines directions.',
      touch: 'Le motif par défaut convient très bien. Le gyroïde est un bon choix polyvalent.'
    },
    seam_position: {
      label: 'Position de la couture',
      aliases: ['couture', 'jointure', 'position de la couture', 'seam'],
      what: 'À chaque couche, la buse commence et finit le contour au même endroit : ça laisse une petite ligne, la couture. Ce réglage choisit où la placer.',
      high: 'Une couture bien visible sur une face qui se voit.',
      low: 'Une couture aléatoire : des petits points éparpillés partout.',
      touch: '« Alignée » ou « arrière » la cache souvent derrière la pièce.'
    },
    skirt_loops: {
      label: 'Jupe (tours autour de la pièce)',
      aliases: ['jupe', 'skirt', 'contour de purge'],
      what: 'Un ou plusieurs tours de plastique autour de la pièce, sans la toucher, pour amorcer la buse avant de commencer.',
      high: 'Un peu de plastique en plus, sans gêne.',
      low: 'À 0, la buse commence directement sur la pièce, parfois mal amorcée.',
      touch: '1 tour suffit. Laisse le profil.'
    },
    initial_layer_print_height: {
      label: 'Hauteur de la première couche',
      aliases: ['hauteur de la première couche', 'première couche'],
      what: 'L’épaisseur de la toute première couche, posée directement sur le plateau.',
      high: 'Une première couche moins écrasée qui colle moins bien.',
      low: 'Une première couche trop fine qui demande un plateau parfaitement réglé.',
      touch: '0,2 mm est le réglage sûr. Laisse-le.'
    },
    fan_max_speed: {
      label: 'Ventilation (vitesse maximale)',
      aliases: ['ventilation', 'ventilateur', 'refroidissement'],
      what: 'La force maximale du ventilateur qui refroidit le plastique juste après sa sortie.',
      high: 'Pour l’ABS ou l’ASA : des fissures entre les couches. Pour le PETG : des couches qui collent moins.',
      low: 'Pour le PLA : des surplombs et des petits détails qui s’affaissent ou se déforment.',
      touch: 'Suis le profil de ton filament : fort pour le PLA, modéré pour le PETG, faible pour l’ABS.'
    },
    filament_flow_ratio: {
      label: 'Débit du filament',
      aliases: ['débit', 'débit du filament', 'flow', 'multiplicateur de débit'],
      what: 'Un coefficient qui ajuste la quantité de plastique poussée. 1 = la quantité théorique.',
      high: 'Sur-extrusion : bourrelets, dessus rugueux, pièce un peu trop grosse.',
      low: 'Sous-extrusion : trous entre les lignes, pièce fragile.',
      touch: 'Ne le change qu’après le test de débit : il trouve la valeur juste pour ta bobine.'
    },
    pressure_advance: {
      label: 'Pressure advance',
      aliases: ['pressure advance', 'avance de pression', 'linear advance'],
      what: 'Une correction qui anticipe la pression dans la buse quand elle accélère ou freine, pour des coins nets.',
      high: 'Des coins creusés ou des manques juste après les virages.',
      low: 'Des coins bombés et des bords qui débordent.',
      touch: 'Laisse la valeur du profil, ou fais le test de pressure advance qui la règle pour toi.'
    },
    wall_generator: {
      label: 'Générateur de parois',
      aliases: ['générateur de parois', 'arachne', 'classique'],
      what: 'La méthode qui calcule les contours. « Arachne » adapte la largeur des lignes aux zones fines, « classique » garde une largeur fixe.',
      high: 'Arachne : parfois des petites irrégularités sur les surfaces.',
      low: 'Classique : les zones très fines peuvent manquer de plastique.',
      touch: 'Laisse « Arachne » : il est meilleur pour les détails fins.'
    },
    inner_wall_speed: {
      label: 'Vitesse des parois internes',
      aliases: ['vitesse des parois internes', 'vitesse paroi interne'],
      what: 'La vitesse des contours cachés, sous la paroi visible.',
      high: 'Des parois internes moins régulières, qui peuvent se voir par transparence.',
      low: 'Plus long, sans gain visible.',
      touch: 'Laisse la valeur du profil.'
    },
    travel_speed: {
      label: 'Vitesse de déplacement',
      aliases: ['vitesse de déplacement', 'déplacement'],
      what: 'La vitesse de la buse quand elle se déplace sans imprimer.',
      high: 'Rien de grave en général, sauf vibrations sur une imprimante peu rigide.',
      low: 'Plus de temps et plus de fils, car le plastique a le temps de couler.',
      touch: 'Laisse la valeur du profil.'
    },
    initial_layer_speed: {
      label: 'Vitesse de la première couche',
      aliases: ['vitesse de la première couche', 'vitesse première couche'],
      what: 'La vitesse de la toute première couche, plus lente pour bien coller.',
      high: 'Une première couche qui accroche mal.',
      low: 'Plus long, mais très sûr.',
      touch: 'Si la première couche décolle, baisse-la un peu.'
    },
    enable_prime_tower: {
      label: 'Tour de purge',
      aliases: ['tour de purge', 'prime tower', 'tour d’essuyage'],
      what: 'Une petite tour imprimée à côté de la pièce pour nettoyer la buse à chaque changement de couleur.',
      high: 'Activée en une seule couleur : temps et plastique perdus.',
      low: 'Désactivée en multicolore : des couleurs qui bavent les unes sur les autres.',
      touch: 'Utile seulement en multicolore. Orca la gère tout seul.'
    }
  };

  root.PLYO_FICHES = FICHES;
  if (typeof module !== 'undefined' && module.exports) module.exports = { FICHES: FICHES };
})(typeof window !== 'undefined' ? window : globalThis);
