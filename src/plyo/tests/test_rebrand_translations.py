# Tests du renommage des traductions : python3 -m unittest discover -s src/plyo/tests
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from rebrand_translations import rebrand, rebrand_po  # noqa: E402


class Rebrand(unittest.TestCase):
    def test_nom_de_l_application(self):
        self.assertEqual(rebrand("Veuillez mettre à jour OrcaSlicer."), "Veuillez mettre à jour Plyo Slicer.")
        self.assertEqual(rebrand("Orca Slicer va s'arrêter."), "Plyo Slicer va s'arrêter.")
        self.assertEqual(rebrand("Orca-Slicer"), "Plyo Slicer")

    def test_orca_seul_designe_l_application(self):
        self.assertEqual(rebrand("Orca will automatically cap the jerk"), "Plyo Slicer will automatically cap the jerk")
        self.assertEqual(rebrand("connexion de l'imprimante et d'Orca."), "connexion de l'imprimante et de Plyo Slicer.")

    def test_elisions_francaises(self):
        self.assertEqual(rebrand("la version d'OrcaSlicer"), "la version de Plyo Slicer")
        self.assertEqual(rebrand("la version d’Orca Slicer"), "la version de Plyo Slicer")
        self.assertEqual(rebrand("lorsqu'Orca détecte"), "lorsque Plyo Slicer détecte")
        self.assertEqual(rebrand("qu'OrcaSlicer"), "que Plyo Slicer")

    def test_services_et_fichiers_d_orca_inchanges(self):
        for text in ["Orca Cloud", "OrcaCloud", "Orca Cube", "OrcaSliced Combo", "Orca YOLO Flow Calibration",
                     "Orca Preset Bundle (*.orca_bundle)", "Orca Palette", "Orca Badge", "Orca Tolerance Test",
                     "Orca String Hell", "https://github.com/OrcaSlicer/OrcaSlicer/wiki", "OrcaSlicer_fr.po"]:
            self.assertEqual(rebrand(text), text, text)


PO = '''msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Please update OrcaSlicer."
msgstr "Veuillez mettre à jour OrcaSlicer."

msgid "Orca will cap the speed."
msgstr ""

msgid "Orca Slicer is based on PrusaSlicer and BambuStudio"
msgstr "Orca Slicer est basé sur PrusaSlicer et BambuStudio"

msgid "Today, OrcaSlicer is the most widely used open-source slicer"
msgstr "Aujourd'hui, OrcaSlicer est le plus utilisé"

msgid ""
"A long message for "
"Orca Slicer"
msgstr ""
"Un long message pour "
"Orca Slicer"

#, fuzzy
msgid "Fuzzy OrcaSlicer"
msgstr "Flou OrcaSlicer"

msgid "%d file"
msgid_plural "%d files of OrcaSlicer"
msgstr[0] "%d fichier"
msgstr[1] "%d fichiers d'OrcaSlicer"
'''


class RebrandPo(unittest.TestCase):
    def setUp(self):
        self.out = rebrand_po(PO)

    def test_traduction_renommee(self):
        self.assertIn('msgstr "Veuillez mettre à jour Plyo Slicer."', self.out)

    def test_le_texte_source_ne_change_jamais(self):
        self.assertIn('msgid "Please update OrcaSlicer."', self.out)

    def test_traduction_vide_remplie_depuis_l_anglais_renomme(self):
        self.assertIn('msgid "Orca will cap the speed."\nmsgstr "Plyo Slicer will cap the speed."', self.out)

    def test_credits_et_histoire_d_orca_inchanges(self):
        self.assertIn('msgstr "Orca Slicer est basé sur PrusaSlicer et BambuStudio"', self.out)
        self.assertIn("msgstr \"Aujourd'hui, OrcaSlicer est le plus utilisé\"", self.out)

    def test_traduction_sur_plusieurs_lignes(self):
        self.assertIn('msgstr ""\n"Un long message pour "\n"Plyo Slicer"', self.out)

    def test_pluriels(self):
        self.assertIn('msgstr[1] "%d fichiers de Plyo Slicer"', self.out)

    def test_en_tete_intact(self):
        self.assertTrue(self.out.startswith('msgid ""\nmsgstr ""\n"Content-Type'))


if __name__ == "__main__":
    unittest.main()
