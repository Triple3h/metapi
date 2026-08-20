import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  api,
  type ProxyLogBillingDetails,
  type ProxyLogClientOption,
  type ProxyLogDetail,
  type ProxyLogListItem,
  type ProxyLogsSummary,
  type ProxyLogStatusFilter,
  type ProxyLogUsageSource,
  type ProxyLogsAnalytics,
} from "../api.js";
import UsageStatsCards from "../components/proxy-logs/UsageStatsCards.js";
import DistributionCard from "../components/proxy-logs/DistributionCard.js";
import TokenTrendChart from "../components/proxy-logs/TokenTrendChart.js";
import ColumnSettingsDropdown from "../components/proxy-logs/ColumnSettingsDropdown.js";
import { exportProxyLogsCsv } from "../components/proxy-logs/exportProxyLogsCsv.js";
import { formatCompactTokens, formatCostFixed, formatSecondsFromMs } from "../components/proxy-logs/formatUsage.js";
import { useToast } from "../components/Toast.js";
import { ModelBadge } from "../components/BrandIcon.js";
import SiteBadgeLink from "../components/SiteBadgeLink.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { formatDateTimeLocal } from "./helpers/checkinLogTime.js";
import ModernSelect from "../components/ModernSelect.js";
import { parseProxyLogPathMeta } from "./helpers/proxyLogPathMeta.js";
import { tr } from "../i18n.js";

type ProxyLogRenderItem = ProxyLogListItem & {
  billingDetails?: ProxyLogBillingDetails;
  username?: string | null;
  siteName?: string | null;
  siteUrl?: string | null;
  errorMessage?: string | null;
};

type ProxyLogDetailState = {
  loading: boolean;
  data?: ProxyLogDetail;
  error?: string;
};

type ProxyLogSiteFilterOption = {
  id: number;
  name: string;
  status: string | null;
};


const PAGE_SIZES = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 50;
const PROXY_LOG_CLIENT_FAMILY_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  gemini_cli: "Gemini CLI",
  generic: "通用",
};
const EMPTY_SUMMARY: ProxyLogsSummary = {
  totalCount: 0,
  successCount: 0,
  failedCount: 0,
  totalCost: 0,
  totalTokensAll: 0,
};


function formatLatency(ms: number) {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  }
  return `${ms}ms`;
}

function latencyColor(ms: number) {
  if (ms >= 3000) return "var(--color-danger)";
  if (ms >= 2000)
    return "color-mix(in srgb, var(--color-warning) 30%, var(--color-danger))";
  if (ms >= 1500)
    return "color-mix(in srgb, var(--color-warning) 60%, var(--color-danger))";
  if (ms >= 1000) return "var(--color-warning)";
  if (ms > 500)
    return "color-mix(in srgb, var(--color-success) 60%, var(--color-warning))";
  return "var(--color-success)";
}

function latencyBgColor(ms: number) {
  if (ms >= 3000)
    return "color-mix(in srgb, var(--color-danger) 12%, transparent)";
  if (ms >= 1000)
    return "color-mix(in srgb, var(--color-warning) 12%, transparent)";
  return "color-mix(in srgb, var(--color-success) 12%, transparent)";
}

function firstByteColor(ms: number) {
  if (ms >= 3000) return "var(--color-danger)";
  if (ms >= 1000) return "var(--color-warning)";
  return "var(--color-primary)";
}

function firstByteBgColor(ms: number) {
  if (ms >= 3000)
    return "color-mix(in srgb, var(--color-danger) 12%, transparent)";
  if (ms >= 1000)
    return "color-mix(in srgb, var(--color-warning) 12%, transparent)";
  return "color-mix(in srgb, var(--color-primary) 12%, transparent)";
}

function formatStreamModeLabel(isStream: boolean | null | undefined) {
  if (isStream == null) return null;
  return isStream ? "流式" : "非流";
}

function formatFirstByteLabel(ms: number | null | undefined) {
  if (!Number.isFinite(ms) || typeof ms !== "number" || ms < 0) return null;
  return `首字 ${formatLatency(ms)}`;
}

function formatCompactNumber(value: number, digits = 6) {
  if (!Number.isFinite(value)) return "0";
  const formatted = value.toFixed(digits).replace(/\.?0+$/, "");
  return formatted || "0";
}

function formatPerMillionPrice(value: number) {
  return `$${formatCompactNumber(value)} / 1M tokens`;
}

function isPricinglessBillingDetails(
  detail: ProxyLogBillingDetails | null | undefined,
): boolean {
  if (!detail) return true;
  return detail.breakdown.inputPerMillion === 0
    && detail.breakdown.outputPerMillion === 0;
}

function formatBillingDetailSummary(log: ProxyLogRenderItem) {
  const detail = log.billingDetails;
  if (!detail) return null;
  if (isPricinglessBillingDetails(detail)) return null;
  return `模型倍率 ${formatCompactNumber(detail.pricing.modelRatio)}，输出倍率 ${formatCompactNumber(detail.pricing.completionRatio)}，缓存倍率 ${formatCompactNumber(detail.pricing.cacheRatio)}，缓存创建倍率 ${formatCompactNumber(detail.pricing.cacheCreationRatio)}，分组倍率 ${formatCompactNumber(detail.pricing.groupRatio)}`;
}

function formatProxyLogUsageSource(
  source: ProxyLogUsageSource | undefined,
): string | null {
  if (source === "upstream") return "上游返回";
  if (source === "self-log") return "站点日志回填";
  if (source === "unknown") return "未知";
  return null;
}

function formatProxyLogTokenValue(value: number | null | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "--";
}

function renderDownstreamKeySummary(log: ProxyLogRenderItem) {
  const parts = [
    log.downstreamKeyName ? `下游 Key: ${log.downstreamKeyName}` : null,
    log.downstreamKeyGroupName ? `主分组: ${log.downstreamKeyGroupName}` : null,
    Array.isArray(log.downstreamKeyTags) && log.downstreamKeyTags.length > 0
      ? `标签: ${log.downstreamKeyTags.join(" / ")}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("，") : null;
}

function buildBillingProcessLines(log: ProxyLogRenderItem) {
  const detail = log.billingDetails;
  if (!detail) return [];
  if (isPricinglessBillingDetails(detail)) return [];

  const lines = [
    `提示价格：${formatPerMillionPrice(detail.breakdown.inputPerMillion)}`,
    `补全价格：${formatPerMillionPrice(detail.breakdown.outputPerMillion)}`,
  ];

  if (detail.usage.cacheReadTokens > 0) {
    lines.push(
      `缓存价格：${formatPerMillionPrice(detail.breakdown.cacheReadPerMillion)} (缓存倍率: ${formatCompactNumber(detail.pricing.cacheRatio)})`,
    );
  }

  if (detail.usage.cacheCreationTokens > 0) {
    lines.push(
      `缓存创建价格：${formatPerMillionPrice(detail.breakdown.cacheCreationPerMillion)} (缓存创建倍率: ${formatCompactNumber(detail.pricing.cacheCreationRatio)})`,
    );
  }

  const parts = [
    `提示 ${detail.usage.billablePromptTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.inputPerMillion)}`,
  ];

  if (detail.usage.cacheReadTokens > 0) {
    parts.push(
      `缓存 ${detail.usage.cacheReadTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.cacheReadPerMillion)}`,
    );
  }

  if (detail.usage.cacheCreationTokens > 0) {
    parts.push(
      `缓存创建 ${detail.usage.cacheCreationTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.cacheCreationPerMillion)}`,
    );
  }

  parts.push(
    `补全 ${detail.usage.completionTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.outputPerMillion)} = $${detail.breakdown.totalCost.toFixed(6)}`,
  );
  lines.push(parts.join(" + "));

  return lines;
}

function padDateTimeSegment(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTimeInputValue(value: Date) {
  return `${value.getFullYear()}-${padDateTimeSegment(value.getMonth() + 1)}-${padDateTimeSegment(value.getDate())}T${padDateTimeSegment(value.getHours())}:${padDateTimeSegment(value.getMinutes())}`;
}

function normalizeRoutePage(raw: string | null): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function normalizeRoutePageSize(raw: string | null): number {
  const parsed = Number.parseInt(raw || "", 10);
  return PAGE_SIZES.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

function normalizeRouteStatus(raw: string | null): ProxyLogStatusFilter {
  if (raw === "success" || raw === "failed") return raw;
  return "all";
}

function normalizeRouteSearch(raw: string | null): string {
  return (raw || "").trim();
}

function normalizeRouteClient(raw: string | null): string {
  const text = (raw || "").trim();
  if (!text) return "";
  return /^((app|family):)/i.test(text) ? text : "";
}

function normalizeRouteSiteId(raw: string | null): number | null {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeRouteText(raw: string | null): string {
  return (raw || "").trim();
}

function normalizeRouteStream(raw: string | null): string {
  const text = (raw || "").trim().toLowerCase();
  if (text === "stream" || text === "sync") return text;
  return "";
}

function normalizeRouteDateTimeInput(raw: string | null): string {
  const text = (raw || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatDateTimeInputValue(parsed);
}

function readProxyLogsRouteState(search: string) {
  const params = new URLSearchParams(search);
  return {
    page: normalizeRoutePage(params.get("page")),
    pageSize: normalizeRoutePageSize(params.get("pageSize")),
    status: normalizeRouteStatus(params.get("status")),
    search: normalizeRouteSearch(params.get("q")),
    client: normalizeRouteClient(params.get("client")),
    siteId: normalizeRouteSiteId(params.get("siteId")),
    from: normalizeRouteDateTimeInput(params.get("from")),
    to: normalizeRouteDateTimeInput(params.get("to")),
    model: normalizeRouteText(params.get("model")),
    group: normalizeRouteText(params.get("group")),
    stream: normalizeRouteStream(params.get("stream")),
    keyId: normalizeRouteSiteId(params.get("keyId")),
  };
}

function buildProxyLogsRouteSearch(input: {
  page: number;
  pageSize: number;
  status: ProxyLogStatusFilter;
  search: string;
  client: string;
  siteId: number | null;
  from: string;
  to: string;
  model: string;
  group: string;
  stream: string;
  keyId: number | null;
}) {
  const params = new URLSearchParams();
  if (input.page > 1) params.set("page", String(input.page));
  if (input.pageSize !== DEFAULT_PAGE_SIZE)
    params.set("pageSize", String(input.pageSize));
  if (input.status !== "all") params.set("status", input.status);
  if (input.search.trim()) params.set("q", input.search.trim());
  if (input.client.trim()) params.set("client", input.client.trim());
  if (input.siteId) params.set("siteId", String(input.siteId));
  if (input.from.trim()) params.set("from", input.from.trim());
  if (input.to.trim()) params.set("to", input.to.trim());
  if (input.model.trim()) params.set("model", input.model.trim());
  if (input.group.trim()) params.set("group", input.group.trim());
  if (input.stream.trim()) params.set("stream", input.stream.trim());
  if (input.keyId) params.set("keyId", String(input.keyId));
  const next = params.toString();
  return next ? `?${next}` : "";
}

function formatProxyLogClientFamilyLabel(
  clientFamily?: string | null,
  options?: { includeGeneric?: boolean },
) {
  const normalized =
    typeof clientFamily === "string" ? clientFamily.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (!options?.includeGeneric && normalized === "generic") return null;
  return PROXY_LOG_CLIENT_FAMILY_LABELS[normalized] || clientFamily || null;
}

function resolveProxyLogClientDisplay(
  log: Pick<
    ProxyLogRenderItem,
    "clientFamily" | "clientAppName" | "clientConfidence"
  >,
  options?: { includeGeneric?: boolean },
) {
  const familyLabel = formatProxyLogClientFamilyLabel(
    log.clientFamily,
    options,
  );
  const appName =
    typeof log.clientAppName === "string" ? log.clientAppName.trim() : "";
  if (appName) {
    return {
      primary: appName,
      secondary: familyLabel,
      heuristic: log.clientConfidence === "heuristic",
    };
  }
  return {
    primary: familyLabel,
    secondary: null,
    heuristic: false,
  };
}

function renderProxyLogClientCell(
  log: Pick<
    ProxyLogRenderItem,
    "clientFamily" | "clientAppName" | "clientConfidence"
  >,
  options?: { includeGeneric?: boolean },
) {
  const display = resolveProxyLogClientDisplay(log, options);
  if (!display.primary) {
    return <span style={{ color: "var(--color-text-muted)" }}>-</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span>{display.primary}</span>
        {display.heuristic ? (
          <span
            className="badge"
            style={{
              fontSize: 10,
              color: "var(--color-text-muted)",
              borderColor: "var(--color-border)",
            }}
          >
            推测
          </span>
        ) : null}
      </div>
      {display.secondary ? (
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {display.secondary}
        </span>
      ) : null}
    </div>
  );
}

function toApiTimeBoundary(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}



const PROXY_LOGS_HIDDEN_COLUMNS_STORAGE_KEY = "metapi.proxyLogs.hiddenColumns";

const PROXY_LOG_TABLE_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "time", label: "时间" },
  { key: "model", label: "模型" },
  { key: "group", label: "分组" },
  { key: "site", label: "站点" },
  { key: "status", label: "状态" },
  { key: "latency", label: "用时" },
  { key: "tokens", label: "Token" },
  { key: "cost", label: "花费" },
  { key: "retry", label: "重试" },
];

const ALWAYS_VISIBLE_COLUMNS = new Set(["time", "model", "status"]);

function readStoredHiddenColumns(): Set<string> {
  try {
    const stored = globalThis.localStorage?.getItem(
      PROXY_LOGS_HIDDEN_COLUMNS_STORAGE_KEY,
    );
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (key): key is string =>
          typeof key === "string" && !ALWAYS_VISIBLE_COLUMNS.has(key),
      ),
    );
  } catch {
    return new Set();
  }
}

function persistHiddenColumns(hidden: Set<string>) {
  try {
    globalThis.localStorage?.setItem(
      PROXY_LOGS_HIDDEN_COLUMNS_STORAGE_KEY,
      JSON.stringify(Array.from(hidden)),
    );
  } catch {
    // Ignore storage write failures.
  }
}

export default function ProxyLogs() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialRouteState = useMemo(
    () => readProxyLogsRouteState(location.search),
    [location.search],
  );
  const [logs, setLogs] = useState<ProxyLogListItem[]>([]);
  const [summary, setSummary] = useState<ProxyLogsSummary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ProxyLogStatusFilter>(
    initialRouteState.status,
  );
  const [searchInput, setSearchInput] = useState(initialRouteState.search);
  const deferredSearchInput = useDeferredValue(searchInput.trim());
  const [clientFilter, setClientFilter] = useState(initialRouteState.client);
  const [siteFilter, setSiteFilter] = useState<number | null>(
    initialRouteState.siteId,
  );
  const [fromInput, setFromInput] = useState(initialRouteState.from);
  const [toInput, setToInput] = useState(initialRouteState.to);
  const [modelFilter, setModelFilter] = useState(initialRouteState.model);
  const [groupFilter, setGroupFilter] = useState(initialRouteState.group);
  const [streamFilter, setStreamFilter] = useState(initialRouteState.stream);
  const [keyFilter, setKeyFilter] = useState<number | null>(initialRouteState.keyId);
  const [granularity, setGranularity] = useState<"hour" | "day">("hour");
  const [analytics, setAnalytics] = useState<ProxyLogsAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => readStoredHiddenColumns());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [page, setPage] = useState(initialRouteState.page);
  const [pageSize, setPageSize] = useState(initialRouteState.pageSize);
  const [detailById, setDetailById] = useState<
    Record<number, ProxyLogDetailState>
  >({});
  const [showFilters, setShowFilters] = useState(false);
  const [sites, setSites] = useState<
    Array<{ id: number; name: string; status?: string | null }>
  >([]);
  const [clientOptions, setClientOptions] = useState<ProxyLogClientOption[]>(
    [],
  );
  const [autoRefresh, setAutoRefresh] = useState(false);
  const isMobile = useIsMobile(768);
  const toast = useToast();
  const loadSeq = useRef(0);
  const metaLoadSeq = useRef(0);
  const fromApiBoundary = toApiTimeBoundary(fromInput);
  const toApiBoundaryValue = toApiTimeBoundary(toInput);
  const hasInvalidTimeRange = Boolean(
    fromApiBoundary &&
    toApiBoundaryValue &&
    new Date(fromApiBoundary).getTime() >=
      new Date(toApiBoundaryValue).getTime(),
  );

  useEffect(() => {
    const next = readProxyLogsRouteState(location.search);
    setStatusFilter((current) =>
      current === next.status ? current : next.status,
    );
    setSearchInput((current) =>
      current === next.search ? current : next.search,
    );
    setClientFilter((current) =>
      current === next.client ? current : next.client,
    );
    setSiteFilter((current) =>
      current === next.siteId ? current : next.siteId,
    );
    setFromInput((current) => (current === next.from ? current : next.from));
    setToInput((current) => (current === next.to ? current : next.to));
    setModelFilter((current) => (current === next.model ? current : next.model));
    setGroupFilter((current) => (current === next.group ? current : next.group));
    setStreamFilter((current) => (current === next.stream ? current : next.stream));
    setKeyFilter((current) => (current === next.keyId ? current : next.keyId));
    setPage((current) => (current === next.page ? current : next.page));
    setPageSize((current) =>
      current === next.pageSize ? current : next.pageSize,
    );
  }, [location.search]);

  useEffect(() => {
    const nextSearch = buildProxyLogsRouteSearch({
      page,
      pageSize,
      status: statusFilter,
      search: searchInput,
      client: clientFilter,
      siteId: siteFilter,
      from: fromInput,
      to: toInput,
      model: modelFilter,
      group: groupFilter,
      stream: streamFilter,
      keyId: keyFilter,
    });
    if (nextSearch === location.search) return;
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: true },
    );
  }, [
    clientFilter,
    fromInput,
    groupFilter,
    keyFilter,
    location.pathname,
    location.search,
    modelFilter,
    navigate,
    page,
    pageSize,
    searchInput,
    siteFilter,
    statusFilter,
    streamFilter,
    toInput,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const currentOffset = (safePage - 1) * pageSize;
  const displayedStart = total === 0 ? 0 : currentOffset + 1;
  const displayedEnd =
    total === 0 ? 0 : Math.min(currentOffset + logs.length, total);

  const pageNumbers = useMemo(
    () =>
      Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
        if (totalPages <= 7) return i + 1;
        if (safePage <= 4) return i + 1;
        if (safePage >= totalPages - 3) return totalPages - 6 + i;
        return safePage - 3 + i;
      }),
    [safePage, totalPages],
  );

  const siteOptions = useMemo(() => {
    const options = sites.map((site) => ({
      value: String(site.id),
      label: site.status === "disabled" ? `${site.name}（已禁用）` : site.name,
    }));
    if (
      siteFilter &&
      !options.some((option) => option.value === String(siteFilter))
    ) {
      options.unshift({
        value: String(siteFilter),
        label: `站点 #${siteFilter}（已删除）`,
      });
    }
    return [{ value: "", label: "全部站点" }, ...options];
  }, [siteFilter, sites]);

  const resolvedClientOptions = useMemo(() => {
    const options = [...clientOptions];
    if (
      clientFilter &&
      !options.some((option) => option.value === clientFilter)
    ) {
      options.unshift({
        value: clientFilter,
        label: clientFilter,
      });
    }
    return [{ value: "", label: "全部客户端" }, ...options];
  }, [clientFilter, clientOptions]);

  const activeSiteLabel = useMemo(() => {
    if (!siteFilter) return "全部站点";
    return (
      siteOptions.find((option) => option.value === String(siteFilter))
        ?.label || `站点 #${siteFilter}`
    );
  }, [siteFilter, siteOptions]);
  const siteIdByName = useMemo(() => {
    const index = new Map<string, number>();
    for (const site of sites) {
      const siteName = String(site?.name || "").trim();
      const siteId = Number(site?.id);
      if (
        !siteName ||
        !Number.isFinite(siteId) ||
        siteId <= 0 ||
        index.has(siteName)
      )
        continue;
      index.set(siteName, Math.trunc(siteId));
    }
    return index;
  }, [sites]);

  const baseFilterParams = useMemo(
    () => ({
      status: statusFilter,
      search: deferredSearchInput,
      ...(clientFilter ? { client: clientFilter } : {}),
      ...(siteFilter ? { siteId: siteFilter } : {}),
      ...(fromApiBoundary ? { from: fromApiBoundary } : {}),
      ...(toApiBoundaryValue ? { to: toApiBoundaryValue } : {}),
      ...(modelFilter.trim() ? { model: modelFilter.trim() } : {}),
      ...(groupFilter.trim() ? { group: groupFilter.trim() } : {}),
      ...(streamFilter ? { stream: streamFilter } : {}),
      ...(keyFilter ? { downstreamKeyId: keyFilter } : {}),
    }),
    [
      clientFilter,
      deferredSearchInput,
      fromApiBoundary,
      groupFilter,
      keyFilter,
      modelFilter,
      siteFilter,
      statusFilter,
      streamFilter,
      toApiBoundaryValue,
    ],
  );

  const loadAnalytics = useCallback(async () => {
    if (hasInvalidTimeRange) {
      setAnalytics(null);
      setAnalyticsLoading(false);
      return;
    }
    setAnalyticsLoading(true);
    try {
      const data = await api.getProxyLogsAnalytics({
        ...baseFilterParams,
        granularity,
      });
      setAnalytics(data);
    } catch (error) {
      console.error("Failed to load usage analytics:", error);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [baseFilterParams, granularity, hasInvalidTimeRange]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const applyRangePreset = useCallback((key: string) => {
    const now = new Date();
    const start = new Date(now);
    if (key === "7d") start.setDate(start.getDate() - 7);
    else if (key === "30d") start.setDate(start.getDate() - 30);
    else start.setHours(start.getHours() - 24);
    setFromInput(formatDateTimeInputValue(start));
    setToInput(formatDateTimeInputValue(now));
    setPage(1);
    setGranularity(key === "24h" ? "hour" : "day");
  }, []);

  const activeRangePreset = useMemo(() => {
    if (!fromInput || !toInput) return null;
    const fromMs = new Date(fromInput).getTime();
    const toMs = new Date(toInput).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
    const diffHours = (toMs - fromMs) / 3_600_000;
    if (Math.abs(diffHours - 24) < 1.5) return "24h";
    if (Math.abs(diffHours - 24 * 7) < 12) return "7d";
    if (Math.abs(diffHours - 24 * 30) < 24) return "30d";
    return null;
  }, [fromInput, toInput]);

  const modelOptions = useMemo(() => {
    const names = (analytics?.modelStats ?? [])
      .map((item) => item.label)
      .filter(Boolean);
    return [
      { value: "", label: "全部模型" },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [analytics]);

  const groupOptions = useMemo(() => {
    const items = (analytics?.groupStats ?? []).filter((item) => item.key !== "(none)");
    return [
      { value: "", label: "全部分组" },
      ...items.map((item) => ({ value: item.label, label: item.label })),
    ];
  }, [analytics]);

  const isColumnVisible = useCallback(
    (key: string) => !hiddenColumns.has(key),
    [hiddenColumns],
  );

  const tableColumnCount = useMemo(
    () =>
      1 +
      PROXY_LOG_TABLE_COLUMNS.filter((column) => !hiddenColumns.has(column.key))
        .length,
    [hiddenColumns],
  );

  const load = useCallback(
    async (silent = false) => {
      const seq = ++loadSeq.current;
      if (hasInvalidTimeRange) {
        setLogs([]);
        setTotal(0);
        setSummary(EMPTY_SUMMARY);
        if (seq === loadSeq.current) setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const params = {
          limit: pageSize,
          offset: currentOffset,
          ...baseFilterParams,
        };
        const data = await api.getProxyLogsQuery(params);
        if (seq !== loadSeq.current) return;
        setLogs(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total || 0));
      } catch (e: any) {
        if (seq !== loadSeq.current) return;
        if (!silent) toast.error(e.message || "加载日志失败");
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [
      baseFilterParams,
      currentOffset,
      hasInvalidTimeRange,
      pageSize,
      toast,
    ],
  );

  const loadMeta = useCallback(
    async (forceRefresh = false) => {
      const seq = ++metaLoadSeq.current;
      if (hasInvalidTimeRange) {
        setSummary(EMPTY_SUMMARY);
        setClientOptions([]);
        return;
      }

      try {
        const data = await api.getProxyLogsMeta({
          ...baseFilterParams,
          ...(forceRefresh ? { refresh: 1 } : {}),
        });
        if (seq !== metaLoadSeq.current) return;
        setSummary(data.summary || EMPTY_SUMMARY);
        setClientOptions(
          Array.isArray(data.clientOptions) ? data.clientOptions : [],
        );
        const normalized: ProxyLogSiteFilterOption[] = (
          Array.isArray(data.sites) ? data.sites : []
        )
          .map((site: any) => ({
            id: Number(site?.id || 0),
            name: String(site?.name || "").trim() || `站点 #${site?.id ?? ""}`,
            status: typeof site?.status === "string" ? site.status : null,
          }))
          .filter((site: ProxyLogSiteFilterOption) => site.id > 0)
          .sort(
            (left: ProxyLogSiteFilterOption, right: ProxyLogSiteFilterOption) =>
              left.name.localeCompare(right.name, "zh-CN"),
          );
        setSites(normalized);
      } catch (error) {
        if (seq !== metaLoadSeq.current) return;
        console.error("Failed to load proxy log meta:", error);
      }
    },
    [
      baseFilterParams,
      hasInvalidTimeRange,
    ],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void load(true);
    }, 2000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  useEffect(() => {
    if (page <= totalPages) return;
    setPage(totalPages);
  }, [page, totalPages]);


  useEffect(() => {
    setExpanded((current) =>
      current !== null && logs.some((log) => log.id === current)
        ? current
        : null,
    );
  }, [logs]);


  const loadDetail = useCallback(
    async (id: number) => {
      const existing = detailById[id];
      if (existing?.loading || existing?.data) return;

      setDetailById((current) => ({
        ...current,
        [id]: { loading: true },
      }));

      try {
        const data = await api.getProxyLogDetail(id);
        setDetailById((current) => ({
          ...current,
          [id]: { loading: false, data },
        }));
      } catch (e: any) {
        const message = e?.message || "加载日志详情失败";
        setDetailById((current) => ({
          ...current,
          [id]: { loading: false, error: message },
        }));
        toast.error(message);
      }
    },
    [detailById, toast],
  );

  const handleToggleExpand = useCallback(
    (id: number) => {
      const shouldExpand = expanded !== id;
      setExpanded(shouldExpand ? id : null);
      if (shouldExpand) {
        void loadDetail(id);
      }
    },
    [expanded, loadDetail],
  );

  const filterControls = (
    <>
      <div className="pill-tabs">
        {[
          {
            key: "all" as ProxyLogStatusFilter,
            label: "全部",
            count: summary.totalCount,
          },
          {
            key: "success" as ProxyLogStatusFilter,
            label: "成功",
            count: summary.successCount,
          },
          {
            key: "failed" as ProxyLogStatusFilter,
            label: "失败",
            count: summary.failedCount,
          },
        ].map((tab) => (
          <button
            key={tab.key}
            className={`pill-tab ${statusFilter === tab.key ? "active" : ""}`}
            onClick={() => {
              setStatusFilter(tab.key);
              setPage(1);
            }}
          >
            {tab.label}{" "}
            <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.7 }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>
      <div className="proxy-logs-filter-select">
        <ModernSelect
          size="sm"
          value={clientFilter}
          onChange={(nextValue) => {
            setClientFilter(nextValue);
            setPage(1);
          }}
          options={resolvedClientOptions}
          placeholder="全部客户端"
        />
      </div>
      <div className="proxy-logs-filter-select">
        <ModernSelect
          size="sm"
          value={siteFilter ? String(siteFilter) : ""}
          onChange={(nextValue) => {
            setSiteFilter(nextValue ? Number(nextValue) : null);
            setPage(1);
          }}
          options={siteOptions}
          placeholder="全部站点"
        />
      </div>
      <div className="proxy-logs-filter-select">
        <ModernSelect
          size="sm"
          value={modelFilter}
          onChange={(nextValue) => {
            setModelFilter(nextValue);
            setPage(1);
          }}
          options={modelOptions}
          placeholder="全部模型"
        />
      </div>
      <div className="proxy-logs-filter-select">
        <ModernSelect
          size="sm"
          value={groupFilter}
          onChange={(nextValue) => {
            setGroupFilter(nextValue);
            setPage(1);
          }}
          options={groupOptions}
          placeholder="全部分组"
        />
      </div>
      <div className="proxy-logs-filter-select">
        <ModernSelect
          size="sm"
          value={streamFilter}
          onChange={(nextValue) => {
            setStreamFilter(nextValue);
            setPage(1);
          }}
          options={[
            { value: "", label: "全部类型" },
            { value: "stream", label: "流式" },
            { value: "sync", label: "非流式" },
          ]}
          placeholder="全部类型"
        />
      </div>
      <label className="proxy-logs-time-field">
        <span>开始</span>
        <input
          type="datetime-local"
          value={fromInput}
          max={toInput || undefined}
          onChange={(e) => {
            setFromInput(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <label className="proxy-logs-time-field">
        <span>结束</span>
        <input
          type="datetime-local"
          value={toInput}
          min={fromInput || undefined}
          onChange={(e) => {
            setToInput(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <div className="toolbar-search" style={{ maxWidth: 280 }}>
        <svg
          width="14"
          height="14"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="搜索模型、下游 Key、主分组、标签..."
        />
      </div>
      <button
        type="button"
        className="btn btn-ghost proxy-logs-filter-reset"
        onClick={() => {
          setStatusFilter("all");
          setClientFilter("");
          setSiteFilter(null);
          setModelFilter("");
          setGroupFilter("");
          setStreamFilter("");
          setKeyFilter(null);
          setFromInput("");
          setToInput("");
          setSearchInput("");
          setPage(1);
        }}
      >
        清空筛选
      </button>
      <ColumnSettingsDropdown
        columns={PROXY_LOG_TABLE_COLUMNS.filter(
          (column) => !ALWAYS_VISIBLE_COLUMNS.has(column.key),
        )}
        hiddenColumns={hiddenColumns}
        onToggle={(key) => {
          setHiddenColumns((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            persistHiddenColumns(next);
            return next;
          });
        }}
      />
      <button
        type="button"
        className="btn btn-ghost"
        style={{ border: "1px solid var(--color-border)", padding: "6px 12px", fontSize: 12 }}
        disabled={exporting}
        onClick={() => {
          setExporting(true);
          exportProxyLogsCsv(baseFilterParams)
            .then((count) => toast.success(`已导出 ${count} 条记录`))
            .catch((error) => toast.error(error?.message || "导出失败"))
            .finally(() => setExporting(false));
        }}
      >
        {exporting ? "导出中..." : "导出 CSV"}
      </button>
    </>
  );

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h2 className="page-title">{tr("使用日志")}</h2>
          <div className="page-subtitle">
            按站点、客户端和时间筛选代理请求。
          </div>
        </div>
        <div
          className="page-actions"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <span className="kpi-chip">{activeSiteLabel}</span>
          <span className="kpi-chip kpi-chip-success">
            消耗总额 ${summary.totalCost.toFixed(4)}
          </span>
          <span className="kpi-chip kpi-chip-warning">
            {summary.totalTokensAll.toLocaleString()} tokens
          </span>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`btn btn-ghost${autoRefresh ? " btn-ghost-active" : ""}`}
            style={{
              border: "1px solid var(--color-border)",
              padding: "6px 14px",
            }}
            title={autoRefresh ? "关闭自动刷新" : "开启自动刷新（每2秒）"}
          >
            <svg
              width="14"
              height="14"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              style={{
                animation: autoRefresh ? "spin 1s linear infinite" : "none",
              }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {autoRefresh ? "自动刷新中" : "自动刷新"}
          </button>
          <button
            onClick={() => {
              void load();
              void loadMeta(true);
            }}
            disabled={loading}
            className="btn btn-ghost"
            style={{
              border: "1px solid var(--color-border)",
              padding: "6px 14px",
            }}
          >
            <svg
              width="14"
              height="14"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              style={{
                animation: loading ? "spin 1s linear infinite" : "none",
              }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {loading ? "加载中..." : "刷新"}
          </button>
        </div>
      </div>

      <UsageStatsCards stats={analytics?.stats ?? null} loading={analyticsLoading} />

      <div className="usage-range-bar">
        <div className="usage-range-presets">
          <span className="usage-range-label">时间范围:</span>
          {[
            { key: "24h", label: "近24小时" },
            { key: "7d", label: "近7天" },
            { key: "30d", label: "近30天" },
          ].map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`usage-preset-btn${activeRangePreset === preset.key ? " active" : ""}`}
              onClick={() => applyRangePreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="usage-range-granularity">
          <span className="usage-range-label">粒度:</span>
          <div className="usage-metric-toggle">
            {(["hour", "day"] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={`usage-metric-toggle-btn${granularity === key ? " active" : ""}`}
                onClick={() => setGranularity(key)}
              >
                {key === "hour" ? "按小时" : "按天"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="usage-chart-grid">
        <DistributionCard
          title="模型分布"
          dimensionLabel="模型"
          items={analytics?.modelStats ?? []}
          loading={analyticsLoading}
        />
        <DistributionCard
          title="分组使用分布"
          dimensionLabel="分组"
          items={analytics?.groupStats ?? []}
          loading={analyticsLoading}
        />
        <DistributionCard
          title="站点分布"
          dimensionLabel="站点"
          items={analytics?.siteStats ?? []}
          loading={analyticsLoading}
        />
        <TokenTrendChart trend={analytics?.trend ?? []} loading={analyticsLoading} />
      </div>

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileOpen={() => setShowFilters(true)}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle={tr("筛选日志")}
        mobileContent={filterControls}
        desktopContent={
          <div className="toolbar" style={{ marginBottom: 12 }}>
            {filterControls}
          </div>
        }
      />

      {hasInvalidTimeRange && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          结束时间必须晚于开始时间
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        {loading ? (
          <div
            style={{
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 16 }}>
                <div className="skeleton" style={{ width: 140, height: 16 }} />
                <div className="skeleton" style={{ width: 200, height: 16 }} />
                <div className="skeleton" style={{ width: 50, height: 16 }} />
                <div className="skeleton" style={{ width: 50, height: 16 }} />
                <div className="skeleton" style={{ width: 50, height: 16 }} />
                <div className="skeleton" style={{ width: 70, height: 16 }} />
              </div>
            ))}
          </div>
        ) : isMobile ? (
          <div className="mobile-card-list">
            {logs.map((log) => {
              const detailState = detailById[log.id];
              const detail = detailState?.data;
              const detailLog: ProxyLogRenderItem = detail
                ? { ...log, ...detail }
                : log;
              const pathMeta = parseProxyLogPathMeta(
                detailLog.errorMessage ?? undefined,
              );
              const billingDetailSummary = detail
                ? formatBillingDetailSummary(detailLog)
                : null;
              const billingProcessLines = detail
                ? buildBillingProcessLines(detailLog)
                : [];
              const downstreamKeySummary =
                renderDownstreamKeySummary(detailLog);
              const isExpanded = expanded === log.id;
              const streamModeLabel = formatStreamModeLabel(detailLog.isStream);
              const firstByteLabel = formatFirstByteLabel(
                detailLog.firstByteLatencyMs,
              );

              return (
                <MobileCard
                  key={log.id}
                  title={detailLog.modelRequested || "unknown"}
                  subtitle={formatDateTimeLocal(log.createdAt)}
                  compact
                  headerActions={
                    <span
                      className={`badge ${log.status === "success" ? "badge-success" : "badge-error"}`}
                      style={{ fontSize: 10 }}
                    >
                      {log.status === "success" ? "成功" : "失败"}
                    </span>
                  }
                  footerActions={
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => handleToggleExpand(log.id)}
                    >
                      {isExpanded ? "收起详情" : "详情"}
                    </button>
                  }
                >
                  <div className="mobile-inline-meta-row">
                    <SiteBadgeLink
                      siteId={siteIdByName.get(
                        String(log.siteName || "").trim(),
                      )}
                      siteName={log.siteName}
                      badgeStyle={{ fontSize: 11 }}
                    />
                    {log.username ? (
                      <span
                        className="badge badge-muted"
                        style={{ fontSize: 10 }}
                      >
                        {log.username}
                      </span>
                    ) : null}
                    {streamModeLabel ? (
                      <span
                        className="badge badge-muted"
                        style={{ fontSize: 10 }}
                      >
                        {streamModeLabel}
                      </span>
                    ) : null}
                    {firstByteLabel ? (
                      <span
                        className="badge"
                        style={{
                          fontSize: 10,
                          color: firstByteColor(
                            detailLog.firstByteLatencyMs ?? 0,
                          ),
                          background: firstByteBgColor(
                            detailLog.firstByteLatencyMs ?? 0,
                          ),
                          borderColor: "transparent",
                        }}
                      >
                        {firstByteLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="mobile-summary-grid">
                    <div className="mobile-summary-metric">
                      <div className="mobile-summary-metric-label">用时</div>
                      <div className="mobile-summary-metric-value">
                        {formatLatency(log.latencyMs)}
                      </div>
                    </div>
                    <div className="mobile-summary-metric">
                      <div className="mobile-summary-metric-label">输入</div>
                      <div className="mobile-summary-metric-value">
                        {formatProxyLogTokenValue(log.promptTokens)}
                      </div>
                    </div>
                    <div className="mobile-summary-metric">
                      <div className="mobile-summary-metric-label">输出</div>
                      <div className="mobile-summary-metric-value">
                        {formatProxyLogTokenValue(log.completionTokens)}
                      </div>
                    </div>
                    <div className="mobile-summary-metric">
                      <div className="mobile-summary-metric-label">花费</div>
                      <div className="mobile-summary-metric-value">
                        {typeof log.estimatedCost === "number"
                          ? `$${log.estimatedCost.toFixed(6)}`
                          : "-"}
                      </div>
                    </div>
                    {(detailLog.billingDetails?.usage?.cacheReadTokens ?? 0) > 0 && (
                      <div className="mobile-summary-metric">
                        <div className="mobile-summary-metric-label">缓存</div>
                        <div className="mobile-summary-metric-value">
                          {formatCompactTokens(
                            detailLog.billingDetails?.usage?.cacheReadTokens ??
                              0,
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {isExpanded ? (
                    <div className="mobile-card-extra">
                      <MobileField
                        label="时间"
                        value={formatDateTimeLocal(log.createdAt)}
                      />
                      <MobileField
                        label="站点"
                        value={
                          <SiteBadgeLink
                            siteId={siteIdByName.get(
                              String(log.siteName || "").trim(),
                            )}
                            siteName={log.siteName}
                            badgeStyle={{ fontSize: 11 }}
                          />
                        }
                      />
                      {streamModeLabel ? (
                        <MobileField label="模式" value={streamModeLabel} />
                      ) : null}
                      {firstByteLabel ? (
                        <MobileField
                          label="首字"
                          value={firstByteLabel.replace(/^首字\s*/, "")}
                        />
                      ) : null}
                      <MobileField
                        label="重试"
                        value={log.retryCount > 0 ? log.retryCount : 0}
                      />
                      <MobileField
                        label="用量来源"
                        value={
                          formatProxyLogUsageSource(
                            detailLog.usageSource ?? pathMeta.usageSource,
                          ) || "--"
                        }
                      />
                      {detailState?.loading && (
                        <div style={{ color: "var(--color-text-muted)" }}>
                          加载详情中...
                        </div>
                      )}
                      {detailState?.error && (
                        <div style={{ color: "var(--color-danger)" }}>
                          {detailState.error}
                        </div>
                      )}
                      {billingDetailSummary && (
                        <div style={{ color: "var(--color-text-muted)" }}>
                          {billingDetailSummary}
                        </div>
                      )}
                      <MobileField
                        label="客户端详情"
                        value={renderProxyLogClientCell(detailLog, {
                          includeGeneric: true,
                        })}
                      />
                      {downstreamKeySummary && (
                        <div style={{ color: "var(--color-text-muted)" }}>
                          {downstreamKeySummary}
                        </div>
                      )}
                      {billingProcessLines.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          {billingProcessLines.map((line, index) => (
                            <span key={`${log.id}-billing-mobile-${index}`}>
                              {line}
                            </span>
                          ))}
                        </div>
                      )}
                      {detail && pathMeta.errorMessage.trim().length > 0 && (
                        <div style={{ color: "var(--color-danger)" }}>
                          {pathMeta.errorMessage}
                        </div>
                      )}
                    </div>
                  ) : null}
                </MobileCard>
              );
            })}
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                {isColumnVisible("time") && <th>时间</th>}
                {isColumnVisible("model") && <th>模型</th>}
                {isColumnVisible("group") && <th>分组</th>}
                {isColumnVisible("site") && <th>站点</th>}
                {isColumnVisible("status") && <th>{tr("状态")}</th>}
                {isColumnVisible("latency") && (
                  <th style={{ textAlign: "center" }}>用时</th>
                )}
                {isColumnVisible("tokens") && (
                  <th style={{ textAlign: "right" }}>Token</th>
                )}
                {isColumnVisible("cost") && (
                  <th style={{ textAlign: "right" }}>花费</th>
                )}
                {isColumnVisible("retry") && (
                  <th style={{ textAlign: "center" }}>重试</th>
                )}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const detailState = detailById[log.id];
                const detail = detailState?.data;
                const detailLog: ProxyLogRenderItem = detail
                  ? { ...log, ...detail }
                  : log;
                const pathMeta = parseProxyLogPathMeta(
                  detailLog.errorMessage ?? undefined,
                );
                const billingDetailSummary = detail
                  ? formatBillingDetailSummary(detailLog)
                  : null;
                const billingProcessLines = detail
                  ? buildBillingProcessLines(detailLog)
                  : [];
                const downstreamKeySummary =
                  renderDownstreamKeySummary(detailLog);
                const streamModeLabel = formatStreamModeLabel(
                  detailLog.isStream,
                );
                const firstByteLabel = formatFirstByteLabel(
                  detailLog.firstByteLatencyMs,
                );

                return (
                  <React.Fragment key={log.id}>
                    <tr
                      data-testid={`proxy-log-row-${log.id}`}
                      onClick={() => handleToggleExpand(log.id)}
                      style={{
                        cursor: "pointer",
                        background:
                          expanded === log.id
                            ? "var(--color-primary-light)"
                            : undefined,
                        transition: "background 0.15s",
                      }}
                    >
                      <td style={{ padding: "8px 4px 8px 12px" }}>
                        <svg
                          width="10"
                          height="10"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          style={{
                            transform:
                              expanded === log.id ? "rotate(90deg)" : "none",
                            transition: "transform 0.2s",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </td>
                      {isColumnVisible("time") && (
                        <td
                          style={{
                            fontSize: 12,
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {formatDateTimeLocal(log.createdAt)}
                        </td>
                      )}
                      {isColumnVisible("model") && (
                      <td>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          <ModelBadge
                            model={log.modelRequested}
                            style={{ alignSelf: "flex-start" }}
                          />
                          {(detailLog.siteName || detailLog.username) && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              <SiteBadgeLink
                                siteId={siteIdByName.get(
                                  String(detailLog.siteName || "").trim(),
                                )}
                                siteName={detailLog.siteName}
                                badgeStyle={{ fontSize: 10 }}
                              />
                              {detailLog.username ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: "var(--color-text-muted)",
                                  }}
                                >
                                  账号: {detailLog.username}
                                </span>
                              ) : null}
                            </div>
                          )}
                          {downstreamKeySummary ? (
                            <div
                              style={{
                                fontSize: 11,
                                lineHeight: 1.45,
                                color: "var(--color-text-muted)",
                              }}
                            >
                              {downstreamKeySummary}
                            </div>
                          ) : null}
                          {streamModeLabel || firstByteLabel ? (
                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              {streamModeLabel ? (
                                <span
                                  className="badge badge-muted"
                                  style={{ fontSize: 10 }}
                                >
                                  {streamModeLabel}
                                </span>
                              ) : null}
                              {firstByteLabel ? (
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: 10,
                                    color: firstByteColor(
                                      detailLog.firstByteLatencyMs ?? 0,
                                    ),
                                    background: firstByteBgColor(
                                      detailLog.firstByteLatencyMs ?? 0,
                                    ),
                                    borderColor: "transparent",
                                  }}
                                >
                                  {firstByteLabel}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      )}
                      {isColumnVisible("group") && (
                        <td style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                          {detailLog.downstreamKeyGroupName ? (
                            <span className="badge badge-muted" style={{ fontSize: 10 }}>
                              {detailLog.downstreamKeyGroupName}
                            </span>
                          ) : (
                            <span style={{ color: "var(--color-text-muted)" }}>-</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible("site") && (
                      <td
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        <SiteBadgeLink
                          siteId={siteIdByName.get(
                            String(log.siteName || "").trim(),
                          )}
                          siteName={log.siteName}
                          badgeStyle={{ fontSize: 11 }}
                        />
                      </td>
                      )}
                      {isColumnVisible("status") && (
                      <td>
                        <span
                          className={`badge ${log.status === "success" ? "badge-success" : "badge-error"}`}
                          style={{ fontSize: 11, fontWeight: 600 }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background:
                                log.status === "success"
                                  ? "var(--color-success)"
                                  : "var(--color-danger)",
                            }}
                          />
                          {log.status === "success" ? "成功" : "失败"}
                        </span>
                      </td>
                      )}
                      {isColumnVisible("latency") && (
                        <td style={{ textAlign: "center" }}>
                          <div
                            className="usage-latency-cell"
                            style={{ borderLeftColor: latencyColor(log.latencyMs) }}
                          >
                            <span style={{ color: "var(--color-text-muted)" }}>
                              首字 {formatSecondsFromMs(detailLog.firstByteLatencyMs)}
                            </span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: latencyColor(log.latencyMs),
                              }}
                            >
                              总 {formatSecondsFromMs(log.latencyMs)}
                            </span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible("tokens") && (
                        <td style={{ textAlign: "right" }}>
                          <div className="usage-token-cell">
                            <span>
                              <span style={{ color: "var(--color-text-muted)" }}>↓</span>{" "}
                              {formatProxyLogTokenValue(log.promptTokens)}
                              {" "}
                              <span style={{ color: "var(--color-text-muted)" }}>↑</span>{" "}
                              {formatProxyLogTokenValue(log.completionTokens)}
                            </span>
                            {(detailLog.billingDetails?.usage?.cacheReadTokens ?? 0) > 0 && (
                              <span className="usage-token-cache">
                                缓存 {formatCompactTokens(detailLog.billingDetails?.usage?.cacheReadTokens ?? 0)}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {isColumnVisible("cost") && (
                        <td style={{ textAlign: "right" }}>
                          <span className="usage-cost-value">
                            {typeof log.estimatedCost === "number"
                              ? formatCostFixed(log.estimatedCost)
                              : "-"}
                          </span>
                        </td>
                      )}
                      {isColumnVisible("retry") && (
                      <td style={{ textAlign: "center" }}>
                        {log.retryCount > 0 ? (
                          <span
                            className="badge badge-warning"
                            style={{ fontSize: 11 }}
                          >
                            {log.retryCount}
                          </span>
                        ) : (
                          <span
                            style={{
                              color: "var(--color-text-muted)",
                              fontSize: 12,
                            }}
                          >
                            0
                          </span>
                        )}
                      </td>
                      )}
                    </tr>
                    {expanded === log.id && (
                      <tr style={{ background: "var(--color-bg)" }}>
                        <td colSpan={tableColumnCount} style={{ padding: 0 }}>
                          <div className="anim-collapse is-open">
                            <div className="anim-collapse-inner">
                              <div
                                className="animate-fade-in"
                                style={{
                                  padding: "14px 20px 14px 40px",
                                  borderTop:
                                    "1px solid var(--color-border-light)",
                                  borderBottom:
                                    "1px solid var(--color-border-light)",
                                  fontSize: 12,
                                  lineHeight: 1.9,
                                  color: "var(--color-text-secondary)",
                                }}
                              >
                                <div style={{ display: "flex", gap: 6 }}>
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color: "var(--color-warning)",
                                      flexShrink: 0,
                                    }}
                                  >
                                    日志详情
                                  </span>
                                  <div>
                                    <div>
                                      请求模型:{" "}
                                      <strong
                                        style={{
                                          color: "var(--color-text-primary)",
                                        }}
                                      >
                                        {detailLog.modelRequested}
                                      </strong>
                                      {detailLog.modelActual &&
                                        detailLog.modelActual !==
                                          detailLog.modelRequested && (
                                          <>
                                            {" -> "}实际模型:{" "}
                                            <strong
                                              style={{
                                                color:
                                                  "var(--color-text-primary)",
                                              }}
                                            >
                                              {detailLog.modelActual}
                                            </strong>
                                          </>
                                        )}
                                      ，状态:{" "}
                                      <strong
                                        style={{
                                          color:
                                            detailLog.status === "success"
                                              ? "var(--color-success)"
                                              : "var(--color-danger)",
                                        }}
                                      >
                                        {detailLog.status === "success"
                                          ? "成功"
                                          : "失败"}
                                      </strong>
                                      {streamModeLabel && (
                                        <>
                                          ，模式:{" "}
                                          <strong
                                            style={{
                                              color:
                                                "var(--color-text-primary)",
                                            }}
                                          >
                                            {streamModeLabel}
                                          </strong>
                                        </>
                                      )}
                                      {firstByteLabel && (
                                        <>
                                          ，首字:{" "}
                                          <strong
                                            style={{
                                              color: firstByteColor(
                                                detailLog.firstByteLatencyMs ??
                                                  0,
                                              ),
                                            }}
                                          >
                                            {formatLatency(
                                              detailLog.firstByteLatencyMs ?? 0,
                                            )}
                                          </strong>
                                        </>
                                      )}
                                      ，用时:{" "}
                                      <strong
                                        style={{
                                          color: latencyColor(
                                            detailLog.latencyMs,
                                          ),
                                        }}
                                      >
                                        {formatLatency(detailLog.latencyMs)}
                                      </strong>
                                      {detail && (
                                        <>
                                          ，站点:{" "}
                                          <strong
                                            style={{
                                              color:
                                                "var(--color-text-primary)",
                                            }}
                                          >
                                            {detailLog.siteName || "未知站点"}
                                          </strong>
                                          ，账号:{" "}
                                          <strong
                                            style={{
                                              color:
                                                "var(--color-text-primary)",
                                            }}
                                          >
                                            {detailLog.username || "未知账号"}
                                          </strong>
                                        </>
                                      )}
                                    </div>
                                    {detailState?.loading && (
                                      <div
                                        style={{
                                          color: "var(--color-text-muted)",
                                        }}
                                      >
                                        加载详情中...
                                      </div>
                                    )}
                                    {detailState?.error && (
                                      <div
                                        style={{ color: "var(--color-danger)" }}
                                      >
                                        {detailState.error}
                                      </div>
                                    )}
                                    {billingDetailSummary && (
                                      <div
                                        style={{
                                          color: "var(--color-text-muted)",
                                        }}
                                      >
                                        {billingDetailSummary}
                                      </div>
                                    )}
                                    <div
                                      style={{
                                        color: "var(--color-text-muted)",
                                      }}
                                    >
                                      用量来源：
                                      {formatProxyLogUsageSource(
                                        detailLog.usageSource ??
                                          pathMeta.usageSource,
                                      ) || "未知"}
                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: 6,
                                        alignItems: "flex-start",
                                      }}
                                    >
                                      <span
                                        style={{
                                          color: "var(--color-text-muted)",
                                          flexShrink: 0,
                                        }}
                                      >
                                        客户端
                                      </span>
                                      <div style={{ minWidth: 0 }}>
                                        {renderProxyLogClientCell(detailLog, {
                                          includeGeneric: true,
                                        })}
                                      </div>
                                    </div>
                                    {downstreamKeySummary && (
                                      <div
                                        style={{
                                          color: "var(--color-text-muted)",
                                        }}
                                      >
                                        {downstreamKeySummary}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {detailLog.billingDetails &&
                                  detailLog.billingDetails.usage
                                    .cacheReadTokens > 0 && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <span
                                        style={{
                                          fontWeight: 600,
                                          color: "var(--color-warning)",
                                          flexShrink: 0,
                                        }}
                                      >
                                        缓存 Tokens
                                      </span>
                                      <span>
                                        {detailLog.billingDetails.usage.cacheReadTokens.toLocaleString()}
                                      </span>
                                    </div>
                                  )}

                                {detailLog.billingDetails &&
                                  detailLog.billingDetails.usage
                                    .cacheCreationTokens > 0 && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <span
                                        style={{
                                          fontWeight: 600,
                                          color: "var(--color-warning)",
                                          flexShrink: 0,
                                        }}
                                      >
                                        缓存创建 Tokens
                                      </span>
                                      <span>
                                        {detailLog.billingDetails.usage.cacheCreationTokens.toLocaleString()}
                                      </span>
                                    </div>
                                  )}

                                <div style={{ display: "flex", gap: 6 }}>
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color: "var(--color-info)",
                                      flexShrink: 0,
                                    }}
                                  >
                                    计费过程
                                  </span>
                                  {billingProcessLines.length > 0 ? (
                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 2,
                                      }}
                                    >
                                      {billingProcessLines.map(
                                        (line, index) => (
                                          <span
                                            key={`${log.id}-billing-${index}`}
                                          >
                                            {line}
                                          </span>
                                        ),
                                      )}
                                      <span
                                        style={{
                                          color: "var(--color-text-muted)",
                                        }}
                                      >
                                        仅供参考，以实际扣费为准
                                      </span>
                                    </div>
                                  ) : (
                                    <span>
                                      输入{" "}
                                      {formatProxyLogTokenValue(
                                        detailLog.promptTokens,
                                      )}{" "}
                                      tokens
                                      {" + "}输出{" "}
                                      {formatProxyLogTokenValue(
                                        detailLog.completionTokens,
                                      )}{" "}
                                      tokens
                                      {" = "}总计{" "}
                                      {formatProxyLogTokenValue(
                                        detailLog.totalTokens,
                                      )}{" "}
                                      tokens
                                      {typeof detailLog.estimatedCost ===
                                        "number" && (
                                        <>
                                          ，预估费用{" "}
                                          <strong
                                            style={{
                                              color:
                                                "var(--color-text-primary)",
                                            }}
                                          >
                                            $
                                            {detailLog.estimatedCost.toFixed(6)}
                                          </strong>
                                        </>
                                      )}
                                    </span>
                                  )}
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color: "var(--color-primary)",
                                      flexShrink: 0,
                                    }}
                                  >
                                    下游请求路径
                                  </span>
                                  {detail && pathMeta.downstreamPath ? (
                                    <code
                                      style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 12,
                                        background: "var(--color-bg-card)",
                                        padding: "1px 8px",
                                        borderRadius: 4,
                                        border:
                                          "1px solid var(--color-border-light)",
                                      }}
                                    >
                                      {pathMeta.downstreamPath}
                                    </code>
                                  ) : (
                                    <span
                                      style={{
                                        color: "var(--color-text-muted)",
                                      }}
                                    >
                                      未记录
                                    </span>
                                  )}
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color: "var(--color-primary)",
                                      flexShrink: 0,
                                    }}
                                  >
                                    上游请求路径
                                  </span>
                                  {detail && pathMeta.upstreamPath ? (
                                    <code
                                      style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 12,
                                        background: "var(--color-bg-card)",
                                        padding: "1px 8px",
                                        borderRadius: 4,
                                        border:
                                          "1px solid var(--color-border-light)",
                                      }}
                                    >
                                      {pathMeta.upstreamPath}
                                    </code>
                                  ) : (
                                    <span
                                      style={{
                                        color: "var(--color-text-muted)",
                                      }}
                                    >
                                      未记录
                                    </span>
                                  )}
                                </div>

                                {detail &&
                                  pathMeta.errorMessage.trim().length > 0 && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <span
                                        style={{
                                          fontWeight: 600,
                                          color: "var(--color-danger)",
                                          flexShrink: 0,
                                        }}
                                      >
                                        错误信息
                                      </span>
                                      <span
                                        style={{
                                          color: "var(--color-danger)",
                                          whiteSpace: "pre-wrap",
                                        }}
                                      >
                                        {pathMeta.errorMessage}
                                      </span>
                                    </div>
                                  )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && logs.length === 0 && (
          <div className="empty-state">
            <svg
              className="empty-state-icon"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <div className="empty-state-title">{tr("暂无使用日志")}</div>
            <div className="empty-state-desc">
              当请求通过代理时，日志将显示在这里
            </div>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="pagination">
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginRight: "auto",
            }}
          >
            显示第 {displayedStart} - {displayedEnd} 条，共 {total} 条
          </div>
          <button
            className="pagination-btn"
            disabled={safePage <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            <svg
              width="14"
              height="14"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          {pageNumbers.map((num) => (
            <button
              key={num}
              className={`pagination-btn ${safePage === num ? "active" : ""}`}
              onClick={() => setPage(num)}
            >
              {num}
            </button>
          ))}
          <button
            className="pagination-btn"
            disabled={safePage >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            <svg
              width="14"
              height="14"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          <div className="pagination-size">
            每页条数:
            <div style={{ minWidth: 86 }}>
              <ModernSelect
                size="sm"
                value={String(pageSize)}
                onChange={(nextValue) => {
                  setPageSize(Number(nextValue));
                  setPage(1);
                }}
                options={PAGE_SIZES.map((s) => ({
                  value: String(s),
                  label: String(s),
                }))}
                placeholder={String(pageSize)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
