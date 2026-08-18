import React, { useMemo } from "react";
import { VChart } from "@visactor/react-vchart";
import type { ProxyLogsAnalyticsTrendPoint } from "../../api.js";
import { formatCompactTokens, formatPercent } from "./formatUsage.js";

interface TokenTrendChartProps {
  trend: ProxyLogsAnalyticsTrendPoint[];
  loading?: boolean;
}

const TOKEN_SERIES_LABELS = ["Input", "Output", "Cache Creation", "Cache Read"] as const;
const RATE_SERIES_LABEL = "Cache Hit Rate";

export default function TokenTrendChart({ trend, loading }: TokenTrendChartProps) {
  const hasData = useMemo(
    () => trend.some((point) => (
      point.inputTokens > 0
      || point.outputTokens > 0
      || point.cacheReadTokens > 0
      || point.cacheCreationTokens > 0
    )),
    [trend],
  );

  const spec = useMemo(() => {
    if (!hasData) return null;

    const tokenValues = trend.flatMap((point) => [
      { label: point.label, series: TOKEN_SERIES_LABELS[0], value: point.inputTokens },
      { label: point.label, series: TOKEN_SERIES_LABELS[1], value: point.outputTokens },
      { label: point.label, series: TOKEN_SERIES_LABELS[2], value: point.cacheCreationTokens },
      { label: point.label, series: TOKEN_SERIES_LABELS[3], value: point.cacheReadTokens },
    ]);
    const rateValues = trend
      .filter((point) => point.cacheHitRate != null)
      .map((point) => ({ label: point.label, value: point.cacheHitRate ?? 0 }));

    return {
      type: "common" as const,
      data: [
        { id: "tokens", values: tokenValues },
        { id: "rate", values: rateValues },
      ],
      series: [
        {
          id: "tokenSeries",
          type: "line" as const,
          data: { id: "tokens" },
          xField: "label",
          yField: "value",
          seriesField: "series",
          area: { visible: true, style: { fillOpacity: 0.12 } },
          line: { style: { curveType: "monotone", lineWidth: 2 } },
          point: { visible: false },
        },
        {
          id: "rateSeries",
          type: "line" as const,
          data: { id: "rate" },
          xField: "label",
          yField: "value",
          line: { style: { curveType: "monotone", lineWidth: 2, lineDash: [5, 4] } },
          point: { visible: false },
        },
      ],
      legends: {
        visible: true,
        orient: "top" as const,
        item: {
          shape: { style: { symbolType: "circle" } },
          label: { style: { fontSize: 12 } },
        },
      },
      tooltip: {
        dimension: {
          title: { value: (datum: Record<string, unknown>) => String(datum?.label ?? "") },
          content: [
            {
              key: (datum: Record<string, unknown>) => (
                String(datum?.series ?? RATE_SERIES_LABEL)
              ),
              value: (datum: Record<string, unknown>) => (
                datum?.series
                  ? formatCompactTokens(Number(datum?.value ?? 0))
                  : formatPercent(Number(datum?.value ?? 0))
              ),
            },
          ],
        },
      },
      axes: [
        {
          orient: "bottom" as const,
          label: { style: { fontSize: 11, fill: "var(--color-text-muted)" } },
          domainLine: { style: { stroke: "var(--color-border-light)" } },
          tick: { style: { stroke: "var(--color-border-light)" } },
        },
        {
          orient: "left" as const,
          seriesIndex: [0],
          label: {
            style: { fontSize: 11, fill: "var(--color-text-muted)" },
            format: (datum: { value?: number | string }) => (
              formatCompactTokens(Number(datum?.value ?? 0))
            ),
          },
          grid: { style: { stroke: "var(--color-border-light)", lineDash: [4, 4] } },
          domainLine: { visible: false },
        },
        {
          orient: "right" as const,
          seriesIndex: [1],
          label: {
            style: { fontSize: 11, fill: "var(--color-text-muted)" },
            format: (datum: { value?: number | string }) => `${datum?.value ?? 0}%`,
          },
          grid: { visible: false },
          domainLine: { visible: false },
        },
      ],
      color: ["#4f46e5", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6"],
      background: "transparent",
      animation: true,
    };
  }, [trend, hasData]);

  if (loading) {
    return (
      <div className="usage-trend-card">
        <div className="usage-card-header">
          <span className="usage-card-title">Token 使用趋势</span>
        </div>
        <div className="skeleton" style={{ width: "100%", height: 260, borderRadius: 8 }} />
      </div>
    );
  }

  return (
    <div className="usage-trend-card">
      <div className="usage-card-header">
        <span className="usage-card-title">Token 使用趋势</span>
      </div>
      {!spec ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <div className="empty-state-title">暂无趋势数据</div>
          <div className="empty-state-desc">调整时间范围或筛选后将自动展示</div>
        </div>
      ) : (
        <div style={{ width: "100%", height: 280 }}>
          <VChart spec={spec as any} style={{ width: "100%", height: "100%" }} />
        </div>
      )}
    </div>
  );
}
