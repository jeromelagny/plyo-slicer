"""Fabrique les icônes et logos de Plyo Slicer à la place de ceux d'Orca (mêmes noms de fichiers, mêmes dimensions).

Lancer depuis la racine du dépôt :  python3 src/plyo/brand/make_assets.py
Il faut Pillow et fontTools (pip), et `iconutil` (macOS) pour les .icns. Les fichiers produits sont versionnés : le script
ne tourne pas pendant la compilation. Liste des fichiers remplacés : docs/plyo/FICHIERS-MODIFIES.md (section Marque).
"""
import os
import shutil
import subprocess
import sys
import tempfile

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import logo_geometry as geo  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
IMAGES = os.path.join(ROOT, "resources", "images")
FONTS = os.path.join(ROOT, "resources", "fonts")

MINT = "#00F1CF"
WHITE = "#FFFFFF"
# Couleurs du nom « plyo slicer » : la menthe du logo est trop claire pour du texte sur fond blanc.
TEXT = {"light": ("#00A38A", "#949494"), "dark": (MINT, "#A8A8A8")}

MARK = geo.mark_commands()
OX, OY = geo.centering_offset(MARK)
POLYS = [geo.sample(c) for c in MARK]


# --- images en pixels -------------------------------------------------------------------------------------------

def tile(size, margin=0.0, radius=0.0, alpha=255, ss=8):
    """Carré menthe (arrondi si radius > 0, en fraction du côté du carré) avec le symbole blanc, centré."""
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = margin * S
    side = S - 2 * m
    box = (m, m, S - m - 1, S - m - 1)
    if radius > 0:
        d.rounded_rectangle(box, radius=radius * side, fill=geo.BG + (alpha,))
    else:
        d.rectangle(box, fill=geo.BG + (alpha,))
    k = side / geo.SIZE
    for poly in POLYS:
        d.polygon([(m + (x + OX) * k, m + (y + OY) * k) for x, y in poly], fill=(255, 255, 255, alpha))
    return img.resize((size, size), Image.LANCZOS)


# Proportions d'une icône macOS (grille Apple : carré de 824 sur 1024, coins de 185).
def mac_tile(size):
    return tile(size, margin=100 / 1024, radius=185 / 824)


def app_tile(size):
    return tile(size, margin=0.03, radius=0.2)


def save_png(img, name, expect_size=True):
    path = os.path.join(IMAGES, name)
    if expect_size:
        old = Image.open(path).size
        assert old == img.size, f"{name} : {img.size} au lieu de {old}"
    img.save(path)
    return path


def save_ico(sizes, render, name):
    path = os.path.join(IMAGES, name)
    old = Image.open(path).info.get("sizes")
    imgs = [render(s) for s in sorted(sizes, reverse=True)]
    imgs[0].save(path, format="ICO", sizes=[(s, s) for s in sorted(sizes, reverse=True)], append_images=imgs[1:])
    new = Image.open(path).info.get("sizes")
    assert new == old, f"{name} : tailles {new} au lieu de {old}"
    return path


def save_icns(path):
    tmp = tempfile.mkdtemp()
    iconset = os.path.join(tmp, "plyo.iconset")
    os.makedirs(iconset)
    for base in (16, 32, 128, 256, 512):
        mac_tile(base).save(os.path.join(iconset, f"icon_{base}x{base}.png"))
        mac_tile(base * 2).save(os.path.join(iconset, f"icon_{base}x{base}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", path], check=True)
    shutil.rmtree(tmp)
    return path


# --- images vectorielles (lues par nanosvg dans Orca : chemins seulement, pas de <text>) ---------------------------

def mark_group(x, y, side):
    """Symbole blanc dans un carré de `side` placé en (x, y), en chemins SVG."""
    k = side / geo.SIZE
    d = " ".join(geo.svg_d(c, 1, OX, OY) for c in MARK)
    return f'<g transform="translate({x:.2f} {y:.2f}) scale({k:.5f})"><path d="{d}" style="fill:{WHITE};"/></g>'


def tile_svg(x, y, side, rx):
    return (f'<rect x="{x:.2f}" y="{y:.2f}" width="{side:.2f}" height="{side:.2f}" rx="{rx:.2f}" ry="{rx:.2f}" '
            f'style="fill:{MINT};"/>' + mark_group(x, y, side))


class Word:
    """Un mot converti en chemin SVG avec sa boîte d'encre, à partir d'une police livrée avec Orca."""

    _fonts = {}

    def __init__(self, text, font_file, tracking=0.0):
        font = Word._fonts.setdefault(font_file, TTFont(os.path.join(FONTS, font_file)))
        cmap, glyphs, hmtx = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
        self.upm = font["head"].unitsPerEm
        self.d, x = [], 0.0
        xs, ys = [], []
        for ch in text:
            name = cmap[ord(ch)]
            pen = SVGPathPen(glyphs)
            glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
            self.d.append(pen.getCommands())
            bp = BoundsPen(glyphs)
            glyphs[name].draw(bp)
            if bp.bounds:
                xs += [x + bp.bounds[0], x + bp.bounds[2]]
                ys += [-bp.bounds[3], -bp.bounds[1]]
            x += hmtx[name][0] + tracking * self.upm
        self.box = (min(xs), min(ys), max(xs), max(ys))  # unités de la police, y vers le bas

    @property
    def width(self):
        return self.box[2] - self.box[0]

    @property
    def height(self):
        return self.box[3] - self.box[1]

    def place(self, x, y, scale, color):
        """Chemin dont la boîte d'encre commence en (x, y), à l'échelle donnée (pixels par unité de police)."""
        tx, ty = x - self.box[0] * scale, y - self.box[1] * scale
        return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.6f})">'
                f'<path d="{" ".join(self.d)}" style="fill:{color};"/></g>')


def wordmark(x, y, width, theme, align="left"):
    """« plyo » au-dessus de « slicer », tous deux de la largeur `width` (comme le logo d'Orca). Renvoie (svg, hauteur)."""
    top = Word("plyo", "HarmonyOS_Sans_SC_Bold.ttf")
    plain = Word("slicer", "HarmonyOS_Sans_SC_Regular.ttf")
    # « slicer » est espacé pour faire la même largeur que « plyo » à hauteur de lettres comparable.
    s1 = width / top.width
    plain_scale = s1 * 0.62
    gap = (width / plain_scale - plain.width) / 5 / plain.upm
    plain = Word("slicer", "HarmonyOS_Sans_SC_Regular.ttf", tracking=max(0.0, gap))
    s2 = width / plain.width
    h1, h2 = top.height * s1, plain.height * s2
    space = h1 * 0.12
    c1, c2 = TEXT[theme]
    x2 = x if align == "left" else x + (width - plain.width * s2) / 2
    svg = top.place(x, y, s1, c1) + plain.place(x2, y + h1 + space, s2, c2)
    return svg, h1 + space + h2


def write_svg(name, w, h, body):
    path = os.path.join(IMAGES, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
                f"<!-- Plyo Slicer : fabriqué par src/plyo/brand/make_assets.py -->{body}</svg>\n")
    return path


def main():
    out = []
    # Icône de l'application (macOS) et icône des documents associés.
    out.append(save_icns(os.path.join(ROOT, "resources", "Icon.icns")))
    out.append(save_icns(os.path.join(IMAGES, "OrcaSlicer.icns")))
    # Windows : icône du .exe, de l'installateur et des fenêtres ; macOS : icône du Dock au lancement.
    out.append(save_ico([16, 32, 48, 64, 128, 256], app_tile, "OrcaSlicer.ico"))
    out.append(save_ico([256], mac_tile, "OrcaSlicer-mac_256px.ico"))
    out.append(save_ico([154], lambda s: tile(s), "OrcaSlicerTitle.ico"))
    out.append(save_png(tile(154), "OrcaSlicerTitle.png"))
    out.append(save_png(app_tile(154), "OrcaSlicer.png"))
    out.append(save_png(tile(128, margin=11 / 128, radius=0.2), "OrcaSlicer_128px.png"))
    big = app_tile(192)
    out.append(save_png(big, "OrcaSlicer_192px.png"))
    gray = ImageOps.grayscale(big.convert("RGB")).convert("RGBA")
    gray.putalpha(big.getchannel("A"))
    out.append(save_png(gray, "OrcaSlicer_192px_grayscale.png"))
    out.append(save_png(tile(192, alpha=191), "OrcaSlicer_192px_transparent.png"))

    # Images vectorielles, mêmes cadres que celles d'Orca.
    out.append(write_svg("OrcaSlicer.svg", 64, 64, tile_svg(0, 0, 64, 14)))
    out.append(write_svg("OrcaSlicer_gradient_circle.svg", 1280, 1280, tile_svg(40, 40, 1200, 240)))
    for theme, suffix in (("light", "_light"), ("dark", "_dark")):
        _, h = wordmark(0, 0, 112, theme)
        width = 112 * min(1.0, 64 / h)  # le nom tient dans 64 px de haut
        _, h = wordmark(0, 0, width, theme)
        words, _ = wordmark(92, (80 - h) / 2, width, theme)
        out.append(write_svg(f"OrcaSlicer_horizontal{suffix}.svg", 214, 80, tile_svg(0, 0, 80, 9.57) + words))
    for theme, name in (("light", "OrcaSlicer_about.svg"), ("dark", "OrcaSlicer_about_dark.svg")):
        _, h = wordmark(0, 0, 120, theme)
        words, _ = wordmark(116, 21.22 + (80.56 - h) / 2, 120, theme)
        line = f'<rect x="20" y="123" width="520" height="2" style="fill:{TEXT[theme][0]};"/>'
        out.append(write_svg(name, 560, 125, tile_svg(20, 21.22, 80.56, 9.64) + words + line))
    for theme, name in (("light", "splash_logo.svg"), ("dark", "splash_logo_dark.svg")):
        words, _ = wordmark(168.97, 248, 142.05, theme, align="center")
        out.append(write_svg(name, 480, 480, tile_svg(168.97, 80.54, 142.05, 17) + words))

    for p in out:
        print(os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
