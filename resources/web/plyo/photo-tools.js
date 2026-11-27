// Photos jointes à une demande : réduites (1 600 px, JPEG 85 % ; vignette de 160 px gardée dans la conversation).
// Partagé par le panneau classique (index.html) et la v2 (v2/index.html). window.PlyoPhotos.
(function (root) {
  var MAX_SIDE = 1600;
  // La vue web peut signaler l'image chargée avant de l'avoir décodée : le dessin reste alors vide, et un canevas
  // vide exporté en JPEG donne une image noire. On attend donc le décodage, on peint un fond blanc, et on vérifie
  // que l'image a bien été dessinée (un second essai, puis abandon plutôt qu'une photo noire).
  function drawn(ctx, w, h) {
    var px = ctx.getImageData(0, 0, w, h).data;
    var step = Math.max(4, Math.floor(px.length / 4 / 400) * 4);
    for (var i = 0; i < px.length; i += step) if (px[i] < 250 || px[i + 1] < 250 || px[i + 2] < 250) return true;
    return false;
  }
  function scaled(src, side, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      function render(retry) {
        var scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (drawn(ctx, canvas.width, canvas.height)) return resolve(canvas.toDataURL('image/jpeg', quality));
        if (retry) return setTimeout(function () { render(false); }, 150);
        reject(new Error('blank'));
      }
      img.onload = function () {
        var ready = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
        ready.then(function () { render(true); });
      };
      img.onerror = function () { reject(new Error('unreadable')); };
      img.src = src;
    });
  }
  // Fichier image choisi → pièce jointe { media_type, data (base64), preview (adresse data:) }.
  function downscale(file) {
    var url = URL.createObjectURL(file);
    return scaled(url, MAX_SIDE, 0.85).then(function (dataUrl) {
      URL.revokeObjectURL(url);
      return { media_type: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl };
    }, function (e) { URL.revokeObjectURL(url); throw e; });
  }
  // Photos réduites d'un palier (ROB-03) : toujours depuis l'image jointe, jamais depuis une copie déjà réduite.
  function shrinkAll(original, step) {
    return Promise.all(original.map(function (p) {
      var src = p.preview || 'data:' + p.media_type + ';base64,' + p.data;
      return scaled(src, step.side, step.quality).then(function (dataUrl) {
        return { media_type: 'image/jpeg', data: dataUrl.split(',')[1], preview: p.preview };
      }, function () { return p; });
    }));
  }

  root.PlyoPhotos = { MAX_SIDE: MAX_SIDE, scaled: scaled, downscale: downscale, shrinkAll: shrinkAll };
})(typeof window !== 'undefined' ? window : globalThis);
