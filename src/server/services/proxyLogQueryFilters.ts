import { and, eq, gte, lt, sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import { formatUtcSqlDateTime } from "./localTimeService.js";

export type ProxyLogStatusFilter = "all" | "success" | "failed";
export type ProxyLogClientFilter = {
  kind: "app" | "family";
  value: string;
} | null;

/**
 * Sentinel value used by the usage-log filters to target logs without a
 * downstream key group.
 */
export const PROXY_LOG_GROUP_NONE_TOKEN = "(none)";

export function normalizeProxyLogStatusFilter(raw?: string): ProxyLogStatusFilter {
  const normalized = (raw || "").trim().toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "failed") return "failed";
  return "all";
}

export function normalizeProxyLogSearch(raw?: string): string {
  return (raw || "").trim().toLowerCase();
}

export function normalizeProxyLogSiteId(raw?: string): number | null {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function normalizeProxyLogClientFilter(raw?: string): ProxyLogClientFilter {
  const text = (raw || "").trim();
  if (!text) return null;
  const separatorIndex = text.indexOf(":");
  if (separatorIndex <= 0) return null;
  const kind = text.slice(0, separatorIndex).trim().toLowerCase();
  const value = text
    .slice(separatorIndex + 1)
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (kind === "app" || kind === "family") {
    return { kind, value };
  }
  return null;
}

export function normalizeProxyLogTimeBoundary(raw?: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatUtcSqlDateTime(parsed);
}

export function normalizeProxyLogModelFilter(raw?: string): string | null {
  const text = (raw || "").trim().toLowerCase();
  return text || null;
}

export function normalizeProxyLogDownstreamKeyIdFilter(raw?: string): number | null {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function normalizeProxyLogGroupFilter(raw?: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  return text;
}

export function normalizeProxyLogStreamFilter(raw?: string): boolean | null {
  const normalized = (raw || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "stream" || normalized === "true" || normalized === "1") {
    return true;
  }
  if (
    normalized === "sync" ||
    normalized === "non-stream" ||
    normalized === "nonstream" ||
    normalized === "false" ||
    normalized === "0"
  ) {
    return false;
  }
  return null;
}

export function buildProxyLogSearchCondition(search: string) {
  if (!search) return null;
  const likeTerm = `%${search}%`;
  return sql<boolean>`(
    lower(coalesce(${schema.proxyLogs.modelRequested}, '')) like ${likeTerm}
    or lower(coalesce(${schema.proxyLogs.modelActual}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.name}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.groupName}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.tags}, '')) like ${likeTerm}
  )`;
}

export function buildProxyLogStatusCondition(status: ProxyLogStatusFilter) {
  if (status === "success") {
    return eq(schema.proxyLogs.status, "success");
  }
  if (status === "failed") {
    return sql<boolean>`coalesce(${schema.proxyLogs.status}, '') <> 'success'`;
  }
  return null;
}

export function buildProxyLogClientCondition(client: ProxyLogClientFilter) {
  if (!client) return null;
  if (client.kind === "app") {
    return eq(schema.proxyLogs.clientAppId, client.value);
  }
  return eq(schema.proxyLogs.clientFamily, client.value);
}

export function buildProxyLogModelCondition(model: string | null | undefined) {
  if (!model) return null;
  return sql<boolean>`lower(coalesce(${schema.proxyLogs.modelActual}, ${schema.proxyLogs.modelRequested}, '')) = ${model}`;
}

export function buildProxyLogDownstreamKeyCondition(
  downstreamKeyId: number | null | undefined,
) {
  if (downstreamKeyId == null) return null;
  return eq(schema.proxyLogs.downstreamApiKeyId, downstreamKeyId);
}

export function buildProxyLogGroupCondition(group: string | null | undefined) {
  if (!group) return null;
  if (group === PROXY_LOG_GROUP_NONE_TOKEN) {
    return sql<boolean>`coalesce(trim(coalesce(${schema.downstreamApiKeys.groupName}, '')), '') = ''`;
  }
  const lowered = group.toLowerCase();
  return sql<boolean>`lower(coalesce(${schema.downstreamApiKeys.groupName}, '')) = ${lowered}`;
}

export function buildProxyLogStreamCondition(stream: boolean | null | undefined) {
  if (stream == null) return null;
  return eq(schema.proxyLogs.isStream, stream);
}

export interface ProxyLogFilterParams {
  status?: ProxyLogStatusFilter;
  search?: string;
  client?: ProxyLogClientFilter;
  siteId?: number | null;
  fromUtc?: string | null;
  toUtc?: string | null;
  model?: string | null;
  downstreamKeyId?: number | null;
  group?: string | null;
  stream?: boolean | null;
}

export function buildProxyLogWhereClause(params: ProxyLogFilterParams) {
  const conditions = [
    params.status ? buildProxyLogStatusCondition(params.status) : null,
    params.search ? buildProxyLogSearchCondition(params.search) : null,
    params.client ? buildProxyLogClientCondition(params.client) : null,
    params.siteId ? eq(schema.sites.id, params.siteId) : null,
    params.fromUtc ? gte(schema.proxyLogs.createdAt, params.fromUtc) : null,
    params.toUtc ? lt(schema.proxyLogs.createdAt, params.toUtc) : null,
    buildProxyLogModelCondition(params.model),
    buildProxyLogDownstreamKeyCondition(params.downstreamKeyId),
    buildProxyLogGroupCondition(params.group),
    buildProxyLogStreamCondition(params.stream),
  ].filter(
    (condition): condition is NonNullable<typeof condition> =>
      condition !== null,
  );

  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}
