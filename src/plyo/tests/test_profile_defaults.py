"""Pour chaque machine du catalogue, le `default_print_profile` désigne-t-il un process qui existe chez sa marque ?
Quand le nom ne correspond à rien, Orca retombe sur le premier process compatible (0,08 mm sur la K1C).
Les profils d'Orca ne sont pas modifiés ; à l'installation par Plyo, voir fix_default_process dans PlyoPrinterSetup.cpp.

    python3 -I -m unittest discover -s src/plyo/tests -p test_profile_defaults.py       (échoue si le nombre de discordances augmente)
    python3 -I src/plyo/tests/test_profile_defaults.py       (rapport complet)
"""
import json
import unittest
from pathlib import Path

PROFILES = Path(__file__).resolve().parents[3] / "resources" / "profiles"
# Relevé le 7 novembre 2026 sur le catalogue d'Orca : à ajuster après une mise à jour d'Orca.
KNOWN_MISMATCHES = 78


def load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def scan(profiles=PROFILES):
    """Rend (machines contrôlées, sans process par défaut, discordances [(marque, machine, nom désigné)]).
    Comme Orca : seuls les fichiers listés par <marque>.json existent, et une valeur peut être héritée du parent."""
    checked, without, mismatches = 0, [], []
    for index in sorted(profiles.glob("*.json")):
        vendor = load(index)
        folder = profiles / index.stem
        machines = {e.get("name"): load(folder / e.get("sub_path", "")) for e in vendor.get("machine_list", []) if e.get("sub_path")}
        processes = set()
        for entry in vendor.get("process_list", []):
            data = load(folder / entry.get("sub_path", "")) if entry.get("sub_path") else {}
            if data.get("instantiation") != "false" and entry.get("name"):
                processes.add(entry["name"])

        def inherited(data):
            seen = 0
            while data and seen < 20:
                if data.get("default_print_profile"):
                    return data["default_print_profile"]
                data, seen = machines.get(data.get("inherits")), seen + 1
            return ""

        for name, data in sorted(machines.items()):
            if not data or data.get("instantiation") == "false":
                continue
            checked += 1
            wanted = inherited(data)
            if not wanted:
                without.append((index.stem, name))
            elif wanted not in processes:
                mismatches.append((index.stem, name, wanted))
    return checked, without, mismatches


class ProfileDefaultsTest(unittest.TestCase):
    def test_pas_de_nouvelle_discordance(self):
        mismatches = scan()[2]
        self.assertLessEqual(len(mismatches), KNOWN_MISMATCHES, "de nouvelles machines désignent un process qui n'existe pas : lancer ce fichier pour la liste")

    def test_la_k1c_est_reperee_tant_qu_orca_ne_l_a_pas_corrigee(self):
        self.assertIn(("Creality", "Creality K1C 0.4 nozzle", "0.20mm Standard @Creality K1C (0.4 nozzle)"), scan()[2])

    def test_un_catalogue_invente_est_bien_lu(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "X" / "machine").mkdir(parents=True)
            (root / "X" / "process").mkdir()
            (root / "X.json").write_text(json.dumps({
                "machine_list": [{"name": "base", "sub_path": "machine/base.json"}, {"name": "M1", "sub_path": "machine/m1.json"}, {"name": "M2", "sub_path": "machine/m2.json"}],
                "process_list": [{"name": "0.20 @X", "sub_path": "process/p.json"}]}))
            (root / "X" / "machine" / "base.json").write_text(json.dumps({"name": "base", "instantiation": "false", "default_print_profile": "0.20 @X"}))
            (root / "X" / "machine" / "m1.json").write_text(json.dumps({"name": "M1", "instantiation": "true", "inherits": "base"}))
            (root / "X" / "machine" / "m2.json").write_text(json.dumps({"name": "M2", "instantiation": "true", "default_print_profile": "0.20 @Y"}))
            (root / "X" / "process" / "p.json").write_text(json.dumps({"name": "0.20 @X", "instantiation": "true"}))
            self.assertEqual(scan(root), (2, [], [("X", "M2", "0.20 @Y")]))


if __name__ == "__main__":
    checked, without, mismatches = scan()
    print(f"{checked} machines contrôlées, {len(without)} sans process par défaut, {len(mismatches)} discordances.")
    for vendor, machine, wanted in mismatches:
        print(f"  {vendor} | {machine} | désigne « {wanted} »")
    for vendor, machine in without:
        print(f"  {vendor} | {machine} | aucun process par défaut")
