#!/usr/bin/env python3
"""Génère le catalogue des réglages Filament + Impression d'Orca pour l'assistant Plyo.

Lecture seule des sources d'Orca (aucune compilation) :
- src/libslic3r/PrintConfig.cpp : définitions (type, libellé, infobulle, bornes, choix) ;
- src/slic3r/GUI/Tab.cpp : TabPrint::build et TabFilament::build, qui définissent ce qu'un maker voit et son onglet ;
- localization/i18n/fr/OrcaSlicer_fr.po : libellés français, renommés comme dans l'application (rebrand_translations.py :
  « Plyo Slicer », jamais « Orca », dans ce que l'assistant lit et répète) ;
- resources/plyo/policy.json : exclusions (G-code, identité des profils…) et niveaux de risque.

Usage : python3 -I src/plyo/catalog/generate_catalog.py [--out ../plyo-api/knowledge/settings-catalog.json]
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rebrand_translations import rebrand  # noqa: E402

STRING = re.compile(r'"((?:[^"\\]|\\.)*)"')
DEF = re.compile(r'def\s*=\s*this->add(?:_nullable)?\("(\w+)",\s*(co\w+)\)\s*;')
KINDS = {
    "coFloat": "float", "coFloats": "float", "coInt": "int", "coInts": "int", "coPercent": "percent", "coPercents": "percent",
    "coFloatOrPercent": "float_or_percent", "coFloatsOrPercents": "float_or_percent", "coBool": "bool", "coBools": "bool",
    "coEnum": "enum", "coEnums": "enum",
}
UNITS = {"\\u2103": "°C", "°C": "°C"}


def unescape(text):
    text = text.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
    return text


def literals(statement):
    """Chaînes d'un appel L(...) ; pour L_CONTEXT seule la première est le texte source."""
    found = [unescape(s) for s in STRING.findall(statement)]
    if "L_CONTEXT(" in statement or "_L_CONTEXT(" in statement:
        return found[:1]
    return found


def statement(block, field):
    m = re.search(r"def->" + field + r"\s*=\s*(.*?);\s*(?://.*)?$", block, re.S | re.M)
    return m.group(1) if m else None


def parse_definitions(text):
    """{clé: {type, label, tooltip, sidetext, min, max, values, value_labels}} d'après PrintConfig.cpp."""
    matches = list(DEF.finditer(text))
    out = {}
    for i, m in enumerate(matches):
        block = text[m.end(): matches[i + 1].start() if i + 1 < len(matches) else len(text)]
        d = {"type": m.group(2), "label": "", "full_label": "", "tooltip": "", "sidetext": "", "min": None, "max": None, "values": [], "value_labels": []}
        for field in ("label", "full_label", "tooltip", "sidetext"):
            s = statement(block, field)
            if s:
                d[field] = "".join(literals(s))
        for field in ("min", "max"):
            n = re.search(r"def->" + field + r"\s*=\s*(-?\d+(?:\.\d+)?)\s*;", block)
            d[field] = float(n.group(1)) if n else None
        d["values"] = [unescape(v) for v in re.findall(r'def->enum_values\.(?:push_back|emplace_back)\("((?:[^"\\]|\\.)*)"\)', block)]
        d["value_labels"] = ["".join(literals(v)) for v in re.findall(r"def->enum_labels\.(?:push_back|emplace_back)\((.*?)\);", block)]
        out[m.group(1)] = d
    return out


# Fonctions de chaque onglet qui construisent des pages de réglages.
BUILDERS = {"TabPrint": ["build"], "TabFilament": ["build", "add_filament_overrides_page"]}


def function_body(text, cls, fn):
    start = re.search(r"^void " + cls + "::" + fn + r"\(", text, re.M)
    if not start:
        return ""
    nxt = re.search(r"^void Tab\w+::\w+\(", text[start.end():], re.M)
    return text[start.start(): start.end() + nxt.start()] if nxt else text[start.start():]


def parse_tab_keys(text, cls):
    """[(clé, onglet, groupe, ligne)] : titres de l'onglet, du groupe et de la ligne (ex. « Max fan speed threshold ») dans l'ordre d'apparition, pour TabPrint ou TabFilament."""
    keys = []
    for fn in BUILDERS[cls]:
        body = function_body(text, cls, fn)
        body = re.sub(r"^\s*//.*$", "", body, flags=re.M)
        tab = group = line = ""
        pattern = r'add_options_page\(\s*L\("([^"]+)"\)\s*,\s*"[^"]*"|new_optgroup\(\s*L\("([^"]+)"\)[^;]*;|\bline\s*=\s*\{\s*L\("([^"]+)"\)|(append_line)\(|"(\w+)"'
        for m in re.finditer(pattern, body):
            if m.group(1):
                tab, group, line = m.group(1), "", ""
            elif m.group(2) is not None:
                group, line = m.group(2), ""
            elif m.group(3) is not None:
                line = m.group(3)
            elif m.group(4):
                line = ""
            elif tab:
                keys.append((m.group(5), tab, group, line))
    return keys


def parse_po(path):
    """{msgid: msgstr} (entrées sans contexte, non vides, non « fuzzy »)."""
    if not path.exists():
        return {}
    out, entries = {}, re.split(r"\n\n+", path.read_text(encoding="utf-8"))
    for e in entries:
        if "msgctxt" in e or "#, fuzzy" in e:
            continue
        mid = re.search(r'^msgid ((?:".*"\n?)+)', e, re.M)
        mstr = re.search(r'^msgstr ((?:".*"\n?)+)', e, re.M)
        if not (mid and mstr):
            continue
        a = "".join(unescape(s) for s in STRING.findall(mid.group(1)))
        b = "".join(unescape(s) for s in STRING.findall(mstr.group(1)))
        if a and b:
            out[a] = b
    return out


def risk_of(key, policy):
    if key in policy["confirm_keys"] or any(p in key for p in policy["confirm_patterns"]):
        return "confirm"
    return "free"


def generate(root):
    root = Path(root)
    policy = json.loads((root / "resources/plyo/policy.json").read_text(encoding="utf-8"))
    defs = parse_definitions((root / "src/libslic3r/PrintConfig.cpp").read_text(encoding="utf-8"))
    tab_text = (root / "src/slic3r/GUI/Tab.cpp").read_text(encoding="utf-8")
    fr = parse_po(root / "localization/i18n/fr/OrcaSlicer_fr.po")
    t = lambda s: rebrand(fr.get(s, s))  # noqa: E731  (texte montré par l'application : traduction renommée)
    seen, entries, excluded, read = set(), [], {}, 0
    for scope, cls in (("print", "TabPrint"), ("filament", "TabFilament")):
        for key, tab, group, line in parse_tab_keys(tab_text, cls):
            # Surcharges du filament (filament_retraction_length…) : copies des réglages de l'imprimante, définies en boucle.
            if key not in defs and key.startswith("filament_") and key[len("filament_"):] in defs:
                defs[key] = defs[key[len("filament_"):]]
            if key not in defs or (scope, key) in seen:
                continue
            seen.add((scope, key))
            read += 1
            d = defs[key]
            kind = KINDS.get(d["type"])
            reason = None
            if key in policy["forbidden_keys"] or any(p in key for p in policy["forbidden_patterns"]):
                reason = "interdit"
            elif kind is None or kind not in policy["writable_kinds"]:
                reason = "type non écrivable"
            elif kind == "enum" and not d["values"]:
                reason = "choix inconnus"
            elif key in policy.get("pending_keys", []):
                reason = "à décider"
            if reason:
                excluded[reason] = excluded.get(reason, 0) + 1
                continue
            # Choix limités par la politique : seules ces valeurs sont proposables à l'assistant.
            allowed = policy.get("allowed_values", {}).get(key)
            if allowed:
                pairs = [(v, l) for v, l in zip(d["values"], d["value_labels"]) if v in allowed]
                d = {**d, "values": [v for v, _ in pairs], "value_labels": [l for _, l in pairs]}
            source = d["full_label"] or d["label"]
            label = t(source) if source else key
            entries.append({
                "key": key, "scope": scope, "label_en": d["full_label"] or d["label"], "tooltip_en": d["tooltip"], "sidetext_en": d["sidetext"] if d["sidetext"] and d["sidetext"].isascii() else "", "tab": tab, "tab_fr": t(tab), "group": group, "group_fr": t(group) if group else "", "line_fr": t(line) if line else "", "label_fr": label,
                "title_fr": (t(line) + " · " + label) if line else label, "tooltip": t(d["tooltip"]),
                "kind": kind, "min": d["min"], "max": d["max"], "values": d["values"] or None,
                "values_fr": [t(v) for v in d["value_labels"]] or None, "unit": UNITS.get(d["sidetext"], d["sidetext"]),
                "vector": d["type"].endswith("s"), "nillable": key.startswith("filament_"), "risk": risk_of(key, policy),
            })
    return {"entries": entries, "report": {"read": read, "writable": len(entries), "excluded": excluded}}


def catalog_keys(entries):
    """{portée: {clé: type}} : la liste que le slicer charge (ce que l'assistant peut lire et écrire)."""
    out = {"print": {}, "filament": {}}
    titles = {}
    for e in entries:
        out[e["scope"]][e["key"]] = e["kind"]
        titles[e["key"]] = e["title_fr"]
    result = {scope: dict(sorted(keys.items())) for scope, keys in out.items()}
    result["titles"] = dict(sorted(titles.items()))  # pour nommer un réglage en français dans le panneau
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    result = generate(root)
    print(json.dumps(result["report"], ensure_ascii=False, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(result["entries"], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (root / "resources/plyo/catalog-keys.json").write_text(json.dumps(catalog_keys(result["entries"]), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
