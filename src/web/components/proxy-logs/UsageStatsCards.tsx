import React from "react";
import type { ProxyLogsAnalytics } from "../../api.js";
import {
  formatCompactTokens,
  formatCost,
  formatPercent,
  formatSecondsFromMs,
} from "./formatUsage.js";

interface UsageStatsCardsProps {
  stats: ProxyLogsAnalytics["stats"] | null;
  loading?: boolean;
}

function computeCacheHitRate(
  cacheReadTokens: number,
  totalInputTokens: number,
): number | null {
  if (totalInputTokens <= 0) return null;
  return Math.round((cacheReadTokens / totalInputTokens) * 1000) / 10;
}

function CardShell({
  tint,
  icon,
  label,
  value,
  valueColor,
  valueExtra,
  sub,
  loading,
}: {
  tint: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  valueExtra?: React.ReactNode;
  sub: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="usage-stat-card">
      <div className="usage-stat-card-icon" style={{ background: tint }}>
        {icon}
      </div>
      <div className="usage-stat-card-body">
        <span className="usage-stat-card-label">{label}</span>
        {loading ? (
          <div className="skeleton" style={{ width: 96, height: 22, borderRadius: 6 }} />
        ) : (
          <strong
            className="usage-stat-card-value"
            style={valueColor ? { color: valueColor } : undefined}
          >
            {value}
            {valueExtra}
          </strong>
        )}
        <div className="usage-stat-card-sub">
          {loading ? (
            <div className="skeleton" style={{ width: 140, height: 12, borderRadius: 4 }} />
          ) : (
            sub
          )}
        </div>
      </div>
    </div>
  );
}

export default function UsageStatsCards({ stats, loading }: UsageStatsCardsProps) {
  const totalRequests = stats?.totalRequests ?? 0;
  const successCount = stats?.successCount ?? 0;
  const failedCount = stats?.failedCount ?? 0;
  const totalTokens = stats?.totalTokens ?? 0;
  const promptTokens = stats?.promptTokens ?? 0;
  const completionTokens = stats?.completionTokens ?? 0;
  const cacheReadTokens = stats?.cacheReadTokens ?? 0;
  const cacheCreationTokens = stats?.cacheCreationTokens ?? 0;
  const totalCost = stats?.totalCost ?? 0;
  const averageLatencyMs = stats?.averageLatencyMs ?? null;
  const cacheHitRate = computeCacheHitRate(
    cacheReadTokens,
    stats?.totalInputTokens ?? (promptTokens + cacheReadTokens + cacheCreationTokens),
  );
  const cacheTotalTokens = cacheReadTokens + cacheCreationTokens;

  return (
    <div className="usage-stat-cards">
      <CardShell
        loading={loading}
        tint="rgba(79, 70, 229, 0.12)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#4f46e5" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M9 8h6M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
          </svg>
        }
        label="总请求数"
        value={totalRequests.toLocaleString()}
        sub={<span>成功 {successCount.toLocaleString()} / 失败 {failedCount.toLocaleString()}</span>}
      />
      <CardShell
        loading={loading}
        tint="rgba(245, 158, 11, 0.14)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#f59e0b" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
          </svg>
        }
        label="总 Token"
        value={formatCompactTokens(totalTokens)}
        valueExtra={
          cacheHitRate != null && cacheTotalTokens > 0 ? (
            <span
              style={{
                marginLeft: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-warning)",
              }}
            >
              缓存命中 {formatPercent(cacheHitRate)}
            </span>
          ) : null
        }
        sub={
          <span>
            输入: {formatCompactTokens(promptTokens)} / 输出: {formatCompactTokens(completionTokens)}
            {" / "}缓存: {formatCompactTokens(cacheTotalTokens)}
            {cacheHitRate != null && cacheTotalTokens > 0
              ? ` (${formatPercent(cacheHitRate)})`
              : ""}
          </span>
        }
      />
      <CardShell
        loading={loading}
        tint="rgba(16, 185, 129, 0.14)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-2.2 0-4 1.34-4 3s1.8 3 4 3 4 1.34 4 3-1.8 3-4 3m0-12c1.4 0 2.64.54 3.4 1.36M12 8V6m0 12v-2m0-8c-1.4 0-2.64.54-3.4 1.36" />
          </svg>
        }
        label="总消费"
        value={formatCost(totalCost)}
        valueColor="var(--color-success, #10b981)"
        sub={<span>按估算成本累计</span>}
      />
      <CardShell
        loading={loading}
        tint="rgba(139, 92, 246, 0.14)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#8b5cf6" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
          </svg>
        }
        label="平均耗时"
        value={averageLatencyMs == null ? "-" : formatSecondsFromMs(averageLatencyMs)}
        sub={<span>成功与失败请求的端到端均值</span>}
      />
    </div>
  );
}
