"""Géométrie du logo Plyo (« P » à couches), redessiné en vectoriel le 26/10/2026 à partir de l'image validée par Jérôme.

Coordonnées dans un carré de 1254 unités (taille de l'image d'origine). `mark_commands()` donne les 5 formes blanches ;
`svg_d()` les écrit en chemin SVG, `render()` les dessine avec Pillow (sur-échantillonnage, sans outil externe).
"""
import math
from PIL import Image, ImageDraw

BG = (0, 241, 207)  # #00F1CF
BOWL = (140, 100, 80, 140)  # poignées des courbes de la boucle du P, ajustées sur l'image d'origine
SIZE = 1254

# --- éléments de chemin : ('pt', x, y, r) | ('arc', x, y, R, sweep) | ('cubic', c1, c2, end)

def p_outer(a, b, c, d):
    top = 0.2760; low = -0.4545
    return [
        ('pt', 356, 438, 8),
        ('pt', 356, 132, 80),
        ('pt', 929, 290, 0),
        ('cubic', (929 + a, 290 + a * top), (1124, 565 - b), (1124, 565)),
        ('cubic', (1124, 565 + c), (940 + d, 838.2 + d * low), (940, 838.2)),
        ('pt', 654, 968, 30),
        ('pt', 654, 725, 35),
        ('pt', 1008, 554, 68),
        ('pt', 615, 438, 40),
        ('pt', 615, 529.4, 4),
    ]

SLAB = [('pt', 354, 456, 12), ('pt', 615, 549, 3), ('pt', 615, 684, 35), ('pt', 462, 777, 35), ('pt', 107, 621, 44)]

def band(k):
    dy = 110 * k; dr = 118 * k - dy  # les couches du bas descendent un peu plus à droite (perspective de l'original)
    s, t = 0.45, -0.585
    ux = (740 + dr + 573 * -t - 700 + 233 * s) / (s - t); uy = 700 + s * (ux - 233)
    bx = (840 + dr + 561 * -t - 800 + 260 * s) / (s - t); by = 800 + s * (bx - 260)
    # bouchon gauche : demi-cercle tangent aux deux droites parallèles
    c0 = 700 - 233 * s; c1 = 800 - 260 * s
    R = (c1 - c0) / math.hypot(1, s) / 2
    nx, ny = -s / math.hypot(1, s), 1 / math.hypot(1, s)
    cx = 154 + R; cy = (c0 + c1) / 2 + s * cx
    up = (cx - R * nx, cy - R * ny); lo = (cx + R * nx, cy + R * ny)
    return [
        ('pt', up[0], up[1] + dy, 0),
        ('pt', ux, uy + dy, 30),
        ('pt', 615, 740 + t * (615 - 573) + dy + dr, 3),
        ('pt', 615, 840 + t * (615 - 561) + dy + dr, 30),
        ('pt', bx, by + dy, 30),
        ('pt', lo[0], lo[1] + dy, 0),
        ('arc', up[0], up[1] + dy, R, 1, (cx, cy + dy)),
    ]

def resolve(path):
    """Transforme les coins arrondis en (ligne, arc) ; renvoie une liste de commandes absolues."""
    n = len(path)
    cmds = []
    def pos(e):
        return (e[1], e[2]) if e[0] in ('pt', 'arc') else e[3]
    for i, e in enumerate(path):
        prev = pos(path[i - 1])
        if e[0] == 'pt':
            x, y, r = e[1], e[2], e[3]
            nxt = path[(i + 1) % n]
            if r == 0 or nxt[0] != 'pt':
                cmds.append(('L', (x, y))); continue
            p, q = prev, (nxt[1], nxt[2])
            v1 = (p[0] - x, p[1] - y); v2 = (q[0] - x, q[1] - y)
            l1, l2 = math.hypot(*v1), math.hypot(*v2)
            u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
            ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
            dd = r / math.tan(ang / 2)
            a = (x + u1[0] * dd, y + u1[1] * dd); b = (x + u2[0] * dd, y + u2[1] * dd)
            bis = (u1[0] + u2[0], u1[1] + u2[1]); lb = math.hypot(*bis)
            k = r / math.sin(ang / 2)
            ctr = (x + bis[0] / lb * k, y + bis[1] / lb * k)
            a0 = math.atan2(a[1] - ctr[1], a[0] - ctr[0]); a1 = math.atan2(b[1] - ctr[1], b[0] - ctr[0])
            da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
            cmds.append(('L', a)); cmds.append(('A', b, r, 1 if da > 0 else 0, ctr))
        elif e[0] == 'arc':
            cmds.append(('A', (e[1], e[2]), e[3], e[4], e[5]))
        else:
            cmds.append(('C', e[1], e[2], e[3]))
    return cmds

def sample(cmds, steps=48):
    pts = []; cur = None
    for c in cmds:
        if c[0] == 'L':
            pts.append(c[1]); cur = c[1]
        elif c[0] == 'C':
            p0 = cur
            for k in range(1, steps + 1):
                t = k / steps
                pts.append(tuple((1 - t) ** 3 * p0[j] + 3 * (1 - t) ** 2 * t * c[1][j] + 3 * (1 - t) * t * t * c[2][j] + t ** 3 * c[3][j] for j in range(2)))
            cur = c[3]
        else:
            end, r, sweep, (cx, cy) = c[1], c[2], c[3], c[4]
            p0 = cur
            a0 = math.atan2(p0[1] - cy, p0[0] - cx); a1 = math.atan2(end[1] - cy, end[0] - cx)
            da = a1 - a0
            if sweep == 1 and da < 0: da += 2 * math.pi
            if sweep == 0 and da > 0: da -= 2 * math.pi
            for k in range(1, steps + 1):
                aa = a0 + da * k / steps
                pts.append((cx + r * math.cos(aa), cy + r * math.sin(aa)))
            cur = end
    return pts

def svg_d(cmds, f, ox, oy):
    T = lambda p: f"{(p[0] + ox) * f:.2f} {(p[1] + oy) * f:.2f}"
    out = []
    for i, c in enumerate(cmds):
        if c[0] == 'L': out.append(("M " if i == 0 else "L ") + T(c[1]))
        elif c[0] == 'C': out.append(f"C {T(c[1])} {T(c[2])} {T(c[3])}")
        else: out.append(f"A {c[2] * f:.2f} {c[2] * f:.2f} 0 0 {c[3]} {T(c[1])}")
    if cmds[0][0] != 'L':
        raise SystemExit("le chemin doit commencer par un point")
    return " ".join(out) + " Z"

def shapes(bowl):
    return [resolve(p_outer(*bowl)), resolve(SLAB)] + [resolve(band(k)) for k in range(3)]

def render(all_cmds, size, f, ox, oy, ss=4, bg=BG, rounded=None):
    S = size * ss
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        m, r = rounded
        d.rounded_rectangle((m * ss, m * ss, S - m * ss - 1, S - m * ss - 1), radius=r * ss, fill=bg + (255,))
    elif bg:
        d.rectangle((0, 0, S, S), fill=bg + (255,))
    for cmds in all_cmds:
        d.polygon([((x + ox) * f * ss, (y + oy) * f * ss) for x, y in sample(cmds)], fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def mark_commands():
    return shapes(BOWL)


def centering_offset(cmds):
    """Décalage qui centre la boîte englobante des formes dans le carré de 1254."""
    xs, ys = [], []
    for c in cmds:
        for x, y in sample(c):
            xs.append(x); ys.append(y)
    return SIZE / 2 - (min(xs) + max(xs)) / 2, SIZE / 2 - (min(ys) + max(ys)) / 2
