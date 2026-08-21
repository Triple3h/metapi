import { describe, expect, it } from "vitest";
import { formatUtcSqlDateTime } from "./localTimeService.js";
import {
  aggregateProxyLogsAnalytics,
  PROXY_LOGS_ANALYTICS_MAX_RANGE_DAYS,
  PROXY_LOGS_ANALYTICS_UNGROUPED_LABEL,
  resolveProxyLogsAnalyticsRange,
  type ProxyLogsAnalyticsRow,
} from "./proxyLogsAnalyticsService.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function rowAt(
  localDate: Date,
  overrides: Partial<ProxyLogsAnalyticsRow> = {},
): ProxyLogsAnalyticsRow {
  return {
    createdAt: formatUtcSqlDateTime(localDate),
    status: "success",
    modelActual: "gpt-5.6-sol",
    modelRequested: "gpt-5.6-sol",
    latencyMs: 100,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    estimatedCost: 0.1,
    billingDetails: null,
    siteId: 1,
    siteName: "site-a",
    downstreamKeyGroupName: "稳定版本",
    ...overrides,
  };
}

describe("resolveProxyLogsAnalyticsRange", () => {
  it("defaults to the last 24 hours when boundaries are missing", () => {
    const now = new Date("2026-08-18T10:00:00.000Z");
    const range = resolveProxyLogsAnalyticsRange({ now });
    expect(range.to.getTime()).toBe(now.getTime());
    expect(range.to.getTime() - range.from.getTime()).toBe(24 * HOUR_MS);
  });

  it("falls back to the default window when from is after to", () => {
    const now = new Date("2026-08-18T10:00:00.000Z");
    const range = resolveProxyLogsAnalyticsRange({
      fromUtc: formatUtcSqlDateTime(new Date("2026-08-19T10:00:00.000Z")),
      toUtc: formatUtcSqlDateTime(now),
      now,
    });
    expect(range.to.getTime()).toBe(now.getTime());
    expect(range.to.getTime() - range.from.getTime()).toBe(24 * HOUR_MS);
  });

  it("caps ranges longer than the maximum window", () => {
    const now = new Date("2026-08-18T10:00:00.000Z");
    const range = resolveProxyLogsAnalyticsRange({
      fromUtc: formatUtcSqlDateTime(new Date(now.getTime() - 90 * DAY_MS)),
      toUtc: formatUtcSqlDateTime(now),
      now,
    });
    expect(range.to.getTime() - range.from.getTime()).toBe(
      PROXY_LOGS_ANALYTICS_MAX_RANGE_DAYS * DAY_MS,
    );
  });
});

describe("aggregateProxyLogsAnalytics", () => {
  const from = new Date(2026, 2, 9, 8, 0, 0);
  const to = new Date(2026, 2, 9, 11, 0, 0);

  it("aggregates stats, hourly buckets, and cache tokens from billing details", () => {
    const rows: ProxyLogsAnalyticsRow[] = [
      rowAt(new Date(2026, 2, 9, 8, 30, 0), {
        billingDetails: JSON.stringify({
          usage: { cacheReadTokens: 10, cacheCreationTokens: 2 },
        }),
      }),
      rowAt(new Date(2026, 2, 9, 9, 15, 0), {
        status: "failed",
        latencyMs: null,
        modelActual: "gpt-5.6-luna",
        modelRequested: "gpt-5.6-luna",
        promptTokens: 4,
        completionTokens: 1,
        totalTokens: 5,
        estimatedCost: 0.05,
        downstreamKeyGroupName: null,
      }),
      rowAt(new Date(2026, 2, 9, 10, 45, 0), {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        estimatedCost: 0.2,
        billingDetails: JSON.stringify({
          usage: { cacheReadTokens: 20 },
        }),
      }),
    ];

    const result = aggregateProxyLogsAnalytics(rows, { from, to }, "hour");

    expect(result.stats).toMatchObject({
      totalRequests: 3,
      successCount: 2,
      failedCount: 1,
      promptTokens: 34,
      completionTokens: 16,
      totalTokens: 50,
      cacheReadTokens: 30,
      cacheCreationTokens: 2,
      totalInputTokens: 34,
    });
    expect(result.stats.totalCost).toBeCloseTo(0.35, 6);
    expect(result.stats.averageLatencyMs).toBe(100);

    // 8:00, 9:00, 10:00, 11:00 local anchors (inclusive end bucket).
    expect(result.trend).toHaveLength(4);
    expect(result.trend[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 10,
      cacheCreationTokens: 2,
    });
    // promptTokens already includes cache reads (flag unset), so the hit rate
    // is cacheRead / promptTokens, not cacheRead / (promptTokens + cacheRead).
    expect(result.trend[0].cacheHitRate).toBe(100);
    expect(result.trend[1]).toMatchObject({ inputTokens: 4, cacheReadTokens: 0 });
    expect(result.trend[1].cacheHitRate).toBe(0);
    expect(result.trend[2]).toMatchObject({ inputTokens: 20, cacheReadTokens: 20 });
    expect(result.trend[2].cacheHitRate).toBe(100);
    expect(result.trend[3]).toMatchObject({ inputTokens: 0 });

    expect(result.modelStats.map((item) => item.label)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ]);
    expect(result.modelStats[0]).toMatchObject({ requests: 2, tokens: 45 });

    expect(result.groupStats).toHaveLength(2);
    expect(result.groupStats[0]).toMatchObject({
      label: "稳定版本",
      requests: 2,
    });
    const ungrouped = result.groupStats.find(
      (item) => item.label === PROXY_LOGS_ANALYTICS_UNGROUPED_LABEL,
    );
    expect(ungrouped).toMatchObject({ requests: 1, tokens: 5 });

    expect(result.siteStats).toEqual([
      expect.objectContaining({ key: "1", label: "site-a", requests: 3 }),
    ]);
  });

  it("treats cache reads as billed separately when promptTokensIncludeCache is false", () => {
    const rows: ProxyLogsAnalyticsRow[] = [
      rowAt(new Date(2026, 2, 9, 8, 30, 0), {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        billingDetails: JSON.stringify({
          usage: {
            promptTokens: 10,
            cacheReadTokens: 20,
            cacheCreationTokens: 3,
            promptTokensIncludeCache: false,
          },
        }),
      }),
    ];

    const result = aggregateProxyLogsAnalytics(rows, { from, to }, "hour");

    // promptTokens excludes the cache reads here, so the real input total is
    // 10 + 20 + 3 = 33 and the hit rate is 20 / 33.
    expect(result.stats.totalInputTokens).toBe(33);
    expect(result.trend[0]).toMatchObject({
      inputTokens: 10,
      cacheReadTokens: 20,
      cacheCreationTokens: 3,
    });
    expect(result.trend[0].cacheHitRate).toBeCloseTo(60.6, 1);
  });

  it("collapses rows into local day buckets for day granularity", () => {
    const dayFrom = new Date(2026, 2, 9, 0, 0, 0);
    const dayTo = new Date(2026, 2, 10, 23, 0, 0);
    const rows: ProxyLogsAnalyticsRow[] = [
      rowAt(new Date(2026, 2, 9, 8, 30, 0)),
      rowAt(new Date(2026, 2, 9, 23, 30, 0)),
      rowAt(new Date(2026, 2, 10, 1, 30, 0), { promptTokens: 2, completionTokens: 1, totalTokens: 3 }),
    ];

    const result = aggregateProxyLogsAnalytics(rows, { from: dayFrom, to: dayTo }, "day");

    expect(result.trend).toHaveLength(2);
    expect(result.trend[0]).toMatchObject({ inputTokens: 20, outputTokens: 10 });
    expect(result.trend[1]).toMatchObject({ inputTokens: 2, outputTokens: 1 });
  });

  it("ignores rows with unparsable timestamps and missing billing payloads", () => {
    const rows: ProxyLogsAnalyticsRow[] = [
      rowAt(new Date(2026, 2, 9, 8, 30, 0), { createdAt: "not-a-date" }),
      rowAt(new Date(2026, 2, 9, 8, 40, 0), { billingDetails: "{invalid json" }),
    ];

    const result = aggregateProxyLogsAnalytics(rows, { from, to }, "hour");

    expect(result.stats.totalRequests).toBe(1);
    expect(result.stats.cacheReadTokens).toBe(0);
  });
});
