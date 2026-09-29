import { NextResponse } from "next/server";
import { portfolioHoldings } from "@/data/portfolio";
import { enrichHoldings, groupBySector, summarizeHoldings } from "@/lib/calculations";
import { fetchFinancialData } from "@/lib/financialProviders";
import type { PortfolioResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { liveData, warnings } = await fetchFinancialData(portfolioHoldings);
    const holdings = enrichHoldings(portfolioHoldings, liveData);
    const sectors = groupBySector(holdings);
    const summary = summarizeHoldings(holdings);
    const hasLive = holdings.some((holding) => holding.cmpSource === "live" || holding.peSource === "live" || holding.earningsSource === "live");
    const hasFallback = holdings.some((holding) => holding.cmpSource !== "live" || holding.peSource !== "live" || holding.earningsSource !== "live");
    const liveStatus = hasLive && hasFallback ? "partial" : hasLive ? "live" : "fallback";
    const response: PortfolioResponse = {
      holdings,
      sectors,
      summary,
      lastUpdated: new Date().toISOString(),
      liveStatus,
      warnings
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: "Portfolio data is temporarily unavailable" }, { status: 503 });
  }
}
