export const moneyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

export const preciseMoneyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export const numberFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2
});

export function formatMoney(value: number | null | undefined, precise = false) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Unavailable";
  }

  return precise ? preciseMoneyFormatter.format(value) : moneyFormatter.format(value);
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-IN", { maximumFractionDigits }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Unavailable";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatUnsignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Unavailable";
  }

  return `${value.toFixed(2)}%`;
}

export function formatTime(value: string | null) {
  if (!value) {
    return "Not updated yet";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
