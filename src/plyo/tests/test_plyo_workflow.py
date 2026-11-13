"""Le workflow des tests de Plyo (.github/workflows/plyo_tests.yml) lance les mêmes commandes qu'en local.

Lancement : python3 -I -m unittest discover -s src/plyo/tests (depuis la racine du dépôt). Lecture du texte seulement
(PyYAML n'est pas dans la bibliothèque standard).
"""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "plyo_tests.yml"
RUN_SH = ROOT / "src" / "plyo" / "tests" / "cpp" / "run.sh"


class PlyoWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding="utf-8")

    def test_runs_the_three_suites(self):
        for command in (
            "node --test resources/web/plyo/tests/*.test.mjs",
            "python3 -I -m unittest discover -s src/plyo/tests",
            "bash src/plyo/tests/cpp/run.sh",
        ):
            self.assertIn("run: " + command, self.text, command)

    def test_cpp_suite_uses_system_boost_without_orca_dependencies(self):
        self.assertIn("PLYO_DEPS: system", self.text)
        self.assertIn("libboost-nowide-dev", self.text)
        self.assertIn('if [ "$DEPS" != "system" ]', RUN_SH.read_text(encoding="utf-8"))
        self.assertNotIn("build_check_cache", self.text, "jamais la compilation d'Orca")

    def test_only_plyo_paths_trigger_it(self):
        for path in ("'src/plyo/**'", "'resources/web/plyo/**'", "'resources/plyo/**'"):
            self.assertEqual(self.text.count(path), 2, path)  # push et pull_request
        self.assertIn("permissions:\n  contents: read", self.text)
        self.assertNotIn("secrets.", self.text)


if __name__ == "__main__":
    unittest.main()
