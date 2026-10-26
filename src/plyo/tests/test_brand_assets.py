import os
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "brand"))
import logo_geometry as geo  # noqa: E402

IMAGES = os.path.join(os.path.dirname(__file__), "..", "..", "..", "resources", "images")
SVGS = ["OrcaSlicer.svg", "OrcaSlicer_gradient_circle.svg", "OrcaSlicer_about.svg", "OrcaSlicer_about_dark.svg",
        "OrcaSlicer_horizontal_light.svg", "OrcaSlicer_horizontal_dark.svg", "splash_logo.svg", "splash_logo_dark.svg"]
NS = "{http://www.w3.org/2000/svg}"


class Logo(unittest.TestCase):
    def test_cinq_formes_centrees_dans_le_carre(self):
        cmds = geo.mark_commands()
        self.assertEqual(len(cmds), 5)
        ox, oy = geo.centering_offset(cmds)
        pts = [p for c in cmds for p in geo.sample(c)]
        self.assertAlmostEqual(min(x for x, _ in pts) + ox, geo.SIZE - (max(x for x, _ in pts) + ox), delta=0.5)
        self.assertAlmostEqual(min(y for _, y in pts) + oy, geo.SIZE - (max(y for _, y in pts) + oy), delta=0.5)


class SvgLisiblesParOrca(unittest.TestCase):
    # nanosvg (lecteur SVG d'Orca) n'affiche ni <text> ni styles CSS : uniquement des formes et des attributs simples.
    def test_formes_seulement(self):
        for name in SVGS:
            with self.subTest(name=name):
                root = ET.parse(os.path.join(IMAGES, name)).getroot()
                tags = {el.tag.replace(NS, "") for el in root.iter()}
                self.assertTrue(tags <= {"svg", "g", "path", "rect"}, tags)
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
