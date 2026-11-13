# FMV generator: market reference from a manual market-price sheet

## Intent
The FMV estimate uses only past ROPA sales. The team wants to see online market prices next to it. No Philippine listing site offers a data API, and Carmudi's terms forbid bulk copying (see the research in the conversation), so prices are recorded by hand once a month and shown as a reference beside the ROPA estimate. The estimate itself does not change.

Visual reference: the preview shown to the team (manual market-price sheet, Parts 1–3).

## Goals
- A file `market-prices.xlsx` (first sheet) next to `index.html`, one row per listing checked, with the columns from the preview.
- In the FMV generator, after an estimate: a "Market reference" card with the asking-price range for bank repo listings and for regular used listings, the number of listings, where the ROPA estimate sits, and how it compares ("about 81% of the bank repo asking price").

## Non-goals
- No automatic collection from listing sites.
- The ROPA estimate is not adjusted by market prices.

## Anti-goals
- Example or made-up prices on the live site. The repo gets a template file with the header row only.

## Approaches
1. **Separate `market-prices.xlsx` (picked).** The team updates it on its own schedule without touching the sales file.
2. A second tab in `fmv-data.xlsx`. One file, but it has to be rebuilt every time the sales file is exported.
3. A tab in the published Google Sheet. Would need Power Automate changes.

## Decisions (builder's calls, for the team to check)
- Columns read (row 1, case-insensitive): MONTH, BRAND, MODEL, YEAR MODEL, LISTING TYPE, ASKING PRICE are required; TRANSMISSION, MILEAGE, SOURCE, LINK, CHECKED BY are optional and kept but not used in the numbers.
- MONTH accepts `2026-11`, a date, or an Excel date. Rows older than the last 3 months (current month and the 2 before) are ignored.
- LISTING TYPE: containing "REPO" → Bank repo; anything else → Regular used.
- Matching: brand and model cleaned the same way the FMV estimator cleans them (`cleanBrand`, `modelOf`), same year model. If no listing has that exact year, listings within ±1 year are used and the card says so.
- Range = lowest to highest asking price; comparison uses the median asking price.
- If the file is missing or has no matching rows: "No market prices recorded yet for this model." The FMV generator works as before.
