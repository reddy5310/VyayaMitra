# VyayaMitra

**VyayaMitra** (Sanskrit/Hindi: *vyaya* = expenditure, *mitra* = friend) is a private personal-finance app for India. It reads your bank and credit-card statements **on your own device** and explains where your money went and how much you are really saving.

It is a Progressive Web App: open it in a browser, or add it to your Android or iPhone home screen and use it like any other app, even offline.

Live app: <https://reddy5310.github.io/VyayaMitra/>

## Privacy

This is the whole point of the project, so it is stated plainly.

- **Statements never leave your device.** PDFs and CSVs are read by code running in your browser. There is no upload and no server to upload to.
- **PDF passwords never leave your device** either. They are used once to open the file and are not stored.
- **Your data lives in this browser's storage** (IndexedDB). There are no accounts, no analytics, no trackers, no CDN fonts or scripts, and the app makes no network requests while you use it. After the first load it works fully offline.
- **Clearing site data deletes everything.** Use *Settings → Backup* to export a backup file, optionally encrypted with a passphrase (AES-GCM, key derived with PBKDF2).
- **Nothing syncs between devices.** To move to a new phone, export a backup and restore it there.

## Features

- Import statements from almost any bank: PDFs (including scanned ones, read on-device with OCR), spreadsheets (XLS, XLSX, ODS, and the HTML tables many banks save as `.xls`), CSV and OFX/QFX files, with a review step before anything is saved.
- Statements teach the app: a format that reconciles once is remembered, and every correction you make improves later suggestions. See [docs/UNIVERSAL_ENGINE.md](docs/UNIVERSAL_ENGINE.md).
- A reconciliation check on every statement: do the running balances and printed totals add up? Each statement is labelled *balanced*, *mismatch* or *unverified*.
- Automatic understanding of each transaction (merchant, category, what kind of money movement it is) with reasons you can read, and a "needs review" queue for anything uncertain.
- Corrections you can remember as rules, and undo by deleting the rule.
- Five destinations: **Overview** (can I trust the data, and what changed), **Explore** (where the money went), **Activity** (every transaction), **Plan** (budgets, goals, recurring) and **Accounts** (accounts, statements and coverage). **Import** is an action available from every screen; **Settings** and the **Learning centre** sit behind the gear and the sidebar. Everything shows the date your statements run through, and all screens share one reporting period.
- Navigation adapts: bottom tabs on phones, a slim rail on tablets, a full sidebar on desktop. The Back button closes sheets first, and lists remember where you were.
- Hide amounts (blurred until you turn it off), light, dark and system themes.
- Encrypted backup and restore (replace or merge).

## Supported statements

The reader detects what a file is by its **content**, not its extension, then verifies its own work: running balances and printed totals must add up, or the statement is labelled *mismatch* or *unverified*.

| Input | Formats |
| --- | --- |
| Bank and card PDFs with text | Any bank or card issuer. ICICI savings, DBS savings and ICICI credit card have dedicated parsers; everything else (HDFC, SBI, SBI Card, Axis, Kotak, BoB, PNB, IDFC, Yes, IndusInd, Federal, Amex…) is read by the universal table engine, which keeps only the reading whose running balance or card summary adds up. 65 banks and issuers are known by name; unknown banks still work |
| Scanned PDFs (images) | On-device OCR (English). Slower and less exact than a text PDF, so rows are checked against balances and flagged when they do not add up |
| Spreadsheets | XLS, XLSX/XLSM, ODS, SpreadsheetML, and HTML tables saved as `.xls` |
| Text exports | CSV |
| Bank software exports | OFX and QFX (SGML and XML) |

Password-protected PDFs are supported: the app asks for the password and uses it only in memory. Password-protected `.xls` files use the same prompt; modern encrypted `.xlsx` files cannot be opened on-device yet (save a copy without a password, or download PDF/CSV).

### Scanned statements and the OCR files

OCR runs entirely in your browser with Tesseract.js. Its files (a worker, a WebAssembly core and the English model: about 9 MB per device, from a 16 MB folder that carries three core variants) are **the app's own files** under `ocr/`, not fetched from any CDN. They are downloaded the first time you import a scanned statement, then cached for offline use; they are not part of the small install-time download. `npm run dev` and `npm run build` copy them from `node_modules` into `public/ocr/` (git-ignored) with `scripts/copy-ocr-assets.mjs`.

## How the numbers are defined

Every transaction gets a *kind*, and the kind decides which headline number it belongs to. When unsure the app never overstates your savings.

| Number | What counts |
| --- | --- |
| **Income** | Salary, business or rent income, bank interest. Credits whose source is unknown are *not* counted as income. |
| **Spending** | Purchases, cash withdrawals, fees and charges, loan EMIs and money sent to people, minus refunds. Unknown debits count as spending and are flagged for review. |
| **Invested** | Money into SIPs, mutual funds, stocks, FDs, PPF and NPS, minus redemptions. |
| **Between your own accounts** | Transfers between accounts you imported. Counted nowhere, so moving money does not look like spending or income. |
| **Card bill payments** | The bank-side payment and the card-side credit are both neutral; the purchases on the card are what count as spending, once. |
| **Money sent to people** | UPI or bank transfers to individuals. Until you label a person, money you sent them is offset by money people sent you and only the **net** outflow counts as spending (money received is never counted as income). Label a person once (family support, rent, gifts, or "my other account") and their payments count accordingly from then on. Large transfers are flagged for review above a threshold you can set. |
| **Savings rate** | `(income − spending) / income`. It is **hidden**, with the reason shown, when the period lacks income coverage (for example only a credit-card statement was imported) or when no regular income arrived (money came in only as transfers), instead of showing a misleading figure. |

Coverage notes tell you which accounts have no statement for part of a period, so a half-empty month is never silently treated as a cheap month.

## How it learns

Everything below happens on your device and stays in its storage and in backups you export.

- **Formats.** When a statement from an unfamiliar bank reconciles, its layout is saved as a *format* (bank markers, header labels and column positions only, never names, numbers or amounts), so the next statement from that bank is read instantly. If a statement isn't recognised, **Teach VyayaMitra this format** lets you tap which column is the date, description, debit, credit and balance, once.
- **Corrections.** Change a category or kind for *just this transaction* or *always for this merchant*. "Always" creates a reversible rule keyed by the merchant, or by the UPI ID for shop QR codes whose names vary.
- **Model.** A small on-device model is trained only on your confirmed choices. Each decision source is calibrated against how often you corrected it, so sources you keep correcting stop being trusted.
- **Review.** The review queue puts first the transactions whose answer fixes the most other rows ("fixing this fixes 11 more"), with top-3 one-tap suggestions.
- **Learning centre.** See what was learned, how often automatic decisions were right month by month, and export or reset learned formats.

## Install on your phone

**Android (Chrome):** open the app, then use the menu and choose **Install app** (or **Add to Home screen**). Inside the app, *Settings → App → Install app* offers the same button.

**iPhone / iPad (Safari):** open the app in **Safari** (other iOS browsers cannot install web apps), tap **Share**, choose **Add to Home Screen**, then **Add**.

The app updates itself in the background. When a new version is ready you will see a small "A new version of VyayaMitra is ready" bar with a **Reload** button; it never reloads on its own.

## Backups

*Settings → Backup* creates `vyayamitra-backup-YYYY-MM-DD.json` (local date). Add a passphrase to encrypt it; if you forget the passphrase nobody can open the file. To restore, choose the file, enter the passphrase if asked, pick **Merge** (adds what is missing) or **Replace** (erases this device first), and confirm. A failed or wrong-passphrase restore never partially applies.

Make a backup before clearing browser data, switching phones or deleting an account.

## Local development

Requires Node 22.

```bash
npm install
npm run dev        # dev server at http://localhost:5173/VyayaMitra/
npm test           # Vitest (unit and component tests)
npm run lint       # ESLint
npm run build      # type-check, then production build into dist/
npm run preview    # serve the production build locally
npm run icons      # regenerate PWA icons from public/logo.svg
# dev and build first copy the OCR runtime into public/ocr/ (scripts/copy-ocr-assets.mjs)
```

The base path is `/VyayaMitra/` (GitHub Pages project site). To build for a different path, set `VITE_BASE`, for example `VITE_BASE=/ npm run build`.

The service worker is only registered in production builds, so use `npm run build && npm run preview` to test offline behaviour and installation.

### Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`: install, lint, test, build, then publish `dist/` to GitHub Pages. In the repository settings, set **Pages → Source** to **GitHub Actions** once.

## Project structure

```
src/
  app/            app shell: providers, routing, layout, period, theme, PWA update and install
  ui/             design-system primitives (Button, Sheet, Menu, Tabs, Stat, ...)
  features/       one folder per screen: overview, activity, import, plan, reports, settings
  domain/         shared types, categories, how kinds map to metrics
  db/             Dexie schema, reactive read hooks, write actions, backup/restore
  engine/
    import/       staged, atomic import (prepare, review, commit) and deduplication
    understand/   merchant, category and kind decisions with reasons
    match/        links transfers, card payments and refunds across accounts
    analytics/    pure functions: periods, summaries, budgets, recurring, goals, insights
  parsing/        PDF text layout, bank parsers, universal table engine, CSV, reconciliation
    adapters/     spreadsheets (XLS/XLSX/ODS/HTML), OFX/QFX, on-device OCR for scanned PDFs
  lib/            money (integer paise), dates (calendar strings), ids
public/           logo, icons (public/ocr/ is generated)
scripts/          build helpers (copy-ocr-assets.mjs)
docs/             ARCHITECTURE.md
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and how to add a bank parser.

## Limitations

- **OCR is best effort.** Scanned statements are read in English only, and a poor scan can misread digits. The balance check catches most errors and flags them, but a digital statement from your net banking is always more reliable.
- **Encrypted .xlsx** (the modern Excel password format) cannot be opened on-device; legacy `.xls` passwords can.
- **No cross-device sync.** Use backups to move data.
- Parsers are written for real statement layouts but banks change them. If a statement is not recognised, the generic parser or CSV import is the fallback, and the reconciliation badge tells you when the numbers do not add up.
- Data is stored in the browser, which can be cleared by the user or, on low-storage devices, by the browser. *Settings → Backup* includes a Storage card that can ask the browser to protect it.

## Contributing

Issues and pull requests are welcome at <https://github.com/reddy5310/VyayaMitra>. Never commit real statements or backups: the repository ignores `*.pdf`, `*.csv` and `vyayamitra-backup-*.json` outside `tests/fixtures`, and fixtures must be synthetic.

## Licence

[MIT](LICENSE).
