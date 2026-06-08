import { assertLiveLlmConfig, assertRealDataConfig, loadConfig } from "../src/config.js";
import { MockAshareDataSource } from "../src/data/mockDataSource.js";
import { exchangeFromTsCode, mapTushareRows, normalizeAshareTicker, RealAshareDataSource } from "../src/data/realAshareDataSource.js";
import { sourceCatalog } from "../src/data/sourceCatalog.js";
import { MockLlmProvider } from "../src/llm/mockLlmProvider.js";
import { PromptBuilder } from "../src/prompts/promptBuilder.js";
import { InvestmentWorkflow } from "../src/workflow/investmentWorkflow.js";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertMatch(value: string, pattern: RegExp, message: string): void {
  if (!pattern.test(value)) throw new Error(message);
}

function assertThrows(block: () => unknown, pattern: RegExp, message: string): void {
  try {
    block();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!pattern.test(errorMessage)) {
      throw new Error(`${message}: unexpected error ${errorMessage}`);
    }
    return;
  }
  throw new Error(`${message}: function did not throw`);
}

const tests: TestCase[] = [
  {
    name: "loadConfig defaults to mock mode and placeholder-safe LLM settings",
    run: () => {
      const config = loadConfig({});
      assertEqual(config.llmMode, "mock", "LLM mode");
      assertEqual(config.dataMode, "mock", "data mode");
      assertEqual(config.llm.baseUrl, "https://api.deepseek.com/v1", "base URL");
      assertEqual(config.llm.model, "deepseek-chat", "model");
      assertEqual(config.llm.apiKey, undefined, "api key");
      assertEqual(config.llm.timeoutMs, 120_000, "timeout");
      assertEqual(config.llm.maxRetries, 3, "max retries");
      assertEqual(config.data.tushareBaseUrl, "http://api.tushare.pro", "Tushare base URL");
      assertEqual(config.data.tushareToken, undefined, "Tushare token");
    },
  },
  {
    name: "loadConfig reads live LLM settings from environment",
    run: () => {
      const config = loadConfig({
        COPILOT_LLM_MODE: "live",
        COPILOT_DATA_MODE: "real",
        LLM_BASE_URL: "https://example.invalid",
        LLM_MODEL: "model-x",
        LLM_API_KEY: "test-key",
        LLM_TIMEOUT_MS: "12345",
        LLM_MAX_RETRIES: "4",
        TUSHARE_TOKEN: "token-x",
        TUSHARE_BASE_URL: "https://tushare.example.invalid",
        AKTOOLS_BASE_URL: "http://127.0.0.1:8080",
        DATA_REQUEST_TIMEOUT_MS: "23456",
      });
      assertEqual(config.llmMode, "live", "LLM mode");
      assertEqual(config.dataMode, "real", "data mode");
      assertEqual(config.llm.baseUrl, "https://example.invalid", "base URL");
      assertEqual(config.llm.model, "model-x", "model");
      assertEqual(config.llm.apiKey, "test-key", "api key");
      assertEqual(config.llm.timeoutMs, 12_345, "timeout");
      assertEqual(config.llm.maxRetries, 4, "max retries");
      assertEqual(config.data.tushareToken, "token-x", "Tushare token");
      assertEqual(config.data.tushareBaseUrl, "https://tushare.example.invalid", "Tushare base URL");
      assertEqual(config.data.aktoolsBaseUrl, "http://127.0.0.1:8080", "AKTools base URL");
      assertEqual(config.data.requestTimeoutMs, 23_456, "data timeout");
    },
  },
  {
    name: "legacy COPILOT_PROVIDER_MODE still selects live LLM mode",
    run: () => {
      const config = loadConfig({ COPILOT_PROVIDER_MODE: "live" });
      assertEqual(config.llmMode, "live", "legacy LLM mode");
      assertEqual(config.dataMode, "mock", "legacy does not enable real data");
    },
  },
  {
    name: "assertLiveLlmConfig rejects missing API key",
    run: () => {
      assertThrows(
        () => assertLiveLlmConfig({ baseUrl: "https://example.invalid", model: "model-x", timeoutMs: 60_000, maxRetries: 3 }),
        /LLM_API_KEY/,
        "missing key rejection",
      );
    },
  },
  {
    name: "assertRealDataConfig rejects missing real data providers",
    run: () => {
      assertThrows(
        () => assertRealDataConfig({ tushareBaseUrl: "https://api.tushare.pro", requestTimeoutMs: 30_000 }),
        /TUSHARE_TOKEN or AKTOOLS_BASE_URL/,
        "missing real provider rejection",
      );
    },
  },
  {
    name: "ticker normalization maps A-share suffixes safely",
    run: () => {
      assertEqual(normalizeAshareTicker("600519"), "600519.SH", "SH ticker");
      assertEqual(normalizeAshareTicker("000001"), "000001.SZ", "SZ ticker");
      assertEqual(normalizeAshareTicker("830799"), "830799.BJ", "BJ ticker");
      assertEqual(exchangeFromTsCode("600519.SH"), "SH", "SH exchange");
      assertThrows(() => normalizeAshareTicker("BAD"), /Invalid A-share ticker/, "invalid ticker");
    },
  },
  {
    name: "Tushare row mapper converts fields/items response",
    run: () => {
      const rows = mapTushareRows({ code: 0, data: { fields: ["ts_code", "name"], items: [["600519.SH", "贵州茅台"]] } });
      assertEqual(rows[0]?.ts_code, "600519.SH", "ts_code mapping");
      assertEqual(rows[0]?.name, "贵州茅台", "name mapping");
    },
  },
  {
    name: "real provider maps mocked Tushare HTTP data without live API calls",
    run: async () => {
      const calls: string[] = [];
      const provider = new RealAshareDataSource(
        { tushareToken: "token-x", tushareBaseUrl: "https://tushare.example.invalid", requestTimeoutMs: 1000 },
        async (_url, init) => {
          const parsed = JSON.parse(init?.body ?? "{}");
          calls.push(parsed.api_name);
          const emptyResponse = { code: 0, data: { fields: [], items: [] } };
          const payloads: Record<string, unknown> = {
            stock_basic: { code: 0, data: { fields: ["ts_code", "name", "industry"], items: [["600519.SH", "贵州茅台", "食品饮料"]] } },
            daily_basic: { code: 0, data: { fields: ["ts_code", "close", "volume_ratio", "pe_ttm", "pb", "total_mv", "dv_ttm"], items: [["600519.SH", 1688.5, 1.2, 27.8, 8.4, 212000000, 2.1]] } },
            fina_indicator: { code: 0, data: { fields: ["ts_code", "end_date", "roe", "grossprofit_margin", "netprofit_margin", "debt_to_assets", "or_yoy", "netprofit_yoy", "ocfps"], items: [["600519.SH", "20260331", 31.6, 91.4, 52.2, 18.7, 15.3, 17.1, 45.2]] } },
            income: { code: 0, data: { fields: ["ts_code", "end_date", "n_income_attr_p"], items: [["600519.SH", "20260331", 100]] } },
            cashflow: { code: 0, data: { fields: ["ts_code", "end_date", "n_cashflow_act"], items: [["600519.SH", "20260331", 108]] } },
          };
          return { ok: true, status: 200, json: async () => payloads[String(parsed.api_name)] ?? emptyResponse };
        },
      );
      const dataset = await provider.loadStockDataset("600519");
      assert(calls.includes("stock_basic"), "stock_basic call");
      assertEqual(dataset.quote.name, "贵州茅台", "quote name");
      assertEqual(dataset.financials.peTtm, 27.8, "PE mapping");
      assertEqual(dataset.financials.operatingCashFlowToNetIncome, 1.08, "cash flow ratio");
      assert(dataset.sentimentItems.length >= 2, "sentiment placeholders");
    },
  },
  {
    name: "real provider degrades gracefully when some Tushare calls lack permission",
    run: async () => {
      // 真实的 Tushare 错误响应形态：data 为 null（而非 undefined）
      const denied = { code: 40203, data: null, msg: "抱歉，您没有访问该接口的权限，权限的具体详情访问：https://tushare.pro/document/1?doc_id=108" };
      const provider = new RealAshareDataSource(
        { tushareToken: "low-credit-token", tushareBaseUrl: "https://tushare.example.invalid", requestTimeoutMs: 1000 },
        async (_url, init) => {
          const parsed = JSON.parse(init?.body ?? "{}");
          const payload =
            parsed.api_name === "daily"
              ? { code: 0, data: { fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount", "pct_chg"], items: [["600519.SH", "20260610", 1680, 1700, 1675, 1690, 30000, 50000, 0.6], ["600519.SH", "20260609", 1670, 1690, 1665, 1680, 28000, 47000, 0.3]] } }
              : denied;
          return { ok: true, status: 200, json: async () => payload };
        },
      );
      const dataset = await provider.loadStockDataset("600519");
      assertEqual(dataset.quote.name, "600519", "name falls back to ticker");
      assertEqual(dataset.dailyPrices.length, 2, "daily prices kept");
      assert((dataset.dataGaps ?? []).length === 13, "13 of 14 tushare calls recorded as gaps");
      assert((dataset.dataGaps ?? []).some((gap) => gap.includes("股票基础信息")), "gap mentions stock_basic label");
      assert((dataset.dataGaps ?? []).some((gap) => gap.includes("没有访问该接口的权限")), "gap carries tushare message");
    },
  },
  {
    name: "real provider fails fast when every Tushare call fails",
    run: async () => {
      const provider = new RealAshareDataSource(
        { tushareToken: "invalid-token", tushareBaseUrl: "https://tushare.example.invalid", requestTimeoutMs: 1000 },
        async () => ({ ok: true, status: 200, json: async () => ({ code: 2002, msg: "token无效" }) }),
      );
      try {
        await provider.loadStockDataset("600519");
        throw new Error("loadStockDataset should have thrown");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assertMatch(message, /全部获取失败/, "aggregated failure message");
        assertMatch(message, /token无效/, "first tushare error surfaced");
      }
    },
  },
  {
    name: "workflow dry-run returns all six copilot capabilities including debate",
    run: async () => {
      const workflow = new InvestmentWorkflow(new MockAshareDataSource(), new MockLlmProvider());
      const result = await workflow.run("600519");
      assert(Array.isArray(result.knowledgeInsights), "knowledge insights is array");
      assertEqual(result.knowledgeInsights.length, 0, "no knowledge in mock mode");
      assertEqual(result.analysis.ticker, "600519", "analysis ticker");
      assertMatch(result.analysis.companyOverview, /贵州茅台/, "company overview");
      assert(result.analysis.sources.length >= 3, "analysis sources");
      assertEqual(result.report.ticker, "600519", "report ticker");
      assert(result.report.coreThesis.length >= 2, "core thesis");
      assertEqual(result.report.valuationRange.currency, "CNY", "valuation currency");
      assertEqual(result.sentiment.ticker, "600519", "sentiment ticker");
      assert(result.sentiment.sentimentScore >= -1 && result.sentiment.sentimentScore <= 1, "sentiment range");
      assert(result.sentiment.eventTypes.includes("announcement"), "announcement event");
      assertEqual(result.bullCase.ticker, "600519", "bull ticker");
      assertEqual(result.bullCase.side, "bull", "bull side");
      assert(result.bullCase.coreArguments.length >= 3, "bull core arguments");
      assert(result.bullCase.rebuttals.length >= 2, "bull rebuttals");
      assert(result.bullCase.conviction >= 0 && result.bullCase.conviction <= 1, "bull conviction range");
      assertEqual(result.bearCase.ticker, "600519", "bear ticker");
      assertEqual(result.bearCase.side, "bear", "bear side");
      assert(result.bearCase.coreArguments.length >= 2, "bear core arguments");
      assert(result.bearCase.rebuttals.length >= 2, "bear rebuttals");
      assert(result.bearCase.conviction >= 0 && result.bearCase.conviction <= 1, "bear conviction range");
      assertEqual(result.decision.ticker, "600519", "decision ticker");
      assert(["buy", "hold", "sell"].includes(result.decision.action), "decision action");
      assert(result.decision.confidence >= 0 && result.decision.confidence <= 1, "confidence range");
      assertMatch(result.decision.suitability, /不构成个性化投资建议/, "suitability warning");
    },
  },
  {
    name: "source catalog flags licensing and production cautions",
    run: () => {
      const akshare = sourceCatalog.find((source) => source.name === "AKShare");
      const exchange = sourceCatalog.find((source) => source.name === "SSE/SZSE/BSE licensed feeds");
      assertEqual(akshare?.commercialUse, "restricted", "AKShare commercial caution");
      assertEqual(exchange?.commercialUse, "requires_license", "exchange license caution");
    },
  },
  {
    name: "prompt builder separates system instructions from user JSON payload",
    run: () => {
      const builder = new PromptBuilder();
      const prompt = builder.decision(
        { ticker: "600519" },
        {
          ticker: "600519",
          action: "hold",
          confidence: 0.5,
          targetPrice: 1,
          timeHorizon: "6-12 months",
          rationale: [],
          riskWarnings: [],
          counterArguments: [],
          assumptions: [],
          suitability: "test",
          generatedAt: "2026-05-24T00:00:00.000Z",
          sources: [],
        },
      );
      assertMatch(prompt.systemPrompt, /不构成个性化投资建议/, "system advice boundary");
      assert(!prompt.systemPrompt.includes("600519"), "system prompt does not include user ticker");
      assertEqual(JSON.parse(prompt.userPrompt).task, "decision", "user JSON task");
    },
  },
];

for (const testCase of tests) {
  await testCase.run();
  console.log(`ok - ${testCase.name}`);
}
