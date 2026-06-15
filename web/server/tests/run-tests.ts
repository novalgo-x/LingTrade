import { buildSystemPrompt, resolveTradingStyle, TRADING_STYLES } from "../src/sim/tradingStyle.js";
import { InvestmentWorkflow } from "../../../src/workflow/investmentWorkflow.js";
import { STAGE_ORDER, WorkflowAbortError, applyStageResult, type StageEvent, type WorkflowContext } from "../../../src/workflow/stageEvents.js";
import { MockLlmProvider } from "../../../src/llm/mockLlmProvider.js";
import { MockAshareDataSource } from "../../../src/data/mockDataSource.js";

type TestCase = { name: string; run: () => void | Promise<void> };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function makeWorkflow(): InvestmentWorkflow {
  return new InvestmentWorkflow(new MockAshareDataSource(), new MockLlmProvider(), undefined, undefined, []);
}

async function runAndCollect(): Promise<{ events: StageEvent[]; ctx: WorkflowContext }> {
  const events: StageEvent[] = [];
  const result = await makeWorkflow().runStaged({ ticker: "600519", emit: (e) => events.push(e) });
  const ctx: WorkflowContext = {};
  for (const e of events) {
    if (e.kind === "stage_done" && e.payload !== undefined) applyStageResult(ctx, e.stage, e.payload);
  }
  void result;
  return { events, ctx };
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
  {
    name: "runStaged emits all 7 stages in order, each start before its done",
    run: async () => {
      const { events, ctx } = await runAndCollect();
      const doneStages = events.filter((e) => e.kind === "stage_done").map((e) => e.stage);
      assert(JSON.stringify(doneStages) === JSON.stringify([...STAGE_ORDER]), "all 7 stages completed in order");
      for (const stage of STAGE_ORDER) {
        const startIdx = events.findIndex((e) => e.kind === "stage_start" && e.stage === stage);
        const doneIdx = events.findIndex((e) => e.kind === "stage_done" && e.stage === stage);
        assert(startIdx >= 0 && doneIdx > startIdx, `${stage} start precedes done`);
      }
      assert(!!ctx.analysis && !!ctx.sentiment && !!ctx.report && !!ctx.bullCase && !!ctx.bearCase && !!ctx.decision, "ctx fully assembled");
    },
  },
  {
    name: "knowledge stage is marked skipped when no insights configured",
    run: async () => {
      const { events } = await runAndCollect();
      const kb = events.find((e) => e.kind === "stage_done" && e.stage === "knowledge_loaded");
      assert(!!kb && kb.kind === "stage_done" && kb.skipped === true, "knowledge_loaded skipped");
    },
  },
  {
    name: "debate stage emits real bull/bear arguments as substeps",
    run: async () => {
      const { events } = await runAndCollect();
      const subs = events.filter((e) => e.kind === "substep" && e.stage === "debate_complete");
      assert(subs.some((e) => e.kind === "substep" && e.side === "bull"), "has bull substep");
      assert(subs.some((e) => e.kind === "substep" && e.side === "bear"), "has bear substep");
    },
  },
  {
    name: "resume from sentiment_complete skips earlier stages and reuses inputs",
    run: async () => {
      const { ctx } = await runAndCollect();
      const events: StageEvent[] = [];
      await makeWorkflow().runStaged({ ticker: "600519", emit: (e) => events.push(e), resumeCtx: ctx, fromStage: "sentiment_complete" });
      const started = events.filter((e) => e.kind === "stage_start").map((e) => e.stage);
      assert(started[0] === "sentiment_complete", "resumes at sentiment_complete");
      assert(!started.includes("data_loaded") && !started.includes("knowledge_loaded") && !started.includes("analysis_complete"), "earlier stages not re-run");
      assert(started.includes("decision_complete"), "runs through to decision");
    },
  },
  {
    name: "an already-aborted signal stops the run with WorkflowAbortError",
    run: async () => {
      const ac = new AbortController();
      ac.abort();
      let threw = false;
      try {
        await makeWorkflow().runStaged({ ticker: "600519", emit: () => {}, signal: ac.signal });
      } catch (e) {
        threw = e instanceof WorkflowAbortError;
      }
      assert(threw, "throws WorkflowAbortError when pre-aborted");
    },
  },
  {
    name: "applyStageResult splits debate payload into bull/bear",
    run: () => {
      const ctx: WorkflowContext = {};
      applyStageResult(ctx, "debate_complete", { bullCase: { side: "bull" }, bearCase: { side: "bear" } });
      assert(ctx.bullCase?.side === "bull" && ctx.bearCase?.side === "bear", "debate split applied");
    },
  },
];

for (const testCase of tests) {
  await testCase.run();
  console.log(`ok - ${testCase.name}`);
}
