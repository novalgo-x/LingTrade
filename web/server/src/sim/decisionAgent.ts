import { getDb } from "../db/connection.js";
import type { AgentDecisionOutput, PortfolioSnapshot } from "./types.js";
import { getRiskConfig } from "./configService.js";

interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

function getLlmConfig(): LlmConfig {
  return {
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.deepseek.com/v1",
    model: process.env.LLM_MODEL ?? "deepseek-chat",
    apiKey: process.env.LLM_API_KEY ?? "",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 120000,
  };
}

const SYSTEM_PROMPT = `你是一个专业的A股量化交易决策者。根据提供的投研报告、账户状态和市场信息，做出交易决策。

**严格要求：**
1. 输出格式必须是纯JSON，不要包含任何markdown标记或说明文字
2. 每个决策必须有明确的 action (buy/sell/hold)、ticker、quantity（整百股）、confidence (0-1) 和 reasoning
3. 遵守风控规则，不要超出允许范围
4. quantity 必须是100的整数倍（A股交易规则）
5. 只对有投研报告或持仓的标的做出决策

输出JSON格式：
{
  "decisions": [
    { "ticker": "600879", "action": "buy|sell|hold", "quantity": 100, "confidence": 0.8, "reasoning": "..." }
  ],
  "marketOutlook": "对当前市场的整体判断",
  "portfolioStrategy": "当前组合策略说明"
}`;

function buildUserPrompt(
  snapshot: PortfolioSnapshot,
  reports: Array<{ ticker: string; name: string; summary: string }>,
  recentDecisions: Array<{ ticker: string; action: string; reasoning: string; createdAt: string }>,
  watchlist: Array<{ ticker: string; name: string; price: number; report?: string }>
): string {
  const risk = getRiskConfig();
  const now = new Date();
  const lines: string[] = [];

  lines.push(`## 当前时间: ${now.toISOString()}`);
  lines.push("");

  lines.push("## 账户概况");
  lines.push(`- 现金: ¥${snapshot.cashBalance.toFixed(2)}`);
  lines.push(`- 总资产: ¥${snapshot.totalAssets.toFixed(2)}`);
  lines.push(`- 持仓数: ${snapshot.positions.length}`);
  lines.push("");

  if (snapshot.positions.length > 0) {
    lines.push("## 当前持仓");
    for (const pos of snapshot.positions) {
      lines.push(`- ${pos.ticker} ${pos.name}: ${pos.quantity}股, 成本¥${pos.avgCost.toFixed(2)}, 现价¥${pos.currentPrice.toFixed(2)}, 盈亏${(pos.unrealizedPnlPct * 100).toFixed(2)}%, 占比${(pos.weight * 100).toFixed(1)}%`);
    }
    lines.push("");
  }

  if (reports.length > 0) {
    lines.push("## 投研报告摘要");
    for (const r of reports) {
      lines.push(`### ${r.ticker} ${r.name}`);
      lines.push(r.summary);
      lines.push("");
    }
  }

  if (watchlist.length > 0) {
    lines.push("## 观察列表（未持仓）");
    for (const w of watchlist) {
      lines.push(`- ${w.ticker} ${w.name}: 现价¥${w.price.toFixed(2)}${w.report ? ` | 报告: ${w.report}` : ""}`);
    }
    lines.push("");
  }

  if (recentDecisions.length > 0) {
    lines.push("## 最近决策记录");
    for (const d of recentDecisions) {
      lines.push(`- [${d.createdAt}] ${d.ticker} ${d.action}: ${d.reasoning ?? "无"}`);
    }
    lines.push("");
  }

  lines.push("## 风控规则");
  lines.push(`- 单票仓位上限: ${(risk.maxPositionPct * 100).toFixed(0)}%`);
  lines.push(`- 最大持仓数: ${risk.maxHoldings}`);
  lines.push(`- 单笔买入上限: ${(risk.maxSingleBuyPct * 100).toFixed(0)}%`);
  lines.push(`- 止损线: ${(risk.stopLossPct * 100).toFixed(0)}%`);
  lines.push(`- 最低现金保留: ${(risk.minCashPct * 100).toFixed(0)}%`);

  return lines.join("\n");
}

function log(msg: string): void {
  console.log(`[DecisionAgent] ${msg}`);
}

function parseJsonOutput(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match?.[1]) return JSON.parse(match[1]);
  return JSON.parse(trimmed);
}

export async function makeDecisions(
  snapshot: PortfolioSnapshot,
  reports: Array<{ ticker: string; name: string; summary: string }>,
  recentDecisions: Array<{ ticker: string; action: string; reasoning: string; createdAt: string }>,
  watchlist: Array<{ ticker: string; name: string; price: number; report?: string }>
): Promise<AgentDecisionOutput> {
  const config = getLlmConfig();
  if (!config.apiKey) {
    log("LLM API key not configured, skipping");
    return { decisions: [], marketOutlook: "LLM API key not configured", portfolioStrategy: "N/A" };
  }

  log(`Context: ${snapshot.positions.length} positions, ${reports.length} reports, ${watchlist.length} watchlist, ${recentDecisions.length} recent decisions`);
  log(`Cash: ¥${snapshot.cashBalance.toFixed(2)}, Total: ¥${snapshot.totalAssets.toFixed(2)}`);
  for (const r of reports) log(`  Report: ${r.ticker} ${r.name} → ${r.summary.slice(0, 100)}`);
  for (const w of watchlist) log(`  Watch: ${w.ticker} ${w.name} ¥${w.price.toFixed(2)}, hasReport=${!!w.report}`);

  const userPrompt = buildUserPrompt(snapshot, reports, recentDecisions, watchlist);
  log(`User prompt length: ${userPrompt.length} chars`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    log(`Calling LLM: ${config.model} @ ${config.baseUrl}`);
    const startMs = Date.now();
    const resp = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startMs;

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      log(`LLM API error: ${resp.status} (${elapsedMs}ms) body: ${body.slice(0, 200)}`);
      return { decisions: [], marketOutlook: `LLM error: ${resp.status}`, portfolioStrategy: "N/A" };
    }

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = data.choices?.[0]?.message?.content;
    log(`LLM responded in ${elapsedMs}ms, tokens: ${data.usage?.prompt_tokens ?? "?"}in/${data.usage?.completion_tokens ?? "?"}out`);

    if (!content) {
      log("Empty LLM response content");
      return { decisions: [], marketOutlook: "Empty LLM response", portfolioStrategy: "N/A" };
    }

    log(`Raw LLM output:\n${content}`);

    let parsed: AgentDecisionOutput;
    try {
      parsed = parseJsonOutput(content) as AgentDecisionOutput;
    } catch (parseErr) {
      log(`JSON parse failed: ${parseErr}`);
      return { decisions: [], marketOutlook: "JSON parse error", portfolioStrategy: "N/A" };
    }

    if (!Array.isArray(parsed.decisions)) {
      log(`Invalid decisions format: ${typeof parsed.decisions}`);
      return { decisions: [], marketOutlook: parsed.marketOutlook ?? "Parse error", portfolioStrategy: "N/A" };
    }

    log(`Parsed ${parsed.decisions.length} raw decisions, market outlook: ${parsed.marketOutlook ?? "none"}`);
    for (const d of parsed.decisions) {
      log(`  Raw: ${d.ticker} ${d.action} qty=${d.quantity} conf=${d.confidence} reason=${(d.reasoning ?? "").slice(0, 80)}`);
    }

    const beforeCount = parsed.decisions.length;
    parsed.decisions = parsed.decisions.filter(d =>
      d.ticker && typeof d.action === "string" && ["buy", "sell", "hold"].includes(d.action)
    ).map(d => ({
      ticker: d.ticker,
      action: d.action,
      quantity: Math.max(0, Math.floor((d.quantity ?? 0) / 100) * 100),
      confidence: Math.max(0, Math.min(1, d.confidence ?? 0.5)),
      reasoning: d.reasoning ?? "",
    }));

    if (parsed.decisions.length < beforeCount) {
      log(`Filtered ${beforeCount - parsed.decisions.length} invalid decisions`);
    }
    log(`Final ${parsed.decisions.length} valid decisions`);

    return parsed;
  } catch (err) {
    log(`Error: ${err}`);
    return { decisions: [], marketOutlook: "Decision failed", portfolioStrategy: "N/A" };
  } finally {
    clearTimeout(timeout);
  }
}

export function getRecentDecisions(accountId: number, limit = 5): Array<{ ticker: string; action: string; reasoning: string; createdAt: string }> {
  const db = getDb();
  const rows = db.prepare(
    "SELECT ticker, action, reasoning, created_at FROM sim_decisions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(accountId, limit) as Array<{ ticker: string | null; action: string; reasoning: string | null; created_at: string }>;

  return rows.map(r => ({
    ticker: r.ticker ?? "",
    action: r.action,
    reasoning: r.reasoning ?? "",
    createdAt: r.created_at,
  }));
}

export function getReportSummaries(stockIds: number[]): Array<{ ticker: string; name: string; summary: string }> {
  if (stockIds.length === 0) return [];
  const db = getDb();
  const results: Array<{ ticker: string; name: string; summary: string }> = [];

  for (const stockId of stockIds) {
    const row = db.prepare(
      "SELECT r.result_json, s.ticker, s.name FROM reports r JOIN stocks s ON r.stock_id = s.id WHERE r.stock_id = ? ORDER BY r.created_at DESC LIMIT 1"
    ).get(stockId) as { result_json: string; ticker: string; name: string } | undefined;

    if (row) {
      try {
        const result = JSON.parse(row.result_json);
        const parts: string[] = [];

        const decision = result.decision ?? {};
        if (decision.action) parts.push(`决策: ${decision.action}`);
        if (decision.confidence != null) parts.push(`置信度: ${decision.confidence}`);
        if (decision.targetPrice != null) parts.push(`目标价: ¥${decision.targetPrice}`);
        if (decision.timeHorizon) parts.push(`时间范围: ${decision.timeHorizon}`);
        if (Array.isArray(decision.rationale)) {
          parts.push(`理由: ${decision.rationale.slice(0, 2).join("; ")}`);
        }
        if (Array.isArray(decision.riskWarnings) && decision.riskWarnings.length > 0) {
          parts.push(`风险: ${decision.riskWarnings.slice(0, 2).join("; ")}`);
        }

        const report = result.report ?? {};
        if (report.investmentSummary) parts.push(`摘要: ${report.investmentSummary}`);

        results.push({ ticker: row.ticker, name: row.name, summary: parts.join("\n") || "报告内容为空" });
      } catch {
        results.push({ ticker: row.ticker, name: row.name, summary: "报告解析失败" });
      }
    }
  }
  return results;
}
