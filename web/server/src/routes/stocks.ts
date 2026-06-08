import { Router, type Request, type Response } from "express";
import { listStocks, createStock, updateStock, deleteStock, backfillStockInfo } from "../services/stockService.js";

export const stocksRouter = Router();

stocksRouter.get("/", (req: Request, res: Response) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  res.json(listStocks(search));
});

stocksRouter.post("/", async (req: Request, res: Response) => {
  const { ticker, name, notes } = req.body;
  if (!ticker || typeof ticker !== "string") {
    res.status(400).json({ error: "ticker is required" });
    return;
  }
  const trimmed = ticker.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    res.status(400).json({ error: "ticker must be a 6-digit code" });
    return;
  }
  try {
    const stock = await createStock(trimmed, name, notes);
    res.status(201).json(stock);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) {
      res.status(409).json({ error: "Stock already exists" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

stocksRouter.put("/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const stock = updateStock(id, req.body);
  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }
  res.json(stock);
});

stocksRouter.delete("/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = deleteStock(id);
  if (!deleted) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }
  res.status(204).end();
});

stocksRouter.post("/backfill", async (_req: Request, res: Response) => {
  try {
    const result = await backfillStockInfo();
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
