/**
 * Server-side Kimi gateway helpers: runtime model discovery and typed AI errors.
 * Credentials come only from KIMI_AGENTGW_BASE_URL and KIMI_AGENTGW_API_KEY.
 */

interface NodeLikeProcess {
  env?: Record<string, string | undefined>;
  loadEnvFile?: (path?: string) => void;
}

let envFileLoaded = false;

function loadEnvFileOnce(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const proc = (globalThis as { process?: NodeLikeProcess }).process;
  if (typeof proc?.loadEnvFile !== "function") return;
  try { proc.loadEnvFile(); } catch { /* Normal unprovisioned path. */ }
}

function readEnv(key: string): string | undefined {
  const proc = (globalThis as { process?: NodeLikeProcess }).process;
  const value = proc?.env?.[key];
  if (value !== undefined && value !== "") return value;
  loadEnvFileOnce();
  return proc?.env?.[key];
}

export class AiUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "AiUnavailable"; }
}
export class ContentRejected extends Error {
  constructor(message: string) { super(message); this.name = "ContentRejected"; }
}
export class AiMisconfigured extends Error {
  constructor(message: string) { super(message); this.name = "AiMisconfigured"; }
}
export class AiInvalidRequest extends Error {
  constructor(message: string) { super(message); this.name = "AiInvalidRequest"; }
}
export class AiTransient extends Error {
  constructor(message: string) { super(message); this.name = "AiTransient"; }
}

export interface ModelInfo {
  id: string;
  displayName?: string;
  contextLength?: number;
  supportsReasoning?: boolean;
  supportsImageIn?: boolean;
}
export interface ModelList {
  models: ModelInfo[];
  defaultModelId: string;
}
interface ErrorBody {
  error?: { type?: string; message?: string; code?: string };
  message?: string;
}
interface GatewayConfig { baseUrl: string; apiKey: string }

function config(): GatewayConfig {
  const baseUrl = readEnv("KIMI_AGENTGW_BASE_URL");
  const apiKey = readEnv("KIMI_AGENTGW_API_KEY");
  if (!baseUrl || !apiKey) {
    throw new AiMisconfigured(
      "KIMI_AGENTGW_BASE_URL / KIMI_AGENTGW_API_KEY 未注入：站点可能尚未供给。" +
      "先确认 .env 里有这两个变量；没有则让用户发布（或重新打开）一次站点后重试。",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function mapAiError(status: number, body: ErrorBody | undefined, raw: string): Error {
  const type = body?.error?.type ?? "";
  const detail = body?.error?.message ?? body?.message ?? raw.slice(0, 300);
  if (type === "access_terminated_error") return new AiUnavailable("额度耗尽，此功能不可用");
  if (type.includes("content") || type.includes("moderation")) return new ContentRejected(detail || "内容被拒绝");
  switch (status) {
    case 401: return new AiMisconfigured("网关凭证无效或缺失，需重新部署站点");
    case 402: return new AiUnavailable("会员权益不可用");
    case 400: return type === "payment_required" ? new AiUnavailable("会员权益不可用") : new AiInvalidRequest(detail || "请求参数非法");
    case 403: return new ContentRejected(detail || "内容被拒绝");
    case 429: return new AiTransient("请求过于频繁，稍后重试");
    case 408:
    case 424: return new AiTransient(detail || "上游暂时不可用，稍后重试");
    default:
      if (status >= 500) return new AiTransient("服务繁忙，请稍后再试");
      return new AiInvalidRequest(detail || `请求失败（HTTP ${status}）`);
  }
}

export function classifyAiError(err: unknown): Error {
  if (err instanceof AiUnavailable || err instanceof ContentRejected || err instanceof AiMisconfigured || err instanceof AiInvalidRequest || err instanceof AiTransient) return err;
  const anyErr = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number; body?: unknown };
    data?: unknown;
    error?: unknown;
    cause?: unknown;
    message?: string;
    responseBody?: unknown;
  };
  const status = anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status;
  let body: ErrorBody | undefined;
  const rawBody = anyErr?.response?.body ?? anyErr?.data ?? anyErr?.error ?? anyErr?.responseBody;
  if (rawBody && typeof rawBody === "object") {
    body = rawBody as ErrorBody;
  } else if (typeof rawBody === "string") {
    try { body = JSON.parse(rawBody) as ErrorBody; } catch { body = undefined; }
  }
  if (typeof status === "number") return mapAiError(status, body, typeof rawBody === "string" ? rawBody : "");
  return new AiTransient(anyErr?.message || "AI 调用失败，请稍后重试");
}

export function isRetryableAiError(err: unknown): boolean {
  return err instanceof AiTransient;
}

export async function listModels(): Promise<ModelList> {
  const { baseUrl, apiKey } = config();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AiTransient("无法连接网关读取模型清单，稍后重试");
  }
  const text = await res.text();
  if (!res.ok) {
    let errBody: { error?: { type?: string; message?: string }; message?: string } | undefined;
    try { errBody = text ? JSON.parse(text) : undefined; } catch { errBody = undefined; }
    throw mapAiError(res.status, errBody, text);
  }
  let body: {
    data?: Array<Record<string, unknown>>;
    default_model_id?: string;
    error?: { type?: string; message?: string };
    message?: string;
  };
  try { body = text ? JSON.parse(text) : {}; } catch { throw new AiTransient("模型清单响应无法解析"); }
  const models: ModelInfo[] = (body.data ?? []).map((m) => ({
    id: String(m.id ?? ""),
    displayName: m.display_name as string | undefined,
    contextLength: m.context_length as number | undefined,
    supportsReasoning: m.supports_reasoning as boolean | undefined,
    supportsImageIn: m.supports_image_in as boolean | undefined,
  }));
  const defaultModelId = body.default_model_id ?? models[0]?.id ?? "";
  if (!defaultModelId) throw new AiUnavailable("网关未下发可用模型");
  return { models, defaultModelId };
}
