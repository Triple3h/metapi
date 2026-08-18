import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import {
  formatLocalDate,
  formatUtcSqlDateTime,
  parseStoredUtcDateTime,
} from "./localTimeService.js";
import { parseProxyLogBillingDetails, withProxyLogSelectFields } from "./proxyLogStore.js";
import {
  buildProxyLogWhereClause,
  type ProxyLogFilterParams,
} from "./proxyLogQueryFilters.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PROXY_LOGS_ANALYTICS_MAX_RANGE_DAYS = 31;
export const PROXY_LOGS_ANALYTICS_DEFAULT_RANGE_MS = 24 * HOUR_MS;

export type ProxyLogsAnalyticsGranularity = "hour" | "day";

export interface ProxyLogsAnalyticsRow {
  createdAt: unknown;
  status?: string | null;
  modelActual?: string | null;
  modelRequested?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  billingDetails?: unknown;
  siteId?: number | null;
  siteName?: string | null;
  downstreamKeyGroupName?: string | null;
}

export interface ProxyLogsAnalyticsRange {
  fromUtc: string;
  toUtc: string;
  granularity: ProxyLogsAnalyticsGranularity;
}

export interface ProxyLogsAnalyticsStats {
  totalRequests: number;
  successCount: number;
  failedCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCost: number;
  averageLatencyMs: number | null;
}

export interface ProxyLogsAnalyticsTrendPoint {
  bucketStart: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHitRate: number | null;
}

export interface ProxyLogsAnalyticsDistributionItem {
  key: string;
  label: string;
  requests: number;
  tokens: number;
  actualCost: number;
}

export interface ProxyLogsAnalyticsResult {
  range: ProxyLogsAnalyticsRange;
  stats: ProxyLogsAnalyticsStats;
  trend: ProxyLogsAnalyticsTrendPoint[];
  modelStats: ProxyLogsAnalyticsDistributionItem[];
  groupStats: ProxyLogsAnalyticsDistributionItem[];
  siteStats: ProxyLogsAnalyticsDistributionItem[];
}

export const PROXY_LOGS_ANALYTICS_UNGROUPED_LABEL = "未分组";
export const PROXY_LOGS_ANALYTICS_UNKNOWN_LABEL = "unknown";
const PROXY_LOGS_ANALYTICS_UNGROUPED_KEY = "(none)";

function toNonNegativeInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function toNonNegativeFloat(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function roundMicro(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function readBillingCacheTokens(
  billingDetails: unknown,
): { cacheReadTokens: number; cacheCreationTokens: number } {
  const parsed = parseProxyLogBillingDetails(billingDetails);
  if (!parsed) return { cacheReadTokens: 0, cacheCreationTokens: 0 };
  const usage = parsed.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return { cacheReadTokens: 0, cacheCreationTokens: 0 };
  }
  const record = usage as Record<string, unknown>;
  return {
    cacheReadTokens: toNonNegativeInt(record.cacheReadTokens),
    cacheCreationTokens: toNonNegativeInt(record.cacheCreationTokens),
  };
}

export function resolveProxyLogsAnalyticsRange(input: {
  fromUtc?: string | null;
  toUtc?: string | null;
  now?: Date;
}): { from: Date; to: Date } {
  const now = input.now ?? new Date();
  let to = parseStoredUtcDateTime(input.toUtc) ?? now;
  let from = parseStoredUtcDateTime(input.fromUtc) ?? new Date(to.getTime() - PROXY_LOGS_ANALYTICS_DEFAULT_RANGE_MS);

  if (from.getTime() >= to.getTime()) {
    from = new Date(to.getTime() - PROXY_LOGS_ANALYTICS_DEFAULT_RANGE_MS);
  }
  const maxRangeMs = PROXY_LOGS_ANALYTICS_MAX_RANGE_DAYS * DAY_MS;
  if (to.getTime() - from.getTime() > maxRangeMs) {
    from = new Date(to.getTime() - maxRangeMs);
  }
  return { from, to };
}

function getLocalHourAnchor(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    0,
    0,
    0,
  );
}

function getLocalDayAnchor(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

function formatHourBucketLabel(date: Date): string {
  return `${formatLocalDate(date)} ${pad2(date.getHours())}:00`;
}

interface TrendBucketAccumulator {
  bucketStart: string;
  label: string;
  startMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

function buildTrendBucketTemplate(
  from: Date,
  to: Date,
  granularity: ProxyLogsAnalyticsGranularity,
): TrendBucketAccumulator[] {
  const bucketMs = granularity === "hour" ? HOUR_MS : DAY_MS;
  const anchor = granularity === "hour" ? getLocalHourAnchor : getLocalDayAnchor;
  const label = granularity === "hour" ? formatHourBucketLabel : formatLocalDate;

  const start = anchor(from);
  const end = anchor(to);
  const buckets: TrendBucketAccumulator[] = [];
  for (
    let cursor = start.getTime();
    cursor <= end.getTime();
    cursor += bucketMs
  ) {
    const bucketDate = new Date(cursor);
    buckets.push({
      bucketStart: formatUtcSqlDateTime(bucketDate),
      label: label(bucketDate),
      startMs: cursor,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  }
  return buckets;
}

interface DistributionAccumulator {
  key: string;
  label: string;
  requests: number;
  tokens: number;
  actualCost: number;
}

function upsertDistribution(
  map: Map<string, DistributionAccumulator>,
  key: string,
  label: string,
  row: { tokens: number; cost: number },
): void {
  const existing = map.get(key);
  if (existing) {
    existing.requests += 1;
    existing.tokens += row.tokens;
    existing.actualCost += row.cost;
    return;
  }
  map.set(key, { key, label, requests: 1, tokens: row.tokens, actualCost: row.cost });
}

function sortDistribution(
  map: Map<string, DistributionAccumulator>,
): ProxyLogsAnalyticsDistributionItem[] {
  return Array.from(map.values())
    .map((item) => ({
      key: item.key,
      label: item.label,
      requests: item.requests,
      tokens: item.tokens,
      actualCost: roundMicro(item.actualCost),
    }))
    .sort((left, right) => right.tokens - left.tokens);
}

function computeCacheHitRate(cacheReadTokens: number, promptTokens: number): number | null {
  const denominator = promptTokens + cacheReadTokens;
  if (denominator <= 0) return null;
  return Math.round((cacheReadTokens / denominator) * 1000) / 10;
}

export function aggregateProxyLogsAnalytics(
  rows: ProxyLogsAnalyticsRow[],
  range: { from: Date; to: Date },
  granularity: ProxyLogsAnalyticsGranularity,
): ProxyLogsAnalyticsResult {
  const stats = {
    totalRequests: 0,
    successCount: 0,
    failedCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCost: 0,
    latencyTotalMs: 0,
    latencyCount: 0,
  };
  const buckets = buildTrendBucketTemplate(range.from, range.to, granularity);
  const bucketMs = granularity === "hour" ? HOUR_MS : DAY_MS;
  const rangeStartMs = buckets.length > 0 ? buckets[0].startMs : range.from.getTime();
  const rangeEndMs = rangeStartMs + buckets.length * bucketMs;

  const modelMap = new Map<string, DistributionAccumulator>();
  const groupMap = new Map<string, DistributionAccumulator>();
  const siteMap = new Map<string, DistributionAccumulator>();

  for (const row of rows) {
    const createdAt = parseStoredUtcDateTime(row.createdAt as never);
    if (!createdAt) continue;

    const isSuccess = (row.status || "").trim().toLowerCase() === "success";
    const promptTokens = toNonNegativeInt(row.promptTokens);
    const completionTokens = toNonNegativeInt(row.completionTokens);
    const totalTokens = Math.max(
      toNonNegativeInt(row.totalTokens),
      promptTokens + completionTokens,
    );
    const cost = toNonNegativeFloat(row.estimatedCost);
    const cache = readBillingCacheTokens(row.billingDetails);

    stats.totalRequests += 1;
    if (isSuccess) stats.successCount += 1;
    else stats.failedCount += 1;
    stats.promptTokens += promptTokens;
    stats.completionTokens += completionTokens;
    stats.totalTokens += totalTokens;
    stats.cacheReadTokens += cache.cacheReadTokens;
    stats.cacheCreationTokens += cache.cacheCreationTokens;
    stats.totalCost += cost;
    const latencyMs = row.latencyMs;
    if (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0) {
      stats.latencyTotalMs += latencyMs;
      stats.latencyCount += 1;
    }

    const rowMetrics = { tokens: totalTokens, cost };

    const modelKey = (row.modelActual || row.modelRequested || "").trim()
      || PROXY_LOGS_ANALYTICS_UNKNOWN_LABEL;
    upsertDistribution(modelMap, modelKey.toLowerCase(), modelKey, rowMetrics);

    const groupName = (row.downstreamKeyGroupName || "").trim();
    upsertDistribution(
      groupMap,
      groupName ? groupName.toLowerCase() : PROXY_LOGS_ANALYTICS_UNGROUPED_KEY,
      groupName || PROXY_LOGS_ANALYTICS_UNGROUPED_LABEL,
      rowMetrics,
    );

    if (row.siteId != null) {
      upsertDistribution(
        siteMap,
        String(row.siteId),
        (row.siteName || "").trim() || `站点 ${row.siteId}`,
        rowMetrics,
      );
    }

    const timestampMs = createdAt.getTime();
    if (timestampMs < rangeStartMs || timestampMs >= rangeEndMs) continue;
    const bucketIndex = Math.floor((timestampMs - rangeStartMs) / bucketMs);
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;
    bucket.inputTokens += promptTokens;
    bucket.outputTokens += completionTokens;
    bucket.cacheCreationTokens += cache.cacheCreationTokens;
    bucket.cacheReadTokens += cache.cacheReadTokens;
  }

  return {
    range: {
      fromUtc: formatUtcSqlDateTime(range.from),
      toUtc: formatUtcSqlDateTime(range.to),
      granularity,
    },
    stats: {
      totalRequests: stats.totalRequests,
      successCount: stats.successCount,
      failedCount: stats.failedCount,
      promptTokens: stats.promptTokens,
      completionTokens: stats.completionTokens,
      totalTokens: stats.totalTokens,
      cacheReadTokens: stats.cacheReadTokens,
      cacheCreationTokens: stats.cacheCreationTokens,
      totalCost: roundMicro(stats.totalCost),
      averageLatencyMs: stats.latencyCount > 0
        ? Math.round(stats.latencyTotalMs / stats.latencyCount)
        : null,
    },
    trend: buckets.map((bucket) => ({
      bucketStart: bucket.bucketStart,
      label: bucket.label,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      cacheCreationTokens: bucket.cacheCreationTokens,
      cacheReadTokens: bucket.cacheReadTokens,
      cacheHitRate: computeCacheHitRate(bucket.cacheReadTokens, bucket.inputTokens),
    })),
    modelStats: sortDistribution(modelMap),
    groupStats: sortDistribution(groupMap),
    siteStats: sortDistribution(siteMap),
  };
}

export interface ProxyLogsAnalyticsInput extends ProxyLogFilterParams {
  granularity?: ProxyLogsAnalyticsGranularity;
  now?: Date;
}

export async function loadProxyLogsAnalytics(
  input: ProxyLogsAnalyticsInput,
): Promise<ProxyLogsAnalyticsResult> {
  const granularity: ProxyLogsAnalyticsGranularity =
    input.granularity === "day" ? "day" : "hour";
  const range = resolveProxyLogsAnalyticsRange({
    fromUtc: input.fromUtc,
    toUtc: input.toUtc,
    now: input.now,
  });
  const fromUtc = formatUtcSqlDateTime(range.from);
  const toUtc = formatUtcSqlDateTime(range.to);

  const where = buildProxyLogWhereClause({
    status: input.status,
    search: input.search,
    client: input.client,
    siteId: input.siteId,
    model: input.model,
    downstreamKeyId: input.downstreamKeyId,
    group: input.group,
    stream: input.stream,
    fromUtc,
    toUtc,
  });

  const rows = (await withProxyLogSelectFields(
    ({ fields }) => {
      let query = db
        .select({
          createdAt: fields.createdAt,
          status: fields.status,
          modelActual: fields.modelActual,
          modelRequested: fields.modelRequested,
          latencyMs: fields.latencyMs,
          promptTokens: fields.promptTokens,
          completionTokens: fields.completionTokens,
          totalTokens: fields.totalTokens,
          estimatedCost: fields.estimatedCost,
          billingDetails: (fields as { billingDetails?: unknown }).billingDetails ?? null,
          siteId: schema.sites.id,
          siteName: schema.sites.name,
          downstreamKeyGroupName: schema.downstreamApiKeys.groupName,
        })
        .from(schema.proxyLogs)
        .leftJoin(
          schema.accounts,
          eq(schema.proxyLogs.accountId, schema.accounts.id),
        )
        .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
        .leftJoin(
          schema.downstreamApiKeys,
          eq(schema.proxyLogs.downstreamApiKeyId, schema.downstreamApiKeys.id),
        );
      if (where) {
        query = query.where(where) as typeof query;
      }
      return query.all();
    },
    { includeBillingDetails: true, includeClientFields: false },
  )) as ProxyLogsAnalyticsRow[];

  return aggregateProxyLogsAnalytics(rows, range, granularity);
}
