# Market Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show online asking-price ranges from a hand-kept `market-prices.xlsx` next to the FMV estimate.

**Architecture:** Pure parsing/matching in `dash-logic.js` (tested in Node); `fmv.js` loads the file with SheetJS and renders a card under the result.

**Tech Stack:** Plain JS, SheetJS 0.18.5, `node --test`, Playwright for the browser check.

**Spec:** `docs/superpowers/specs/2026-11-13-market-prices-design.md`

## Global Constraints
- The ROPA estimate and its numbers do not change.
- No example prices in the repo; `market-prices.xlsx` ships with the header row only.
- A missing or empty file must not break the FMV generator.

## Review Focus
1. Brand/model typed differently in the two files ("Mitsubishi" vs "MITSUBIHSI", "Mirage G4 GLX" vs "MIRAGE G4"): both go through `cleanBrand`/`modelOf`.
2. Asking prices typed as text with ₱ and commas: parsed as numbers; blank or zero prices skipped.
3. Only old rows (over 3 months): treated as no market prices.
4. Only one listing: range shows a single price, still compared.

---

### Task 1: `parseMarket` and `marketRef` in dash-logic.js

**Interfaces — Produces:**
- `parseMarket(rows: any[][]) -> { brand, model, year, type: 'repo'|'used', price, month: 'YYYY-MM' }[]` — header row mapped by name; rows missing a required value skipped.
- `marketRef(list, q: {brand, series, year}, fmv, today: Date, ropa: number) -> null | { yearNote: ''|'±1 year', repo: Stat|null, used: Stat|null }`, `Stat = { low, high, median, n, pct }` where `pct = ropa / median`. Uses rows with month ≥ (today's month − 2).

- [ ] Tests in `tests/dash-logic.test.js`: header in any case/order; `'₱ 398,000'` → 398000; type mapping; old rows dropped; exact-year preferred over ±1; ±1 fallback sets `yearNote`; median of [398000, 425000] = 411500 and `pct` = 335000/411500; no match → `null`.
- [ ] Run `node --test tests/*.test.js` → fail; implement; → pass; commit.

### Task 2: Load and show in the FMV generator

**Files:** `fmv.js`, `index.html`, `styles.css`, new `market-prices.xlsx` (header row only).
- [ ] `index.html`: `<div class="card" id="market" hidden>` after the result card, inside the FMV view.
- [ ] `fmv.js`: load `market-prices.xlsx` (404 → empty list); after each estimate call `DASH.marketRef` and render: two range bars on one scale with the gold dot for the ROPA estimate, "N listings", the comparison line, source note "Asking prices recorded by hand, last 3 months"; or the "No market prices recorded yet" note. Hide on Clear.
- [ ] Browser check with a temporary test file (not committed): card shows; without the file, the generator works as before; 390px no sideways scroll.
- [ ] Commit, push.
