"""Garde de l'empreinte de Plyo sur OrcaSlicer.

Compare les fichiers d'Orca modifiés (diff avec `main`, état de travail compris) à la liste publique
docs/plyo/FICHIERS-MODIFIES.md, et vérifie que chaque ligne ajoutée ou modifiée dans un fichier d'Orca porte un
marqueur `PLYO:` (en fin de ligne, ou dans un bloc `PLYO: begin` … `PLYO: end`).

Lancement : python3 -I -m unittest discover -s src/plyo/tests (depuis la racine du dépôt). Ignoré si la branche
`main` (Orca officiel) n'existe pas en local.
"""

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOC = ROOT / "docs" / "plyo" / "FICHIERS-MODIFIES.md"
# Dossiers propres à Plyo : tout y est ajouté, rien n'est un fichier d'Orca.
PLYO_DIRS = ("src/plyo/", "resources/web/plyo/", "resources/plyo/", "docs/plyo/")
# Images remplacées (logos) : pas de marqueur possible, mais listées dans le document.
ASSET_PREFIXES = ("resources/images/", "resources/Icon.icns")
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
BARE_MARKER = re.compile(r"PLYO(?!:)")


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")


def plyo_owned(path):
    return path.startswith(PLYO_DIRS)


class OrcaFootprint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if git("rev-parse", "--is-inside-work-tree").returncode != 0:
            raise unittest.SkipTest("pas un dépôt git")
        if git("rev-parse", "--verify", "--quiet", "main").returncode != 0:
            raise unittest.SkipTest("branche main absente en local : rien à comparer")
        base = git("merge-base", "main", "HEAD")
        if base.returncode != 0:
            raise unittest.SkipTest("pas d'ancêtre commun avec main")
        cls.base = base.stdout.strip()
        # Fichiers changés depuis main (commits de la branche + état de travail), et fichiers non suivis.
        status = git("diff", "--no-renames", "--name-status", cls.base).stdout.splitlines()
        cls.changed = {}
        for line in status:
            kind, path = line.split("\t", 1)
            cls.changed[path] = kind[0]
        for path in git("ls-files", "--others", "--exclude-standard").stdout.splitlines():
            cls.changed.setdefault(path, "A")
        cls.orca = {p: k for p, k in cls.changed.items() if not plyo_owned(p)}
        cls.doc = DOC.read_text(encoding="utf-8")

    def listed_files(self):
        """Chemins de la première colonne des tableaux du document."""
        listed = set()
        for line in self.doc.splitlines():
            if not line.startswith("|") or line.startswith("|---"):
                continue
            first = line.split("|")[1]
            for path in re.findall(r"`([^`]+)`", first):
                listed.add(path)
        return listed

    def test_every_orca_file_is_listed_and_nothing_else(self):
        listed = self.listed_files()
        missing = sorted(p for p in self.orca if p not in listed)
        self.assertEqual(missing, [], "fichiers d'Orca modifiés absents de docs/plyo/FICHIERS-MODIFIES.md : " + ", ".join(missing))
        stale = sorted(p for p in listed if p not in self.orca)
        self.assertEqual(stale, [], "fichiers listés dans docs/plyo/FICHIERS-MODIFIES.md mais identiques à Orca : " + ", ".join(stale))

    def test_every_changed_line_carries_a_marker(self):
        problems = []
        for path, kind in sorted(self.orca.items()):
            if kind == "A" or path.startswith(ASSET_PREFIXES):
                continue  # fichier ajouté par Plyo, ou image
            numstat = git("diff", "--numstat", self.base, "--", path).stdout
            if numstat.startswith("-\t-"):
                continue  # binaire
            if kind == "D":
                problems.append(f"{path} : fichier d'Orca supprimé")
                continue
            new_lines = (ROOT / path).read_text(encoding="utf-8").splitlines()
            in_block, inside = [False] * (len(new_lines) + 2), False
            for number, text in enumerate(new_lines, start=1):
                if "PLYO: begin" in text:
                    if inside:
                        problems.append(f"{path}:{number} : « PLYO: begin » dans un bloc déjà ouvert")
                    inside = True
                in_block[number] = inside
                if "PLYO: end" in text:
                    if not inside:
                        problems.append(f"{path}:{number} : « PLYO: end » sans « PLYO: begin »")
                    inside = False
            if inside:
                problems.append(f"{path} : « PLYO: begin » sans « PLYO: end »")

            def marked(number):
                return 1 <= number <= len(new_lines) and (in_block[number] or "PLYO:" in new_lines[number - 1])

            diff = git("diff", "-U0", "--no-color", self.base, "--", path).stdout.splitlines()
            for line in diff:
                hunk = HUNK.match(line)
                if not hunk:
                    continue
                start, count = int(hunk.group(3)), int(hunk.group(4) or "1")
                if count == 0:
                    # Lignes d'Orca retirées sans rien ajouter : une ligne voisine doit le dire.
                    if not (marked(start) or marked(start + 1)):
                        problems.append(f"{path}:{start} : lignes d'Orca retirées sans marqueur PLYO: à côté")
                    continue
                for number in range(start, start + count):
                    text = new_lines[number - 1]
                    if BARE_MARKER.search(text):
                        problems.append(f"{path}:{number} : marqueur « PLYO » sans deux-points")
                    if not marked(number):
                        problems.append(f"{path}:{number} : ligne modifiée sans marqueur PLYO: — {text.strip()[:80]}")
        self.assertEqual(problems, [], "\n" + "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
