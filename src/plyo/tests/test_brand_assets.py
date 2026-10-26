import os
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "brand"))
import logo_degrade as logo  # noqa: E402
from logo_geometry import SIZE, sample  # noqa: E402

IMAGES = os.path.join(os.path.dirname(__file__), "..", "..", "..", "resources", "images")
SVGS = ["OrcaSlicer.svg", "OrcaSlicer_gradient_circle.svg", "OrcaSlicer_about.svg", "OrcaSlicer_about_dark.svg",
        "OrcaSlicer_horizontal_light.svg", "OrcaSlicer_horizontal_dark.svg", "splash_logo.svg", "splash_logo_dark.svg"]
NS = "{http://www.w3.org/2000/svg}"


class Logo(unittest.TestCase):
    def test_symbole_centre_dans_le_carre(self):
        layers = logo.layers()
        self.assertEqual([name for name, _ in layers], ["mur", "voile", "dalle", "c1", "c2", "c3"])
        pts = [p for _, c in layers for p in sample(c)]
        ox, oy = logo.OX, logo.OY
        self.assertAlmostEqual(min(x for x, _ in pts) + ox, SIZE - (max(x for x, _ in pts) + ox), delta=0.5)
        self.assertAlmostEqual(min(y for _, y in pts) + oy, SIZE - (max(y for _, y in pts) + oy), delta=0.5)

    def test_chaque_forme_a_son_degrade(self):
        body = logo.svg_body("t")
        for name, _ in logo.layers():
            self.assertIn(f'id="t-{name}"', body)
            self.assertIn(f'fill="url(#t-{name})"', body)

    def test_rendu_en_pixels_opaque_au_centre_du_symbole(self):
        img = logo.render(64)
        self.assertEqual(img.size, (64, 64))
        self.assertEqual(img.getpixel((0, 0))[3], 0)
        self.assertGreater(max(img.getchannel("A").getdata()), 250)


class SvgLisiblesParOrca(unittest.TestCase):
    # nanosvg (lecteur SVG d'Orca) n'affiche ni <text> ni styles CSS : des formes, des attributs simples et des dégradés.
    def test_formes_seulement(self):
        for name in SVGS:
            with self.subTest(name=name):
                root = ET.parse(os.path.join(IMAGES, name)).getroot()
                tags = {el.tag.replace(NS, "") for el in root.iter()}
                self.assertTrue(tags <= {"svg", "g", "path", "rect", "defs", "linearGradient", "radialGradient", "stop"}, tags)
                self.assertIn("path", tags)
                self.assertIn("Plyo", open(os.path.join(IMAGES, name), encoding="utf-8").read())

    def test_dimensions_de_celles_d_orca(self):
        sizes = {"OrcaSlicer.svg": "64", "OrcaSlicer_about.svg": "560", "OrcaSlicer_horizontal_light.svg": "214",
                 "splash_logo.svg": "480"}
        for name, width in sizes.items():
            with self.subTest(name=name):
                self.assertEqual(ET.parse(os.path.join(IMAGES, name)).getroot().get("width"), width)


if __name__ == "__main__":
    unittest.main()
