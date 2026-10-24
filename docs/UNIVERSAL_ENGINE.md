# Universal statements & self-training

VyayaMitra's goal: **read any bank or credit-card statement from any bank, and get smarter with every correction**, entirely on the user's device.

The design rests on two ideas:

1. **Statements verify themselves.** A bank statement's running balance (`previous ± amount = balance`) and a card statement's summary (`previous balance + charges − credits = total due`) let the engine *prove* an interpretation is right, instead of trusting a bank-specific script.
2. **Everything learned is reusable.** A format parsed and reconciled once becomes a template; a merchant categorised once becomes a rule; every correction becomes training data. None of it leaves the device, and none of it contains personal data except the user's own ledger.

## Mind map

```mermaid
mindmap
  root((VyayaMitra<br/>universal + self-training))
    Read anything
      PDF with text
        pdf.js positioned text
        lines, columns by right edge
        repeated header/footer removal
        page-break description stitching
      Scanned PDF
        on-device OCR, Tesseract.js
        self-hosted assets, lazy, opt-in
        same layout engine after OCR
      Spreadsheets
        XLS, XLSX, ODS
        HTML tables saved as .xls
      CSV and TXT exports
      OFX and QFX
    Universal engine
      Bank knowledge base
        60+ Indian banks, SFBs, payments banks, card issuers
        markers, IFSC codes, header synonyms
        Hindi/bilingual headers
      Table inference
        header synonyms
        headerless numeric column clustering
        date-first, serial-first, description-first
        transaction date + value date
      Amount styles
        separate debit and credit
        signed amount
        Dr/Cr suffix
        Dr/Cr column
        brackets for negatives
      Dates
        DMY vs MDY voting
        year-less dates from statement period
        Dec to Jan rollover
      Self-verification
        balance-chain solver chooses columns and direction
        opening + credits − debits = closing
        card summary reconciliation
        every row date inside period
      Credit cards
        add-on card sections
        reward points and foreign-currency columns ignored
        summary: total due, minimum, due date, limit
    Self-training
      Formats
        auto-template from every reconciled import
        Teach this format: user maps columns once
        template match before inference
        export and import templates without personal data
      Understanding
        rules from corrections: this one or always
        VPA and counterparty memory
        on-device Naive Bayes on your choices
        per-source calibration from feedback
        top-3 suggestions
      Active learning
        review queue ranked by impact
        teach one merchant, fix many rows
      Transparency
        Learning centre: what was learned, accuracy trend
        every decision shows source and confidence
    Deep understanding
      channel: UPI, IMPS, NEFT, RTGS, ACH, card, ATM
      narration grammars for 30+ banks
      merchant vs person vs own account
      truncation-aware names
      kinds: income, spending, transfer, card bill, investment, EMI, refund
      links: self transfers, card payments, refunds, reversals
    Honest numbers
      coverage-aware periods
      spending vs sent to people vs transfers
      card dues and commitments
      estimates kept apart from achieved savings
```

## Pipeline

```mermaid
flowchart LR
  F[File] --> K{Kind?}
  K -- PDF text --> L[Layout lines]
  K -- scanned PDF --> O[OCR → layout lines]
  K -- XLS/XLSX/ODS/HTML --> S[Sheet tables]
  K -- CSV/TXT --> S
  K -- OFX/QFX --> S
  O --> L
  L --> T{Stored template<br/>matches?}
  S --> T
  T -- yes --> P1[Parse with template]
  T -- no --> B[Bank profile + header synonyms]
  B --> I[Infer columns, dates, amount style]
  I --> V[Balance-chain / summary solver<br/>picks the interpretation that reconciles]
  P1 --> R[Reconcile]
  V --> R
  R -- balanced --> A[Auto-save template]
  R -- mismatch / low confidence --> U[Teach this format UI]
  U --> P1
  R --> N[Understand each row → link pairs → analytics]
  N --> C[User corrections] --> M[Rules + model + calibration]
  M --> N
```

## Where things live

| Concern | Module |
|---|---|
| Bank knowledge base (names, IFSC, markers) | `src/domain/institutions.ts` |
| Universal PDF/sheet engine, templates applied, inspection for teaching | `src/parsing/**` |
| XLS/XLSX/ODS/HTML, OFX/QFX, OCR adapters | `src/parsing/adapters/**` |
| Template + feedback storage, auto-learning on import | `src/db/**`, `src/engine/import/**` |
| Narration grammars, merchant knowledge, learning, calibration, suggestions, review priority | `src/engine/understand/**` |
| Learning metrics, card dues | `src/engine/analytics/**` |
| Teach-format UI, smarter review queue | `src/features/import/**`, `src/features/activity/**` |
| Learning centre | `src/features/learning/**` |

## Privacy rules for learned artefacts

- A template stores only: lower-case marker phrases (bank names, domains, card brands), header labels, column geometry/indexes, and format flags. Never names, account numbers, addresses, amounts or descriptions. `draftTemplate` scrubs anything that contains a digit run of 4+ or looks like an address/name line.
- Feedback events and the learned model stay in the device's IndexedDB and in the user's own backups.
- Exported template files can be shared publicly; the importer re-validates and scrubs them.
