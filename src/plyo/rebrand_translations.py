#!/usr/bin/env python3
"""Traductions d'Orca renommées pour Plyo Slicer, sans toucher aux fichiers d'Orca.

Lit localization/i18n/<langue>/OrcaSlicer_<langue>.po, remplace dans les traductions le nom de
l'application (« OrcaSlicer », « Orca Slicer », « Orca » quand il désigne l'application) par
« Plyo Slicer », et compile le résultat avec msgfmt dans resources/i18n/<langue>/OrcaSlicer.mo,
là où Orca lit ses traductions. Les textes sources (msgid) ne changent jamais.

Restent intacts : les services et fichiers d'Orca (Orca Cloud, Orca Cube, .orca_bundle…), les
adresses, et les phrases de crédits et d'histoire d'OrcaSlicer de la fenêtre « À propos » (licence).

Usage : rebrand_translations.py <dossier localization/i18n> <dossier resources/i18n> <dossier des témoins>
Un témoin par langue (dans le dossier de build) évite de recompiler une langue inchangée, et fait refaire
le renommage si les traductions d'Orca sont régénérées par-dessus (cible gettext_po_to_mo).
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

NAME = "Plyo Slicer"

# Phrases qui parlent d'OrcaSlicer lui-même (crédits, licence, histoire) : jamais renommées.
KEEP = ("based on PrusaSlicer", "began in that same spirit", "Today, OrcaSlicer", "is licensed under")

# Mots qui suivent « Orca » dans le nom d'un service ou d'un modèle d'Orca.
PRODUCTS = "Cloud|Cube|Badge|Tolerance|String|YOLO|Palette|Preset|Sliced|Combo"

ELISIONS = {"lorsqu": "lorsque ", "puisqu": "puisque ", "jusqu": "jusque ", "qu": "que ", "d": "de ", "l": ""}

APP = re.compile(
    r"(?<![\w/.])"
    r"(?:(?P<el>lorsqu|puisqu|jusqu|qu|d|l|Lorsqu|Puisqu|Jusqu|Qu|D|L)['’])?"
    r"Orca(?:[ -]?Slicer)?"
    r"(?![ ]?(?:" + PRODUCTS + r")|\w|/|\.\w)"
)


def rebrand(text):
    def repl(m):
        el = m.group("el")
        if not el:
            return NAME
        prefix = ELISIONS[el.lower()]
        return (prefix[:1].upper() + prefix[1:] if el[0].isupper() else prefix) + NAME

    return APP.sub(repl, text)


def _content(lines):
    return "".join(re.findall(r'"(.*)"', "\n".join(lines)))


def _rebrand_entry(block):
    lines = block.split("\n")
    if any(l.startswith("#,") and "fuzzy" in l for l in lines):
        return block
    fields, current = [], None  # [(clé, [lignes])]
    for line in lines:
        m = re.match(r"^(msgid_plural|msgid|msgstr(?:\[\d+\])?) ", line)
        if m:
            current = (m.group(1), [line])
            fields.append(current)
        elif line.startswith('"') and current:
            current[1].append(line)
        else:
            fields.append((None, [line]))
            current = None
    keys = {k: ls for k, ls in fields if k}
    msgid = _content(keys.get("msgid", []))
    if not msgid or any(k in msgid for k in KEEP):
        return block
    plural = _content(keys.get("msgid_plural", []))
    out = []
    strs = [k for k, _ in fields if k and k.startswith("msgstr")]
    empty = all(not _content(keys[k]) for k in strs)
    for key, ls in fields:
        if key and key.startswith("msgstr"):
            if empty:
                source = plural if (key.endswith("]") and not key.endswith("[0]") and plural) else msgid
                renamed = rebrand(source)
                if renamed != source:
                    ls = ['%s "%s"' % (key, renamed)]
            else:
                ls = [rebrand(l) for l in ls]
        out.extend(ls)
    return "\n".join(out)


def rebrand_po(text):
    blocks = text.split("\n\n")
    return "\n\n".join(_rebrand_entry(b) for b in blocks)


def main(src, dst, stamps):
    msgfmt = shutil.which("msgfmt")
    if not msgfmt:
        print("Plyo: msgfmt introuvable, traductions non renommées (brew install gettext)", file=sys.stderr)
        return 0
    script_time = os.path.getmtime(__file__)
    for lang in sorted(os.listdir(src)):
        po = os.path.join(src, lang, "OrcaSlicer_%s.po" % lang)
        if not os.path.isfile(po):
            continue
        mo = os.path.join(dst, lang, "OrcaSlicer.mo")
        stamp = os.path.join(stamps, lang + ".stamp")
        if os.path.isfile(mo) and os.path.isfile(stamp) and \
                os.path.getmtime(stamp) >= max(os.path.getmtime(po), script_time, os.path.getmtime(mo)):
            continue
        with open(po, encoding="utf-8") as f:
            renamed = rebrand_po(f.read())
        os.makedirs(os.path.dirname(mo), exist_ok=True)
        with tempfile.NamedTemporaryFile("w", suffix=".po", encoding="utf-8", delete=False) as tmp:
            tmp.write(renamed)
        try:
            subprocess.run([msgfmt, "--check-format", "-o", mo, tmp.name], check=True)
        finally:
            os.unlink(tmp.name)
        os.makedirs(stamps, exist_ok=True)
        with open(stamp, "w"):
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
