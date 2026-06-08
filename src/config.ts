declare const process: { env: Environment };

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface AppConfig {
  llm: LlmConfig;
  llmMode: "mock" | "live";
  dataMode: "mock" | "real";
  data: DataProviderConfig;
}

export interface DataProviderConfig {
  tushareToken?: string;
  tushareBaseUrl: string;
  aktoolsBaseUrl?: string;
  xueqiuToken?: string;
  requestTimeoutMs: number;
}

export type Environment = Record<string, string | undefined>;

function optionalEnv(name: string, env: Environment): string | undefined {
  const value = env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: Environment = process.env): AppConfig {
  const apiKey = optionalEnv("LLM_API_KEY", env);
  const legacyProviderMode = optionalEnv("COPILOT_PROVIDER_MODE", env);
  const llmMode = optionalEnv("COPILOT_LLM_MODE", env) === "live" || legacyProviderMode === "live" ? "live" : "mock";
  const dataMode = optionalEnv("COPILOT_DATA_MODE", env) === "real" ? "real" : "mock";
  const tushareToken = optionalEnv("TUSHARE_TOKEN", env);
  const aktoolsBaseUrl = optionalEnv("AKTOOLS_BASE_URL", env);
  const xueqiuToken = optionalEnv("XUEQIU_TOKEN", env);
  const llm: LlmConfig = {
    baseUrl: optionalEnv("LLM_BASE_URL", env) ?? "https://api.deepseek.com/v1",
    model: optionalEnv("LLM_MODEL", env) ?? "deepseek-chat",
    timeoutMs: parsePositiveInteger(env.LLM_TIMEOUT_MS, 120_000),
    maxRetries: parsePositiveInteger(env.LLM_MAX_RETRIES, 3),
  };
  if (apiKey) {
    llm.apiKey = apiKey;
  }
  const data: DataProviderConfig = {
    tushareBaseUrl: optionalEnv("TUSHARE_BASE_URL", env) ?? "http://api.tushare.pro",
    requestTimeoutMs: parsePositiveInteger(env.DATA_REQUEST_TIMEOUT_MS, 30_000),
  };
  if (tushareToken) {
    data.tushareToken = tushareToken;
  }
  if (aktoolsBaseUrl) {
    data.aktoolsBaseUrl = aktoolsBaseUrl;
  }
  if (xueqiuToken) {
    data.xueqiuToken = xueqiuToken;
  }
  return {
    llmMode,
    dataMode,
    llm,
    data,
  };
}

export function assertLiveLlmConfig(config: LlmConfig): void {
  const missing: string[] = [];
  if (!config.baseUrl) missing.push("LLM_BASE_URL");
  if (!config.model) missing.push("LLM_MODEL");
  if (!config.apiKey) missing.push("LLM_API_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing required live LLM configuration: ${missing.join(", ")}`);
  }
}

export function assertRealDataConfig(config: DataProviderConfig): void {
  const hasTushare = Boolean(config.tushareToken);
  const hasAktools = Boolean(config.aktoolsBaseUrl);
  if (!hasTushare && !hasAktools) {
    throw new Error("Real data mode requires TUSHARE_TOKEN or AKTOOLS_BASE_URL");
  }
}
