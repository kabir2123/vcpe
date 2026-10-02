# Portfolio Dashboard

Next.js, TypeScript, and Tailwind portfolio dashboard built for the interview assignment. It shows sector-level and holding-level investment, current value, gain/loss, portfolio weight, and live-data source status.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open the local URL printed by Next.js:

   ```text
   http://127.0.0.1:3002
   ```

## Useful Commands

```bash
npm run lint
npm run build
```

## Data Notes

Holdings are defined in `src/data/portfolio.ts`. Each holding stores its exchange explicitly:

- `NSE` holdings use Yahoo symbols like `HDFCBANK.NS` and Google Finance symbols like `HDFCBANK:NSE`.
- `BSE` holdings use Yahoo symbols like `500400.BO` and Google Finance symbols like `500400:BOM`.

Live CMP values use Yahoo Finance first, with Google Finance as a visible fallback when Yahoo is unavailable. P/E and latest earnings are scraped server-side from Google Finance. If a provider fails or omits a value, the dashboard falls back to the spreadsheet value and labels the cell as `Sheet`.
