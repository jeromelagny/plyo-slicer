"""Tests du générateur du catalogue des réglages : python3 -I -m unittest src/plyo/tests/test_generate_catalog.py"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src" / "plyo" / "catalog"))
import generate_catalog as g  # noqa: E402

POLICY = json.loads((ROOT / "resources" / "plyo" / "policy.json").read_text(encoding="utf-8"))
CATALOG = g.generate(ROOT)
BY_KEY = {e["key"]: e for e in CATALOG["entries"]}


class ParsingTest(unittest.TestCase):
    def test_definition_complete(self):
        text = '''
    def = this->add("fan_cooling_layer_time", coFloats);
    def->label = L("Layer time");
    def->tooltip = L("The part cooling fan will be enabled " "for short layers.");
    def->sidetext = L_CONTEXT("s", "second");
    def->min = 0;
    def->max = 1000;
    def = this->add("next_one", coBool);
'''
        defs = g.parse_definitions(text)
        d = defs["fan_cooling_layer_time"]
        self.assertEqual(d["type"], "coFloats")
        self.assertEqual(d["label"], "Layer time")
        self.assertEqual(d["tooltip"], "The part cooling fan will be enabled for short layers.")
        self.assertEqual((d["min"], d["max"]), (0.0, 1000.0))
        self.assertEqual(d["sidetext"], "s")
        self.assertIn("next_one", defs)

    def test_enum_values(self):
        text = '''
    def = this->add("ironing_type", coEnum);
    def->label = L("Ironing Type");
    def->enum_values.push_back("no ironing");
    def->enum_values.push_back("top");
'''
        self.assertEqual(g.parse_definitions(text)["ironing_type"]["values"], ["no ironing", "top"])

    def test_pages_assign_scope_and_tab(self):
        text = '''
void TabFilament::build()
{
    auto page = add_options_page(L("Cooling"), "x");
    optgroup = page->new_optgroup(L("Cooling fan"), L"param");
    optgroup->append_single_option_line("fan_min_speed");
    line = { L("Max fan speed threshold"), L("Tooltip.") };
    line.append_option(optgroup->get_option("fan_max_speed", 0));
    line.append_option(optgroup->get_option("slow_down_layer_time"));
    optgroup->append_line(line);
    optgroup->append_single_option_line("fan_x");
    page = add_options_page(L("Advanced"), "x");
    optgroup = page->new_optgroup(L("Print chamber"), L"param");
    optgroup->append_single_option_line("filament_density");
}
void TabFilament::add_filament_overrides_page()
{
    PageShp page = add_options_page(L("Setting Overrides"), "x");
    optgroup->append_single_option_line("filament_retraction_length");
}
void TabFilament::update_x() { "other_key"; }
'''
        self.assertEqual(
            g.parse_tab_keys(text, "TabFilament"),
            [
                ("fan_min_speed", "Cooling", "Cooling fan", ""),
                ("fan_max_speed", "Cooling", "Cooling fan", "Max fan speed threshold"),
                ("slow_down_layer_time", "Cooling", "Cooling fan", "Max fan speed threshold"),
                ("fan_x", "Cooling", "Cooling fan", ""),
                ("filament_density", "Advanced", "Print chamber", ""),
                ("filament_retraction_length", "Setting Overrides", "", ""),
            ],
        )


class CatalogTest(unittest.TestCase):
    def test_cooling_layer_time_is_proposable_with_french_label(self):
        e = BY_KEY["fan_cooling_layer_time"]
        self.assertEqual(e["scope"], "filament")
        self.assertEqual(e["tab"], "Cooling")
        self.assertEqual(e["label_fr"], "Temps de couche")
        self.assertTrue(e["tooltip"])

    def test_the_two_layer_time_settings_can_be_told_apart(self):
        a, b = BY_KEY["fan_cooling_layer_time"], BY_KEY["slow_down_layer_time"]
        self.assertNotEqual(a["title_fr"], b["title_fr"])
        self.assertIn("Seuil de vitesse max", b["title_fr"])

    def test_filament_overrides_page_is_covered(self):
        self.assertEqual(BY_KEY["filament_retraction_length"]["scope"], "filament")

    def test_print_and_filament_scopes(self):
        self.assertEqual(BY_KEY["layer_height"]["scope"], "print")
        self.assertEqual(BY_KEY["nozzle_temperature"]["scope"], "filament")

    def test_no_gcode_key(self):
        bad = [k for k in BY_KEY if any(p in k for p in POLICY["forbidden_patterns"]) or k in POLICY["forbidden_keys"]]
        self.assertEqual(bad, [])
        for k in ("machine_start_gcode", "layer_change_gcode", "filament_start_gcode", "filament_end_gcode", "post_process"):
            self.assertNotIn(k, BY_KEY)

    def test_no_printer_preset_key(self):
        for k in ("nozzle_diameter", "machine_max_acceleration_x", "printable_area", "gcode_flavor", "retraction_length"):
            self.assertNotIn(k, BY_KEY)

    def test_every_entry_is_well_formed(self):
        for e in CATALOG["entries"]:
            self.assertIn(e["kind"], ("int", "float", "percent", "float_or_percent", "bool", "enum"), e["key"])
            self.assertTrue(e["label_fr"], e["key"])
            if e["min"] is not None and e["max"] is not None:
                self.assertLessEqual(e["min"], e["max"], e["key"])
            if e["kind"] == "enum":
                self.assertTrue(e["values"], e["key"])

    def test_risk_levels(self):
        self.assertEqual(BY_KEY["nozzle_temperature"]["risk"], "confirm")
        self.assertEqual(BY_KEY["fan_cooling_layer_time"]["risk"], "free")

    def test_report_adds_up(self):
        r = CATALOG["report"]
        self.assertEqual(r["read"], r["writable"] + sum(r["excluded"].values()))
        self.assertEqual(r["writable"], len(CATALOG["entries"]))


if __name__ == "__main__":
    unittest.main()
