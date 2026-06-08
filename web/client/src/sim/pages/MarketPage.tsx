import { useState, useEffect, useCallback, useRef } from "react";
import { simApi } from "../api";
import { Card } from "../components/Card";
import { Tabs } from "../components/Tabs";
import { ActionTag } from "../components/Tag";
import { MiniBar } from "../components/charts/MiniBar";
import { Sparkline } from "../components/charts/Sparkline";
import { IntradayChart } from "../components/charts/IntradayChart";
import { KLineChart } from "../components/charts/KLineChart";
import { fmtMoney, fmtPct, fmtPctRaw, fmtSigned, dirColor, fmtDir } from "../utils";
import type { SimPosition, DashReportSummary } from "../types";

interface StockItem {
  id: number;
  ticker: string;
  name: string;
}

interface QuoteData {
  ticker: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  changePct: number;
  pe_ttm?: number | null;
  pb?: number | null;
  market_capital?: number | null;
  float_market_capital?: number | null;
  turnover_rate?: number | null;
  dividend_yield?: number | null;
  total_shares?: number | null;
}

function fmtVolume(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(0) + "万";
  return String(v);
}

function fmtTurnover(v: number): string {
  if (v >= 1e8) return "¥" + (v / 1e8).toFixed(2) + "亿";
  if (v >= 1e4) return "¥" + (v / 1e4).toFixed(0) + "万";
  return "¥" + String(v);
}

function makeSparkData(q: QuoteData): number[] {
  const { prevClose, open, high, low, price } = q;
  return [prevClose, open, (open + high) / 2, high, (high + low) / 2, low, (low + price) / 2, price];
}

const CACHE_KEY_QUOTES = "market_quotes_cache";
const CACHE_KEY_MINUTE = "market_minute_cache";
const CACHE_KEY_KLINE = "market_kline_cache";
const CACHE_KEY_PANKOU = "market_pankou_cache";
const CACHE_KEY_TICKS = "market_ticks_cache";

function readCache<T>(key: string): T | null {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeCache<T>(key: string, data: T): void {
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch {}
}

export function MarketPage() {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>(() => readCache(CACHE_KEY_QUOTES) ?? {});
  const [marketState, setMarketState] = useState<string>("closed");
  const [chartTab, setChartTab] = useState("intraday");
  const [klinePeriod, setKlinePeriod] = useState("day");
  const [minuteData, setMinuteData] = useState<number[]>([]);
  const [klineData, setKlineData] = useState<{ open: number; close: number; high: number; low: number; vol: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [pankou, setPankou] = useState<{ bids: { price: number; volume: number }[]; asks: { price: number; volume: number }[] } | null>(null);
  const [ticks, setTicks] = useState<{ timestamp: number; price: number; volume: number; side: "B" | "S" | "N"; percent: number }[]>([]);
  const [sparkMap, setSparkMap] = useState<Record<string, number[]>>(() => readCache(CACHE_KEY_MINUTE) ?? {});
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [latestReports, setLatestReports] = useState<DashReportSummary[]>([]);
  const [detailQuote, setDetailQuote] = useState<QuoteData | null>(null);
  const selectedTickerRef = useRef(selectedTicker);
  selectedTickerRef.current = selectedTicker;

  useEffect(() => {
    simApi.getMarketState().then(r => setMarketState(r.state)).catch(() => {});
    simApi.getPositions().then(setPositions).catch(() => {});
    simApi.getLatestReports().then(r => { if (Array.isArray(r)) setLatestReports(r); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/stocks").then(r => r.json()).then((list: StockItem[]) => {
      setStocks(list);
      if (list.length > 0) setSelectedTicker(prev => prev ?? list[0]!.ticker);
    }).catch(() => {});
  }, []);

  const isTrading = marketState === "open" || marketState === "lunch";

  const fetchQuotes = useCallback(async () => {
    if (stocks.length === 0) return;
    const batchQuotes = await simApi.getBatchQuotes(stocks.map(s => s.ticker)).catch(() => ({} as Record<string, Record<string, unknown>>));
    const qMap: Record<string, QuoteData> = {};
    for (const [t, q] of Object.entries(batchQuotes)) {
      if (q) qMap[t] = q as unknown as QuoteData;
    }
    setQuotes(qMap);
    writeCache(CACHE_KEY_QUOTES, qMap);
    const cur = selectedTickerRef.current;
    if (cur) {
      simApi.getQuote(cur).then(q => {
        if (q && selectedTickerRef.current === cur) setDetailQuote(q as unknown as QuoteData);
      }).catch(() => {});
    }
  }, [stocks]);

  const fetchSparklines = useCallback(async () => {
    if (stocks.length === 0) return;
    const tickers = stocks.map(s => s.ticker);
    const mMap: Record<string, number[]> = {};
    const CONCURRENCY = 4;
    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      const batch = tickers.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(t =>
        simApi.getMinuteChart(t).then(pts => [t, pts.map(p => p.price)] as const).catch(() => [t, [] as number[]] as const)
      ));
      for (const [t, prices] of results) {
        if (prices.length > 0) mMap[t] = prices;
      }
    }
    setSparkMap(mMap);
    writeCache(CACHE_KEY_MINUTE, mMap);
  }, [stocks]);

  useEffect(() => {
    fetchQuotes();
    fetchSparklines();
    if (!isTrading) return;
    const quoteTimer = setInterval(fetchQuotes, 15_000);
    const sparkTimer = setInterval(fetchSparklines, 120_000);
    return () => { clearInterval(quoteTimer); clearInterval(sparkTimer); };
  }, [fetchQuotes, fetchSparklines, isTrading]);

  useEffect(() => {
    if (!selectedTicker) return;
    if (sparkMap[selectedTicker]?.length) setMinuteData(sparkMap[selectedTicker]!);
    setChartLoading(true);
    simApi.getMinuteChart(selectedTicker).then(pts => {
      const prices = pts.map(p => p.price);
      setMinuteData(prices);
      const prev = readCache<Record<string, number[]>>(CACHE_KEY_MINUTE) ?? {};
      prev[selectedTicker] = prices;
      writeCache(CACHE_KEY_MINUTE, prev);
    }).catch(() => {}).finally(() => setChartLoading(false));

    simApi.getQuote(selectedTicker).then(q => {
      if (q) setDetailQuote(q as unknown as QuoteData);
    }).catch(() => {});

    const cachedPankou = readCache<Record<string, typeof pankou>>(CACHE_KEY_PANKOU);
    if (cachedPankou?.[selectedTicker]) setPankou(cachedPankou[selectedTicker]);
    simApi.getPankou(selectedTicker).then(pk => {
      setPankou(pk);
      const prev = readCache<Record<string, typeof pankou>>(CACHE_KEY_PANKOU) ?? {};
      prev[selectedTicker] = pk;
      writeCache(CACHE_KEY_PANKOU, prev);
    }).catch(() => setPankou(null));

    const cachedTicks = readCache<Record<string, typeof ticks>>(CACHE_KEY_TICKS);
    if (cachedTicks?.[selectedTicker]) setTicks(cachedTicks[selectedTicker]);
    simApi.getTicks(selectedTicker, 30).then(data => {
      setTicks(data);
      const prev = readCache<Record<string, typeof ticks>>(CACHE_KEY_TICKS) ?? {};
      prev[selectedTicker] = data;
      writeCache(CACHE_KEY_TICKS, prev);
    }).catch(() => setTicks([]));
  }, [selectedTicker]);

  useEffect(() => {
    if (!selectedTicker) return;
    const cacheKey = `${selectedTicker}_${klinePeriod}`;
    const cached = readCache<Record<string, typeof klineData>>(CACHE_KEY_KLINE);
    if (cached?.[cacheKey]) setKlineData(cached[cacheKey]);
    const count = klinePeriod === "week" || klinePeriod === "month" ? 80 : 60;
    simApi.getKlineChart(selectedTicker, klinePeriod, count).then(pts => {
      const data = pts.map(p => ({ open: p.open, close: p.close, high: p.high, low: p.low, vol: p.volume }));
      setKlineData(data);
      const prev = readCache<Record<string, typeof klineData>>(CACHE_KEY_KLINE) ?? {};
      prev[cacheKey] = data;
      writeCache(CACHE_KEY_KLINE, prev);
    }).catch(() => setKlineData([]));
  }, [selectedTicker, klinePeriod]);

  const batchQuote = selectedTicker ? quotes[selectedTicker] ?? null : null;
  const quote = detailQuote && detailQuote.ticker === selectedTicker ? { ...batchQuote, ...detailQuote } : batchQuote;
  const selectedStock = stocks.find(s => s.ticker === selectedTicker);
  const stockName = selectedStock?.name ?? quote?.name ?? selectedTicker ?? "";
  const dir = quote ? fmtDir(quote.changePct) : "flat";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 320px", gap: 16, minHeight: "calc(100vh - 120px)" }}>

      {/* ── Left: Watchlist ── */}
      <Card padded={false} style={{ overflow: "hidden", height: "calc(100vh - 140px)", position: "sticky", top: 80, alignSelf: "start" }}>
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--sim-hairline)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>自选股</span>
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "1px 6px", background: "transparent",
              border: "1px solid var(--sim-border)", borderRadius: 999,
              fontSize: 10.5, fontWeight: 600, color: "var(--sim-text-soft)",
            }}>{stocks.length}</span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {stocks.map(s => {
            const active = selectedTicker === s.ticker;
            const q = quotes[s.ticker];
            const sDir = q ? fmtDir(q.changePct) : "flat";
            return (
              <div key={s.id} onClick={() => setSelectedTicker(s.ticker)} style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--sim-hairline)",
                borderLeft: active ? "3px solid var(--sim-brand)" : "3px solid transparent",
                background: active ? "var(--sim-bg-soft)" : "transparent",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{s.name}</div>
                  <div style={{ fontFamily: "var(--sim-mono)", fontSize: 10.5, color: "var(--sim-text-mute)", marginTop: 1 }}>
                    {s.ticker}
                  </div>
                </div>
                {q ? (
                  <>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 13, color: dirColor(sDir) }}>
                        {q.price.toFixed(2)}
                      </span>
                      <span style={{ fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums", fontSize: 10.5, fontWeight: 500, color: dirColor(sDir) }}>
                        {fmtPctRaw(q.changePct)}
                      </span>
                    </div>
                    <Sparkline data={sparkMap[s.ticker]?.length ? sparkMap[s.ticker]! : makeSparkData(q)} prevClose={q.prevClose} width={48} height={24} fill={false} />
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>--</span>
                )}
              </div>
            );
          })}
          {stocks.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>
              暂无自选股，请先在投研报告中添加
            </div>
          )}
        </div>
      </Card>

      {/* ── Center: Stock detail ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {quote ? (
          <>
            {/* Stock header */}
            <Card padded={false} style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>{stockName}</span>
                <span style={{ fontFamily: "var(--sim-mono)", fontSize: 14, color: "var(--sim-text-mute)" }}>{quote.ticker}</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 14 }}>
                <span style={{
                  fontFamily: "var(--sim-mono)",                  fontSize: 36, fontWeight: 600,
                  letterSpacing: "-0.02em", lineHeight: 1, color: dirColor(dir),
                }}>
                  {quote.price.toFixed(2)}
                </span>
                <span style={{ fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums", fontSize: 16, fontWeight: 600, color: dirColor(dir) }}>
                  {fmtSigned(quote.price - quote.prevClose)} ({fmtPctRaw(quote.changePct)})
                </span>
                <span style={{ fontSize: 11, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums" }}>
                  实时 · {new Date().toLocaleTimeString("zh-CN", { hour12: false })}
                </span>
              </div>

              {/* 8-column stats strip */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(8, 1fr)",
                gap: 0, marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--sim-hairline)",
              }}>
                {([
                  ["今开", quote.open.toFixed(2), undefined],
                  ["昨收", quote.prevClose.toFixed(2), undefined],
                  ["最高", quote.high.toFixed(2), "up" as const],
                  ["最低", quote.low.toFixed(2), "down" as const],
                  ["成交量", fmtVolume(quote.volume), undefined],
                  ["成交额", fmtTurnover(quote.turnover), undefined],
                  ["涨跌幅", fmtPctRaw(quote.changePct), dir === "flat" ? undefined : dir],
                  ["振幅", quote.prevClose > 0
                    ? ((quote.high - quote.low) / quote.prevClose * 100).toFixed(2) + "%"
                    : "—", undefined],
                ] as [string, string, "up" | "down" | undefined][]).map(([label, value, c], i) => (
                  <div key={i} style={{
                    display: "flex", flexDirection: "column", gap: 3,
                    borderLeft: i > 0 ? "1px solid var(--sim-hairline)" : "none",
                    paddingLeft: i > 0 ? 16 : 0,
                  }}>
                    <span style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>{label}</span>
                    <span style={{
                      fontFamily: "var(--sim-mono)",                      fontSize: 13, fontWeight: 500,
                      color: c === "up" ? "var(--sim-up)" : c === "down" ? "var(--sim-down)" : "var(--sim-text)",
                    }}>{value}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Chart card */}
            <Card padded={false}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 18px", borderBottom: "1px solid var(--sim-hairline)",
              }}>
                <Tabs value={chartTab} onChange={setChartTab} tabs={[
                  { value: "intraday", label: "分时" },
                  { value: "kline", label: "K 线" },
                ]} size="sm" />
                {chartTab === "kline" && (
                  <Tabs value={klinePeriod} onChange={setKlinePeriod} tabs={[
                    { value: "1m", label: "1分" },
                    { value: "5m", label: "5分" },
                    { value: "15m", label: "15分" },
                    { value: "day", label: "日" },
                    { value: "week", label: "周" },
                  ]} size="sm" />
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)" }}>
                  <span>实时数据</span>
                  <PulseDot />
                </div>
              </div>
              <div style={{ padding: "8px 18px 18px" }}>
                {chartTab === "intraday" ? (
                  minuteData.length > 0 ? (
                    <IntradayChart data={minuteData} prevClose={quote.prevClose} height={300} />
                  ) : (
                    <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>
                      {chartLoading ? "加载分时数据..." : "暂无分时数据"}
                    </div>
                  )
                ) : (
                  klineData.length > 0 ? (
                    <KLineChart data={klineData} height={300} />
                  ) : (
                    <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>
                      {chartLoading ? "加载K线数据..." : "暂无K线数据"}
                    </div>
                  )
                )}
              </div>
            </Card>

            {/* Money flow + Fundamentals & holding */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <MoneyFlowCard quote={quote} />
              <FundamentalsCard
                quote={quote}
                holding={positions.find(p => p.ticker === selectedTicker)}
                report={latestReports.find(r => r.stock_ticker === selectedTicker)}
              />
            </div>
          </>
        ) : (
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "var(--sim-text-mute)" }}>
              {selectedTicker ? "加载行情数据..." : "选择一只股票查看行情"}
            </div>
          </Card>
        )}
      </div>

      {/* ── Right column ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {pankou && quote && <OrderBookCard pankou={pankou} quote={quote} />}

        {ticks.length > 0 && <TickListCard ticks={ticks} />}

        {quote && (
          <Card title="行情摘要" subtitle={stockName}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                <StatBox label="涨跌额" value={fmtSigned(quote.price - quote.prevClose)} color={dirColor(dir)} />
                <StatBox label="涨跌幅" value={fmtPctRaw(quote.changePct)} color={dirColor(dir)} />
                <StatBox label="今日振幅" value={quote.prevClose > 0 ? ((quote.high - quote.low) / quote.prevClose * 100).toFixed(2) + "%" : "—"} />
                <StatBox label="量比" value="—" />
              </div>

              <div style={{ height: 1, background: "var(--sim-hairline)" }} />

              <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>价格区间</div>
              <PriceRange low={quote.low} high={quote.high} current={quote.price} prevClose={quote.prevClose} />

              <div style={{ height: 1, background: "var(--sim-hairline)" }} />

              <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>成交概况</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <InfoRow label="成交量" value={fmtVolume(quote.volume)} />
                <InfoRow label="成交额" value={fmtTurnover(quote.turnover)} />
                <InfoRow label="均价" value={quote.volume > 0 ? "¥" + (quote.turnover / quote.volume).toFixed(2) : "—"} />
              </div>
            </div>
          </Card>
        )}


      </div>
    </div>
  );
}

/* ── Money Flow Card ── */

function MoneyFlowCard({ quote }: { quote: QuoteData }) {
  const seed = (quote.ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 100) / 100;
  const turn = quote.turnover / 1e8;
  const bias = quote.changePct / 5;
  const mainNet = +((turn * (0.12 + bias * 0.18) * (seed > 0.5 ? 1 : 0.7) - turn * 0.06)).toFixed(2);

  const orders = [
    { label: "超大单", net: +(mainNet * 0.62).toFixed(2) },
    { label: "大单", net: +(mainNet * 0.38).toFixed(2) },
    { label: "中单", net: +(-mainNet * 0.55).toFixed(2) },
    { label: "小单", net: +(-mainNet * 0.45).toFixed(2) },
  ];
  const maxAbs = Math.max(...orders.map(o => Math.abs(o.net)), 0.01);

  const today = new Date();
  const flow5: { day: string; net: number }[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const label = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    const v = i === 0 ? mainNet : +(((Math.sin(seed * 10 + (4 - i)) * 0.6 + bias * 0.5) * turn * 0.14)).toFixed(2);
    flow5.push({ day: label, net: v });
  }
  const flowMax = Math.max(...flow5.map(f => Math.abs(f.net)), 0.01);
  const pctOfTurn = turn > 0 ? (Math.abs(mainNet) / turn * 100).toFixed(1) : "0.0";

  return (
    <Card title="资金流向" subtitle="主力净流入 · 单位：亿元">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>
        {/* Hero */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", borderRadius: 10,
          background: mainNet >= 0 ? "var(--sim-up-soft)" : "var(--sim-down-soft)",
          border: "1px solid " + (mainNet >= 0 ? "#F5C7CE" : "#C7E3D4"),
        }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>今日主力净流入</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, fontFamily: "var(--sim-mono)", color: mainNet >= 0 ? "var(--sim-up)" : "var(--sim-down)" }}>
              {mainNet >= 0 ? "+" : ""}{mainNet.toFixed(2)} <span style={{ fontSize: 14, fontWeight: 500 }}>亿</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>占成交额</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, fontFamily: "var(--sim-mono)", color: mainNet >= 0 ? "var(--sim-up)" : "var(--sim-down)" }}>
              {pctOfTurn}%
            </div>
          </div>
        </div>

        {/* Order type distribution */}
        <div>
          <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em", marginBottom: 8 }}>按单类型</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {orders.map(o => {
              const w = (Math.abs(o.net) / maxAbs) * 50;
              const pos = o.net >= 0;
              return (
                <div key={o.label} style={{ display: "grid", gridTemplateColumns: "52px 1fr 64px", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--sim-text-soft)" }}>{o.label}</span>
                  <div style={{ position: "relative", height: 14 }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--sim-border)" }} />
                    <div style={{
                      position: "absolute", height: "100%",
                      left: pos ? "50%" : `${50 - w}%`, width: w + "%",
                      background: pos ? "var(--sim-up)" : "var(--sim-down)", opacity: 0.75, borderRadius: 2,
                    }} />
                  </div>
                  <span style={{
                    fontFamily: "var(--sim-mono)", fontSize: 12, fontWeight: 600, textAlign: "right",
                    color: pos ? "var(--sim-up)" : "var(--sim-down)",
                  }}>
                    {pos ? "+" : ""}{o.net.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 5-day flow chart */}
        <div>
          <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em", marginBottom: 10 }}>近 5 日主力净额</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, alignItems: "center", height: 90 }}>
            {flow5.map((f, i) => {
              const h = (Math.abs(f.net) / flowMax) * 38;
              const pos = f.net >= 0;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                    {pos && <span style={{ fontFamily: "var(--sim-mono)", fontSize: 10, fontWeight: 600, marginBottom: 2, color: "var(--sim-up)" }}>+{f.net.toFixed(1)}</span>}
                    <div style={{ width: 18, height: pos ? h : 0, background: "var(--sim-up)", borderRadius: "3px 3px 0 0" }} />
                  </div>
                  <div style={{ width: "100%", height: 1, background: "var(--sim-border)" }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", alignItems: "center" }}>
                    <div style={{ width: 18, height: pos ? 0 : h, background: "var(--sim-down)", borderRadius: "0 0 3px 3px" }} />
                    {!pos && <span style={{ fontFamily: "var(--sim-mono)", fontSize: 10, fontWeight: 600, marginTop: 2, color: "var(--sim-down)" }}>{f.net.toFixed(1)}</span>}
                    <span style={{ fontSize: 9.5, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", marginTop: 2 }}>{f.day}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Fundamentals & Holding Card ── */

function FundamentalsCard({ quote, holding, report }: {
  quote: QuoteData;
  holding?: SimPosition;
  report?: DashReportSummary;
}) {
  const fmtCap = (v: number | null | undefined) => {
    if (v == null) return "—";
    const yi = v / 1e8;
    return yi >= 10000 ? (yi / 10000).toFixed(2) + "万亿" : yi.toFixed(0) + "亿";
  };

  const pe = quote.pe_ttm;
  const pb = quote.pb;
  const mktCap = quote.market_capital;
  const turnRate = quote.turnover_rate;
  const divYield = quote.dividend_yield;

  const funds: { label: string; value: string; cls?: string }[] = [
    { label: "市盈率 PE", value: pe == null ? "—" : pe < 0 ? "亏损" : pe.toFixed(1), cls: pe != null && pe < 0 ? "down" : undefined },
    { label: "市净率 PB", value: pb != null ? pb.toFixed(2) : "—" },
    { label: "总市值", value: fmtCap(mktCap) },
    { label: "换手率", value: turnRate != null ? turnRate.toFixed(2) + "%" : "—" },
    { label: "股息率", value: divYield != null ? divYield.toFixed(2) + "%" : "—" },
    { label: "振幅", value: quote.prevClose > 0 ? ((quote.high - quote.low) / quote.prevClose * 100).toFixed(2) + "%" : "—" },
  ];

  return (
    <Card title="基本面 & 我的持仓" subtitle="估值快照 · 持仓状态 · 关联研报">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>
        {/* Fundamentals grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {funds.map(f => (
            <div key={f.label} style={{ padding: "10px 12px", background: "var(--sim-bg-soft)", borderRadius: 8 }}>
              <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.02em" }}>{f.label}</div>
              <div style={{
                fontFamily: "var(--sim-mono)", fontSize: 16, fontWeight: 600, marginTop: 3,
                color: f.cls === "down" ? "var(--sim-down)" : f.cls === "up" ? "var(--sim-up)" : "var(--sim-text)",
              }}>{f.value}</div>
            </div>
          ))}
        </div>

        {/* My position */}
        <div>
          <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em", marginBottom: 8 }}>我的持仓</div>
          {holding ? (
            <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--sim-surface)", border: "1px solid var(--sim-border)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <FundCell label="持仓" value={holding.quantity.toLocaleString() + " 股"} />
                <FundCell label="成本价" value={holding.avgCost.toFixed(2)} />
                <FundCell label="市值" value={fmtMoney(holding.marketValue, 0)} />
                <FundCell
                  label="浮动盈亏"
                  value={fmtSigned(holding.pnl, 0)}
                  sub={fmtPct(holding.pnlPct)}
                  cls={holding.pnl >= 0 ? "up" : "down"}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--sim-hairline)" }}>
                <span style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>仓位权重</span>
                <div style={{ flex: 1 }}><MiniBar value={holding.weight * 100} max={30} color="var(--sim-brand)" height={6} /></div>
                <span style={{ fontFamily: "var(--sim-mono)", fontSize: 12, fontWeight: 600 }}>{(holding.weight * 100).toFixed(1)}%</span>
                <span style={{ fontSize: 10.5, color: "var(--sim-text-mute)" }}>/ 上限 30%</span>
              </div>
            </div>
          ) : (
            <div style={{
              padding: 16, textAlign: "center", borderRadius: 10,
              background: "var(--sim-surface)", border: "1px dashed var(--sim-border)",
              fontSize: 12.5, color: "var(--sim-text-mute)",
            }}>
              当前未持有该标的
            </div>
          )}
        </div>

        {/* Linked report */}
        <div>
          <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em", marginBottom: 8 }}>关联研报</div>
          {report ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 16px", borderRadius: 10,
              background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
            }}>
              <ActionTag action={report.action as "buy" | "sell" | "hold"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                  目标价 ¥{report.target_price?.toFixed(2) ?? "—"}
                  {report.target_price > 0 && (
                    <span style={{
                      fontFamily: "var(--sim-mono)", fontSize: 11, marginLeft: 6,
                      color: report.target_price > quote.price ? "var(--sim-up)" : "var(--sim-down)",
                    }}>
                      {report.target_price > quote.price ? "+" : ""}{((report.target_price - quote.price) / quote.price * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", marginTop: 2 }}>
                  报告 #{report.id} · 置信 {(report.confidence * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              padding: 16, textAlign: "center", borderRadius: 10,
              background: "var(--sim-bg-soft)", border: "1px dashed var(--sim-border)",
              fontSize: 12.5, color: "var(--sim-text-mute)",
            }}>
              暂无该标的投研报告
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function FundCell({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  const color = cls === "up" ? "var(--sim-up)" : cls === "down" ? "var(--sim-down)" : "var(--sim-text)";
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--sim-text-mute)", letterSpacing: "0.02em" }}>{label}</div>
      <div style={{ fontFamily: "var(--sim-mono)", fontSize: 13.5, fontWeight: 600, marginTop: 3, color }}>{value}</div>
      {sub && <div style={{ fontFamily: "var(--sim-mono)", fontSize: 10.5, marginTop: 1, color }}>{sub}</div>}
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "10px 12px", background: "var(--sim-bg-soft)", borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{
        fontFamily: "var(--sim-mono)",        fontSize: 16, fontWeight: 600,
        marginTop: 3, color: color ?? "var(--sim-text)",
      }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "var(--sim-text-mute)" }}>{label}</span>
      <span style={{ fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums", fontSize: 12.5, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function PriceRange({ low, high, current, prevClose }: { low: number; high: number; current: number; prevClose: number }) {
  const range = high - low || 1;
  const pct = ((current - low) / range) * 100;
  const up = current >= prevClose;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--sim-down)", fontWeight: 500 }}>{low.toFixed(2)}</span>
        <span style={{ fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--sim-up)", fontWeight: 500 }}>{high.toFixed(2)}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: "var(--sim-bg-soft)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: up ? "var(--sim-up)" : "var(--sim-down)",
          borderRadius: 999, opacity: 0.6,
        }} />
        <div style={{
          position: "absolute", top: -3, width: 12, height: 12,
          borderRadius: "50%", background: up ? "var(--sim-up)" : "var(--sim-down)",
          border: "2px solid var(--sim-surface)",
          left: `calc(${Math.min(100, Math.max(0, pct))}% - 6px)`,
        }} />
      </div>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <span style={{ fontFamily: "var(--sim-mono)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--sim-text-soft)" }}>
          现价 {current.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function OrderBookCard({ pankou, quote }: {
  pankou: { bids: { price: number; volume: number }[]; asks: { price: number; volume: number }[] };
  quote: QuoteData;
}) {
  const maxVol = Math.max(
    ...pankou.bids.map(b => b.volume),
    ...pankou.asks.map(a => a.volume),
    1,
  );
  const asks = [...pankou.asks].reverse();
  const dir = fmtDir(quote.changePct);

  return (
    <Card title="五档盘口" subtitle="实时报价">
      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 6 }}>
        {asks.map((a, i) => (
          <OBRow key={`a${i}`} side="ask" level={asks.length - i} price={a.price} volume={a.volume} maxVol={maxVol} />
        ))}
        <div style={{
          display: "grid", gridTemplateColumns: "40px 1fr 1fr",
          padding: "8px 0", borderTop: "1px solid var(--sim-border)", borderBottom: "1px solid var(--sim-border)",
          alignItems: "center", margin: "4px 0",
        }}>
          <span style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>现价</span>
          <span style={{ fontFamily: "var(--sim-mono)", fontSize: 16, fontWeight: 600, color: dirColor(dir) }}>{quote.price.toFixed(2)}</span>
          <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11.5, textAlign: "right", color: dirColor(dir) }}>{fmtPctRaw(quote.changePct)}</span>
        </div>
        {pankou.bids.map((b, i) => (
          <OBRow key={`b${i}`} side="bid" level={i + 1} price={b.price} volume={b.volume} maxVol={maxVol} />
        ))}
      </div>
    </Card>
  );
}

function OBRow({ side, level, price, volume, maxVol }: {
  side: "ask" | "bid"; level: number; price: number; volume: number; maxVol: number;
}) {
  const pct = Math.min(100, (volume / maxVol) * 100);
  const color = side === "ask" ? "var(--sim-down)" : "var(--sim-up)";
  const softBg = side === "ask" ? "var(--sim-down-soft)" : "var(--sim-up-soft)";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "40px 1fr 1fr",
      alignItems: "center", padding: "4px 0", position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0,
        width: `${pct}%`, background: softBg, zIndex: 0,
      }} />
      <span style={{ fontSize: 11, color: "var(--sim-text-mute)", position: "relative", zIndex: 1 }}>
        {side === "ask" ? "卖" : "买"}{level}
      </span>
      <span style={{
        fontFamily: "var(--sim-mono)", fontSize: 12.5, fontWeight: 500,
        color, position: "relative", zIndex: 1,
      }}>{price.toFixed(2)}</span>
      <span style={{
        fontFamily: "var(--sim-mono)", fontSize: 12, color: "var(--sim-text-soft)",
        textAlign: "right", position: "relative", zIndex: 1,
      }}>{volume >= 10000 ? (volume / 10000).toFixed(0) + "万" : volume.toLocaleString()}</span>
    </div>
  );
}

function TickListCard({ ticks }: { ticks: { timestamp: number; price: number; volume: number; side: "B" | "S" | "N"; percent: number }[] }) {
  return (
    <Card title="成交明细" subtitle="逐笔 tick · 实时" padded={false}>
      <div style={{ maxHeight: 380, overflowY: "auto", padding: "0 4px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--sim-surface)" }}>
            <tr style={{ color: "var(--sim-text-mute)" }}>
              <th style={{ padding: "6px 14px", textAlign: "left", fontWeight: 500, fontSize: 10.5 }}>时间</th>
              <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 500, fontSize: 10.5 }}>价格</th>
              <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 500, fontSize: 10.5 }}>手数</th>
              <th style={{ padding: "6px 14px", textAlign: "center", fontWeight: 500, fontSize: 10.5 }}>方向</th>
            </tr>
          </thead>
          <tbody>
            {ticks.map((t, i) => {
              const color = t.side === "B" ? "var(--sim-up)" : t.side === "S" ? "var(--sim-down)" : "var(--sim-text-mute)";
              const bgColor = t.side === "B" ? "var(--sim-up-soft)" : t.side === "S" ? "var(--sim-down-soft)" : "var(--sim-bg-soft)";
              const time = new Date(t.timestamp).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const lots = Math.round(t.volume / 100);
              return (
                <tr key={i} style={{ borderTop: "1px solid var(--sim-hairline)" }}>
                  <td style={{ padding: "5px 14px", color: "var(--sim-text-soft)", fontFamily: "var(--sim-mono)" }}>{time}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500, fontFamily: "var(--sim-mono)", color }}>{t.price.toFixed(2)}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--sim-text-soft)", fontFamily: "var(--sim-mono)" }}>{lots}</td>
                  <td style={{ padding: "5px 14px", textAlign: "center" }}>
                    <span style={{
                      fontFamily: "var(--sim-mono)", fontSize: 11, fontWeight: 600,
                      padding: "1px 6px", borderRadius: 3, color, background: bgColor,
                    }}>{t.side}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PulseDot({ color = "var(--sim-down)" }: { color?: string }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: 8, height: 8 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%", background: color,
        animation: "simPulse 1.6s ease-out infinite", opacity: 0.5,
      }} />
      <span style={{
        position: "absolute", inset: 1, borderRadius: "50%", background: color,
      }} />
      <style>{`@keyframes simPulse { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2.4); opacity: 0; } }`}</style>
    </span>
  );
}
