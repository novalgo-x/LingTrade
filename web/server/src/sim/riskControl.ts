import { getRiskConfig, getTradingConfig } from "./configService.js";
import { getPositions, getPositionByStock } from "./accountService.js";
import { calculateFees, isTradingTime } from "./virtualMarket.js";
import type { RiskCheckResult, RiskCheckItem, PortfolioSnapshot } from "./types.js";

export function checkBuyRisk(
  accountId: number,
  stockId: number,
  ticker: string,
  quantity: number,
  price: number,
  snapshot: PortfolioSnapshot
): RiskCheckResult {
  const risk = getRiskConfig();
  const checks: RiskCheckItem[] = [];
  const warnings: string[] = [];
  const violations: string[] = [];

  // 0. Check trading time
  const timePass = isTradingTime();
  checks.push({ name: "交易时段", pass: timePass, value: timePass ? "交易中" : "已休市" });
  if (!timePass) violations.push("当前非交易时段（交易时间: 9:30-11:30, 13:00-15:00）");

  const amount = quantity * price;
  const fees = calculateFees("buy", amount);
  const totalCost = amount + fees.total;
  const totalAssets = snapshot.totalAssets;

  // 1. Check max holdings count
  const positions = getPositions(accountId);
  const existingPosition = positions.find(p => p.stock_id === stockId);
  const currentHoldingCount = positions.length + (existingPosition ? 0 : 1);
  const holdingsPass = currentHoldingCount <= risk.maxHoldings;
  checks.push({ name: "最大持仓数", pass: holdingsPass, value: `${currentHoldingCount}/${risk.maxHoldings}` });
  if (!holdingsPass) violations.push(`持仓数 ${currentHoldingCount} 超过上限 ${risk.maxHoldings}`);

  // 2. Check single position limit
  const existingValue = existingPosition ? existingPosition.quantity * price : 0;
  const newPositionValue = existingValue + amount;
  const positionPct = totalAssets > 0 ? newPositionValue / totalAssets : 0;
  const positionPass = positionPct <= risk.maxPositionPct;
  checks.push({ name: "单票仓位上限", pass: positionPass, value: `${(positionPct * 100).toFixed(1)}%/${(risk.maxPositionPct * 100).toFixed(0)}%` });
  if (!positionPass) violations.push(`${ticker} 仓位 ${(positionPct * 100).toFixed(1)}% 超过上限 ${(risk.maxPositionPct * 100).toFixed(0)}%`);

  // 3. Check single buy limit
  const singleBuyPct = totalAssets > 0 ? amount / totalAssets : 0;
  const singleBuyPass = singleBuyPct <= risk.maxSingleBuyPct;
  checks.push({ name: "单笔买入上限", pass: singleBuyPass, value: `${(singleBuyPct * 100).toFixed(1)}%/${(risk.maxSingleBuyPct * 100).toFixed(0)}%` });
  if (!singleBuyPass) warnings.push(`单笔买入 ${(singleBuyPct * 100).toFixed(1)}% 超过建议上限 ${(risk.maxSingleBuyPct * 100).toFixed(0)}%`);

  // 4. Check minimum cash reserve
  const remainingCash = snapshot.cashBalance - totalCost;
  const cashPct = totalAssets > 0 ? remainingCash / totalAssets : 0;
  const cashPass = cashPct >= risk.minCashPct;
  checks.push({ name: "最低现金保留", pass: cashPass, value: `${(cashPct * 100).toFixed(1)}%/${(risk.minCashPct * 100).toFixed(0)}%` });
  if (!cashPass) violations.push(`买入后现金仅 ${(cashPct * 100).toFixed(1)}%，低于最低 ${(risk.minCashPct * 100).toFixed(0)}%`);

  // 5. Check sufficient cash
  const fundPass = snapshot.cashBalance >= totalCost;
  checks.push({ name: "资金充足", pass: fundPass, value: `¥${snapshot.cashBalance.toFixed(0)}/¥${totalCost.toFixed(0)}` });
  if (!fundPass) violations.push("现金不足");

  const approved = violations.length === 0;

  // 仅当违规都是「数量可解决」的（仓位 / 现金比例超限）才给缩量建议；
  // 交易时段、持仓数、资金不足这类缩量救不了的违规必须整单拦截，不能借缩量路径放行
  let adjustedQuantity: number | undefined;
  if (!approved && timePass && fundPass && holdingsPass) {
    const maxByPosition = totalAssets > 0 ? Math.floor((risk.maxPositionPct * totalAssets - existingValue) / price / 100) * 100 : 0;
    const maxByCash = Math.floor((snapshot.cashBalance * (1 - risk.minCashPct) - fees.total) / price / 100) * 100;
    const suggested = Math.min(maxByPosition, maxByCash);
    if (suggested > 0 && suggested < quantity) {
      adjustedQuantity = suggested;
    }
  }

  return { approved, adjustedQuantity, warnings, violations, checks };
}

export function checkSellRisk(
  accountId: number,
  stockId: number,
  _ticker: string,
  quantity: number
): RiskCheckResult {
  const config = getTradingConfig();
  const checks: RiskCheckItem[] = [];
  const warnings: string[] = [];
  const violations: string[] = [];

  // 0. Check trading time
  const timePass = isTradingTime();
  checks.push({ name: "交易时段", pass: timePass, value: timePass ? "交易中" : "已休市" });
  if (!timePass) violations.push("当前非交易时段（交易时间: 9:30-11:30, 13:00-15:00）");

  const position = getPositionByStock(accountId, stockId);

  // 1. Check position exists and sufficient
  const qtyPass = !!position && position.quantity >= quantity;
  checks.push({ name: "持仓充足", pass: qtyPass, value: `${position?.quantity ?? 0}/${quantity}` });
  if (!qtyPass) violations.push(`持仓不足: 持有 ${position?.quantity ?? 0}，卖出 ${quantity}`);

  // 2. Check T+1 settlement
  if (config.t1Settlement && position?.buy_date) {
    const buyDate = position.buy_date.split("T")[0] ?? "";
    const today = new Date().toISOString().split("T")[0] ?? "";
    const t1Pass = buyDate !== "" && buyDate < today;
    checks.push({ name: "T+1交割", pass: t1Pass, value: `买入日: ${buyDate}` });
    if (!t1Pass) violations.push("T+1限制: 当日买入不可卖出");
  }

  return { approved: violations.length === 0, warnings, violations, checks };
}

export interface StopLossAlert {
  ticker: string;
  stockId: number;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  lossPct: number;
}

export function checkStopLoss(snapshot: PortfolioSnapshot): StopLossAlert[] {
  const risk = getRiskConfig();
  const alerts: StopLossAlert[] = [];

  for (const pos of snapshot.positions) {
    if (pos.unrealizedPnlPct <= risk.stopLossPct) {
      alerts.push({
        ticker: pos.ticker,
        stockId: pos.stockId,
        quantity: pos.quantity,
        avgCost: pos.avgCost,
        currentPrice: pos.currentPrice,
        lossPct: pos.unrealizedPnlPct,
      });
    }
  }

  return alerts;
}
