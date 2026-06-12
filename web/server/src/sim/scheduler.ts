import { getDb } from "../db/connection.js";
import { getSchedulerConfig, getConfig } from "./configService.js";
import { isTradingTime, getCurrentPrice } from "./virtualMarket.js";
import { getOrCreateAccount, getPositions, getPortfolioSnapshot, executeBuy, executeSell } from "./accountService.js";
import { checkBuyRisk, checkSellRisk, checkStopLoss } from "./riskControl.js";
import { makeDecisions, getRecentDecisions, getReportSummaries } from "./decisionAgent.js";
import { resolveTradingStyle } from "./tradingStyle.js";
import { recordDailyNav } from "./performanceService.js";
import { startAnalysis, hasRunningTask, startBatchAnalysis, getBatchStatus } from "../services/analyzerService.js";
import type { SchedulerStatus } from "./types.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastRunDecisions: number | null = null;
let lastRunError: string | null = null;
let nextRunAt: string | null = null;
let currentCycleId: string | null = null;

let reportTimer: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
  console.log(`[Scheduler] ${msg}`);
}

function isTradingDay(now: Date = new Date()): boolean {
  const day = now.getDay();
  return day !== 0 && day !== 6;
}

function checkReportSchedule(): void {
  const freq = getConfig<string>("scheduler.reportFrequency");
  if (freq === "manual") return;

  const now = new Date();
  if (freq === "tradingDay" && !isTradingDay(now)) return;

  const targetTime = getConfig<string>("scheduler.reportTime") || "08:30";
  const [h, m] = targetTime.split(":").map(Number);
  if (now.getHours() !== (h || 0) || now.getMinutes() !== (m || 0)) return;

  triggerReportGeneration();
}

function triggerReportGeneration(): void {
  const scope = getConfig<string>("scheduler.reportScope") || "positions";

  if (scope === "watchlist") {
    const batch = getBatchStatus();
    if (batch.running) {
      log("[Report] Batch analysis already running, skipping");
      return;
    }
    log("[Report] Triggering batch analysis for all watchlist stocks");
    startBatchAnalysis();
    return;
  }

  const account = getOrCreateAccount();
  const positions = getPositions(account.id);
  if (positions.length === 0) {
    log("[Report] No positions, skipping report generation");
    return;
  }
  const db = getDb();
  const stockIds = positions.map(p => p.stock_id);
  const stocks = db.prepare(
    `SELECT id, ticker, name FROM stocks WHERE id IN (${stockIds.map(() => "?").join(",")})`
  ).all(...stockIds) as Array<{ id: number; ticker: string; name: string }>;

  log(`[Report] Generating reports for ${stocks.length} position stocks: ${stocks.map(s => s.ticker).join(", ")}`);

  for (const stock of stocks) {
    if (hasRunningTask(stock.id)) {
      log(`[Report] ${stock.ticker} already has a running task, skipping`);
      continue;
    }
    try {
      const taskId = startAnalysis(stock.id, stock.ticker);
      log(`[Report] Started analysis for ${stock.ticker}, taskId=${taskId}`);
    } catch (err) {
      log(`[Report] Failed to start analysis for ${stock.ticker}: ${err}`);
    }
  }
}

export function startReportScheduler(): void {
  if (reportTimer) return;
  const msToNextMinute = (60 - new Date().getSeconds()) * 1000;
  setTimeout(() => {
    checkReportSchedule();
    reportTimer = setInterval(checkReportSchedule, 60_000);
  }, msToNextMinute);
  log(`[Report] Report scheduler started, first check in ${Math.round(msToNextMinute / 1000)}s`);
}

export function stopReportScheduler(): void {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
}

export async function runOnce(force = false): Promise<void> {
  if (!force && !isTradingTime()) {
    log("Not trading time, skipping cycle");
    return;
  }
  if (force) log("Force mode enabled, bypassing trading time check");

  const cycleId = `CYC-${Date.now()}`;
  currentCycleId = cycleId;
  log(`Starting cycle ${cycleId}`);

  try {
    const account = getOrCreateAccount();
    const db = getDb();
    const tradingStyle = resolveTradingStyle(getConfig("agent.tradingStyle"));
    let decisionCount = 0;

    const stocks = db.prepare("SELECT id, ticker, name FROM stocks").all() as Array<{ id: number; ticker: string; name: string }>;
    if (stocks.length === 0) {
      log("No stocks in watchlist, skipping");
      return;
    }
    log(`Watchlist: ${stocks.map(s => s.ticker).join(", ")}`);

    // Check report freshness
    const config = getSchedulerConfig();
    const staleThreshold = new Date(Date.now() - config.reportRefreshHours * 3600000).toISOString();
    for (const stock of stocks) {
      const latest = db.prepare(
        "SELECT created_at FROM reports WHERE stock_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(stock.id) as { created_at: string } | undefined;
      if (!latest || latest.created_at < staleThreshold) {
        log(`Report for ${stock.ticker} is stale or missing`);
      }
    }

    // Get portfolio snapshot with live prices
    const snapshot = await getPortfolioSnapshot(account.id);

    // Check stop-loss first
    const stopLossAlerts = checkStopLoss(snapshot);
    for (const alert of stopLossAlerts) {
      log(`Stop-loss triggered for ${alert.ticker}: ${(alert.lossPct * 100).toFixed(1)}%`);
      const sellCheck = checkSellRisk(account.id, alert.stockId, alert.ticker, alert.quantity);
      if (sellCheck.approved) {
        const result = executeSell(account.id, alert.stockId, alert.ticker, alert.quantity, alert.currentPrice);
        log(`Stop-loss sell ${alert.ticker}: ${result.success ? "filled" : result.rejectReason}`);

        // Record stop-loss decision
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO sim_decisions (account_id, cycle_id, stock_id, ticker, action, quantity, price_at_decision, reasoning, risk_action, final_action, order_id, confidence, trading_style, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(account.id, cycleId, alert.stockId, alert.ticker, "sell", alert.quantity, alert.currentPrice,
          `止损触发: 亏损${(alert.lossPct * 100).toFixed(1)}%`, "stop_loss", result.success ? "executed" : "rejected",
          result.orderId ?? null, 1.0, tradingStyle, now);
        decisionCount += 1;
      }
    }

    // Refresh snapshot after stop-loss sells
    const updatedSnapshot = stopLossAlerts.length > 0 ? await getPortfolioSnapshot(account.id) : snapshot;

    // Get report summaries for all stocks
    const allStockIds = stocks.map(s => s.id);
    const reports = getReportSummaries(allStockIds);

    // Get recent decisions for context
    const recentDecisions = getRecentDecisions(account.id);

    // Build watchlist (stocks not currently held)
    const heldTickers = new Set(updatedSnapshot.positions.map(p => p.ticker));
    const watchlist: Array<{ ticker: string; name: string; price: number; report?: string }> = [];
    for (const stock of stocks) {
      if (heldTickers.has(stock.ticker)) continue;
      const quote = await getCurrentPrice(stock.ticker);
      if (quote) {
        const report = reports.find(r => r.ticker === stock.ticker);
        watchlist.push({ ticker: stock.ticker, name: stock.name, price: quote.price, report: report?.summary });
      }
    }

    log(`Reports found: ${reports.length}, Watchlist candidates: ${watchlist.length}, Positions: ${updatedSnapshot.positions.length}`);
    const agentOutput = await makeDecisions(updatedSnapshot, reports, recentDecisions, watchlist, tradingStyle);
    log(`Agent returned ${agentOutput.decisions.length} decisions`);
    if (agentOutput.marketOutlook) log(`Market outlook: ${agentOutput.marketOutlook}`);
    if (agentOutput.portfolioStrategy) log(`Strategy: ${agentOutput.portfolioStrategy}`);

    // Process each decision
    for (const decision of agentOutput.decisions) {
      const stock = stocks.find(s => s.ticker === decision.ticker);
      if (!stock) {
        log(`Unknown ticker ${decision.ticker}, skipping`);
        continue;
      }

      const quote = await getCurrentPrice(decision.ticker);
      const price = quote?.price ?? 0;
      if (price <= 0) {
        log(`No price for ${decision.ticker}, skipping`);
        continue;
      }

      const now = new Date().toISOString();
      let riskCheckResult: string | null = null;
      let riskAction: string | null = null;
      let finalAction: string | null = null;
      let orderId: number | null = null;

      if (decision.action === "buy" && decision.quantity > 0) {
        const riskCheck = checkBuyRisk(account.id, stock.id, stock.ticker, decision.quantity, price, updatedSnapshot);
        riskCheckResult = JSON.stringify(riskCheck);

        if (riskCheck.approved) {
          riskAction = "approved";
          const result = executeBuy(account.id, stock.id, stock.ticker, decision.quantity, price);
          finalAction = result.success ? "executed" : "rejected";
          orderId = result.orderId ?? null;
          log(`Buy ${decision.ticker} x${decision.quantity} @ ¥${price}: ${finalAction}`);
        } else if (riskCheck.adjustedQuantity && riskCheck.adjustedQuantity > 0) {
          riskAction = "adjusted";
          const result = executeBuy(account.id, stock.id, stock.ticker, riskCheck.adjustedQuantity, price);
          finalAction = result.success ? "executed" : "rejected";
          orderId = result.orderId ?? null;
          log(`Buy ${decision.ticker} adjusted x${riskCheck.adjustedQuantity} @ ¥${price}: ${finalAction}`);
        } else {
          riskAction = "blocked";
          finalAction = "rejected";
          log(`Buy ${decision.ticker} blocked by risk: ${riskCheck.violations.join(", ")}`);
        }
      } else if (decision.action === "sell" && decision.quantity > 0) {
        const riskCheck = checkSellRisk(account.id, stock.id, stock.ticker, decision.quantity);
        riskCheckResult = JSON.stringify(riskCheck);

        if (riskCheck.approved) {
          riskAction = "approved";
          const result = executeSell(account.id, stock.id, stock.ticker, decision.quantity, price);
          finalAction = result.success ? "executed" : "rejected";
          orderId = result.orderId ?? null;
          log(`Sell ${decision.ticker} x${decision.quantity} @ ¥${price}: ${finalAction}`);
        } else {
          riskAction = "blocked";
          finalAction = "rejected";
          log(`Sell ${decision.ticker} blocked: ${riskCheck.violations.join(", ")}`);
        }
      } else {
        riskAction = "n/a";
        finalAction = "hold";
        log(`Hold ${decision.ticker}`);
      }

      // Find latest report for this stock
      const latestReport = db.prepare(
        "SELECT id FROM reports WHERE stock_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(stock.id) as { id: number } | undefined;

      // Record decision
      db.prepare(
        `INSERT INTO sim_decisions (account_id, cycle_id, stock_id, ticker, action, quantity, price_at_decision, reasoning,
         portfolio_snapshot, risk_check_result, risk_action, final_action, order_id, confidence, triggers, market_outlook, trading_style, report_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        account.id, cycleId, stock.id, decision.ticker, decision.action,
        decision.quantity, price, decision.reasoning,
        JSON.stringify(updatedSnapshot), riskCheckResult, riskAction, finalAction,
        orderId, decision.confidence, null, agentOutput.marketOutlook, tradingStyle, latestReport?.id ?? null, now
      );
      decisionCount += 1;
    }

    await recordDailyNav(account.id);
    lastRunAt = new Date().toISOString();
    lastRunDecisions = decisionCount;
    lastRunError = agentOutput.error ?? null;
    log(`Cycle ${cycleId} completed, ${decisionCount} decisions recorded${agentOutput.error ? `, error: ${agentOutput.error}` : ""}`);
  } catch (err) {
    console.error(`[Scheduler] Cycle ${cycleId} error:`, err);
    lastRunError = String(err).slice(0, 160);
  } finally {
    currentCycleId = null;
  }
}

export function start(): void {
  if (timer) return;
  const config = getSchedulerConfig();
  const intervalMs = config.intervalMinutes * 60 * 1000;
  running = true;
  log(`Started with interval ${config.intervalMinutes}min`);

  const scheduleNext = () => {
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  };

  // Run immediately, then on interval
  runOnce().then(scheduleNext);
  timer = setInterval(() => {
    runOnce().then(scheduleNext);
  }, intervalMs);
}

export function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  nextRunAt = null;
  log("Stopped");
}

export function getStatus(): SchedulerStatus {
  return {
    running,
    lastRunAt,
    lastRunDecisions,
    lastRunError,
    nextRunAt,
    currentCycleId,
  };
}
