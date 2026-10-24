# VyayaMitra architecture

VyayaMitra is a browser-only app. There is no backend: everything below runs in the user's browser and stores data in IndexedDB. A service worker makes the app load offline.

## Principles

1. **Money is integer paise.** Never floats. 1 INR = 100 paise (`src/lib/money.ts`).
2. **Dates are calendar strings** `YYYY-MM-DD`, never converted through `Date#toISOString()` (which shifts dates in India's timezone). Helpers live in `src/lib/dates.ts`.
3. **Nothing leaves the device.** No analytics, no CDN assets, no network calls from the app. The PDF.js worker is bundled and precached.
4. **Never overstate savings.** Unknown credits are not income; unknown debits are spending and flagged for review.
5. **Writes are atomic.** An import, a delete, a restore either completes or changes nothing.
6. **Screens read through hooks and never hold their own copy of ledger data**, so a stale response cannot overwrite newer data.

## Modules

| Module | Role |
| --- | --- |
| `src/domain` | Types shared everywhere (`Transaction`, `Statement`, `Account`, ...), the category catalogue, and `kinds.ts`, which maps each transaction kind to the metric it feeds. |
| `src/parsing` | Turns a PDF, scanned PDF, spreadsheet, CSV or OFX/QFX file into a `ParsedStatement`: input adapters (`adapters/`), PDF text extraction and line reconstruction, bank-specific parsers, a universal table engine, and reconciliation checks. Throws typed errors (`PasswordRequiredError`, `IncorrectPasswordError`, `ScannedPdfError`, `UnsupportedStatementError`). |
| `src/engine/understand` | Decides each row's merchant, channel, counterparty, kind and category, with human-readable `reasons`, a `confidence`, and `needsReview`. Order of authority: user per-transaction choice, user rules, built-in rules, on-device learned model, kind defaults. |
| `src/engine/match` | Links the two legs of transfers between own accounts, credit-card bill payments and their card-side credits, refunds and their purchases, and reversals. |
| `src/engine/import` | The staged import workflow (`prepareImport`, `retargetPreview`, `commitImport`), duplicate detection, statement deletion, reprocessing. |
| `src/engine/analytics` | Pure functions: query filter, periods, coverage, summary, monthly series, merchants, recurring payments, budgets, goals, insights, saving-action outcomes. |
| `src/db` | Dexie schema, `hooks.ts` (reactive reads), `actions.ts` (every write, validated, one transaction each), `backup.ts` (versioned, optionally encrypted export/restore). |
| `src/features/*` | One folder per screen: overview, activity, import, plan, reports, settings. |
| `src/app` | The shell: providers, routes, layout, the shared reporting period, theme, install and update handling. |
| `src/ui` | Design-system primitives and components on CSS-variable tokens. |

## Data flow

```
file ──► parse ──► stage ──► review ──► atomic commit ──► link ──► understand ──► analytics ──► screens
```

1. **Parse** (`parseStatement`): the file is read in memory and its kind is detected by content (see *Universal engine and input adapters*). A text PDF is converted to positioned text items, grouped into lines, matched to a parser by `detect()`, and turned into rows plus printed totals. A reconciliation (running balance and printed totals) yields `balanced`, `mismatch` or `unverified`.
2. **Stage** (`prepareImport`): rows are understood against the matching (or a proposed new) account, checked against existing fingerprints for duplicates, and compared with already-imported files and overlapping periods. **Nothing is written.**
3. **Review**: the Import screen shows new rows, duplicates, rows needing review, and lets the user choose the account, add vs replace, and rows to exclude.
4. **Atomic commit** (`commitImport`): one Dexie transaction over every table. A unique index on `[accountId+fingerprint]` is the last defence against duplicates; any failure rolls everything back, so a cancelled or failed import never touches existing data.
5. **Link**: transfers, card payments and refunds are matched across the whole ledger, since the other leg may come from an earlier or later statement.
6. **Understand**: decisions can be recomputed (`reprocessLedger`) when rules change or the app is upgraded, without overriding choices the user made.
7. **Analytics**: screens call `applyQuery` with the shared period, then `summarize` and friends. List, totals and charts therefore agree.

## Universal engine and input adapters

The goal is to read a statement from any bank. The full design, pipeline diagram and mind map are in [UNIVERSAL_ENGINE.md](UNIVERSAL_ENGINE.md). In short: every input is first turned into one of two shapes, then one engine does the rest.

| Input | Reader (`src/parsing/...`) | Becomes |
| --- | --- | --- |
| PDF with text | `pdf/extract.ts` (pdf.js) | `LayoutDoc`: pages of positioned lines |
| Scanned PDF | `adapters/ocr.ts`: pdf.js renders each page, Tesseract.js recognises words, `adapters/ocrLayout.ts` maps boxes back to PDF points | the same `LayoutDoc` |
| XLS, XLSX, ODS, SpreadsheetML, HTML saved as `.xls` | `adapters/spreadsheet.ts` (SheetJS) | `SheetTable[]`: rows of display strings |
| CSV | CSV reader | `SheetTable` |
| OFX / QFX | `adapters/ofx.ts` | one `SheetTable` with columns Date, Description, Amount, Reference, Type, Balance, plus account type and last 4 digits |

Design rules for adapters:

- **Detect by content.** Extensions are hints only (`sniff.ts` checks ZIP, OLE2, HTML-table and OFX signatures). Banks routinely send HTML named `.xls` and PDFs named `.pdf.xls`.
- **Keep text as printed.** Cells are returned as display strings (SheetJS formatted text), so `1,234.50` and `01/02/2025` reach the engine unchanged. The one exception is Excel's locale-dependent built-in date format, which SheetJS would print US-style; those cells become ISO `YYYY-MM-DD`, which is unambiguous.
- **Clean padding only.** Blank rows and fully blank columns are dropped; merged cells keep their text in the first cell.
- **Everything heavy is lazy and self-hosted.** SheetJS, Tesseract.js and pdf.js are dynamic imports, so the first paint does not pay for them. OCR files live under `ocr/` in the app itself.
- **Privacy.** No network request is made by any adapter other than loading the app's own files.

### OCR assets and caching

`scripts/copy-ocr-assets.mjs` (run by `predev` and `prebuild`) copies `worker.min.js`, the three LSTM WebAssembly cores and the English model (`4.0.0_best_int`, stored **decompressed** as `eng.traineddata`) from `node_modules` into `public/ocr/`, which is git-ignored and rebuilt on every CI run. The model is decompressed at build time because the gunzip that Tesseract.js bundles for browsers (zlibjs) corrupts this file and the engine then fails to initialise; the app loads it with `gzip: false`. The service worker does **not** precache `ocr/**`, the SheetJS chunk or the Tesseract client chunk, which keeps the install-time download small. Instead a runtime `CacheFirst` cache stores them on first use, so OCR and spreadsheet import keep working offline afterwards. The pdf.js worker stays precached.

## Self-training

The app improves from the user's own data only, and none of it leaves the device:

- **Formats.** A statement layout that reconciles is saved as a template (header labels, column geometry and format flags only, never names, numbers or descriptions) and matched before any inference on the next import. If a layout is not understood the user can teach the column mapping once.
- **Understanding.** Corrections become rules ("this one" or "always"), merchant and UPI-handle memory, and an on-device classifier trained on the user's confirmed choices. Each decision records its source and confidence.
- **Transparency.** The Learning centre shows what was learned and how accuracy is trending.

See [UNIVERSAL_ENGINE.md](UNIVERSAL_ENGINE.md) for the privacy rules that govern learned artefacts.

## Storage schema

Dexie database `vyayamitra`, version 1 (`src/db/db.ts`):

| Table | Primary key and indexes |
| --- | --- |
| `accounts` | `id` |
| `statements` | `id`, `accountId`, `fileHash` |
| `transactions` | `id`, `accountId`, `statementId`, `date`, `linkId`, `merchantKey`, unique `[accountId+fingerprint]` |
| `rules` | `id` |
| `customCategories` | `id` |
| `budgets` | `id`, unique `category` |
| `goals`, `goalContributions` | `id`, (`goalId`) |
| `recurringDecisions` | `merchantKey` |
| `savingActions` | `id` |
| `meta` | `key` (settings and bookkeeping) |

To change the schema, never edit `version(1)`: append `this.version(2).stores({...})` with an upgrade function, and bump the backup `schemaVersion` so old backups still restore.

Browser-side preferences that are not part of the ledger live in `localStorage`: `vm-theme`, `vm-period`, `vm-last-backup`, `vm-offline-announced`. All reads and writes are wrapped in try/catch because storage can be blocked.

## App shell

- **Providers** (`src/app/App.tsx`): Theme, Toast, Install, PWA, Privacy (from `AppSettings.hideAmounts`), Period, then the `HashRouter`. Hash routing is used so GitHub Pages needs no rewrite rules.
- **Screens are lazy-loaded** with `React.lazy`, each wrapped in a `Suspense` fallback and its own error boundary that resets when the route changes. A broken screen never blanks the shell.
- **Layout** (`Shell.tsx`): five destinations (Overview, Explore, Activity, Plan, Accounts). Below `md` a bottom tab bar, `md` to `lg` a navigation rail, `lg`+ a sidebar that also carries Import, Learning and Settings. Import is an action (header button, rail and sidebar), Settings a gear. Skip link, `aria-current`, safe-area padding. `SampleBanner` (from `src/db`) sits in the sticky header while sample data is on.
- **Page chrome** (`chrome.tsx`): screens declare `usePageChrome({ title, showPeriod, actions })` and the shell renders the header.
- **Period** (`period.tsx`): one shared period for every screen, defaulting to the month of the latest transaction, persisted per device.
- **PWA** (`pwa.tsx`, `PwaRegistrar.tsx`, `vite.config.ts`): `registerType: 'prompt'`. A waiting version produces a banner, never an automatic reload. Registration happens only in production builds. Workbox precaches JS (including the `.mjs` PDF worker), CSS, HTML, SVG and PNG, with `index.html` as navigation fallback.

- **Back and scroll** (`src/ui/backClose.ts`, `src/app/scroll.ts`): every `Sheet` pushes one history entry while open so the Back gesture closes it; the shell stores each route's scroll offset in `sessionStorage` and restores it on Back/Forward.

## Design system

The look is calm and personal: warm light neutrals (deep neutral in dark), one teal accent, tabular numerals, status always colour plus icon or text. Category colours are 24 fixed slots (`--chart-1..24`, `--chart-neutral`) that avoid the status hues. `ChartFrame` wraps every chart (question, scope, takeaway, completeness marker, table alternative); `MeterBar` and `ProgressRing` show budgets and goals accessibly. Colours are CSS variables holding `R G B` channels (`src/index.css`), exposed to Tailwind with alpha support (`bg-primary/10`). Light is the default; `[data-theme="dark"]` overrides the tokens. `index.html` applies the stored theme before first paint to avoid a flash. Text and background pairs meet 4.5:1 in both themes, and form-control outlines meet 3:1. Touch targets are at least 44 px (`min-h-touch`); dense controls shrink only on fine pointers (`coarse:` variant). Motion is reduced under `prefers-reduced-motion`.

## Testing

Vitest with jsdom for components and `fake-indexeddb` for the database. Mock `@/db/hooks` and `@/db/actions` when testing a screen in isolation. Test data must be synthetic: never use real statements.

## Adding a bank parser

A parser turns the reconstructed text of one statement layout into a `ParsedStatement`. See `src/parsing/core/types.ts` for the interfaces and `src/parsing/parsers/` for working examples (`iciciSavings.ts`, `dbsSavings.ts`, `iciciCreditCard.ts`).

1. **Collect a synthetic fixture.** Create a fake statement that has the same layout as the real one (same headings, column order, date and amount formats, wrapped descriptions) with invented names and numbers. Put it under `tests/fixtures/parsing/` with a `.synthetic.pdf` name. Never commit a real statement.
2. **Implement `PdfParser`** (or `CsvParser`):
   - `id`, `version`, `label`, `institution`, `accountType`, `fileTypes`.
   - `detect(doc)` returns a `confidence` between 0 and 1 and `reasons`. Look for stable header text and column titles, not account numbers. Return 0 for anything else so parsers do not steal each other's files.
   - `parse(doc, ctx)` returns a `ParsedStatement`: rows in integer paise with `YYYY-MM-DD` dates, direction from the debit/credit column or the balance movement, `source` (page, line range and raw text) for every row, the period, opening and closing balance, last 4 digits of the account, and any printed totals.
3. **Reconcile.** Fill `reconciliation` using the helpers in `src/parsing/core/reconcile.ts`: running balance continuity per row, and printed totals against the sum of rows. Mark `unverified` only when the statement prints nothing to check against.
4. **Report what you skipped.** Lines that looked transactional but were not turned into rows go in `skipped` with a reason. A parser must never silently drop money.
5. **Register** the parser in the parser list used by `parseStatement` and `listSupportedFormats` (`src/parsing`), so the Import screen advertises it.
6. **Test.** Add a test that parses the fixture and asserts the row count, the totals, a few specific rows, and `reconciliation.status`. Add a negative test that a statement from another bank is not detected.
7. **Bump `version`** whenever parsing output changes, so imports record which parser version produced them.

Anything that cannot be recognised falls back to the generic table parser or CSV import; scanned PDFs raise `ScannedPdfError` (there is no OCR).

## Adding a screen

1. Create `src/features/<name>/<Name>Page.tsx` with a default export.
2. Add the path to `ROUTES` in `src/app/routes.ts`, a lazy import and `<Route>` in `src/app/App.tsx`, and a `NAV_ITEMS` entry in `Shell.tsx` if it belongs in the main navigation.
3. Call `usePageChrome({ title, showPeriod })`, read data through `@/db/hooks`, filter with `applyQuery` using `usePeriod().period`, and build the UI from `@/ui`.
