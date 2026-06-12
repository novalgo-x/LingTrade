// 交易风格的前端元数据：标签、定位、关键行为与推荐风控预设。
// 策略 prompt 本体在服务端 web/server/src/sim/tradingStyle.ts。

export const STYLE_LABELS: Record<string, string> = {
  conservative: "保守",
  balanced: "均衡",
  aggressive: "激进",
};

export const TRADING_STYLE_PRESETS = [
  {
    id: "conservative",
    name: "保守",
    tagline: "资本保全优先，宁可错过，不可做错",
    points: ["建仓门槛高：研报置信度 ≥ 0.75", "试探建仓，浮盈验证后才分批加仓", "浮亏 8% 主动离场，高现金常态"],
    risk: { "risk.maxPositionPct": 0.15, "risk.maxSingleBuyPct": 0.08, "risk.minCashPct": 0.25, "risk.stopLossPct": -0.10, "risk.maxHoldings": 8 } as Record<string, number>,
    colors: { base: "#F2F8F4", active: "#E3F3EB", main: "#1F8A5B" },
  },
  {
    id: "balanced",
    name: "均衡",
    tagline: "风险可控下稳健增值，按信号纪律执行",
    points: ["建仓门槛：研报置信度 ≥ 0.65", "仓位随置信度 8-15%，目标价分批止盈", "浮亏 12% 主动减半"],
    risk: { "risk.maxPositionPct": 0.30, "risk.maxSingleBuyPct": 0.15, "risk.minCashPct": 0.10, "risk.stopLossPct": -0.20, "risk.maxHoldings": 10 } as Record<string, number>,
    colors: { base: "#F2F4F9", active: "#E4E8F4", main: "#1B2559" },
  },
  {
    id: "aggressive",
    name: "激进",
    tagline: "火力集中于最强信号，接受更大回撤",
    points: ["建仓门槛：研报置信度 ≥ 0.55", "强信号一次买足，顺势加仓", "让利润奔跑，浮亏 15% 果断止损"],
    risk: { "risk.maxPositionPct": 0.40, "risk.maxSingleBuyPct": 0.25, "risk.minCashPct": 0.05, "risk.stopLossPct": -0.25, "risk.maxHoldings": 6 } as Record<string, number>,
    colors: { base: "#FCF5EC", active: "#FEEDD8", main: "#C2410C" },
  },
];
