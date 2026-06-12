import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupFileLogging } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });
setupFileLogging();
import { getDb } from "./db/connection.js";
import { initSchema } from "./db/schema.js";
import { stocksRouter } from "./routes/stocks.js";
import { tasksRouter } from "./routes/tasks.js";
import { reportsRouter } from "./routes/reports.js";
import { simRouter } from "./routes/sim.js";
import { kbRouter } from "./routes/kb.js";

const PORT = parseInt(process.env.WEB_SERVER_PORT ?? "26681", 10);

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/stocks", stocksRouter);
app.use("/api", tasksRouter);
app.use("/api", reportsRouter);
app.use("/api/sim", simRouter);
app.use("/api/kb", kbRouter);

const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

import { cleanupStaleTasks } from "./services/analyzerService.js";
import { start as startScheduler, startReportScheduler } from "./sim/scheduler.js";
import { getOrCreateAccount } from "./sim/accountService.js";
import { recordDailyNav } from "./sim/performanceService.js";
import { resetStuckKbFiles, cleanupExpiredKbFiles, startKbCleanupTimer } from "./services/kbService.js";
import { getAllConfig } from "./sim/configService.js";

const db = getDb();
initSchema(db);

// config 数据库中的 tushare 配置优先于 .env，同步到 process.env 供 CLI 子进程使用
const savedCfg = getAllConfig();
if (savedCfg["tushare.token"]) process.env.TUSHARE_TOKEN = String(savedCfg["tushare.token"]);
if (savedCfg["tushare.baseUrl"]) process.env.TUSHARE_BASE_URL = String(savedCfg["tushare.baseUrl"]);

const LLM_PROVIDERS_LIST = ["anthropic", "openai", "google", "deepseek", "qwen", "zhipu", "moonshot", "minimax", "baichuan", "custom"];
const researchProvider = savedCfg["agent.research.provider"] as string | undefined;
const researchModel = savedCfg["agent.research.model"] as string | undefined;
const activeLlm = researchProvider || LLM_PROVIDERS_LIST.find(p => savedCfg[`llm.${p}.enabled`] && savedCfg[`llm.${p}.key`]);
if (activeLlm) {
  const llmKey = savedCfg[`llm.${activeLlm}.key`];
  const llmUrl = savedCfg[`llm.${activeLlm}.baseUrl`];
  if (llmKey) {
    process.env.LLM_API_KEY = String(llmKey);
    process.env.COPILOT_LLM_MODE = "live";
  }
  if (llmUrl) process.env.LLM_BASE_URL = String(llmUrl).replace(/\/+$/, "").replace(/\/v\d+$/, "");
} else if (process.env.LLM_API_KEY) {
  process.env.COPILOT_LLM_MODE = "live";
}
if (researchModel) process.env.LLM_MODEL = String(researchModel);
if (savedCfg["tushare.token"] || process.env.TUSHARE_TOKEN) {
  process.env.COPILOT_DATA_MODE = "real";
}

cleanupStaleTasks();
resetStuckKbFiles();
cleanupExpiredKbFiles();
startKbCleanupTimer();

app.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);
  const account = getOrCreateAccount();
  await recordDailyNav(account.id);
  startScheduler();
  startReportScheduler();
});
