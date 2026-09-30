import type { Holding } from "@/data/portfolio";

export type LiveFieldSource = "live" | "spreadsheet" | "unavailable";
export type LiveProvider = "Yahoo" | "Google";

export type LiveFinancialData = {
  cmp: number | null;
  peRatio: number | null;
  latestEarnings: number | null;
  cmpSource: LiveFieldSource;
  cmpProvider?: LiveProvider;
  peSource: LiveFieldSource;
  peProvider?: LiveProvider;
  earningsSource: LiveFieldSource;
  earningsProvider?: LiveProvider;
  symbol: string;
  message?: string;
};

export type EnrichedHolding = Holding & {
  investment: number;
  portfolioPercent: number;
  cmp: number | null;
  cmpSource: LiveFieldSource;
  cmpProvider?: LiveProvider;
  peRatio: number | null;
  peSource: LiveFieldSource;
  peProvider?: LiveProvider;
  latestEarnings: number | null;
  earningsSource: LiveFieldSource;
  earningsProvider?: LiveProvider;
  presentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  liveSymbol: string;
  liveMessage?: string;
};

export type PortfolioSummary = {
  totalInvestment: number;
  totalPresentValue: number;
  gainLoss: number;
  gainLossPercent: number;
};

export type SectorSummary = PortfolioSummary & {
  sector: string;
  holdings: EnrichedHolding[];
  portfolioPercent: number;
  liveCount: number;
  totalCount: number;
};

export type PortfolioResponse = {
  holdings: EnrichedHolding[];
  sectors: SectorSummary[];
  summary: PortfolioSummary;
  lastUpdated: string;
  liveStatus: "live" | "partial" | "fallback";
  warnings: string[];
};
