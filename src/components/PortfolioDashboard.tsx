"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EnrichedHolding, LiveProvider, PortfolioResponse, SectorSummary } from "@/lib/types";
import { formatMoney, formatNumber, formatPercent, formatTime, formatUnsignedPercent } from "@/lib/format";

type SortKey = "particulars" | "investment" | "presentValue" | "gainLoss" | "gainLossPercent" | "portfolioPercent";
type SortDirection = "asc" | "desc";

const holdingTableFeatures = tableFeatures({});
const holdingColumnHelper = createColumnHelper<typeof holdingTableFeatures, EnrichedHolding>();

const sortLabels: Record<SortKey, string> = {
  particulars: "Stock",
  investment: "Investment",
  presentValue: "Present Value",
  gainLoss: "Gain/Loss",
  gainLossPercent: "Return",
  portfolioPercent: "Weight"
};
const liveRefreshTimeoutMs = 8000;
const leftAlignedColumnIndexes = new Set([0, 5]);
const sectorSummaryColumnIndexes = {
  investment: 3,
  weight: 4,
  presentValue: 7,
  gainLoss: 8
};

async function fetchPortfolio(url: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), liveRefreshTimeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Portfolio refresh failed");
    }

    return await response.json() as PortfolioResponse;
  } finally {
    window.clearTimeout(timeout);
  }
}

function signedClass(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "text-slate-600";
  }

  if (value > 0) {
    return "text-emerald-700";
  }

  if (value < 0) {
    return "text-red-700";
  }

  return "text-slate-700";
}

function sourceLabel(source: string, provider?: LiveProvider) {
  if (source === "live") {
    return provider ?? "Live";
  }

  if (source === "spreadsheet") {
    return "Sheet";
  }

  return "N/A";
}

function sourceClass(source: string) {
  if (source === "spreadsheet") {
    return "text-amber-700";
  }

  return "text-slate-500";
}

function marketStatusLabel() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const dayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(weekday ?? "");
  const minutes = hour * 60 + minute;
  const isOpen = dayIndex !== -1 && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;

  return isOpen ? "Market open" : "Market closed";
}

function StatusPill({ value }: { value: PortfolioResponse["liveStatus"] | "loading" | "error" }) {
  const label = value === "live" ? "Live data" : value === "partial" ? "Mixed live/fallback" : value === "fallback" ? "Spreadsheet fallback" : value === "loading" ? "Loading" : "Unavailable";
  const className = value === "live" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : value === "partial" ? "border-amber-200 bg-amber-50 text-amber-800" : value === "loading" ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-slate-100 text-slate-700";

  return <span className={`inline-flex items-center border px-2 py-1 text-xs font-medium ${className}`}>{label}</span>;
}

function SummaryTile({ label, value, secondary, tone }: { label: string; value: string; secondary?: string; tone?: "gain" | "loss" }) {
  const toneClass = tone === "gain" ? "text-emerald-700" : tone === "loss" ? "text-red-700" : "text-slate-950";

  return (
    <div className="border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {secondary ? <div className="mt-1 text-sm text-slate-500">{secondary}</div> : null}
    </div>
  );
}

function compareHoldings(a: EnrichedHolding, b: EnrichedHolding, sortKey: SortKey, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  const first = a[sortKey];
  const second = b[sortKey];

  if (typeof first === "string" && typeof second === "string") {
    return first.localeCompare(second) * multiplier;
  }

  const firstNumber = typeof first === "number" ? first : Number.NEGATIVE_INFINITY;
  const secondNumber = typeof second === "number" ? second : Number.NEGATIVE_INFINITY;
  return (firstNumber - secondNumber) * multiplier;
}

function HoldingDetails({ holding }: { holding: EnrichedHolding }) {
  const details = [
    ["Market Cap", formatNumber(holding.marketCap)],
    ["Revenue TTM", formatNumber(holding.revenue)],
    ["EBITDA TTM", formatNumber(holding.ebitda)],
    ["EBITDA Margin", holding.ebitdaMargin === null ? "Unavailable" : formatPercent(holding.ebitdaMargin * 100)],
    ["PAT", formatNumber(holding.pat)],
    ["PAT Margin", holding.patMargin === null ? "Unavailable" : formatPercent(holding.patMargin * 100)],
    ["CFO March 24", formatNumber(holding.cfoMarch24)],
    ["CFO 5Y", formatNumber(holding.cfoFiveYears)],
    ["Free Cash Flow 5Y", formatNumber(holding.freeCashFlowFiveYears)],
    ["Debt to Equity", formatNumber(holding.debtToEquity)],
    ["Book Value", formatNumber(holding.bookValue)],
    ["Revenue Growth 3Y", holding.revenueGrowth === null ? "Unavailable" : formatPercent(holding.revenueGrowth * 100)],
    ["EBITDA Growth 3Y", holding.ebitdaGrowth === null ? "Unavailable" : formatPercent(holding.ebitdaGrowth * 100)],
    ["Profit Growth 3Y", holding.profitGrowth === null ? "Unavailable" : formatPercent(holding.profitGrowth * 100)],
    ["Price to Sales", formatNumber(holding.priceToSales)],
    ["Price to Book", formatNumber(holding.priceToBook)],
    ["Stage-2", holding.stageTwo ?? "Unavailable"],
    ["Note", holding.note ?? "None"]
  ];

  return (
    <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {details.map(([label, value]) => (
        <div key={label}>
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
        </div>
      ))}
    </div>
  );
}

function HoldingsTable({ sectors }: { sectors: SectorSummary[] }) {
  const [openSectors, setOpenSectors] = useState(() => new Set(sectors.map((sector) => sector.sector)));
  const [expandedHolding, setExpandedHolding] = useState<string | null>(null);
  const tableData = useMemo(() => sectors.flatMap((sector) => sector.holdings), [sectors]);
  const columns = useMemo(
    () => holdingColumnHelper.columns([
      holdingColumnHelper.accessor("particulars", {
        header: "Stock",
        cell: ({ row }) => {
          const holding = row.original;

          return (
            <div>
              <button type="button" className="text-left font-medium text-slate-950 hover:underline" onClick={() => setExpandedHolding(expandedHolding === holding.id ? null : holding.id)}>
                {holding.particulars}
              </button>
              {holding.note ? <div className="mt-1 text-xs text-slate-500">{holding.note}</div> : null}
              {holding.adjustmentFactor && holding.adjustmentFactor > 1 ? <div className="mt-1 text-[11px] font-medium text-amber-700">Adjusted for split/bonus</div> : null}
            </div>
          );
        }
      }),
      holdingColumnHelper.accessor("purchasePrice", {
        header: "Purchase",
        cell: ({ row }) => formatMoney(row.original.purchasePrice, true)
      }),
      holdingColumnHelper.accessor("quantity", {
        header: "Qty",
        cell: ({ row }) => formatNumber(row.original.quantity, 0)
      }),
      holdingColumnHelper.accessor("investment", {
        header: "Investment",
        cell: ({ row }) => formatMoney(row.original.investment)
      }),
      holdingColumnHelper.accessor("portfolioPercent", {
        header: "Weight",
        cell: ({ row }) => formatUnsignedPercent(row.original.portfolioPercent)
      }),
      holdingColumnHelper.accessor("exchangeCode", {
        header: "Code",
        cell: ({ row }) => (
          <div>
            <div className="whitespace-nowrap">{row.original.exchangeCode}</div>
            <div className="text-[11px] text-slate-500">{row.original.exchange}</div>
          </div>
        )
      }),
      holdingColumnHelper.accessor("cmp", {
        header: "CMP",
        cell: ({ row }) => (
          <div>
            <div>{formatMoney(row.original.cmp, true)}</div>
            <div className={`text-[11px] font-medium ${sourceClass(row.original.cmpSource)}`}>{sourceLabel(row.original.cmpSource, row.original.cmpProvider)}</div>
          </div>
        )
      }),
      holdingColumnHelper.accessor("presentValue", {
        header: "Present Value",
        cell: ({ row }) => formatMoney(row.original.presentValue)
      }),
      holdingColumnHelper.accessor("gainLoss", {
        header: "Gain/Loss",
        cell: ({ row }) => <span className={`font-medium ${signedClass(row.original.gainLoss)}`}>{formatMoney(row.original.gainLoss)}</span>
      }),
      holdingColumnHelper.accessor("gainLossPercent", {
        header: "Return",
        cell: ({ row }) => <span className={`font-medium ${signedClass(row.original.gainLossPercent)}`}>{formatPercent(row.original.gainLossPercent)}</span>
      }),
      holdingColumnHelper.accessor("peRatio", {
        header: "P/E",
        cell: ({ row }) => (
          <div>
            <div>{formatNumber(row.original.peRatio)}</div>
            <div className={`text-[11px] font-medium ${sourceClass(row.original.peSource)}`}>{sourceLabel(row.original.peSource, row.original.peProvider)}</div>
          </div>
        )
      }),
      holdingColumnHelper.accessor("latestEarnings", {
        header: "Earnings",
        cell: ({ row }) => (
          <div>
            <div>{formatNumber(row.original.latestEarnings)}</div>
            <div className={`text-[11px] font-medium ${sourceClass(row.original.earningsSource)}`}>{sourceLabel(row.original.earningsSource, row.original.earningsProvider)}</div>
          </div>
        )
      })
    ]),
    [expandedHolding]
  );
  const table = useTable({
    data: tableData,
    columns,
    features: holdingTableFeatures,
    getRowId: (row) => row.id
  });
  const rowsById = useMemo(() => new Map(table.getRowModel().rows.map((row) => [row.original.id, row])), [table]);

  useEffect(() => {
    setOpenSectors(new Set(sectors.map((sector) => sector.sector)));
  }, [sectors]);

  return (
    <div className="overflow-hidden border border-slate-200 bg-white">
      <div className="hidden overflow-x-auto lg:block lg:overflow-visible">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[7.5%]" />
            <col className="w-[5.5%]" />
            <col className="w-[9%]" />
            <col className="w-[6.5%]" />
            <col className="w-[7.5%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[7%]" />
            <col className="w-[6%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="bg-white text-[11px] uppercase tracking-wide text-slate-500 shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => (
                  <th key={header.id} className={`px-2 py-2.5 font-semibold ${leftAlignedColumnIndexes.has(index) ? "text-left" : "text-right tabular-nums"}`}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {sectors.map((sector) => {
              const isOpen = openSectors.has(sector.sector);

              return (
                <Fragment key={sector.sector}>
                  <tr className="border-t border-slate-200 bg-slate-100 text-slate-800">
                    <td colSpan={sectorSummaryColumnIndexes.investment} className="px-3 py-2.5 text-left">
                      <button
                        type="button"
                        className="text-left font-semibold text-slate-950 hover:underline"
                        onClick={() => {
                          setOpenSectors((current) => {
                            const next = new Set(current);
                            if (next.has(sector.sector)) {
                              next.delete(sector.sector);
                            } else {
                              next.add(sector.sector);
                            }
                            return next;
                          });
                        }}
                      >
                        {isOpen ? "−" : "+"} {sector.sector}
                      </button>
                      <span className="ml-3 text-xs font-medium text-slate-500">{sector.liveCount} of {sector.totalCount} live</span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-medium tabular-nums">{formatMoney(sector.totalInvestment)}</td>
                    <td className="px-2 py-2.5 text-right font-medium tabular-nums">{formatUnsignedPercent(sector.portfolioPercent)}</td>
                    <td className="px-2 py-2.5" />
                    <td className="px-2 py-2.5 text-right font-medium tabular-nums">{formatMoney(sector.totalPresentValue)}</td>
                    <td className={`px-2 py-2.5 text-right font-semibold tabular-nums ${signedClass(sector.gainLoss)}`}>{formatMoney(sector.gainLoss)}</td>
                    <td className={`px-2 py-2.5 text-right font-semibold tabular-nums ${signedClass(sector.gainLossPercent)}`}>{formatPercent(sector.gainLossPercent)}</td>
                    <td className="px-2 py-2.5" />
                    <td className="px-2 py-2.5" />
                    <td className="px-2 py-2.5" />
                  </tr>
                  {isOpen ? sector.holdings.map((holding) => {
                    const row = rowsById.get(holding.id);

                    if (!row) {
                      return null;
                    }

                    return (
                      <Fragment key={row.id}>
                        <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                          {row.getAllCells().map((cell, index) => (
                            <td key={cell.id} className={`px-2 py-2.5 align-top ${leftAlignedColumnIndexes.has(index) ? "text-left" : "text-right tabular-nums"} ${index === 5 ? "text-slate-600" : ""}`}>
                              <table.FlexRender cell={cell} />
                            </td>
                          ))}
                        </tr>
                        {expandedHolding === holding.id ? (
                          <tr key={`${holding.id}-details`}>
                            <td colSpan={columns.length} className="p-0">
                              <HoldingDetails holding={holding} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  }) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-200 lg:hidden">
        {sectors.map((sector) => {
          const isOpen = openSectors.has(sector.sector);

          return (
            <section key={sector.sector}>
              <button
                type="button"
                className="w-full bg-slate-100 px-4 py-3 text-left"
                onClick={() => {
                  setOpenSectors((current) => {
                    const next = new Set(current);
                    if (next.has(sector.sector)) {
                      next.delete(sector.sector);
                    } else {
                      next.add(sector.sector);
                    }
                    return next;
                  });
                }}
              >
                <span className="block font-semibold text-slate-950">{isOpen ? "−" : "+"} {sector.sector}</span>
                <span className="mt-1 block text-sm text-slate-500">{sector.liveCount} of {sector.totalCount} live · {formatUnsignedPercent(sector.portfolioPercent)} of portfolio</span>
              </button>
              {isOpen ? sector.holdings.map((holding) => (
                <article key={holding.id} className="border-t border-slate-200 p-4">
                  <button type="button" className="flex w-full items-start justify-between gap-4 text-left" onClick={() => setExpandedHolding(expandedHolding === holding.id ? null : holding.id)}>
                    <span>
                      <span className="block font-semibold text-slate-950">{holding.particulars}</span>
                      <span className="mt-1 block text-sm text-slate-500">{holding.exchangeCode} · {holding.exchange} · Qty {formatNumber(holding.quantity, 0)}</span>
                      {holding.adjustmentFactor && holding.adjustmentFactor > 1 ? <span className="mt-1 block text-xs font-medium text-amber-700">Adjusted for split/bonus</span> : null}
                    </span>
                    <span className={`text-right font-semibold ${signedClass(holding.gainLoss)}`}>
                      {formatMoney(holding.gainLoss)}
                      <span className="block text-sm">{formatPercent(holding.gainLossPercent)}</span>
                    </span>
                  </button>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-slate-500">Investment</div>
                      <div className="font-medium">{formatMoney(holding.investment)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Present Value</div>
                      <div className="font-medium">{formatMoney(holding.presentValue)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">CMP</div>
                      <div className="font-medium">{formatMoney(holding.cmp, true)} <span className={`text-xs font-medium ${sourceClass(holding.cmpSource)}`}>{sourceLabel(holding.cmpSource, holding.cmpProvider)}</span></div>
                    </div>
                    <div>
                      <div className="text-slate-500">P/E · Earnings</div>
                      <div className="font-medium">
                        {formatNumber(holding.peRatio)} <span className={`text-xs font-medium ${sourceClass(holding.peSource)}`}>{sourceLabel(holding.peSource, holding.peProvider)}</span>
                        <span className="mx-1 text-slate-400">·</span>
                        {formatNumber(holding.latestEarnings)} <span className={`text-xs font-medium ${sourceClass(holding.earningsSource)}`}>{sourceLabel(holding.earningsSource, holding.earningsProvider)}</span>
                      </div>
                    </div>
                  </div>
                  {expandedHolding === holding.id ? <HoldingDetails holding={holding} /> : null}
                </article>
              )) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function PortfolioDashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("gainLoss");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const loadPortfolio = useCallback(async (initial = false) => {
    if (initial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const payload = await fetchPortfolio(initial ? "/api/portfolio?source=sheet" : "/api/portfolio");
      setPortfolio(payload);
      setError(null);
    } catch {
      setError("Live portfolio data is temporarily unavailable. The last successful snapshot remains visible when available.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPortfolio(true);
    const firstLiveRefresh = window.setTimeout(() => loadPortfolio(false), 2000);
    const interval = window.setInterval(() => loadPortfolio(false), 60000);
    return () => {
      window.clearTimeout(firstLiveRefresh);
      window.clearInterval(interval);
    };
  }, [loadPortfolio]);

  const filteredSectors = useMemo(() => {
    if (!portfolio) {
      return [];
    }

    const normalizedSearch = search.trim().toLowerCase();

    return portfolio.sectors
      .map((sector) => {
        const holdings = sector.holdings
          .filter((holding) => {
            if (!normalizedSearch) {
              return true;
            }

            return `${holding.particulars} ${holding.exchangeCode} ${holding.sector}`.toLowerCase().includes(normalizedSearch);
          })
          .sort((a, b) => compareHoldings(a, b, sortKey, sortDirection));

        return {
          ...sector,
          holdings
        };
      })
      .filter((sector) => sector.holdings.length > 0);
  }, [portfolio, search, sortDirection, sortKey]);

  const chartData = useMemo(() => portfolio?.sectors.map((sector) => ({
    sector: sector.sector.replace(" Sector", ""),
    investment: Math.round(sector.totalInvestment),
    value: Math.round(sector.totalPresentValue)
  })) ?? [], [portfolio]);

  const summaryTone = portfolio && portfolio.summary.gainLoss >= 0 ? "gain" : "loss";

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-300 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950">Portfolio Dashboard</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Active holdings are structured from the supplied workbook. Live prices and fundamentals are requested server-side, with spreadsheet values shown when public providers fail or omit fields.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusPill value={loading ? "loading" : portfolio?.liveStatus ?? "error"} />
            <span className="text-slate-500">Last updated {formatTime(portfolio?.lastUpdated ?? null)}</span>
            <span className="border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">{marketStatusLabel()}</span>
            <button type="button" onClick={() => loadPortfolio(false)} disabled={refreshing || loading} className="border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60">
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </header>

        {error ? <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {portfolio?.warnings.length ? <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Some live fields are unavailable, so affected cells use spreadsheet values. {portfolio.warnings.slice(0, 3).join(" · ")}{portfolio.warnings.length > 3 ? ` · ${portfolio.warnings.length - 3} more` : ""}</div> : null}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {["Total Investment", "Current Value", "Gain/Loss", "Overall Return"].map((item) => (
              <div key={item} className="h-28 animate-pulse border border-slate-200 bg-white p-4">
                <div className="h-3 w-28 bg-slate-200" />
                <div className="mt-6 h-7 w-36 bg-slate-200" />
              </div>
            ))}
          </div>
        ) : portfolio ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-4">
              <SummaryTile label="Total Investment" value={formatMoney(portfolio.summary.totalInvestment)} secondary={`${portfolio.holdings.length} active holdings`} />
              <SummaryTile label="Current Portfolio Value" value={formatMoney(portfolio.summary.totalPresentValue)} secondary="CMP × quantity" />
              <SummaryTile label="Overall Gain/Loss" value={formatMoney(portfolio.summary.gainLoss)} secondary={portfolio.summary.gainLoss >= 0 ? "Net gain" : "Net loss"} tone={summaryTone} />
              <SummaryTile label="Overall Return" value={formatPercent(portfolio.summary.gainLossPercent)} secondary="Gain/Loss ÷ investment" tone={summaryTone} />
            </section>

            <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.3fr]">
              <div className="border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold text-slate-950">Sector Overview</h2>
                  <span className="text-sm text-slate-500">{portfolio.sectors.length} sectors</span>
                </div>
                <div className="mt-4 space-y-3">
                  {portfolio.sectors.map((sector) => (
                    <div key={sector.sector} className="grid grid-cols-[1fr_auto] gap-3 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                      <div>
                        <div className="font-medium text-slate-950">{sector.sector}</div>
                        <div className="mt-1 text-sm text-slate-500">{formatUnsignedPercent(sector.portfolioPercent)} of portfolio · {sector.liveCount} of {sector.totalCount} live</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-slate-950">{formatMoney(sector.totalPresentValue)}</div>
                        <div className={`text-sm ${signedClass(sector.gainLoss)}`}>{formatMoney(sector.gainLoss)} · {formatPercent(sector.gainLossPercent)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold text-slate-950">Investment vs Current Value</h2>
                  <span className="text-sm text-slate-500">By sector</span>
                </div>
                <div className="mt-4 min-h-[360px] flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <CartesianGrid stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="sector" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#475569" }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#475569" }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                      <Tooltip formatter={(value) => formatMoney(Number(value))} cursor={{ fill: "#f1f5f9" }} />
                      <Legend />
                      <Bar dataKey="investment" name="Investment" fill="#334155" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="value" name="Current Value" fill="#0f766e" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="mt-6">
              <div className="mb-3 flex flex-col gap-3 border-b border-slate-300 pb-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-lg font-semibold text-slate-950">Holdings</h2>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stock, code, sector" className="border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-700" />
                  <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-700">
                    {Object.entries(sortLabels).map(([key, label]) => <option key={key} value={key}>Sort by {label}</option>)}
                  </select>
                  <button type="button" onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">
                    {sortDirection === "asc" ? "Ascending" : "Descending"}
                  </button>
                </div>
              </div>
              {filteredSectors.length ? <HoldingsTable sectors={filteredSectors} /> : <div className="border border-slate-200 bg-white p-8 text-center text-slate-600">No holdings match your search.</div>}
            </section>
          </>
        ) : (
          <div className="mt-6 border border-slate-200 bg-white p-8 text-center text-slate-600">Portfolio data could not be loaded.</div>
        )}
      </div>
    </main>
  );
}
