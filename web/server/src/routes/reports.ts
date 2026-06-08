import { Router, type Request, type Response } from "express";
import { getReport, listReportsByStock, deleteReport, getLatestReportsForAllStocks } from "../services/reportService.js";

export const reportsRouter = Router();

reportsRouter.get("/reports/latest", (_req: Request, res: Response) => {
  res.json(getLatestReportsForAllStocks());
});

reportsRouter.get("/stocks/:id/reports", (req: Request, res: Response) => {
  const stockId = Number(req.params.id);
  res.json(listReportsByStock(stockId));
});

reportsRouter.get("/reports/:id", (req: Request, res: Response) => {
  const reportId = Number(req.params.id);
  const report = getReport(reportId);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json({ ...report, result_json: JSON.parse(report.result_json) });
});

reportsRouter.delete("/reports/:id", (req: Request, res: Response) => {
  const reportId = Number(req.params.id);
  const deleted = deleteReport(reportId);
  if (!deleted) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.status(204).end();
});
