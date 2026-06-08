import { getConfig as getDbConfig } from "../sim/configService.js";

export interface StockBasicInfo {
  name: string;
  sector: string;
}

interface TushareResponse {
  code: number;
  msg?: string;
  data?: { fields?: string[]; items?: (string | number | null)[][] };
}

function getTushareConfig() {
  const dbToken = getDbConfig<string | undefined>("tushare.token");
  const dbUrl = getDbConfig<string | undefined>("tushare.baseUrl");
  return {
    token: dbToken || process.env.TUSHARE_TOKEN || "",
    baseUrl: dbUrl || process.env.TUSHARE_BASE_URL || "http://api.tushare.pro",
  };
}

function normalizeTickerToTsCode(ticker: string): string {
  const t = ticker.trim();
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(t)) return t;
  if (!/^\d{6}$/.test(t)) throw new Error(`Invalid ticker: ${ticker}`);
  if (t.startsWith("6")) return `${t}.SH`;
  if (t.startsWith("8") || t.startsWith("4")) return `${t}.BJ`;
  return `${t}.SZ`;
}

export async function lookupStockBasic(ticker: string): Promise<StockBasicInfo | null> {
  const { token, baseUrl } = getTushareConfig();
  if (!token) return null;

  const tsCode = normalizeTickerToTsCode(ticker);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_name: "stock_basic",
        token,
        params: { ts_code: tsCode },
        fields: "ts_code,name,industry",
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const json = (await res.json()) as TushareResponse;
    if (json.code !== 0 || !json.data?.fields || !json.data.items?.length) return null;

    const fields = json.data.fields;
    const row = json.data.items[0]!;
    const nameIdx = fields.indexOf("name");
    const industryIdx = fields.indexOf("industry");

    return {
      name: nameIdx >= 0 && typeof row[nameIdx] === "string" ? row[nameIdx] : "",
      sector: industryIdx >= 0 && typeof row[industryIdx] === "string" ? row[industryIdx] : "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
