import type { Holding } from "@/data/portfolio";
import type { EnrichedHolding, LiveFinancialData, PortfolioSummary, SectorSummary } from "@/lib/types";

export function calculateInvestment(holding: Pick<Holding, "purchasePrice" | "quantity">) {
  return holding.purchasePrice * holding.quantity;
}

export function calculatePresentValue(cmp: number | null, quantity: number) {
  return cmp === null ? null : cmp * quantity;
}

export function calculateGainLoss(presentValue: number | null, investment: number) {
  return presentValue === null ? null : presentValue - investment;
}

export function calculateGainLossPercent(gainLoss: number | null, investment: number) {
  if (gainLoss === null || investment === 0) {
    return null;
  }

  return (gainLoss / investment) * 100;
}

function adjustedPurchasePrice(holding: Pick<Holding, "purchasePrice" | "adjustmentFactor">) {
  return holding.purchasePrice / (holding.adjustmentFactor ?? 1);
}

function adjustedQuantity(holding: Pick<Holding, "quantity" | "adjustmentFactor">) {
  return holding.quantity * (holding.adjustmentFactor ?? 1);
}

export function enrichHoldings(holdings: Holding[], liveData: Map<string, LiveFinancialData>) {
  const totalInvestment = holdings.reduce((sum, holding) => {
    const purchasePrice = adjustedPurchasePrice(holding);
    const quantity = adjustedQuantity(holding);
    return sum + calculateInvestment({ purchasePrice, quantity });
  }, 0);

  return holdings.map((holding): EnrichedHolding => {
    const live = liveData.get(holding.id);
    const purchasePrice = adjustedPurchasePrice(holding);
    const quantity = adjustedQuantity(holding);
    const investment = calculateInvestment({ purchasePrice, quantity });
    const cmp = live?.cmp ?? holding.spreadsheetCmp;
    const presentValue = calculatePresentValue(cmp, quantity);
    const gainLoss = calculateGainLoss(presentValue, investment);
    const gainLossPercent = calculateGainLossPercent(gainLoss, investment);

    return {
      ...holding,
      purchasePrice,
      quantity,
      investment,
      portfolioPercent: totalInvestment === 0 ? 0 : (investment / totalInvestment) * 100,
      cmp,
      cmpSource: live?.cmpSource ?? (holding.spreadsheetCmp === null ? "unavailable" : "spreadsheet"),
      cmpProvider: live?.cmpProvider,
      peRatio: live?.peRatio ?? holding.spreadsheetPe,
      peSource: live?.peSource ?? (holding.spreadsheetPe === null ? "unavailable" : "spreadsheet"),
      peProvider: live?.peProvider,
      latestEarnings: live?.latestEarnings ?? holding.spreadsheetLatestEarnings,
      earningsSource: live?.earningsSource ?? (holding.spreadsheetLatestEarnings === null ? "unavailable" : "spreadsheet"),
      earningsProvider: live?.earningsProvider,
      presentValue,
      gainLoss,
      gainLossPercent,
      liveSymbol: live?.symbol ?? holding.exchangeCode,
      liveMessage: live?.message
    };
  });
}

export function summarizeHoldings(holdings: EnrichedHolding[]): PortfolioSummary {
  const totalInvestment = holdings.reduce((sum, holding) => sum + holding.investment, 0);
  const totalPresentValue = holdings.reduce((sum, holding) => sum + (holding.presentValue ?? 0), 0);
  const gainLoss = totalPresentValue - totalInvestment;

  return {
    totalInvestment,
    totalPresentValue,
    gainLoss,
    gainLossPercent: totalInvestment === 0 ? 0 : (gainLoss / totalInvestment) * 100
  };
}

export function groupBySector(holdings: EnrichedHolding[]) {
  const totalInvestment = holdings.reduce((sum, holding) => sum + holding.investment, 0);
  const sectors = new Map<string, EnrichedHolding[]>();

  for (const holding of holdings) {
    const current = sectors.get(holding.sector) ?? [];
    current.push(holding);
    sectors.set(holding.sector, current);
  }

  return Array.from(sectors.entries()).map(([sector, sectorHoldings]): SectorSummary => {
    const summary = summarizeHoldings(sectorHoldings);

    return {
      sector,
      holdings: sectorHoldings,
      ...summary,
      portfolioPercent: totalInvestment === 0 ? 0 : (summary.totalInvestment / totalInvestment) * 100,
      liveCount: sectorHoldings.filter((holding) => holding.cmpSource === "live").length,
      totalCount: sectorHoldings.length
    };
  });
}
