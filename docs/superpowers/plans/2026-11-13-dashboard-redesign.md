# ROPA Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-page dashboard plus the FMV page into one page with a sidebar (Overview, Sales, Losses, Inventory, FMV generator) in the "Command Center" look.

**Architecture:** `index.html` holds 5 `<section data-view>` blocks. A hash router (`#overview`, `#sales`, `#losses`, `#inventory`, `#fmv`) shows one at a time. `app.js` keeps loading the Google Sheet exactly as today. `fmv.js` keeps loading `fmv-data.xlsx` and also exposes the loaded units, which the Sales and Losses menus use for the sold-per-day calendar and the brand/series table. New calculations live in a pure `dash-logic.js` with Node tests.

**Tech Stack:** Plain HTML/CSS/JS, d3 7.9.0, SheetJS 0.18.5 (already used), `node --test` for unit tests, Playwright (pre-installed) for the browser check.

**Spec:** `docs/superpowers/specs/2026-11-13-dashboard-redesign-design.md` (visual reference: option A in `2026-11-13-dashboard-redesign-preview.html`)

## Global Constraints
- No change to the Google Sheet, the Power Automate flow or `config.js`.
- Every existing number is computed as today (`tot`, `groupSum`, `recClass`, inventory outflow rules in `app.js`).
- Recovery target `C.recoveryTarget` (0.83), inventory target `C.inventoryTarget` (360).
- No sample or made-up figures on the live site; empty data shows "—" or a "No … for this month" note.
- Works at 390px width with no horizontal page scroll; light and dark mode.
- PINNACLE stays excluded from associates.
- No borrower data is read or shown.

## Review Focus
1. A month that starts on Saturday/Sunday (Nov 2026 starts on Sunday): weekend units can't go to the Friday before, so they go to the first workday of the month.
2. A month in the sheet but not in `fmv-data.xlsx` (e.g. 2025 comparisons, or a new month before the file is replaced): Sales calendar and brand table show "No daily data for this month", nothing crashes.
3. `fmv-data.xlsx` missing or failing to load: Overview, Losses tables and Inventory still render; only the two file-based cards show the error.
4. Dates from SheetJS that land a few seconds before midnight (a known SheetJS time-zone quirk) must still count on the right day.
5. A month with no loss of ₱300K or more: Top 10 loss units shows "No units lost ₱300K or more this month".

---

### Task 1: Pure logic module with tests

**Files:**
- Create: `dash-logic.js` (UMD: `module.exports` in Node, `window.DASH` in the browser, like `fmv-engine.js`)
- Test: `tests/dash-logic.test.js`

**Interfaces:**
- Produces:
  - `dayOf(v: Date|number|string) -> 'YYYY-MM-DD'|null` — Date: add 12h, then local Y/M/D; Excel serial (>20000): UTC; strings `M/D/YYYY` or `YYYY-MM-DD`.
  - `workdayCalendar(days: string[], year: number, month0: number, today: Date) -> { weeks: Array<Array<{date, d, units, weekend}|null>>, total, workdaysSoFar, average, weekendUnits }` — weeks are Mon–Fri rows; Sat/Sun units are added to the Friday before, or the first workday if that Friday is in another month (`weekend` = units moved onto that day). `workdaysSoFar` counts workdays up to `today` when `today` is in that month, else all. `average = total / workdaysSoFar` (0 when none).
  - `topBrandModels(units: {brand, series, price, day}[], year, month0, fmv: {cleanBrand, modelOf, cleanSeries}, n = 10) -> {name, units, amount}[]` — group key `cleanBrand(brand) + ' ' + (modelOf(series, brand) || cleanSeries(series, brand))`, sorted by units desc, then amount desc.
  - `bigLosses(top: {month, gain}[], month: string, min = 300000) -> top[]` — rows of that month with `gain <= -min`, sorted by gain ascending, max 10.
  - `invKpis(rows: {status, units}[]) -> { onHand, underLegal, forSale }` — `underLegal` sums statuses matching `/LEGAL/`, `forSale` `/FOR SALE/`, `onHand` all except `SOLD` and `REDEEMED`; `null` when `rows` is empty.

- [ ] **Step 1: Write the failing tests** in `tests/dash-logic.test.js` with `node:test` + `node:assert`:
  - `dayOf(new Date(2026,0,1,23,59,40))` → `'2026-01-02'` (the SheetJS quirk stores Jan 2 as a few seconds before midnight); `dayOf(new Date(2026,0,2))` → `'2026-01-02'`; `dayOf(46023)` → `'2026-01-01'`; `dayOf('1/5/2026')` → `'2026-01-05'`; `dayOf('')` → `null`.
  - Nov 2026 (`month0 = 10`), days `['2026-11-01','2026-11-02','2026-11-02','2026-11-07','2026-11-13']`, today `2026-11-13`: first week's Monday 2 has `units 3, weekend 1`; Friday 6 has `units 1, weekend 1`; `total 5`, `workdaysSoFar 10`, `average 0.5`, `weekendUnits 2`; every week has 5 slots.
  - Oct 2026 with today in November: `workdaysSoFar 22`.
  - `topBrandModels` with fake fmv (`cleanBrand: s=>s.toUpperCase()`, `modelOf: s=>s.split(' ')[0].toUpperCase()`, `cleanSeries: s=>s.toUpperCase()`): 2× toyota "vios 1.3", 1× ford "ranger" in Nov 2026 and 1× in Oct → `[{name:'TOYOTA VIOS',units:2,...},{name:'FORD RANGER',units:1,...}]`.
  - `bigLosses` keeps `-300000`, drops `-299999`, other months dropped.
  - `invKpis` on `[{status:'UNDER LEGAL',units:47},{status:'UNDER LEGAL SPECIAL CASE - RETURNED UNITS',units:3},{status:'FOR SALE TRANSMITTED',units:100},{status:'FOR SALE UNTRANSMITTED',units:20},{status:'SOLD',units:150},{status:'REDEEMED',units:9}]` → `{onHand:170, underLegal:50, forSale:120}`; `invKpis([])` → `null`.
- [ ] **Step 2:** `node --test tests/*.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `dash-logic.js`.
- [ ] **Step 4:** `node --test tests/*.test.js` → all pass.
- [ ] **Step 5:** Commit `dash-logic.js tests/`.

### Task 2: FMV generator moves into index.html and shares its data

**Files:**
- Modify: `fmv.js` (ids, data sharing, day dates), `fmv.html` (redirect)

**Interfaces:**
- Produces: `window.ROPA_SALES: Promise<{ units: {brand, series, price, day, ...}[], asOf }>` set by `fmv.js` before loading; each unit gains `day` from `DASH.dayOf(dateCell)`.
- Rename the ids `fmv.js` touches that clash with the dashboard: `asof` → `fmv-asof`, `load-err` → `fmv-err`; it no longer touches `loading`.

- [ ] **Step 1:** Make the changes; `fmv.html` becomes a page that redirects to `index.html#fmv` (meta refresh + `location.replace`).
- [ ] **Step 2:** Verified in Task 4's browser check (FMV estimate works inside `#fmv`).
- [ ] **Step 3:** Commit.

### Task 3: Sidebar shell, router and styles

**Files:**
- Modify: `index.html`, `styles.css`

**Interfaces:**
- DOM ids `app.js` uses stay the same where the content is unchanged (`kpis`, `line`, `bars`, `top5`, `div`, `cond`, `assoc`, `ns`, `lc`, `lp`, `costs`, `top10`, `inv`). New ids: `nav` (sidebar links with `data-view`), `months` (month buttons), `view-title`, `sales-kpis`, `cal`, `cal-note`, `ld` (losses by division table), `brands`, `brands-note`, `inv-kpis`. Views: `<section data-view="overview|sales|losses|inventory|fmv">`.
- `lc`, `lp`, `ld` tables get columns: name, Units sold, Sold amount, Total loss, % of net loss, Recovery rate; columns 2–5 carry class `hl` (highlighted).
- `top10` gets an extra note line; `brands` columns: #, Brand / model, Units sold, Sold amount.

- [ ] **Step 1:** Build the layout: navy sidebar (dark: `#0B0A1F`) with logo, 5 links, refresh button and "Data as of"; main area with title, live dot + "auto-refresh every N min", month buttons; at ≤820px the sidebar becomes a sticky top row of tabs. Move FMV markup from `fmv.html` into the `fmv` view with the renamed ids. Load `dash-logic.js`, SheetJS, `fmv-engine.js`, `fmv.js`, then `app.js`.
- [ ] **Step 2:** Verified in Task 4.
- [ ] **Step 3:** Commit.

### Task 4: Render each menu and verify in a browser

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `DASH.*` (Task 1), `window.ROPA_SALES` (Task 2), ids (Task 3).

- [ ] **Step 1:** Router: `showView(name)` from `location.hash` (default `overview`), updates `aria-current`, `view-title`, redraws charts of the shown view (charts need a visible box to measure). Month buttons replace the `<select>`; clicking one sets `month` and re-renders.
- [ ] **Step 2:** Overview: existing KPIs, line, bars, top 5, division donut (unchanged logic). Sales: all associates sorted desc (no `.slice(0,5)`); `sales-kpis` holds 3 empty placeholder cards ("KPI to be added"); calendar from `workdayCalendar` with year from `D.generated_at`, note "From the sales file · data through <latest day> · N weekend units added to the Friday before". Losses: condition donut whose legend shows count, % of units and total loss; non-starter table; `lp` and new `ld` by division with the highlighted columns; `top10` via `bigLosses`; `brands` via `topBrandModels`; disposal costs last. Inventory: 3 KPI cards from `invKpis` for the inventory month and the month before (on hand also vs target), then the existing table.
- [ ] **Step 3:** Browser check with Playwright, routing the sheet URL to the downloaded CSV: every view renders with no page errors; Nov numbers in Overview match the current site's; FMV estimate returns a value; 390px width has no horizontal scroll; light and dark screenshots look right.
- [ ] **Step 4:** `node --test tests/*.test.js` still passes. Commit and push.
