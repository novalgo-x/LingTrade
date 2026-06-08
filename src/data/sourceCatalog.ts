import type { SourceReference } from "../domain/types.js";

export interface SourceCatalogEntry {
  name: string;
  bestFor: string[];
  access: "library" | "rest_api" | "scraping" | "licensed_vendor" | "terminal";
  credibility: SourceReference["credibility"];
  commercialUse: SourceReference["commercialUse"];
  caution: string;
}

export const sourceCatalog: SourceCatalogEntry[] = [
  {
    name: "AKShare",
    bestFor: ["historical_ohlcv", "technical_indicators", "market_snapshot"],
    access: "library",
    credibility: "medium",
    commercialUse: "restricted",
    caution: "Open-source and useful for MVP research, but verify license and upstream website terms before commercial use.",
  },
  {
    name: "Tushare Pro",
    bestFor: ["financial_statements", "valuation_metrics", "industry_comparison"],
    access: "rest_api",
    credibility: "high",
    commercialUse: "allowed",
    caution: "Requires token and credits; use paid/commercial plan for production.",
  },
  {
    name: "CNINFO",
    bestFor: ["official_announcements", "filings", "annual_reports"],
    access: "scraping",
    credibility: "high",
    commercialUse: "allowed",
    caution: "Official disclosure data, but no stable public API; rate-limit and cache fetches.",
  },
  {
    name: "Xueqiu",
    bestFor: ["social_sentiment", "kol_tracking", "discussion_heat"],
    access: "scraping",
    credibility: "medium",
    commercialUse: "restricted",
    caution: "Community sentiment source; scraping/cookie access has ToS and stability risk.",
  },
  {
    name: "SSE/SZSE/BSE licensed feeds",
    bestFor: ["real_time_quotes", "level_1_2_market_data", "official_market_data"],
    access: "licensed_vendor",
    credibility: "high",
    commercialUse: "requires_license",
    caution: "Use licensed exchange/vendor feeds for commercial real-time systems.",
  },
];

export function catalogSourceNames(): string[] {
  return sourceCatalog.map((source) => source.name);
}
