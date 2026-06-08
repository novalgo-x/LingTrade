import { Router } from "express";
import { getDb } from "../db/connection.js";
import { getOrCreateAccount, getOrders, getOrderCount, getPortfolioSnapshot, resetAccount, clearDecisions } from "../sim/accountService.js";
import { getAllConfig, setMultipleConfig } from "../sim/configService.js";
import { getCurrentPrice, getBatchQuotes, getMarketState, getMinuteChart, getKlineChart, getPankou, getTradeTicks, getIndexQuotes } from "../sim/virtualMarket.js";
import { start as startScheduler, stop as stopScheduler, getStatus as getSchedulerStatus, runOnce } from "../sim/scheduler.js";
import { getPerformance, getPrevDayNav } from "../sim/performanceService.js";
import type { SimDecisionRow } from "../sim/types.js";

export const simRouter = Router();

// Account overview
simRouter.get("/account", async (_req, res) => {
  try {
    const account = getOrCreateAccount();
    const snapshot = await getPortfolioSnapshot(account.id);
    const orderCount = getOrderCount(account.id);

    const positionValue = snapshot.positions.reduce((s, p) => s + p.marketValue, 0);
    const totalPnl = snapshot.totalAssets - account.initial_balance;
    const mState = getMarketState();
    const initializing = mState === "auction" || mState === "pre";
    const baseAssets = getPrevDayNav(account.id) ?? account.initial_balance;
    const todayPnl = initializing ? null : snapshot.totalAssets - baseAssets;

    res.json({
      id: account.id,
      name: account.name,
      initialBalance: account.initial_balance,
      cashBalance: account.cash_balance,
      totalAssets: snapshot.totalAssets,
      marketValue: positionValue,
      todayPnl,
      todayPnlPct: todayPnl != null && baseAssets > 0 ? todayPnl / baseAssets : null,
      totalPnl,
      totalPnlPct: account.initial_balance > 0 ? totalPnl / account.initial_balance : 0,
      positionCount: snapshot.positions.length,
      orderCount,
      createdAt: account.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// NAV history
simRouter.get("/nav/history", (_req, res) => {
  try {
    const account = getOrCreateAccount();
    const db = getDb();
    const rows = db.prepare(
      "SELECT trade_date, nav FROM sim_daily_nav WHERE account_id = ? ORDER BY trade_date ASC"
    ).all(account.id) as { trade_date: string; nav: number }[];
    res.json(rows.map(r => ({ date: r.trade_date, nav: r.nav })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Positions
simRouter.get("/positions", async (_req, res) => {
  try {
    const account = getOrCreateAccount();
    const snapshot = await getPortfolioSnapshot(account.id);

    const positions = snapshot.positions.map(p => {
      const stock = getDb().prepare("SELECT exchange, sector FROM stocks WHERE id = ?").get(p.stockId) as { exchange: string; sector: string } | undefined;
      return {
        id: 0,
        stockId: p.stockId,
        ticker: p.ticker,
        name: p.name,
        exchange: stock?.exchange ?? "",
        sector: stock?.sector ?? "",
        quantity: p.quantity,
        avgCost: p.avgCost,
        currentPrice: p.currentPrice,
        prevClose: p.currentPrice / (1 + p.todayPnlPct || 1),
        marketValue: p.marketValue,
        costValue: p.quantity * p.avgCost,
        pnl: p.unrealizedPnl,
        pnlPct: p.unrealizedPnlPct,
        todayPnl: p.todayPnl,
        todayPnlPct: p.todayPnlPct,
        weight: p.weight,
        buyDate: p.buyDate,
      };
    });

    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Orders
simRouter.get("/orders", (req, res) => {
  try {
    const account = getOrCreateAccount();
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const side = req.query.side as string | undefined;
    const status = req.query.status as string | undefined;
    const orders = getOrders(account.id, limit, offset, side, status);

    const db = getDb();
    const result = orders.map(o => {
      const stock = db.prepare("SELECT name FROM stocks WHERE id = ?").get(o.stock_id) as { name: string } | undefined;
      const decisionId = o.decision_id
        ?? (db.prepare("SELECT id FROM sim_decisions WHERE order_id = ? LIMIT 1").get(o.id) as { id: number } | undefined)?.id
        ?? null;
      return {
        id: o.id,
        decisionId,
        ticker: o.ticker,
        name: stock?.name ?? o.ticker,
        side: o.side,
        quantity: o.quantity,
        price: o.price,
        amount: o.amount,
        commission: o.commission,
        stampDuty: o.stamp_duty,
        fee: o.commission + o.stamp_duty,
        status: o.status,
        rejectReason: o.reject_reason,
        agentId: decisionId ? `DEC-${decisionId}` : null,
        createdAt: o.created_at,
      };
    });

    res.json({ data: result, total: getOrderCount(account.id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Decisions
simRouter.get("/decisions", (req, res) => {
  try {
    const account = getOrCreateAccount();
    const db = getDb();
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const action = req.query.action as string | undefined;

    let sql = "SELECT * FROM sim_decisions WHERE account_id = ?";
    const params: unknown[] = [account.id];
    if (action) { sql += " AND action = ?"; params.push(action); }
    const date = req.query.date as string | undefined;
    if (date) {
      const start = `${date}T00:00:00+08:00`;
      const end = `${date}T23:59:59+08:00`;
      const utcStart = new Date(start).toISOString();
      const utcEnd = new Date(end).toISOString();
      sql += " AND created_at >= ? AND created_at <= ?";
      params.push(utcStart, utcEnd);
    }
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as SimDecisionRow[];
    const total = (db.prepare("SELECT COUNT(*) as cnt FROM sim_decisions WHERE account_id = ?").get(account.id) as { cnt: number }).cnt;

    const data = rows.map(d => {
      const stock = d.stock_id ? db.prepare("SELECT name FROM stocks WHERE id = ?").get(d.stock_id) as { name: string } | undefined : undefined;
      let riskChecks: unknown[] = [];
      try { riskChecks = d.risk_check_result ? (JSON.parse(d.risk_check_result) as { checks?: unknown[] }).checks ?? [] : []; } catch {}

      return {
        id: d.id,
        cycleId: d.cycle_id,
        stockId: d.stock_id,
        ticker: d.ticker,
        name: stock?.name ?? d.ticker,
        action: d.action,
        quantity: d.quantity,
        price: d.price_at_decision,
        confidence: d.confidence,
        reasoning: d.reasoning,
        status: d.final_action === "executed" ? "executed" : d.final_action === "rejected" ? "rejected" : "evaluated",
        riskScore: d.confidence >= 0.7 ? "low" : d.confidence >= 0.4 ? "medium" : "high",
        triggers: d.triggers ? JSON.parse(d.triggers) : [],
        reportId: d.report_id,
        portfolioSnapshot: d.portfolio_snapshot ? JSON.parse(d.portfolio_snapshot) : null,
        riskChecks,
        riskAction: d.risk_action,
        orderId: d.order_id,
        marketOutlook: d.market_outlook,
        createdAt: d.created_at,
      };
    });

    res.json({ data, total });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Single decision detail
simRouter.get("/decisions/:id", (req, res) => {
  try {
    const db = getDb();
    const d = db.prepare("SELECT * FROM sim_decisions WHERE id = ?").get(req.params.id) as SimDecisionRow | undefined;
    if (!d) return res.status(404).json({ error: "Not found" });

    const stock = d.stock_id ? db.prepare("SELECT name FROM stocks WHERE id = ?").get(d.stock_id) as { name: string } | undefined : undefined;
    let riskChecks: unknown[] = [];
    try { riskChecks = d.risk_check_result ? (JSON.parse(d.risk_check_result) as { checks?: unknown[] }).checks ?? [] : []; } catch {}

    let linkedReport: unknown = null;
    if (d.report_id) {
      const rpt = db.prepare("SELECT r.id, r.result_json, r.created_at, s.name as stock_name FROM reports r JOIN stocks s ON s.id = r.stock_id WHERE r.id = ?").get(d.report_id) as { id: number; result_json: string; created_at: string; stock_name: string } | undefined;
      if (rpt) {
        try {
          const parsed = JSON.parse(rpt.result_json);
          linkedReport = {
            id: rpt.id,
            stockName: rpt.stock_name,
            createdAt: rpt.created_at,
            report: parsed.report ?? null,
            decision: parsed.decision ?? null,
            bullCase: parsed.bullCase ?? null,
            bearCase: parsed.bearCase ?? null,
          };
        } catch {}
      }
    }

    res.json({
      id: d.id, cycleId: d.cycle_id, stockId: d.stock_id, ticker: d.ticker,
      name: stock?.name ?? d.ticker, action: d.action, quantity: d.quantity,
      price: d.price_at_decision, confidence: d.confidence, reasoning: d.reasoning,
      status: d.final_action === "executed" ? "executed" : d.final_action === "rejected" ? "rejected" : "evaluated",
      riskScore: d.confidence >= 0.7 ? "low" : d.confidence >= 0.4 ? "medium" : "high",
      triggers: d.triggers ? JSON.parse(d.triggers) : [],
      reportId: d.report_id,
      linkedReport,
      portfolioSnapshot: d.portfolio_snapshot ? JSON.parse(d.portfolio_snapshot) : null,
      riskChecks, riskAction: d.risk_action, orderId: d.order_id,
      marketOutlook: d.market_outlook, createdAt: d.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Performance
simRouter.get("/performance", async (_req, res) => {
  try {
    const metrics = await getPerformance();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Config
simRouter.get("/config", (_req, res) => {
  res.json(getAllConfig());
});

simRouter.put("/config", (req, res) => {
  try {
    setMultipleConfig(req.body);
    res.json(getAllConfig());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/tushare", (_req, res) => {
  const allCfg = getAllConfig();
  const hasDbToken = "tushare.token" in allCfg;
  const hasDbUrl = "tushare.baseUrl" in allCfg;
  const token = hasDbToken ? String(allCfg["tushare.token"] ?? "") : (process.env.TUSHARE_TOKEN ?? "");
  const baseUrl = hasDbUrl ? String(allCfg["tushare.baseUrl"] ?? "") : (process.env.TUSHARE_BASE_URL ?? "");
  const masked = token ? token.slice(0, 6) + "••••••••" + token.slice(-4) : "";
  const verified = Boolean(allCfg["tushare.verified"]);
  res.json({ token: masked, rawToken: token, baseUrl, verified });
});

simRouter.post("/tushare/test", async (req, res) => {
  const { token, baseUrl } = req.body as { token?: string; baseUrl?: string };
  const dbToken = getAllConfig()["tushare.token"];
  const dbUrl = getAllConfig()["tushare.baseUrl"];
  const t = token ?? (dbToken ? String(dbToken) : (process.env.TUSHARE_TOKEN || ""));
  // baseUrl === "" means the user cleared the field → use the official endpoint, not the stored one
  const u = (baseUrl ?? (dbUrl ? String(dbUrl) : (process.env.TUSHARE_BASE_URL || ""))) || "http://api.tushare.pro";
  if (!t) { res.status(400).json({ ok: false, error: "Token 为空" }); return; }

  try {
    const start = Date.now();
    // 用 daily（日线行情）做连通性验证：它是积分门槛最低的接口之一（120 分即可），
    // 低积分 token 也能通过测试；stock_basic 需要 2000 分，会把有效的低分 token 误判为无效。
    // 窗口取 30 天以跨越最长的节假日休市
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    const r = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_name: "daily",
        token: t,
        params: { ts_code: "000001.SZ", start_date: fmt(startDate), end_date: fmt(endDate) },
        fields: "ts_code,trade_date,close",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const elapsed = Date.now() - start;
    if (!r.ok) { res.json({ ok: false, error: `HTTP ${r.status}` }); return; }
    const json = await r.json() as { code: number; msg?: string; data?: { items?: unknown[][] } };
    if (json.code !== 0) { res.json({ ok: false, error: json.msg ?? `code=${json.code}` }); return; }
    const hasData = !!(json.data?.items?.length);
    if (hasData) {
      // A successful test persists the verified credentials, so that "test passed"
      // can never drift apart from what is actually stored
      const entries: Record<string, unknown> = { "tushare.verified": true };
      if (token !== undefined) {
        entries["tushare.token"] = token;
        process.env.TUSHARE_TOKEN = token;
        if (token) process.env.COPILOT_DATA_MODE = "real";
      }
      if (baseUrl !== undefined) {
        entries["tushare.baseUrl"] = baseUrl;
        process.env.TUSHARE_BASE_URL = baseUrl;
      }
      setMultipleConfig(entries);
    } else {
      setMultipleConfig({ "tushare.verified": false });
    }
    res.json({ ok: hasData, latency: elapsed, error: hasData ? undefined : "返回数据为空" });
  } catch (e: unknown) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? "连接超时 (10s)" : String(e);
    res.json({ ok: false, error: msg });
  }
});

simRouter.post("/tushare/save", (req, res) => {
  const { token, baseUrl } = req.body as { token?: string; baseUrl?: string };
  if (token !== undefined) {
    process.env.TUSHARE_TOKEN = token;
    if (token) process.env.COPILOT_DATA_MODE = "real";
  }
  if (baseUrl !== undefined) process.env.TUSHARE_BASE_URL = baseUrl;
  const cfg = getAllConfig();
  const entries: Record<string, unknown> = {};
  if (token !== undefined) entries["tushare.token"] = token;
  if (baseUrl !== undefined) entries["tushare.baseUrl"] = baseUrl;
  const tokenChanged = (token !== undefined && cfg["tushare.token"] !== token) ||
    (baseUrl !== undefined && cfg["tushare.baseUrl"] !== baseUrl);
  if (tokenChanged) entries["tushare.verified"] = false;
  if (Object.keys(entries).length > 0) setMultipleConfig(entries);
  res.json({ ok: true });
});

// Xueqiu
simRouter.get("/xueqiu", (_req, res) => {
  const allCfg = getAllConfig();
  const cookie = allCfg["xueqiu.cookie"] ? String(allCfg["xueqiu.cookie"]) : "";
  res.json({ cookie, mode: cookie ? "manual" : "auto" });
});

simRouter.post("/xueqiu/test", async (req, res) => {
  const { cookie } = req.body as { cookie?: string };
  const testCookie = cookie ?? "";
  let effectiveCookie = testCookie;

  if (!effectiveCookie) {
    try {
      const resp = await fetch("https://xueqiu.com/hq", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(10_000),
      });
      const raw = resp.headers.getSetCookie();
      if (raw.length > 0) effectiveCookie = raw.map(c => c.split(";")[0]).join("; ");
    } catch (e) {
      const msg = e instanceof Error && e.name === "TimeoutError" ? "连接超时 (10s)" : "自动获取 cookie 失败: " + String(e);
      res.json({ ok: false, error: msg });
      return;
    }
  }
  if (!effectiveCookie) { res.json({ ok: false, error: "无法获取有效 cookie" }); return; }

  try {
    const start = Date.now();
    const r = await fetch("https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=SH000001", {
      headers: { Cookie: effectiveCookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", Referer: "https://xueqiu.com/" },
      signal: AbortSignal.timeout(10_000),
    });
    const elapsed = Date.now() - start;
    if (!r.ok) { res.json({ ok: false, error: `HTTP ${r.status}` }); return; }
    const json = await r.json() as { error_code?: number; error_description?: string; data?: unknown[] };
    if (json.error_code && json.error_code !== 0) { res.json({ ok: false, error: json.error_description ?? `error_code=${json.error_code}` }); return; }
    const hasData = Array.isArray(json.data) && json.data.length > 0;
    res.json({ ok: hasData, latency: elapsed, mode: testCookie ? "manual" : "auto" });
  } catch (e: unknown) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? "连接超时 (10s)" : String(e);
    res.json({ ok: false, error: msg });
  }
});

simRouter.post("/xueqiu/save", (req, res) => {
  const { cookie } = req.body as { cookie?: string };
  setMultipleConfig({ "xueqiu.cookie": cookie ?? "" });
  res.json({ ok: true });
});

// LLM provider management
function llmUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  return /\/v\d+$/.test(b) ? `${b}${path}` : `${b}/v1${path}`;
}

function llmBaseForEnv(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v\d+$/, "");
}

function syncLlmToEnv(): void {
  const cfg = getAllConfig();
  const researchProvider = cfg["agent.research.provider"] as string | undefined;
  const researchModel = cfg["agent.research.model"] as string | undefined;
  const providers = ["anthropic", "openai", "google", "deepseek", "qwen", "zhipu", "moonshot", "minimax", "baichuan", "custom"];
  const activeId = researchProvider || providers.find(p => cfg[`llm.${p}.enabled`] && cfg[`llm.${p}.key`]);
  if (activeId) {
    const key = cfg[`llm.${activeId}.key`];
    const url = cfg[`llm.${activeId}.baseUrl`];
    if (key) {
      process.env.LLM_API_KEY = String(key);
      process.env.COPILOT_LLM_MODE = "live";
    }
    if (url) process.env.LLM_BASE_URL = llmBaseForEnv(String(url));
  }
  if (researchModel) process.env.LLM_MODEL = String(researchModel);
}

simRouter.get("/llm/status", (_req, res) => {
  const cfg = getAllConfig();
  const providers = ["anthropic", "openai", "google", "deepseek", "qwen", "zhipu", "moonshot", "minimax", "baichuan", "custom"];
  const activeId = providers.find(p => cfg[`llm.${p}.enabled`] && cfg[`llm.${p}.key`]);
  const hasEnvKey = !!process.env.LLM_API_KEY;
  const verified = Boolean(cfg["llm.verified"]);
  res.json({ configured: !!(activeId || hasEnvKey), verified });
});

simRouter.post("/llm/test", async (req, res) => {
  const { apiKey, baseUrl, model, id } = req.body as { apiKey: string; baseUrl: string; model?: string; id?: string };
  if (!apiKey || !baseUrl) return res.json({ ok: false, error: "API Key 和 Base URL 不能为空" });
  try {
    const start = Date.now();
    const r = await fetch(llmUrl(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || "gpt-4o-mini", messages: [{ role: "user", content: "Hi" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - start;
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.json({ ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 200)}` });
    }
    // A successful test persists the verified key/baseUrl for the provider,
    // so the verified flag never points at credentials that were not saved
    const entries: Record<string, unknown> = { "llm.verified": true };
    if (id) {
      entries[`llm.${id}.key`] = apiKey;
      entries[`llm.${id}.baseUrl`] = baseUrl;
    }
    setMultipleConfig(entries);
    res.json({ ok: true, latency });
  } catch (e: unknown) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? "请求超时 (15s)" : String(e);
    res.json({ ok: false, error: msg });
  }
});

simRouter.post("/llm/models", async (req, res) => {
  const { apiKey, baseUrl } = req.body as { apiKey: string; baseUrl: string };
  if (!apiKey || !baseUrl) return res.json({ models: [] });
  try {
    const r = await fetch(llmUrl(baseUrl, "/models"), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return res.json({ models: [] });
    const data = (await r.json()) as { data?: Array<{ id: string }> };
    const models = (data.data || []).map(m => m.id).filter(Boolean).sort();
    res.json({ models });
  } catch {
    res.json({ models: [] });
  }
});

simRouter.post("/llm/save", (req, res) => {
  const { id, key, baseUrl, enabled } = req.body as { id: string; key: string; baseUrl: string; enabled: boolean };
  const cfg = getAllConfig();
  const keyChanged = cfg[`llm.${id}.key`] !== key || cfg[`llm.${id}.baseUrl`] !== baseUrl;
  const entries: Record<string, unknown> = {
    [`llm.${id}.key`]: key,
    [`llm.${id}.baseUrl`]: baseUrl,
    [`llm.${id}.enabled`]: enabled,
  };
  if (keyChanged) entries["llm.verified"] = false;
  setMultipleConfig(entries);
  syncLlmToEnv();
  res.json({ ok: true });
});

simRouter.post("/llm/roles/save", (req, res) => {
  const { roles } = req.body as { roles: Record<string, { provider: string; model: string }> };
  const entries: Record<string, unknown> = {};
  for (const [roleId, rm] of Object.entries(roles)) {
    entries[`agent.${roleId}.provider`] = rm.provider;
    entries[`agent.${roleId}.model`] = rm.model;
  }
  setMultipleConfig(entries);
  syncLlmToEnv();
  res.json({ ok: true });
});

// Scheduler
simRouter.get("/scheduler/status", (_req, res) => {
  res.json(getSchedulerStatus());
});

simRouter.post("/scheduler/start", (_req, res) => {
  startScheduler();
  res.json(getSchedulerStatus());
});

simRouter.post("/scheduler/stop", (_req, res) => {
  stopScheduler();
  res.json(getSchedulerStatus());
});

simRouter.post("/run-once", async (req, res) => {
  try {
    const force = req.body?.force === true;
    await runOnce(force);
    res.json({ success: true, status: getSchedulerStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Account reset
simRouter.post("/account/reset", (req, res) => {
  try {
    const initialBalance = req.body?.initialBalance;
    if (initialBalance !== undefined) {
      if (typeof initialBalance !== "number" || isNaN(initialBalance) || initialBalance < 10000 || initialBalance > 100000000) {
        res.status(400).json({ error: "初始资金需在 10,000 ~ 100,000,000 之间" });
        return;
      }
    }
    const account = getOrCreateAccount();
    resetAccount(account.id, typeof initialBalance === "number" ? initialBalance : undefined);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.post("/account/clear-decisions", (_req, res) => {
  try {
    const account = getOrCreateAccount();
    clearDecisions(account.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Market
simRouter.get("/market/quote/:ticker", async (req, res) => {
  try {
    const quote = await getCurrentPrice(req.params.ticker);
    if (!quote) return res.status(404).json({ error: "Quote not available" });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/market/quotes", async (req, res) => {
  try {
    const symbols = typeof req.query.symbols === "string" ? req.query.symbols : "";
    if (!symbols) return res.json({});
    const tickers = symbols.split(",").filter(Boolean);
    const db = getDb();
    const nameMap = new Map<string, string>();
    for (const t of tickers) {
      const row = db.prepare("SELECT name FROM stocks WHERE ticker = ?").get(t) as { name: string } | undefined;
      if (row) nameMap.set(t, row.name);
    }
    const quoteMap = await getBatchQuotes(tickers, nameMap);
    const result: Record<string, unknown> = {};
    for (const [ticker, quote] of quoteMap) result[ticker] = quote;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/market/pankou/:ticker", async (req, res) => {
  try {
    const data = await getPankou(req.params.ticker);
    if (!data) return res.status(404).json({ error: "Pankou not available" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/market/minute/:ticker", async (req, res) => {
  try {
    const data = await getMinuteChart(req.params.ticker);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/market/kline/:ticker", async (req, res) => {
  try {
    const period = (req.query.period as string) ?? "day";
    const count = parseInt(req.query.count as string) || 60;
    const data = await getKlineChart(req.params.ticker, period, count);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/market/ticks/:ticker", async (req, res) => {
  try {
    const count = parseInt(req.query.count as string) || 30;
    const data = await getTradeTicks(req.params.ticker, count);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/market/indices", async (_req, res) => {
  try {
    const indices = await getIndexQuotes();
    res.json(indices);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

simRouter.get("/market/state", (_req, res) => {
  res.json({ state: getMarketState() });
});
