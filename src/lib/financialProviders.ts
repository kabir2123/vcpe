import type { Holding } from "@/data/portfolio";
import type { LiveFinancialData } from "@/lib/types";

type CacheEntry = {
  expiresAt: number;
  data: LiveFinancialData;
};

const cache = new Map<string, CacheEntry>();
const cacheDurationMs = 14000;
const requestTimeoutMs = 5000;

function resolveYahooSymbol(exchangeCode: string) {
  if (/^\d+$/.test(exchangeCode)) {
    return `${exchangeCode}.BO`;
  }

  return `${exchangeCode}.NS`;
}

function resolveGoogleSymbol(exchangeCode: string) {
  if (/^\d+$/.test(exchangeCode)) {
    return `BOM:${exchangeCode}`;
  }

  return `NSE:${exchangeCode}`;
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0"
      },
      cache: "no-store"
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYahooCmp(symbol: string) {
  const response = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`);

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice ?? result?.meta?.previousClose;

  if (typeof price !== "number" || Number.isNaN(price)) {
    throw new Error("Yahoo Finance response did not include a valid price");
  }

  return price;
}

function extractGoogleNumber(html: string, labels: string[]) {
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escapedLabel}[\\s\\S]{0,240}?([-+]?\\d+(?:,\\d{2,3})*(?:\\.\\d+)?)`, "i");
    const match = html.match(pattern);
    const value = match?.[1]?.replace(/,/g, "");

    if (value) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

async function fetchGoogleFundamentals(symbol: string) {
  const response = await fetchWithTimeout(`https://www.google.com/finance/quote/${encodeURIComponent(symbol)}`);

  if (!response.ok) {
    throw new Error(`Google Finance returned ${response.status}`);
  }

  const html = await response.text();

  return {
    peRatio: extractGoogleNumber(html, ["P/E ratio", "P/E"]),
    latestEarnings: extractGoogleNumber(html, ["Earnings per share", "EPS"])
  };
}

async function fetchLiveHoldingData(holding: Holding): Promise<LiveFinancialData> {
  const cached = cache.get(holding.id);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const yahooSymbol = resolveYahooSymbol(holding.exchangeCode);
  const googleSymbol = resolveGoogleSymbol(holding.exchangeCode);
  const yahooResult = await Promise.allSettled([fetchYahooCmp(yahooSymbol)]);
  const googleResult = await Promise.allSettled([fetchGoogleFundamentals(googleSymbol)]);
  const cmp = yahooResult[0].status === "fulfilled" ? yahooResult[0].value : holding.spreadsheetCmp;
  const googleData = googleResult[0].status === "fulfilled" ? googleResult[0].value : null;
  const peRatio = googleData?.peRatio ?? holding.spreadsheetPe;
  const latestEarnings = googleData?.latestEarnings ?? holding.spreadsheetLatestEarnings;
  const failures = [
    yahooResult[0].status === "rejected" ? "Yahoo CMP unavailable" : null,
    googleResult[0].status === "rejected" ? "Google fundamentals unavailable" : null,
    googleData && googleData.peRatio === null ? "Google P/E missing" : null,
    googleData && googleData.latestEarnings === null ? "Google earnings missing" : null
  ].filter(Boolean);

  const data: LiveFinancialData = {
    cmp,
    peRatio,
    latestEarnings,
    cmpSource: yahooResult[0].status === "fulfilled" ? "live" : holding.spreadsheetCmp === null ? "unavailable" : "spreadsheet",
    peSource: googleData?.peRatio !== null && googleData?.peRatio !== undefined ? "live" : holding.spreadsheetPe === null ? "unavailable" : "spreadsheet",
    earningsSource: googleData?.latestEarnings !== null && googleData?.latestEarnings !== undefined ? "live" : holding.spreadsheetLatestEarnings === null ? "unavailable" : "spreadsheet",
    symbol: yahooSymbol,
    message: failures.length > 0 ? failures.join(", ") : undefined
  };

  cache.set(holding.id, {
    expiresAt: Date.now() + cacheDurationMs,
    data
  });

  return data;
}

export async function fetchFinancialData(holdings: Holding[]) {
  const results = await Promise.allSettled(holdings.map(fetchLiveHoldingData));
  const liveData = new Map<string, LiveFinancialData>();
  const warnings: string[] = [];

  for (let index = 0; index < holdings.length; index += 1) {
    const result = results[index];
    const holding = holdings[index];

    if (result.status === "fulfilled") {
      liveData.set(holding.id, result.value);

      if (result.value.message) {
        warnings.push(`${holding.particulars}: ${result.value.message}`);
      }
    } else {
      liveData.set(holding.id, {
        cmp: holding.spreadsheetCmp,
        peRatio: holding.spreadsheetPe,
        latestEarnings: holding.spreadsheetLatestEarnings,
        cmpSource: holding.spreadsheetCmp === null ? "unavailable" : "spreadsheet",
        peSource: holding.spreadsheetPe === null ? "unavailable" : "spreadsheet",
        earningsSource: holding.spreadsheetLatestEarnings === null ? "unavailable" : "spreadsheet",
        symbol: resolveYahooSymbol(holding.exchangeCode),
        message: "Financial provider request failed"
      });
      warnings.push(`${holding.particulars}: financial provider request failed`);
    }
  }

  return { liveData, warnings };
}
