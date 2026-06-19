# RepoObat — Cari Obat per Komposisi

A mobile-first PWA to search medicines by **active ingredient (komposisi)** and
see which **brands each insurance provider covers**. Built for a telemedicine
doctor who remembers ingredients, not brand names.

The dataset is **encrypted** and only decrypts in the browser after a password
is entered, so the proprietary formulary data is never publicly readable even
though the site is hosted on a public URL.

## Data sources (in this folder)

| Provider | File | Ingredient column |
|---|---|---|
| FOI 2026 | `Daftar Obat FOI 2026 untuk Telemedicine.xlsx` | ✅ `Generik` |
| Primaya Care | `Formularium obat Telemedicine Primayan Care (Update 7 April 2026).xlsx` | ✅ `Komposisi` |
| BRI Life | `Produk Obat BRILife per 24 April 2026.xlsx` | ❌ name only (backfilled) |

BRI Life has no ingredient column, so the build harvests a **brand → ingredient
dictionary** from FOI + Primaya and uses it to fill BRI Life ingredients where
the brand matches; the rest stay findable by full-text search.

## Build the data

```bash
# 1. Normalize the spreadsheets -> data.json (plaintext, gitignored, never deployed)
python scripts/build_data.py

# 2. Encrypt -> web/data.enc.json (the only data file that ships)
#    Set your own password (recommended), or omit to get a generated one:
REPOOBAT_PASSWORD="choose-a-password" node scripts/encrypt_data.js
```

Re-run both steps whenever a spreadsheet is updated (keep the column headers the
same). Whoever opens the app needs the password you used here.

## Run locally

```bash
cd web
python -m http.server 8000
```

Open http://localhost:8000 and enter the password. On a phone on the same Wi-Fi,
use your PC's LAN IP (e.g. `http://192.168.x.x:8000`).

## Deploy to Vercel

Only the `web/` folder is deployed (no spreadsheets, no scripts, no plaintext).

```bash
cd web
vercel login        # one-time, interactive
vercel --prod       # deploy
```

`web/vercel.json` sets `noindex` headers so search engines don't list it.

## Security notes

- Encryption: PBKDF2-SHA256 (150k iterations) → AES-256-GCM. The password is
  never sent to a server; decryption happens client-side via Web Crypto.
- Strength is as good as the password — use a non-trivial one.
- "Ingat di perangkat ini" stores the password in the browser's localStorage on
  that device only (convenience for a personal phone).

## Known data-quality notes (prototype)

- FOI lists ingredients in Indonesian (Parasetamol, Setirizin); Primaya/BRI Life
  use English (Paracetamol, Cetirizine). Search bridges both because it also
  matches the full product text. (Reconciling these is the planned next step.)
- BRI Life rows marked `≈ ref` had their ingredient *inferred* from a brand-name
  match — double-check before relying on it clinically.
- Dose is parsed from the product name for Primaya/BRI Life; liquids that only
  list a volume (e.g. `60 ml`) show that volume, not a strength.
