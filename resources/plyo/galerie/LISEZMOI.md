# Galerie de l'étape « Ta pièce »

Les modèles de ce dossier s'affichent dans la galerie du panneau Assistant, avant ceux livrés avec Orca. Pour en ajouter
un : déposer le fichier (STL, 3MF ou OBJ) et sa vignette (PNG ou JPEG, 300 Ko au plus, format 4:3 conseillé, par exemple
400 × 300 px) dans ce dossier, puis ajouter une entrée à `galerie.json` :

```json
[
  {
    "id": "crochet-mural",
    "file": "crochet-mural.3mf",
    "image": "crochet-mural.png",
    "name": "Crochet mural",
    "category": "utile",
    "what": "Se visse au mur, tient un sac ou un câble.",
    "author": "Nom de l'auteur",
    "license": "CC BY 4.0",
    "source": "https://makerworld.com/fr/models/…"
  }
]
```

- `id` : minuscules, chiffres et tirets (2 à 40 caractères), unique.
- `category` : `utile`, `jouet`, `déco` ou `test`.
- `author` et `license` sont obligatoires : le panneau affiche « par <auteur> · <licence> » sous la vignette (attribution).

## Licences acceptées

Seulement celles qui autorisent à livrer le fichier tel quel avec Plyo : CC0, domaine public, CC BY, CC BY-SA, CC BY-ND
(versions 2.0 à 4.0). Une entrée avec une autre licence est ignorée.

Refusées : toute licence « NC » (non commerciale ; Plyo a des formules payantes) et les licences propres à un site. Sur
MakerWorld, la licence par défaut, « Standard Digital File License », interdit la redistribution : vérifier la licence
affichée sur la page de chaque modèle, et garder son adresse dans `source`.

Le panneau vérifie aussi que les fichiers existent ; une entrée incomplète ou abîmée est simplement ignorée
(`src/plyo/PlyoGalleryLogic.cpp`).
