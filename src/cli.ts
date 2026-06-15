import "dotenv/config";

declare const process: {
  argv: string[];
  exitCode?: number;
  env: Record<string, string | undefined>;
  cwd: () => string;
};

import { loadConfig } from "./config.js";
import { MockAshareDataSource } from "./data/mockDataSource.js";
import { RealAshareDataSource } from "./data/realAshareDataSource.js";
import { MockLlmProvider } from "./llm/mockLlmProvider.js";
import { OpenAiCompatibleProvider } from "./llm/openAiCompatibleProvider.js";
import { InvestmentWorkflow } from "./workflow/investmentWorkflow.js";
import type { StageEmitter } from "./workflow/stageEvents.js";
import { join, resolve } from "path";
import { pathToFileURL } from "node:url";
import type { KnowledgeInsight } from "./domain/types.js";

function usage(): string {
  return `Usage: lingtrade analyze <ticker> [options]

Options:
  --dry-run         Use mock LLM and data (no API calls)
  --real-data       Use real A-share data sources
  --compact         Compact JSON output (default: pretty-printed)
  --verbose         Print raw dataset after loading
  --save-raw-data   Save raw data to data/ directory
  --no-kb           Skip knowledge base loading
  --ticker <code>   Stock ticker (alternative to positional arg)
  --help, -h        Show this help message

Examples:
  lingtrade analyze 600519
  lingtrade analyze 600519 --real-data
  lingtrade analyze 600519 --dry-run
  lingtrade analyze 600519 --real-data --verbose
  lingtrade analyze 600519 --real-data --save-raw-data
`;
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command !== "analyze") {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }

  const ticker = args[1] ?? getArgValue(args, "--ticker");
  if (!ticker) {
    throw new Error(`Missing ticker.\n${usage()}`);
  }

  const dryRun = args.includes("--dry-run");
  const realData = args.includes("--real-data");
  const pretty = !args.includes("--compact"); // Default to pretty, use --compact to disable
  const verbose = args.includes("--verbose");
  const saveRawData = args.includes("--save-raw-data");
  const config = loadConfig();
  const llm = dryRun || config.llmMode === "mock" ? new MockLlmProvider() : new OpenAiCompatibleProvider(config.llm);
  const dataSource = !dryRun && (realData || config.dataMode === "real") ? new RealAshareDataSource(config.data) : new MockAshareDataSource();
  
  const noKb = args.includes("--no-kb");
  const kbInsights = noKb ? [] : await loadKbInsightsFromDb();

  const emit: StageEmitter = (ev): void => {
    const ts = new Date().toISOString();
    if (ev.kind === "stage_start") {
      console.error(`\n[${ts}] ▶ ${ev.stage}`);
    } else if (ev.kind === "substep") {
      const tag = ev.side ? `[${ev.side}] ` : "";
      console.error(`   - ${tag}${ev.text}`);
    } else if (ev.kind === "stage_done") {
      console.error(`[${ts}] ✓ ${ev.stage} (${(ev.durationMs / 1000).toFixed(1)}s)${ev.skipped ? " [skipped]" : ""}`);
      if (ev.summary) console.error(`     ${ev.summary}`);
      if (verbose && ev.stage === "data_loaded") {
        console.error("\n📦 原始数据集:");
        console.error(JSON.stringify(ev.payload, null, 2));
      }
    } else if (ev.kind === "stage_failed") {
      console.error(`[${ts}] ✗ ${ev.stage}: ${ev.error}`);
    }
  };

  const workflow = new InvestmentWorkflow(dataSource, llm, undefined, undefined, kbInsights);
  const result = await workflow.runStaged({ ticker, emit });
  
  if (saveRawData) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const dataDir = path.join(process.cwd(), "data");
    await fs.mkdir(dataDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ticker}_raw_${timestamp}.json`;
    const filepath = path.join(dataDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(result, null, 2), "utf-8");
    console.error(`\n💾 原始数据已保存: ${filepath}`);
  }
  
  console.log(JSON.stringify(result, null, pretty ? 2 : 0));
}

async function loadKbInsightsFromDb(): Promise<KnowledgeInsight[]> {
  try {
    // better-sqlite3 lives in web/server/node_modules (not a root dependency,
    // to keep root install free of native builds); resolve it from there
    const { createRequire } = await import("node:module");
    const requireFromServer = createRequire(join(process.cwd(), "web", "server", "package.json"));
    const Database = requireFromServer("better-sqlite3") as new (path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => {
      prepare: (sql: string) => { all: () => unknown[] };
      close: () => void;
    };
    const dbPath = join(process.cwd(), "web", "data", "copilot.db");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare("SELECT insight_json FROM kb_files WHERE status = 'ready' AND insight_json IS NOT NULL").all() as Array<{ insight_json: string }>;
    db.close();
    const insights: KnowledgeInsight[] = [];
    for (const row of rows) {
      // insight_json comes from LLM output and may miss fields — normalize to the full shape
      try {
        const raw = JSON.parse(row.insight_json) as Partial<KnowledgeInsight>;
        insights.push({
          author: raw.author ?? "未知",
          title: raw.title ?? "未命名文档",
          publishDate: raw.publishDate ?? "",
          marketOutlook: raw.marketOutlook ?? "",
          sectorViews: Array.isArray(raw.sectorViews) ? raw.sectorViews : [],
          stockMentions: Array.isArray(raw.stockMentions) ? raw.stockMentions : [],
          keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints : [],
          riskFactors: Array.isArray(raw.riskFactors) ? raw.riskFactors : [],
          investmentThemes: Array.isArray(raw.investmentThemes) ? raw.investmentThemes : [],
          summary: raw.summary ?? "",
        });
      } catch {}
    }
    console.error(`[KB] 从数据库加载 ${insights.length} 篇知识库文档`);
    return insights;
  } catch (err) {
    console.error(`[KB] 知识库加载失败: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
