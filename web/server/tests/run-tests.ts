import { buildSystemPrompt, resolveTradingStyle, TRADING_STYLES } from "../src/sim/tradingStyle.js";

type TestCase = { name: string; run: () => void | Promise<void> };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const tests: TestCase[] = [
  {
    name: "resolveTradingStyle accepts valid styles and falls back to balanced",
    run: () => {
      assert(resolveTradingStyle("conservative") === "conservative", "conservative passthrough");
      assert(resolveTradingStyle("balanced") === "balanced", "balanced passthrough");
      assert(resolveTradingStyle("aggressive") === "aggressive", "aggressive passthrough");
      assert(resolveTradingStyle("yolo") === "balanced", "invalid falls back");
      assert(resolveTradingStyle(undefined) === "balanced", "undefined falls back");
      assert(resolveTradingStyle(null) === "balanced", "null falls back");
    },
  },
  {
    name: "buildSystemPrompt injects style block into shared skeleton",
    run: () => {
      const markers: Record<string, string> = {
        conservative: "风格：保守",
        balanced: "风格：均衡",
        aggressive: "风格：激进",
      };
      for (const style of TRADING_STYLES) {
        const prompt = buildSystemPrompt(style);
        assert(prompt.includes(markers[style]!), `${style} block present`);
        assert(!prompt.includes("{STYLE_BLOCK}"), `${style} placeholder replaced`);
        assert(prompt.includes("A 股交易规则"), `${style} keeps shared skeleton`);
        assert(prompt.includes("输出格式"), `${style} keeps output contract`);
        assert(prompt.includes("marketOutlook"), `${style} keeps JSON contract fields`);
      }
      assert(buildSystemPrompt("conservative") !== buildSystemPrompt("aggressive"), "styles differ");
    },
  },
];

for (const testCase of tests) {
  await testCase.run();
  console.log(`ok - ${testCase.name}`);
}
