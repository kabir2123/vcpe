# Technical Write-Up

## Overview

I built a portfolio dashboard with Next.js, TypeScript, Tailwind, TanStack React Table, and Recharts. The holdings start from the spreadsheet data in `src/data/portfolio.ts`, a server-side API route enriches those holdings with market data and fundamentals, and the client renders the dashboard with a sheet-backed first load followed by live refreshes.

The data flow is intentionally simple. The browser first asks `/api/portfolio?source=sheet` so the page opens quickly, then it refreshes `/api/portfolio` after 2 seconds and polls every 60 seconds. The API route calculates investment, current value, gain/loss, sector summaries, and source labels before sending one response to the client.

## Yahoo Finance Returned 429

The first issue I found was that Yahoo Finance was not reliably returning CMP values. I tested the Yahoo chart endpoint directly for both `HDFCBANK.NS` and `532174.BO`, and both returned HTTP `429 Too Many Requests` with the body `Edge: Too Many Requests`. That ruled out the simple theory that the NSE/BSE suffixes were wrong.

I tried the practical fixes first: explicit `.NS` and `.BO` symbols, browser-like request headers, waiting between requests, and then batching. The chart endpoint could not be batched, so I switched the Yahoo path to a single quote request for all portfolio symbols. Yahoo is still the primary CMP source in the code, but when it fails the fallback order is Google current price, then spreadsheet value. Every CMP cell shows the actual source tag: `Yahoo`, `Google`, `Sheet`, or `N/A`, and the warning banner lists the fallbacks that happened.

In production I would not depend on scraped or unofficial public endpoints for this. I would use a licensed market-data API or a broker/feed integration with clear rate-limit terms, retries, and observability.

## Rate Limits And Request Volume

I reduced request volume in a few places. Yahoo prices are requested in one batch, not one request per holding. The server keeps a 15 second cache for the full portfolio response, a 14 second per-symbol cache for Yahoo prices, and a 6 hour cache for Google P/E and earnings because fundamentals barely move intraday.

If Yahoo returns `429`, the code records a blocked-until time for 120 seconds, or longer if Yahoo sends a larger `Retry-After` value. During that window it does not call Yahoo again and serves Google or sheet values instead. Overlapping `/api/portfolio` requests share the same pending promise, so two browser tabs or refreshes do not start two upstream fetches. Individual provider calls use a 5 second timeout, and the enrichment uses `Promise.allSettled` so one failed stock does not fail the whole dashboard.

I did not add a Google concurrency limiter in this version. Google requests are cached for hours and failures are handled per holding, but a production version should add a small concurrency pool.

## NSE And BSE Symbols

The sheet mixes NSE tickers such as `HDFCBANK` with numeric BSE codes such as `532174`. I added an explicit `exchange` field to every holding, so Yahoo symbols are built as `.NS` or `.BO`, while Google symbols are built as `:NSE` or `:BOM`. The table also shows the code and exchange together so the source symbol is visible.

Tata Consumer was a data-quality issue. The sheet had `532540`, but that code produced a price far away from the sheet’s own CMP because `532540` belongs to Tata Consultancy Services. Tata Consumer lists BSE stock code `500800`, so I corrected that holding to `500800`.

## Split And Bonus Adjustments

This was the biggest portfolio accuracy issue. Some workbook prices and quantities were on a pre-corporate-action basis, while live prices were on the post-action basis. That made Bajaj Finance, HDFC Bank, and Pidilite look like large losses even though the position math was being compared across different share counts.

Bajaj Finance had a 1:2 split together with a 4:1 bonus, with a 16 June 2025 record date, so the share count rose tenfold. HDFC Bank had a 1:1 bonus around the 27 August 2025 record date, doubling the shares. Pidilite had a 1:1 bonus with a 23 September 2025 record date, also doubling the shares.

I fixed this with an optional `adjustmentFactor` on a holding. Bajaj Finance uses `10`, HDFC Bank uses `2`, and Pidilite uses `2`. During enrichment, I divide purchase price by the factor and multiply quantity by the factor. Investment stays unchanged because the two changes cancel out, but current value and gain/loss are now on the same basis as live CMP.

After the change, the adjusted display values are:

| Stock | Purchase price | Quantity |
| --- | ---: | ---: |
| Bajaj Finance | ₹646.60 | 150 |
| HDFC Bank | ₹745.00 | 100 |
| Pidilite | ₹1,188.00 | 72 |

On my final live check, the portfolio moved from a misleading loss to about `+₹1.20 lakh`, or `+7.77%`. Financials moved to about `+17.10%`. I also checked other large movers such as KPIT Tech and Gensol. They did not match this clean split/bonus mismatch pattern; Gensol still looked like a real price drop, while KPIT did not need a corporate-action adjustment.

## Data-Quality Handling

I kept imperfect data visible instead of hiding it. Savani’s P/E is missing in the sheet, so the dashboard shows unavailable values where there is no usable source. LTI Mindtree can fall back to sheet values when both providers miss. Gensol can show a live price next to sheet fundamentals, which is risky if the sheet P/E is stale, so sheet-sourced P/E and earnings are tagged in amber.

The sector rows show `X of Y live`, where live means live CMP availability. This makes it clear when a sector has live prices but still has mixed or fallback fundamentals.

## UI Decisions

The holdings view uses one fixed-layout table so the header, holding rows, and sector rows share the same column widths. Sector totals sit in their real columns instead of inside a nested grid, which keeps Investment, Weight, Present Value, Gain/Loss, Return, P/E, and Earnings aligned.

I removed the inner vertical scroll so the page scrolls as one document. The table uses tighter padding and smaller body text so the Earnings column fits on desktop. The Code column shows the code on one line and the exchange as a small label underneath. I also added a `Market open` / `Market closed` label based on Indian market hours, 9:15 AM to 3:30 PM IST on weekdays, so reviewers know why prices may not be moving.

## Known Limitations

The current data sources are unofficial and can be throttled, blocked, or changed without notice. In my local testing, Yahoo still returned no usable live CMP values from this IP after repeated `429` responses, so the app used Google and sheet fallbacks while labeling them clearly.

The server cache is in memory, so it will reset on process restart and may not behave the same way on serverless hosting. Deployed behavior can also differ from local behavior because Yahoo and Google may treat cloud IPs differently. A production version should use a licensed market-data provider, persistent caching, structured logs for provider failures, and a clear refresh policy matched to exchange hours.
