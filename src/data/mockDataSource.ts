import type { RawStockDataset, SourceReference } from "../domain/types.js";
import type { StockDataSource } from "./dataSource.js";

function source(name: string, type: SourceReference["type"], note: string): SourceReference {
  return {
    name,
    type,
    credibility: name === "CNINFO" || name === "Tushare Pro" ? "high" : "medium",
    commercialUse: name === "Tushare Pro" || name === "CNINFO" ? "allowed" : "restricted",
    retrievedAt: "2026-05-24T00:00:00.000Z",
    note,
  };
}

export class MockAshareDataSource implements StockDataSource {
  readonly name = "mock-a-share-data";

  async loadStockDataset(ticker: string, _signal?: AbortSignal): Promise<RawStockDataset> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const marketSource = source("AKShare", "market_data", "Mocked MVP market data shaped after AKShare coverage.");
    const financialSource = source("Tushare Pro", "financials", "Mocked financial metrics shaped after Tushare fields.");
    const filingSource = source("CNINFO", "official", "Mocked official announcement provenance.");
    const socialSource = source("Xueqiu", "social", "Mocked social discussion signal for dry-run sentiment.");

    return {
      quote: {
        ticker: normalizedTicker,
        name: normalizedTicker === "600519" ? "贵州茅台" : `示例公司 ${normalizedTicker}`,
        exchange: normalizedTicker.startsWith("6") ? "SH" : "SZ",
        industry: "食品饮料",
        lastPrice: 1688.5,
        marketCapCny: 2_120_000_000_000,
        changePct1d: 1.2,
        changePct20d: 6.4,
        volumeRatio: 1.18,
        dataAsOf: "2026-05-24T00:00:00.000Z",
        sources: [marketSource],
      },
      financials: {
        revenueGrowthYoY: 15.3,
        netProfitGrowthYoY: 17.1,
        grossMargin: 91.4,
        netMargin: 52.2,
        roe: 31.6,
        operatingCashFlowToNetIncome: 1.08,
        debtToAsset: 18.7,
        peTtm: 27.8,
        pb: 8.4,
        dividendYield: 2.1,
        reportingPeriod: "2026Q1",
        sources: [financialSource, filingSource],
      },
      technicals: {
        trend: "uptrend",
        aboveMa20: true,
        aboveMa60: true,
        rsi14: 61.5,
        volatility20d: 18.2,
        support: 1580,
        resistance: 1760,
        sources: [marketSource],
      },
      peers: [
        { peerTicker: "000858", peerName: "五粮液", peTtm: 20.6, pb: 4.9, roe: 24.2, revenueGrowthYoY: 11.8 },
        { peerTicker: "000568", peerName: "泸州老窖", peTtm: 22.4, pb: 6.7, roe: 28.1, revenueGrowthYoY: 13.4 },
      ],
      sentimentItems: [
        {
          sourceType: "announcement",
          title: "公司披露季度经营稳健增长",
          summary: "收入和利润延续双位数增长，现金流质量保持稳定。",
          publishedAt: "2026-05-20T09:30:00.000Z",
          engagement: 65,
          source: filingSource,
        },
        {
          sourceType: "social",
          title: "雪球投资者讨论高端白酒需求修复",
          summary: "多空分歧集中在估值是否充分反映增长韧性。",
          publishedAt: "2026-05-23T12:00:00.000Z",
          engagement: 240,
          source: socialSource,
        },
        {
          sourceType: "research_title",
          title: "券商研报称龙头品牌溢价与分红能力仍具吸引力",
          summary: "研报标题偏正面，但提醒渠道库存和宏观消费风险。",
          publishedAt: "2026-05-22T08:00:00.000Z",
          engagement: 40,
          source: source("Research title feed", "news", "Mocked research-title metadata, not full report content."),
        },
      ],
      dailyPrices: [],
      moneyFlow: [],
      earningsForecasts: [],
      holderTrades: [],
      topList: [],
      topInst: [],
      margin: [],
      institutionSurveys: [],
      concepts: [],
    };
  }
}
