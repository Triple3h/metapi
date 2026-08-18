import { api, type ProxyLogsQuery } from "../../api.js";

const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_ROWS = 10_000;

function escapeCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${parsed.getFullYear()}/${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

export async function exportProxyLogsCsv(
  params: Omit<ProxyLogsQuery, "limit" | "offset">,
): Promise<number> {
  const headers = [
    "时间",
    "状态",
    "API 密钥",
    "分组",
    "站点",
    "账号",
    "请求模型",
    "实际模型",
    "类型",
    "输入 Tokens",
    "输出 Tokens",
    "总 Tokens",
    "费用",
    "首字节耗时(ms)",
    "总耗时(ms)",
    "客户端",
    "错误信息",
  ];
  const rows: string[][] = [headers];

  let offset = 0;
  let exported = 0;
  for (;;) {
    const page = await api.getProxyLogsQuery({
      ...params,
      limit: EXPORT_PAGE_SIZE,
      offset,
    });
    for (const item of page.items) {
      rows.push([
        formatDateTimeLocal(item.createdAt),
        item.status === "success" ? "成功" : "失败",
        item.downstreamKeyName || "",
        item.downstreamKeyGroupName || "",
        item.siteName || "",
        item.username || "",
        item.modelRequested || "",
        item.modelActual || "",
        item.isStream == null ? "" : item.isStream ? "流式" : "非流式",
        String(item.promptTokens ?? 0),
        String(item.completionTokens ?? 0),
        String(item.totalTokens ?? 0),
        (item.estimatedCost ?? 0).toFixed(6),
        item.firstByteLatencyMs == null ? "" : String(item.firstByteLatencyMs),
        String(item.latencyMs ?? 0),
        item.clientAppName || item.clientFamily || "",
        item.errorMessage || "",
      ]);
    }
    exported += page.items.length;
    if (
      page.items.length < EXPORT_PAGE_SIZE
      || offset + EXPORT_PAGE_SIZE >= page.total
      || exported >= EXPORT_MAX_ROWS
    ) {
      break;
    }
    offset += EXPORT_PAGE_SIZE;
  }

  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `usage-logs_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return exported;
}
