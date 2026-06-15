import { loadConfig } from "../../../../src/config.js";
import { MockAshareDataSource } from "../../../../src/data/mockDataSource.js";
import { RealAshareDataSource } from "../../../../src/data/realAshareDataSource.js";
import { MockLlmProvider } from "../../../../src/llm/mockLlmProvider.js";
import { OpenAiCompatibleProvider } from "../../../../src/llm/openAiCompatibleProvider.js";
import type { LlmProvider } from "../../../../src/llm/llmProvider.js";
import type { StockDataSource } from "../../../../src/data/dataSource.js";
import { getAllConfig } from "../sim/configService.js";

const LLM_PROVIDERS_LIST = ["anthropic", "openai", "google", "deepseek", "qwen", "zhipu", "moonshot", "minimax", "baichuan", "custom"];

/**
 * 把数据库里保存的 LLM / Tushare 设置同步进 process.env，供 loadConfig 读取。
 * 启动时与每次分析前都会调用，使设置改动无需重启即可生效。
 */
export function syncRuntimeConfigFromDb(): void {
  const savedCfg = getAllConfig();
  if (savedCfg["tushare.token"]) process.env.TUSHARE_TOKEN = String(savedCfg["tushare.token"]);
  if (savedCfg["tushare.baseUrl"]) process.env.TUSHARE_BASE_URL = String(savedCfg["tushare.baseUrl"]);

  const researchProvider = savedCfg["agent.research.provider"] as string | undefined;
  const researchModel = savedCfg["agent.research.model"] as string | undefined;
  const activeLlm = researchProvider || LLM_PROVIDERS_LIST.find((p) => savedCfg[`llm.${p}.enabled`] && savedCfg[`llm.${p}.key`]);
  if (activeLlm) {
    const llmKey = savedCfg[`llm.${activeLlm}.key`];
    const llmUrl = savedCfg[`llm.${activeLlm}.baseUrl`];
    if (llmKey) {
      process.env.LLM_API_KEY = String(llmKey);
      process.env.COPILOT_LLM_MODE = "live";
    }
    if (llmUrl) process.env.LLM_BASE_URL = String(llmUrl).replace(/\/+$/, "").replace(/\/v\d+$/, "");
  } else if (process.env.LLM_API_KEY) {
    process.env.COPILOT_LLM_MODE = "live";
  }
  if (researchModel) process.env.LLM_MODEL = String(researchModel);
  if (savedCfg["tushare.token"] || process.env.TUSHARE_TOKEN) {
    process.env.COPILOT_DATA_MODE = "real";
  }
}

export interface Engine {
  llm: LlmProvider;
  dataSource: StockDataSource;
}

/** 依据当前（已同步的）配置构造 LLM 与数据源，与 CLI 的构造逻辑保持一致。 */
export function buildEngine(opts?: { dryRun?: boolean }): Engine {
  syncRuntimeConfigFromDb();
  const config = loadConfig();
  const dryRun = opts?.dryRun ?? false;
  const llm = dryRun || config.llmMode === "mock" ? new MockLlmProvider() : new OpenAiCompatibleProvider(config.llm);
  const dataSource = !dryRun && config.dataMode === "real" ? new RealAshareDataSource(config.data) : new MockAshareDataSource();
  return { llm, dataSource };
}
