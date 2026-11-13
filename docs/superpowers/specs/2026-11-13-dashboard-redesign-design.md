# ROPA dashboard redesign: sidebar menus, Command Center look

## Intent
Today the dashboard is one long page plus a separate FMV page. The ROPA team wants it split into menus (Overview, Sales, Losses, Inventory, FMV generator), so each topic is one click away. It should use the dark "Command Center" look from the preview (option A in `2026-11-13-dashboard-redesign-preview.html`, next to this file; its numbers are samples): sidebar, month buttons, KPI cards with trend lines, and the GDFI navy and gold.

## Goals
- A sidebar with 5 menus. The month picker applies to every menu.
- Keep every number the current dashboard shows, computed the same way (same data source, same recovery and inventory rules).
- Add the new items the team listed: losses by division, sold per day calendar, top 10 brand/series, inventory KPIs, top 10 loss units filtered to ₱300K and up.
- Works on a phone (the sidebar becomes a row of tabs at the top) and in light and dark mode.

## Non-goals
- No change to the Google Sheet, the Power Automate flow or `config.js`.
- No sign-in, no Export CSV, no "live feed" or insight boxes (these were in the preview but aren't in the list).

## Anti-goals
- Numbers that no longer match the Excel workbook.
- Sample or made-up figures on the live site.

## Approaches considered
1. **Sidebar menus in one page (picked).** `index.html` holds all 5 menus and the sidebar switches between them, with the menu kept in the URL (`#sales`, `#losses`…) so links and refresh keep your place. The FMV generator moves in as a menu and `fmv.html` redirects to `index.html#fmv`.
2. **One HTML page per menu.** Simpler per page, but each click reloads and re-downloads the data.
3. **Restyle the current long page only.** Cheapest, but it doesn't give the menus the team asked for.

## What goes in each menu (as the team specified)

**Overview**
- KPIs: Total sales (vs last month, vs same month 2025), Total units sold (same), Recovery rate (vs last month, vs 83% target), Total gain/(loss) (vs last month, vs same month 2025), Total inventory (vs last month, vs 360 target).
- Monthly sales, 2026 vs 2025: line chart.
- Units sold, 2026 vs 2025: vertical bar chart.
- Top 5 product types sold.
- Sold by division: donut.

**Sales**
- Sold by sales associate: every associate, sorted highest to lowest (PINNACLE left out, as today).
- KPI row: empty placeholder cards for now.
- Sold per day: a calendar of the picked month showing workdays only (Mon–Fri), units sold each day, and the daily average.

**Losses**
- Sold by unit condition: donut, with count, % of units and total loss per condition.
- Non-starter accounts by division.
- Losses by product type and losses by division: units sold, sold amount, total loss and % of the net loss, with those columns highlighted.
- Top 10 loss units: only units with a loss of ₱300K or more.
- Top 10 sold by brand/series: ranked by units sold, highest first (the team's choice, since the data has no loss per brand).

**Inventory**
- KPIs: On-hand inventory (vs last month, vs 360 target), Under legal (vs last month), For sale (vs last month).
- Total breakdown inventories table, vs last month (the current table).

**FMV generator**
- The current FMV generator, unchanged in how it works, restyled to match.

## Data sources
- Everything except two items comes from the published Google Sheet, as now.
- **Sold per day** and **Top 10 brand/series** come from `fmv-data.xlsx` (it has DATE SOLD, BRAND and SERIES for each sold unit; currently through Nov 12, 2026). These only update when someone replaces that file, so both cards show "Data through <latest date>".
- The current disposal costs table isn't in the team's list; it will be kept at the bottom of Losses unless the team says to drop it.

## Builder's calls (marked so the team can check them)
- Workdays are Monday to Friday. Philippine holidays are not taken out.
- Daily average = units sold in the month ÷ workdays in the month so far (whole month for past months).
- "Under legal" and "For sale" are matched to inventory status names that contain LEGAL and FOR SALE. If the sheet uses other names, they'll be mapped once the real names are seen.
- Light mode keeps a navy sidebar and a light content area. Dark mode matches the preview.
- Sold per day counts every row in `fmv-data.xlsx` that has a DATE SOLD (not the FMV estimator's cleaned rows). Weekend sales aren't hidden: they're added to the Friday before, and the card says how many were. The card notes that its count comes from the sales file and can differ slightly from the sheet's Total units sold.
- Brand/series groups by BRAND + MODEL (e.g. "TOYOTA VIOS"), since the SERIES column is messy free text (571 variations against 244 models). Brand and model names are cleaned the same way the FMV estimator cleans them.
- "Total loss" on the Losses menu is net gain/(loss), and "% of distribution" is each group's share of the net loss, as in today's tables and the workbook.
- Month buttons come from the sheet, as the month picker does today. For a month the sales file doesn't cover, the two cards that use it say "No daily data for this month".
- Top 10 loss units uses the 10 biggest losses per month already in the export, filtered to ₱300K and up. If more than 10 units lose ₱300K+, only the export's 10 can be shown.
