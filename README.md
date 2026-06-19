# RepoObat — Cari Obat per Komposisi

A mobile-first web app to search medicines by **active ingredient (komposisi)** and
see which **brands each insurance provider covers**. Built for a telemedicine doctor
who remembers ingredients, not brand names.

## Data sources (in this folder)

| Provider | File | Ingredient column |
|---|---|---|
| FOI 2026 | `Daftar Obat FOI 2026 untuk Telemedicine.xlsx` | ✅ `Generik` |
| Primaya Care | `Formularium obat Telemedicine Primayan Care (Update 7 April 2026).xlsx` | ✅ `Komposisi` |
| BRI Life | `Produk Obat BRILife per 24 April 2026.xlsx` | ❌ name only (backfilled, see below) |

BRI Life has no ingredient column, so the build script harvests a
**brand → ingredient dictionary** from FOI + Primaya and uses it to fill in
BRI Life ingredients where the brand matches. Anything not matched is still
findable by full-text search over the product name.

## How to run

```bash
# 1. (Re)build the data file from the spreadsheets
python scripts/build_data.py

# 2. Serve the web app (a server is required; opening index.html directly
#    via file:// will not load data.json)
cd web
python -m http.server 8000
```

Open **http://localhost:8000** on your phone (same Wi-Fi: use your PC's LAN IP,
e.g. `http://192.168.x.x:8000`). On the phone you can "Add to Home Screen" to
install it as an app; it then works **offline**.

## Updating the medicine lists

Replace any of the three `.xlsx` files with a newer version (keep the column
headers the same) and re-run `python scripts/build_data.py`. The app reads the
regenerated `web/data.json`.

## Known data-quality notes (prototype)

- FOI lists ingredients in Indonesian (Parasetamol, Setirizin) while Primaya/BRI Life
  use English (Paracetamol, Cetirizine). Search covers both because it also matches
  the full product text — but the autocomplete list shows both spellings.
- BRI Life rows marked `≈ ref` had their ingredient *inferred* from a brand-name
  match in another formulary; double-check before relying on it clinically.
- Strength/dose is only structured for FOI; for Primaya/BRI Life it stays inside
  the product name.

## Next steps (when you're ready beyond the prototype)

- Reconcile Indonesian/English ingredient names to one canonical list.
- Add a proper search index (e.g. Fuse.js) for typo tolerance.
- If it grows past one user: move to a small backend + database and add login.
