"""Logo Plyo en dégradé (« P » à couches, menthe → bleu → bleu nuit), redessiné le 26/10/2026 depuis l'image de Jérôme.

Coordonnées dans un carré de 1254 unités (taille de l'image d'origine). Les formes et les dégradés ont été ajustés sur
l'image par les scripts de `Plyo/marque/logo-degrade/` ; ce module n'en garde que le résultat.
`svg_body()` écrit le symbole en SVG (chemins + dégradés, lisibles par nanosvg), `render()` le dessine en pixels.
L'ancien logo (blanc sur menthe) reste dans logo_geometry.py.
"""
import math

import numpy as np
from PIL import Image, ImageDraw

from logo_geometry import SIZE, resolve, sample, svg_d

# --- formes ------------------------------------------------------------------------------------------------------

P = dict(jx=348.1, jy=421.2, tlx=350.2, tly=128.5, tlr=81.2, tex=911.9, tey=276.1, rx=1141.3, ry=565.1,
         lex=943.2, ley=846.2, a1=166.2, b1=105.2, c1=99.8, d1=142.2, lbx=672.7, lby=957.7, lbr=27.9,
         ltx=672.8, lty=706.7, ltr=53.7, nx=1027.4, ny=556.5, nr=65.5, ntx=631.1, nty=447.2, ntr=44.1,
         srx=630.0, sry=676.4, srr=38.1, sbx=479.4, sby=771.9, sbr=58.1, slx=95.7, sly=601.3, slr=38.8)

# Couches : un même gabarit répété trois fois. Bord haut y = a + s·x (bord bas : + h), bord montant y = b + t·x
# (bord bas : + hb). Pas p entre couches, et pe de descente en plus côté droit (perspective de l'original).
B = dict(xl=134.5, xr=631.0, s=0.4472, a=581.0, h=99.7, t=-0.6276, b=1102.7, hb=103.6, p=123.2, pe=4.2,
         r_tl=33.8, r_v=58.3, r_tip=1.3, r_br=36.9, r_bv=51.9, r_bl=48.4)

JUNCTION_Y = 543  # le mur et le dessus de la dalle se séparent sur la ligne (jx, jy) → (630, 543)


def p_outline():
    """Contour du P entier : mur, boucle, jambe, encoche et dessus de la dalle."""
    q = P
    top = (q["tey"] - q["tly"]) / (q["tex"] - q["tlx"])
    low = (q["lby"] - q["ley"]) / (q["lbx"] - q["lex"])
    return [
        ("pt", q["jx"], q["jy"], 0),
        ("pt", q["tlx"], q["tly"], q["tlr"]),
        ("pt", q["tex"], q["tey"], 0),
        ("cubic", (q["tex"] + q["a1"], q["tey"] + q["a1"] * top), (q["rx"], q["ry"] - q["b1"]), (q["rx"], q["ry"])),
        ("cubic", (q["rx"], q["ry"] + q["c1"]), (q["lex"] + q["d1"], q["ley"] + q["d1"] * low), (q["lex"], q["ley"])),
        ("pt", q["lbx"], q["lby"], q["lbr"]),
        ("pt", q["ltx"], q["lty"], q["ltr"]),
        ("pt", q["nx"], q["ny"], q["nr"]),
        ("pt", q["ntx"], q["nty"], q["ntr"]),
        ("pt", q["srx"], q["sry"], q["srr"]),
        ("pt", q["sbx"], q["sby"], q["sbr"]),
        ("pt", q["slx"], q["sly"], q["slr"]),
    ]


def slab_top():
    """Dessus de la dalle, peint par-dessus le P avec son propre dégradé."""
    q = P
    k = (JUNCTION_Y - q["nty"]) / (q["sry"] - q["nty"])
    x = q["ntx"] + k * (q["srx"] - q["ntx"])
    return [("pt", q["jx"], q["jy"], 0), ("pt", x, JUNCTION_Y, 0), ("pt", q["srx"], q["sry"], q["srr"]),
            ("pt", q["sbx"], q["sby"], q["sbr"]), ("pt", q["slx"], q["sly"], q["slr"])]


def _inter(a1, s1, a2, s2):
    x = (a2 - a1) / (s1 - s2)
    return x, a1 + s1 * x


def band(k):
    q = B
    A, Bk = q["a"] + q["p"] * k, q["b"] + (q["p"] + q["pe"]) * k
    vx, vy = _inter(A, q["s"], Bk, q["t"])
    bx, by = _inter(A + q["h"], q["s"], Bk + q["hb"], q["t"])
    return [
        ("pt", q["xl"], A + q["s"] * q["xl"], q["r_tl"]),
        ("pt", vx, vy, q["r_v"]),
        ("pt", q["xr"], Bk + q["t"] * q["xr"], q["r_tip"]),
        ("pt", q["xr"], Bk + q["hb"] + q["t"] * q["xr"], q["r_br"]),
        ("pt", bx, by, q["r_bv"]),
        ("pt", q["xl"], A + q["h"] + q["s"] * q["xl"], q["r_bl"]),
    ]


# --- dégradés (coordonnées dans le carré de 1254) ------------------------------------------------------------------
# Linéaire : (x1, y1, x2, y2, couleurs réparties régulièrement). Radial : voile bleu nuit sur la jambe du P.

LINEAR = {
    "mur": (126.9, 285.1, 468.3, 1051.9, ((3, 255, 183), (1, 217, 227), (0, 80, 255), (3, 24, 144))),
    "dalle": (445.7, -119.4, -20.1, 5.4, ((0, 76, 249), (1, 146, 234), (2, 216, 210), (3, 255, 194))),
    "c1": (-13.1, 2.8, 455.9, -96.9, ((2, 242, 215), (1, 144, 238), (0, 58, 240), (3, 14, 145))),
    "c2": (532.8, -56.0, 50.9, -5.4, ((6, 13, 128), (0, 44, 225), (0, 106, 253), (1, 199, 249))),
    "c3": (138.0, 0.0, 626.0, 0.0, ((1, 159, 253), (0, 81, 255), (0, 35, 200), (7, 13, 122))),
}
VEIL = dict(cx=596.9, cy=793.8, r=288.6, color=(6, 25, 129))


def layers():
    """Formes dans l'ordre où elles sont peintes : (nom du dégradé, commandes de chemin)."""
    p = resolve(p_outline())
    return [("mur", p), ("voile", p), ("dalle", resolve(slab_top()))] + [(f"c{k + 1}", resolve(band(k))) for k in range(3)]


def centering_offset():
    """Décalage qui centre la boîte englobante du symbole dans le carré de 1254."""
    pts = [pt for name, c in layers() if name != "voile" for pt in sample(c)]
    xs, ys = [x for x, _ in pts], [y for _, y in pts]
    return SIZE / 2 - (min(xs) + max(xs)) / 2, SIZE / 2 - (min(ys) + max(ys)) / 2


OX, OY = centering_offset()


# --- SVG ---------------------------------------------------------------------------------------------------------

def _hex(c):
    return "#%02X%02X%02X" % c


def svg_body(prefix="plyo"):
    """Symbole centré dans le carré de 1254 : <defs> des dégradés puis les chemins (ids préfixés par `prefix`)."""
    defs = []
    for name, (x1, y1, x2, y2, cols) in LINEAR.items():
        stops = "".join(f'<stop offset="{i / (len(cols) - 1):.3f}" stop-color="{_hex(c)}"/>' for i, c in enumerate(cols))
        defs.append(f'<linearGradient id="{prefix}-{name}" gradientUnits="userSpaceOnUse" x1="{x1 + OX:.1f}" '
                    f'y1="{y1 + OY:.1f}" x2="{x2 + OX:.1f}" y2="{y2 + OY:.1f}">{stops}</linearGradient>')
    c = _hex(VEIL["color"])
    defs.append(f'<radialGradient id="{prefix}-voile" gradientUnits="userSpaceOnUse" cx="{VEIL["cx"] + OX:.1f}" '
                f'cy="{VEIL["cy"] + OY:.1f}" r="{VEIL["r"]:.1f}"><stop offset="0" stop-color="{c}" stop-opacity="1"/>'
                f'<stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>')
    paths = "".join(f'<path d="{svg_d(cmds, 1, OX, OY)}" fill="url(#{prefix}-{name})"/>' for name, cmds in layers())
    return f"<defs>{''.join(defs)}</defs>{paths}"


# --- pixels ------------------------------------------------------------------------------------------------------

def _paint(name, X, Y):
    """Couleur (RVB) et opacité du dégradé `name` aux points (X, Y) du carré de 1254."""
    if name == "voile":
        w = np.clip(1 - np.hypot(X - VEIL["cx"], Y - VEIL["cy"]) / VEIL["r"], 0, 1)
        return np.broadcast_to(np.array(VEIL["color"], float), X.shape + (3,)), w
    x1, y1, x2, y2, cols = LINEAR[name]
    dx, dy = x2 - x1, y2 - y1
    u = np.clip(((X - x1) * dx + (Y - y1) * dy) / (dx * dx + dy * dy), 0, 1) * (len(cols) - 1)
    i = np.minimum(u.astype(int), len(cols) - 2)
    f = (u - i)[..., None]
    cols = np.array(cols, float)
    return cols[i] * (1 - f) + cols[i + 1] * f, np.ones(X.shape)


def render(size, ss=4):
    """Symbole seul (fond transparent) en image RGBA de `size` pixels, centré dans le carré."""
    S = size * ss
    k = S / SIZE
    Y, X = np.mgrid[0:S, 0:S]
    X, Y = (X + 0.5) / k - OX, (Y + 0.5) / k - OY
    rgb, alpha = np.zeros((S, S, 3)), np.zeros((S, S))
    for name, cmds in layers():
        img = Image.new("L", (S, S), 0)
        ImageDraw.Draw(img).polygon([((x + OX) * k, (y + OY) * k) for x, y in sample(cmds)], fill=255)
        cover = np.asarray(img, float) / 255
        col, op = _paint(name, X, Y)
        a = cover * op
        rgb = rgb * (1 - a[..., None]) + col * a[..., None]
        alpha = alpha * (1 - a) + a
    # rgb est prémultiplié par alpha : on le divise avant d'enregistrer
    out = np.dstack([np.where(alpha[..., None] > 0, rgb / np.maximum(alpha, 1e-6)[..., None], 0), alpha * 255])
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8), "RGBA").resize((size, size), Image.LANCZOS)
