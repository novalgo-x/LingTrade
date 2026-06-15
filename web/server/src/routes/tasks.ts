import { Router, type Request, type Response } from "express";
import { getStock } from "../services/stockService.js";
import { startAnalysis, retryTask, cancelTask, getTask, getTaskStages, getRunningTask, getLatestTask, getActiveTasks, getLatestTasksForAllStocks, subscribeToLogs, startBatchAnalysis, getBatchStatus, cancelBatch } from "../services/analyzerService.js";

export const tasksRouter = Router();

tasksRouter.post("/stocks/:id/analyze", (req: Request, res: Response) => {
  const stockId = Number(req.params.id);
  const stock = getStock(stockId);
  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }
  const running = getRunningTask(stockId);
  if (running) {
    res.json({ taskId: running.id, resumed: true });
    return;
  }
  const { dryRun, verbose } = req.body ?? {};
  const taskId = startAnalysis(stockId, stock.ticker, { dryRun, verbose });
  res.status(201).json({ taskId });
});

tasksRouter.get("/stocks/:id/running-task", (req: Request, res: Response) => {
  const stockId = Number(req.params.id);
  const running = getRunningTask(stockId);
  if (running) {
    res.json({ taskId: running.id, startedAt: running.started_at });
  } else {
    res.json({ taskId: null });
  }
});

tasksRouter.get("/stocks/:id/latest-task", (req: Request, res: Response) => {
  res.json(getLatestTask(Number(req.params.id)));
});

tasksRouter.get("/tasks/active", (_req: Request, res: Response) => {
  res.json(getActiveTasks());
});

tasksRouter.get("/tasks/latest", (_req: Request, res: Response) => {
  res.json(getLatestTasksForAllStocks());
});

tasksRouter.get("/tasks/:id", (req: Request, res: Response) => {
  const taskId = Number(req.params.id);
  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
});

tasksRouter.get("/tasks/:id/logs", (req: Request, res: Response) => {
  const taskId = Number(req.params.id);
  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  subscribeToLogs(taskId, res);
});

tasksRouter.get("/tasks/:id/stages", (req: Request, res: Response) => {
  const taskId = Number(req.params.id);
  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(getTaskStages(taskId));
});

tasksRouter.post("/tasks/:id/retry", (req: Request, res: Response) => {
  const taskId = Number(req.params.id);
  const result = retryTask(taskId);
  if (!result.ok) {
    const notFound = result.error === "Task not found" || result.error === "Stock not found";
    res.status(notFound ? 404 : 409).json({ error: result.error });
    return;
  }
  res.json({ taskId, retried: true });
});

tasksRouter.post("/tasks/:id/cancel", (req: Request, res: Response) => {
  const taskId = Number(req.params.id);
  const result = cancelTask(taskId);
  res.json({ cancelled: result.ok });
});

tasksRouter.post("/batch-analyze", (_req: Request, res: Response) => {
  const status = getBatchStatus();
  if (status.running) {
    res.status(409).json({ error: "Batch analysis already running" });
    return;
  }
  startBatchAnalysis();
  res.json({ started: true });
});

tasksRouter.get("/batch-analyze/status", (_req: Request, res: Response) => {
  res.json(getBatchStatus());
});

tasksRouter.post("/batch-analyze/cancel", (_req: Request, res: Response) => {
  cancelBatch();
  res.json({ cancelled: true });
});
