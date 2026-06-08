import { Router, type Request, type Response } from "express";
import { getStock } from "../services/stockService.js";
import { startAnalysis, getTask, getRunningTask, subscribeToLogs, startBatchAnalysis, getBatchStatus, cancelBatch } from "../services/analyzerService.js";

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
