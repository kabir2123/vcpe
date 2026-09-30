import { NextResponse } from "next/server";
import { portfolioHoldings } from "@/data/portfolio";
import { enrichHoldings, groupBySector, summarizeHoldings } from "@/lib/calculations";
import { fetchFinancialData } from "@/lib/financialProviders";
import type { LiveFinancialData, PortfolioResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

function createPortfolioResponse(liveData = new Map<string, LiveFinancialData>(), warnings: string[] = []): PortfolioResponse {
  const holdings = enrichHoldings(portfolioHoldings, liveData);
  const sectors = groupBySector(holdings);
  const summary = summarizeHoldings(holdings);
  const hasLive = holdings.some((holding) => holding.cmpSource === "live" || holding.peSource === "live" || holding.earningsSource === "live");
  const hasFallback = holdings.some((holding) => holding.cmpSource !== "live" || holding.peSource !== "live" || holding.earningsSource !== "live");
  const liveStatus = hasLive && hasFallback ? "partial" : hasLive ? "live" : "fallback";

  return {
    holdings,
    sectors,
    summary,
    lastUpdated: new Date().toISOString(),
    liveStatus,
    warnings
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get("source") === "sheet") {
      return NextResponse.json(createPortfolioResponse());
    }

    const { liveData, warnings } = await fetchFinancialData(portfolioHoldings);
    return NextResponse.json(createPortfolioResponse(liveData, warnings));
  } catch {
    return NextResponse.json({ error: "Portfolio data is temporarily unavailable" }, { status: 503 });
  }
}
