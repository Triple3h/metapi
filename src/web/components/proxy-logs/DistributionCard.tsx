import React, { useMemo, useState } from "react";
import { VChart } from "@visactor/react-vchart";
import type { ProxyLogsAnalyticsDistributionItem } from "../../api.js";
import { formatCompactTokens, formatCost } from "./formatUsage.js";

type DistributionMetric = "tokens" | "cost";

interface DistributionCardProps {
  title: string;
  dimensionLabel: string;
  items: ProxyLogsAnalyticsDistributionItem[];
  loading?: boolean;
}

const PIE_COLORS = [
  "#4f46e5",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

const MAX_SLICES = 8;

export default function DistributionCard({
  title,
  dimensionLabel,
  items,
  loading,
}: DistributionCardProps) {
  const [metric, setMetric] = useState<DistributionMetric>("tokens");

  const chartItems = useMemo(() => {
    const sorted = [...items].sort((left, right) => (
      metric === "tokens" ? right.tokens - left.tokens : right.actualCost - left.actualCost
    ));
    const head = sorted.slice(0, MAX_SLICES);
    const tail = sorted.slice(MAX_SLICES);
    if (tail.length === 0) return head;
    const rest = tail.reduce(
      (acc, item) => ({
        requests: acc.requests + item.requests,
        tokens: acc.tokens + item.tokens,
        actualCost: acc.actualCost + item.actualCost,
      }),
      { requests: 0, tokens: 0, actualCost: 0 },
    );
    return [
      ...head,
      { key: "__rest__", label: "其他", ...rest },
    ];
  }, [items, metric]);

  const hasData = chartItems.some((item) => (
    metric === "tokens" ? item.tokens > 0 : item.actualCost > 0
  ));

  const spec = useMemo(() => {
    if (!hasData) return null;
    return {
      type: "pie" as const,
      data: [
        {
          id: "distribution",
          values: chartItems.map((item) => ({
            name: item.label,
            value: metric === "tokens" ? item.tokens : item.actualCost,
          })),
        },
      ],
      valueField: "value",
      categoryField: "name",
      outerRadius: 0.82,
      innerRadius: 0.56,
      pie: { style: { cornerRadius: 4, padAngle: 0.02 } },
      label: { visible: false },
      legends: { visible: false },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => String(datum?.name ?? ""),
              value: (datum: Record<string, unknown>) => (
                metric === "tokens"
                  ? formatCompactTokens(Number(datum?.value ?? 0))
                  : formatCost(Number(datum?.value ?? 0))
              ),
            },
          ],
        },
      },
      axes: [],
      color: PIE_COLORS,
      background: "transparent",
      animation: true,
    };
  }, [chartItems, hasData, metric]);

  return (
    <div className="usage-distribution-card">
      <div className="usage-card-header">
        <span className="usage-card-title">{title}</span>
        <div className="usage-metric-toggle">
          {(["tokens", "cost"] as DistributionMetric[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`usage-metric-toggle-btn ${metric === key ? "active" : ""}`}
              onClick={() => setMetric(key)}
            >
              {key === "tokens" ? "按 Token" : "按实际消费"}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="usage-distribution-body">
          <div className="skeleton" style={{ width: 148, height: 148, borderRadius: "50%" }} />
          <div style={{ flex: 1, display: "grid", gap: 10 }}>
            {[0, 1, 2].map((index) => (
              <div key={index} className="skeleton" style={{ height: 18 }} />
            ))}
          </div>
        </div>
      ) : !hasData ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <div className="empty-state-title">暂无{title}数据</div>
          <div className="empty-state-desc">调整时间范围或筛选后将自动展示</div>
        </div>
      ) : (
        <div className="usage-distribution-body">
          <div className="usage-distribution-donut">
            {spec && <VChart spec={spec as any} style={{ width: "100%", height: "100%" }} />}
          </div>
          <div className="usage-distribution-table">
            <div className="usage-distribution-row usage-distribution-row-head">
              <span>{dimensionLabel}</span>
              <span className="num">请求</span>
              <span className="num">Token</span>
              <span className="num">实际</span>
            </div>
            {chartItems.map((item) => (
              <div key={item.key} className="usage-distribution-row">
                <span className="usage-distribution-label" title={item.label}>{item.label}</span>
                <span className="num">{item.requests.toLocaleString()}</span>
                <span className="num">{formatCompactTokens(item.tokens)}</span>
                <span className="num usage-distribution-cost">{formatCost(item.actualCost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
