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
import { syncRuntimeConfigFromDb } from "./services/runtimeConfig.js";

const db = getDb();
initSchema(db);

// 把数据库中保存的 LLM / Tushare 配置同步进 process.env（每次分析前也会再同步一次，改设置无需重启）
syncRuntimeConfigFromDb();

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
