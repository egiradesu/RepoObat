#!/usr/bin/env python3
"""
Build a unified medicine repository (data.json) from the three insurance
formularies in this folder.

Problem: a telemedicine doctor remembers the ACTIVE INGREDIENT, not the brand,
and each insurer covers different brands. This script normalizes all three
spreadsheets into one searchable list so an ingredient search can return the
covered brands per insurer.

Key challenge: FOI 2026 and Primaya have an explicit ingredient column, but
BRILife only has product names. We backfill BRILife ingredients with a
brand -> ingredient dictionary harvested from FOI + Primaya, and fall back to
full-text matching for the rest.
"""
import json
import os
import re
import sys
import unicodedata

import openpyxl

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = {
    "FOI": "Daftar Obat FOI 2026 untuk Telemedicine.xlsx",
    "Primaya": "Formularium obat Telemedicine Primayan Care (Update 7 April 2026).xlsx",
    "BRILife": "Produk Obat BRILife per 24 April 2026.xlsx",
}

# Human-friendly provider labels shown in the UI.
PROVIDER_LABEL = {
    "FOI": "FOI 2026 (Telemedicine)",
    "Primaya": "Primaya Care",
    "BRILife": "BRI Life",
}


def norm(s):
    """Lowercase, strip accents/diacritics and collapse whitespace."""
    if s is None:
        return ""
    s = str(s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s


def norm_ingredient(s):
    """Normalize an ingredient string for grouping/search.

    Standardizes common salt/spelling noise so 'Cetirizine HCL',
    'cetirizine hcl' and 'Cetirizine' collapse toward the same key.
    """
    s = norm(s)
    if not s:
        return ""
    # split combination ingredients on ; + / , and keep the primary token order
    s = s.replace("hcl", "").replace("hci", "")
    s = re.sub(r"\b(sodium|natrium|kalium|potassium|monohydrate|monohidrat|"
               r"trometamol|tromethamine|maleate|maleat|besylate|besilat|"
               r"dihydrochloride|hydrochloride|sulfate|sulfat|sulphate|"
               r"fumarate|fumarat|succinate|tartrate|mesylate|axetil)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" .,-;")
    return s


def split_ingredients(s):
    """Split a composition string into individual ingredient tokens."""
    parts = re.split(r"[;+/]|,(?![0-9])", str(s))
    out = []
    for p in parts:
        n = norm_ingredient(p)
        if n:
            out.append(n)
    return out


_CONC = re.compile(r'\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|g|iu)\s*/\s*\d*\s?ml', re.I)
_MASS = re.compile(r'\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|iu)\b', re.I)
_PCT = re.compile(r'\d+(?:[.,]\d+)?\s?%', re.I)
_VOL = re.compile(r'\d+(?:[.,]\d+)?\s?ml\b', re.I)


def extract_dose(name):
    """Pull the active strength out of a product name.

    Prefers concentration (5 mg/5 ml) and mass (30 mg) over bottle volume
    (60 ml), since volume is pack size, not dose. Returns '' if none found.
    """
    if not name:
        return ""
    s = str(name)
    for rx in (_CONC, _MASS, _PCT):
        m = rx.search(s)
        if m:
            return re.sub(r'\s+', ' ', m.group(0)).strip().lower()
    m = _VOL.search(s)  # last resort: liquids that only list a volume
    return re.sub(r'\s+', ' ', m.group(0)).strip().lower() if m else ""


def clean_brand(name):
    """Extract a probable brand token from a product/item name."""
    if not name:
        return ""
    n = str(name).strip()
    # Primaya generic marker like "(G) ..." and leading composition in parens
    n = re.sub(r"^\(g\)\s*", "", n, flags=re.I)
    # brand is usually the text before the first "(" or before strength/form
    n = re.split(r"[(]", n)[0]
    n = re.split(r"\b\d", n)[0]  # cut at first number (strength/pack)
    return n.strip(" -.,")


def rows_of(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def find_header(rows, must_have):
    """Return (header_index, {colname_lower: idx}) for the first row that
    contains all of the must_have column names."""
    must = [m.lower() for m in must_have]
    for i, row in enumerate(rows[:10]):
        cells = [norm(c) for c in row]
        if all(any(m in c for c in cells) for m in must):
            idx = {}
            for j, c in enumerate(row):
                if c is not None and str(c).strip():
                    idx[norm(c)] = j
            return i, idx
    raise SystemExit(f"Header not found (need {must_have})")


def col(idx, *names):
    """Find a column index by fuzzy name match."""
    for name in names:
        for k, v in idx.items():
            if name in k:
                return v
    return None


records = []
brand_to_ingredient = {}  # normalized brand -> ingredient (display)


def remember_brand(brand, ingredient_display):
    b = norm(clean_brand(brand))
    if len(b) >= 4 and ingredient_display:  # avoid 1-3 char noise
        brand_to_ingredient.setdefault(b, ingredient_display)


# ---------------------------------------------------------------- FOI 2026
def load_foi():
    rows = rows_of(os.path.join(HERE, FILES["FOI"]))
    hi, idx = find_header(rows, ["generik", "dagang"])
    c_gen = col(idx, "generik")
    c_brand = col(idx, "dagang")
    c_mfr = col(idx, "pabrik full", "pabrik")
    c_form = col(idx, "satuan")
    c_str = col(idx, "kekuatan")
    c_cls = col(idx, "nama kelas terapi", "kelas")
    c_restr = col(idx, "restriksi")
    c_ket = col(idx, "keterangan")
    c_raw = col(idx, "obat")
    n = 0
    for row in rows[hi + 1:]:
        gen = row[c_gen] if c_gen is not None else None
        brand = row[c_brand] if c_brand is not None else None
        if not gen and not brand:
            continue
        ing_disp = (str(gen).strip() if gen else "").title()
        note = " | ".join(str(row[c]).strip() for c in (c_restr, c_ket)
                          if c is not None and row[c] and str(row[c]).strip())
        records.append({
            "provider": "FOI",
            "ingredient": norm_ingredient(gen) if gen else "",
            "ingredientDisplay": ing_disp,
            "brand": (str(brand).strip() if brand else ""),
            "manufacturer": (str(row[c_mfr]).strip() if c_mfr is not None and row[c_mfr] else ""),
            "form": (str(row[c_form]).strip() if c_form is not None and row[c_form] else ""),
            "strength": (str(row[c_str]).strip() if c_str is not None and row[c_str] else ""),
            "class": (str(row[c_cls]).strip() if c_cls is not None and row[c_cls] else ""),
            "note": note,
            "raw": (str(row[c_raw]).strip() if c_raw is not None and row[c_raw] else ""),
            "ingredientSource": "explicit" if gen else "name",
        })
        remember_brand(brand, ing_disp)
        n += 1
    return n


# ---------------------------------------------------------------- Primaya
def load_primaya():
    rows = rows_of(os.path.join(HERE, FILES["Primaya"]))
    hi, idx = find_header(rows, ["komposisi", "nama item"])
    c_komp = col(idx, "komposisi")
    c_item = col(idx, "nama item")
    c_mfr = col(idx, "principal")
    c_form = col(idx, "sediaan")
    c_gol = col(idx, "golongan")
    c_sub = col(idx, "sub golongan")
    n = 0
    for row in rows[hi + 1:]:
        komp = row[c_komp] if c_komp is not None else None
        item = row[c_item] if c_item is not None else None
        if not komp and not item:
            continue
        ing_disp = (str(komp).strip() if komp else "")
        cls = " / ".join(str(row[c]).strip() for c in (c_gol, c_sub)
                         if c is not None and row[c] and str(row[c]).strip())
        records.append({
            "provider": "Primaya",
            "ingredient": norm_ingredient(komp) if komp else "",
            "ingredientDisplay": ing_disp,
            "brand": clean_brand(item),
            "manufacturer": (str(row[c_mfr]).strip() if c_mfr is not None and row[c_mfr] else ""),
            "form": (str(row[c_form]).strip() if c_form is not None and row[c_form] else ""),
            "strength": extract_dose(item),
            "class": cls,
            "note": "",
            "raw": (str(item).strip() if item else ""),
            "ingredientSource": "explicit" if komp else "name",
        })
        remember_brand(item, ing_disp)
        n += 1
    return n


# ---------------------------------------------------------------- BRILife
def load_brilife():
    rows = rows_of(os.path.join(HERE, FILES["BRILife"]))
    hi, idx = find_header(rows, ["nama produk"])
    c_name = col(idx, "nama produk")
    c_gol = col(idx, "golongan obat")
    c_sat = col(idx, "satuan")
    pending = []
    for row in rows[hi + 1:]:
        name = row[c_name] if c_name is not None else None
        if not name:
            continue
        pending.append((str(name).strip(),
                        str(row[c_gol]).strip() if c_gol is not None and row[c_gol] else "",
                        str(row[c_sat]).strip() if c_sat is not None and row[c_sat] else ""))
    # Resolve ingredient per product: try brand dictionary first, else leave the
    # raw name to be matched by full-text search at query time.
    n = 0
    matched = 0
    for name, gol, sat in pending:
        brand = clean_brand(name)
        ing_disp = ""
        src = "name"
        b = norm(brand)
        if b in brand_to_ingredient:
            ing_disp = brand_to_ingredient[b]
            src = "crossref"
            matched += 1
        records.append({
            "provider": "BRILife",
            "ingredient": norm_ingredient(ing_disp) if ing_disp else "",
            "ingredientDisplay": ing_disp,
            "brand": brand,
            "manufacturer": "",
            "form": sat,
            "strength": extract_dose(name),
            "class": gol,  # Keras / Bebas / etc.
            "note": "",
            "raw": name,
            "ingredientSource": src,
        })
        n += 1
    return n, matched


def main():
    nf = load_foi()
    np = load_primaya()
    nb, matched = load_brilife()
    # Build an ingredient autocomplete list (only explicit/crossref ones).
    ingredients = {}
    for r in records:
        d = r["ingredientDisplay"].strip()
        if d:
            ingredients.setdefault(norm_ingredient(d), d)
    ing_list = sorted(ingredients.values(), key=lambda s: s.lower())

    out = {
        "generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "providers": PROVIDER_LABEL,
        "ingredients": ing_list,
        "items": records,
    }
    # Plaintext lands at repo root. It is gitignored and never deployed; the
    # encrypt step (scripts/encrypt_data.js) turns it into web/data.enc.json.
    out_path = os.path.join(HERE, "data.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"FOI:     {nf} items")
    print(f"Primaya: {np} items")
    print(f"BRILife: {nb} items ({matched} ingredients backfilled via brand cross-reference)")
    print(f"Unique ingredient names: {len(ing_list)}")
    print(f"Brand->ingredient dictionary size: {len(brand_to_ingredient)}")
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
