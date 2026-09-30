import * as cheerio from "cheerio";
import type { Holding } from "@/data/portfolio";
import type { LiveFinancialData } from "@/lib/types";

type CachedValue<T> = {
  expiresAt: number;
  data: T;
};

type GoogleFundamentals = {
  currentPrice: number | null;
  peRatio: number | null;
  latestEarnings: number | null;
};

type FinancialDataResult = {
  liveData: Map<string, LiveFinancialData>;
  warnings: string[];
};

const priceCache = new Map<string, CachedValue<number>>();
const failedPriceCache = new Map<string, CachedValue<string>>();
const fundamentalsCache = new Map<string, CachedValue<GoogleFundamentals>>();
const priceCacheDurationMs = 14_000;
const failedPriceCacheDurationMs = 120_000;
const fundamentalsCacheDurationMs = 6 * 60 * 60 * 1000;
const financialDataCacheDurationMs = 15_000;
const requestTimeoutMs = 5000;
let yahooBlockedUntil = 0;
let pendingYahooBatch: Promise<void> | null = null;
let pendingFinancialData: Promise<FinancialDataResult> | null = null;
let financialDataCache: CachedValue<FinancialDataResult> | null = null;

function resolveYahooSymbol(holding: Pick<Holding, "exchange" | "exchangeCode">) {
  const suffix = holding.exchange === "BSE" ? "BO" : "NS";
  return `${holding.exchangeCode}.${suffix}`;
}

function resolveGoogleSymbol(holding: Pick<Holding, "exchange" | "exchangeCode">) {
  const exchange = holding.exchange === "BSE" ? "BOM" : "NSE";
  return `${holding.exchangeCode}:${exchange}`;
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      },
      cache: "no-store"
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getCachedValue<T>(cache: Map<string, CachedValue<T>>, key: string) {
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  if (cached) {
    cache.delete(key);
  }

  return null;
}

function setCachedValue<T>(cache: Map<string, CachedValue<T>>, key: string, data: T, durationMs: number) {
  cache.set(key, {
    expiresAt: Date.now() + durationMs,
    data
  });
}

async function fetchYahooCmp(symbol: string) {
  const cached = getCachedValue(priceCache, symbol);

  if (cached !== null) {
    return cached;
  }

  const cachedFailure = getCachedValue(failedPriceCache, symbol);

  if (cachedFailure !== null) {
    throw new Error(cachedFailure);
  }

  throw new Error("Yahoo CMP unavailable from batch cache");
}

function getRetryAfterMs(response: Response) {
  const retryAfter = response.headers.get("retry-after");

  if (!retryAfter) {
    return failedPriceCacheDurationMs;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds)) {
    return Math.max(seconds * 1000, failedPriceCacheDurationMs);
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isNaN(retryAt) ? failedPriceCacheDurationMs : Math.max(retryAt - Date.now(), failedPriceCacheDurationMs);
}

async function fetchYahooCmpBatch(symbols: string[]) {
  const uniqueSymbols = Array.from(new Set(symbols));
  const symbolsToFetch = uniqueSymbols.filter((symbol) => getCachedValue(priceCache, symbol) === null && getCachedValue(failedPriceCache, symbol) === null);

  if (symbolsToFetch.length === 0) {
    return;
  }

  if (Date.now() < yahooBlockedUntil) {
    const message = "Yahoo Finance temporarily blocked after rate limiting";
    for (const symbol of symbolsToFetch) {
      setCachedValue(failedPriceCache, symbol, message, yahooBlockedUntil - Date.now());
    }
    return;
  }

  if (pendingYahooBatch) {
    return pendingYahooBatch;
  }

  pendingYahooBatch = (async () => {
    console.info(`[finance] Yahoo upstream quote batch: ${symbolsToFetch.length} symbols`);
    const response = await fetchWithTimeout(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsToFetch.map(encodeURIComponent).join(",")}`);

    if (!response.ok) {
      const backoffMs = response.status === 429 ? getRetryAfterMs(response) : failedPriceCacheDurationMs;
      const message = response.status === 429 ? "Yahoo Finance rate limited the request" : `Yahoo Finance returned ${response.status}`;

      if (response.status === 429) {
        yahooBlockedUntil = Date.now() + backoffMs;
      }

      for (const symbol of symbolsToFetch) {
        setCachedValue(failedPriceCache, symbol, message, backoffMs);
      }

      return;
    }

    const payload = await response.json();
    const quotes = Array.isArray(payload?.quoteResponse?.result) ? payload.quoteResponse.result : [];
    const seenSymbols = new Set<string>();

    for (const quote of quotes) {
      const symbol = quote?.symbol;
      const price = quote?.regularMarketPrice ?? quote?.postMarketPrice ?? quote?.preMarketPrice;

      if (typeof symbol !== "string") {
        continue;
      }

      seenSymbols.add(symbol);

      if (typeof price === "number" && Number.isFinite(price)) {
        setCachedValue(priceCache, symbol, price, priceCacheDurationMs);
      } else {
        setCachedValue(failedPriceCache, symbol, "Yahoo Finance response did not include a valid price", failedPriceCacheDurationMs);
      }
    }

    for (const symbol of symbolsToFetch) {
      if (!seenSymbols.has(symbol)) {
        setCachedValue(failedPriceCache, symbol, "Yahoo Finance did not return this symbol", failedPriceCacheDurationMs);
      }
    }
  })().finally(() => {
    pendingYahooBatch = null;
  });

  return pendingYahooBatch;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseFinancialNumber(value: string) {
  const normalized = value.replace(/,/g, "").replace(/[₹$]/g, "");
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);

  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractGoogleCurrentPrice(html: string) {
  const $ = cheerio.load(html);
  const currencyPattern = /^₹\s?[\d,.]+$/;
  const candidates = $("div,span")
    .toArray()
    .map((element) => {
      const text = $(element).text().trim();

      if (!currencyPattern.test(text)) {
        return null;
      }

      return {
        text,
        parentText: normalizeText($(element).parent().text())
      };
    })
    .filter((candidate): candidate is { text: string; parentText: string } => candidate !== null);
  const todayPrice = candidates.find((candidate) => candidate.parentText.includes("today"));
  const parsed = parseFinancialNumber((todayPrice ?? candidates[0])?.text ?? "");

  return parsed;
}

function extractGoogleNumber(html: string, labels: string[]) {
  const $ = cheerio.load(html);
  const normalizedLabels = labels.map(normalizeText);

  for (const element of $("div,span").toArray()) {
    const labelText = normalizeText($(element).text());
    const matchedLabel = normalizedLabels.find((label) => labelText === label);

    if (!matchedLabel) {
      continue;
    }

    const siblings = $(element)
      .parent()
      .children()
      .toArray()
      .filter((candidate) => candidate !== element)
      .map((candidate) => $(candidate).text());

    for (const text of siblings) {
      const parsed = parseFinancialNumber(text);

      if (parsed !== null) {
        return parsed;
      }
    }

    const parentText = $(element).parent().text();
    const parsed = parseFinancialNumber(parentText.replace($(element).text(), ""));

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

async function fetchGoogleFundamentals(symbol: string) {
  const cached = getCachedValue(fundamentalsCache, symbol);

  if (cached !== null) {
    return cached;
  }

  const response = await fetchWithTimeout(`https://www.google.com/finance/quote/${symbol}`);

  if (!response.ok) {
    throw new Error(`Google Finance returned ${response.status}`);
  }

  const html = await response.text();
  const data = {
    currentPrice: extractGoogleCurrentPrice(html),
    peRatio: extractGoogleNumber(html, ["P/E ratio", "P/E"]),
    latestEarnings: extractGoogleNumber(html, ["Earnings per share", "EPS"])
  };

  setCachedValue(fundamentalsCache, symbol, data, fundamentalsCacheDurationMs);
  return data;
}

async function fetchLiveHoldingData(holding: Holding): Promise<LiveFinancialData> {
  const yahooSymbol = resolveYahooSymbol(holding);
  const googleSymbol = resolveGoogleSymbol(holding);
  const [yahooResult, googleResult] = await Promise.allSettled([
    fetchYahooCmp(yahooSymbol),
    fetchGoogleFundamentals(googleSymbol)
  ]);
  const googleData = googleResult.status === "fulfilled" ? googleResult.value : null;
  const hasGoogleCmp = googleData?.currentPrice !== null && googleData?.currentPrice !== undefined;
  const cmp = yahooResult.status === "fulfilled" ? yahooResult.value : hasGoogleCmp ? googleData.currentPrice : holding.spreadsheetCmp;
  const peRatio = googleData?.peRatio ?? holding.spreadsheetPe;
  const latestEarnings = googleData?.latestEarnings ?? holding.spreadsheetLatestEarnings;
  const yahooMessage = yahooResult.status === "rejected" ? yahooResult.reason instanceof Error ? yahooResult.reason.message : "Yahoo CMP unavailable" : null;
  const googleMessage = googleResult.status === "rejected" ? googleResult.reason instanceof Error ? googleResult.reason.message : "Google fundamentals unavailable" : null;
  const failures = [
    yahooMessage && !hasGoogleCmp ? yahooMessage : null,
    googleMessage,
    yahooMessage && hasGoogleCmp ? "Yahoo CMP unavailable; Google CMP fallback used" : null,
    googleData && googleData.peRatio === null ? "Google P/E missing" : null,
    googleData && googleData.latestEarnings === null ? "Google earnings missing" : null
  ].filter(Boolean);

  return {
    cmp,
    peRatio,
    latestEarnings,
    cmpSource: yahooResult.status === "fulfilled" || hasGoogleCmp ? "live" : holding.spreadsheetCmp === null ? "unavailable" : "spreadsheet",
    cmpProvider: yahooResult.status === "fulfilled" ? "Yahoo" : hasGoogleCmp ? "Google" : undefined,
    peSource: googleData?.peRatio !== null && googleData?.peRatio !== undefined ? "live" : holding.spreadsheetPe === null ? "unavailable" : "spreadsheet",
    peProvider: googleData?.peRatio !== null && googleData?.peRatio !== undefined ? "Google" : undefined,
    earningsSource: googleData?.latestEarnings !== null && googleData?.latestEarnings !== undefined ? "live" : holding.spreadsheetLatestEarnings === null ? "unavailable" : "spreadsheet",
    earningsProvider: googleData?.latestEarnings !== null && googleData?.latestEarnings !== undefined ? "Google" : undefined,
    symbol: yahooSymbol,
    message: failures.length > 0 ? failures.join(", ") : undefined
  };
}

export async function fetchFinancialData(holdings: Holding[]) {
  if (financialDataCache && financialDataCache.expiresAt > Date.now()) {
    return financialDataCache.data;
  }

  if (pendingFinancialData) {
    return pendingFinancialData;
  }

  pendingFinancialData = (async () => {
    await fetchYahooCmpBatch(holdings.map((holding) => resolveYahooSymbol(holding)));

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
          symbol: resolveYahooSymbol(holding),
          message: "Financial provider request failed"
        });
        warnings.push(`${holding.particulars}: financial provider request failed`);
      }
    }

    const result = { liveData, warnings };
    financialDataCache = {
      expiresAt: Date.now() + financialDataCacheDurationMs,
      data: result
    };

    return result;
  })().finally(() => {
    pendingFinancialData = null;
  });

  return pendingFinancialData;
}
