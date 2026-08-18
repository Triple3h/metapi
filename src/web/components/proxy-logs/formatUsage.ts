export function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${trimFixed(value / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${trimFixed(value / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${trimFixed(value / 1_000)}K`;
  }
  return String(Math.round(value));
}

function trimFixed(value: number): string {
  const text = value.toFixed(2);
  return text.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function formatCost(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const digits = Math.abs(value) >= 1 ? 4 : 6;
  return `$${Number(value.toFixed(digits))}`;
}

export function formatCostFixed(value: number): string {
  if (!Number.isFinite(value)) return "$0.000000";
  return `$${value.toFixed(6)}`;
}

export function formatSecondsFromMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value}%`;
}
