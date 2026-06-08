import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { getDb } from "../db/connection.js";
import { KB_DIR, enqueueKbFile, subscribeToKbProgress } from "../services/kbService.js";

mkdirSync(KB_DIR, { recursive: true });

const ALLOWED_EXTS = new Set([".txt", ".md", ".doc", ".docx", ".pdf"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KB_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      cb(new Error(`不支持的文件格式: ${ext}`));
      return;
    }
    cb(null, true);
  },
});

export const kbRouter = Router();

// Upload
kbRouter.post("/upload", upload.single("file"), (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "未上传文件" });

    const db = getDb();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
    const ext = path.extname(originalName).toLowerCase().replace(".", "");
    const source = (req.body?.source as string) ?? "";

    const result = db.prepare(`
      INSERT INTO kb_files (filename, original_name, file_type, file_size, source, status, uploaded_at, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
    `).run(file.filename, originalName, ext, file.size, source, now, expires, now, now);

    const id = Number(result.lastInsertRowid);
    enqueueKbFile(id);

    res.status(201).json({ id, filename: file.filename, originalName, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List files
kbRouter.get("/files", (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM kb_files ORDER BY uploaded_at DESC").all() as KbRow[];
    const now = Date.now();
    const refMap = buildRefMap();
    res.json(rows.map(r => toKbFile(r, now, refMap)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Single file detail
kbRouter.get("/files/:id", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM kb_files WHERE id = ?").get(req.params.id) as KbRow | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });

    const now = Date.now();
    const refMap = buildRefMap();
    const base = toKbFile(row, now, refMap);
    let insight = null;
    try { if (row.insight_json) insight = JSON.parse(row.insight_json); } catch {}

    res.json({ ...base, insight });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete file
kbRouter.delete("/files/:id", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT filename FROM kb_files WHERE id = ?").get(req.params.id) as { filename: string } | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });

    try { unlinkSync(path.join(KB_DIR, row.filename)); } catch {}
    db.prepare("DELETE FROM kb_files WHERE id = ?").run(req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Download
kbRouter.get("/files/:id/download", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT filename, original_name FROM kb_files WHERE id = ?").get(req.params.id) as { filename: string; original_name: string } | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });
    res.download(path.join(KB_DIR, row.filename), row.original_name);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// SSE progress
kbRouter.get("/files/:id/progress", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  subscribeToKbProgress(id, res);
});

// Reprocess
kbRouter.post("/files/:id/reprocess", (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = db.prepare("SELECT id FROM kb_files WHERE id = ?").get(id) as { id: number } | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });

    db.prepare("UPDATE kb_files SET status = 'queued', progress = 0, progress_step = '', error_message = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
    enqueueKbFile(id);

    res.json({ id, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Stats
kbRouter.get("/stats", (_req, res) => {
  try {
    const db = getDb();
    const total = (db.prepare("SELECT COUNT(*) as c FROM kb_files").get() as { c: number }).c;
    const processingCount = (db.prepare("SELECT COUNT(*) as c FROM kb_files WHERE status IN ('queued','processing')").get() as { c: number }).c;
    const soonThreshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const expiringSoon = (db.prepare("SELECT COUNT(*) as c FROM kb_files WHERE expires_at < ? AND status = 'ready'").get(soonThreshold) as { c: number }).c;

    const refMap = buildRefMap();
    const kbRows = db.prepare("SELECT original_name FROM kb_files WHERE status = 'ready'").all() as Array<{ original_name: string }>;
    const referenced = kbRows.filter(r => (refMap.get(getKbTitle(r.original_name))?.length ?? 0) > 0).length;

    res.json({ total, processing: processingCount, expiringSoon, referenced });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── reference tracking ──

interface ReportRef { reportId: number; stockName: string; createdAt: string }

function buildRefMap(): Map<string, ReportRef[]> {
  const db = getDb();
  const reports = db.prepare("SELECT r.id, r.result_json, r.created_at, s.name as stock_name FROM reports r JOIN stocks s ON s.id = r.stock_id ORDER BY r.created_at DESC").all() as Array<{ id: number; result_json: string; created_at: string; stock_name: string }>;
  const map = new Map<string, ReportRef[]>();
  for (const rpt of reports) {
    try {
      const parsed = JSON.parse(rpt.result_json);
      const insights = parsed.knowledgeInsights as Array<{ title?: string }> | undefined;
      if (!insights || insights.length === 0) continue;
      for (const ins of insights) {
        if (!ins.title) continue;
        const key = ins.title;
        const list = map.get(key) ?? [];
        if (!list.some(r => r.reportId === rpt.id)) {
          list.push({ reportId: rpt.id, stockName: rpt.stock_name, createdAt: rpt.created_at });
        }
        map.set(key, list);
      }
    } catch {}
  }
  return map;
}

function getKbTitle(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  return dot > 0 ? originalName.substring(0, dot) : originalName;
}

// ── helpers ──

interface KbRow {
  id: number;
  filename: string;
  original_name: string;
  file_type: string;
  file_size: number;
  page_count: number | null;
  source: string;
  status: string;
  progress: number;
  progress_step: string;
  error_message: string | null;
  insight_json: string | null;
  tags_json: string;
  uploaded_at: string;
  expires_at: string;
}

function toKbFile(r: KbRow, nowMs: number, refMap?: Map<string, ReportRef[]>) {
  let summary: string | null = null;
  let keyPoints: string[] = [];
  let tags: string[] = [];

  try { if (r.insight_json) { const ins = JSON.parse(r.insight_json); summary = ins.summary ?? null; keyPoints = ins.keyPoints ?? []; } } catch {}
  try { tags = JSON.parse(r.tags_json); } catch {}

  const daysLeft = Math.max(0, Math.ceil((new Date(r.expires_at).getTime() - nowMs) / 86400000));
  const title = getKbTitle(r.original_name);
  const refList = refMap?.get(title) ?? [];

  return {
    id: r.id,
    filename: r.filename,
    originalName: r.original_name,
    fileType: r.file_type,
    fileSize: r.file_size,
    pageCount: r.page_count,
    source: r.source,
    status: r.status,
    progress: r.progress,
    progressStep: r.progress_step,
    errorMessage: r.error_message,
    summary,
    keyPoints,
    tags,
    uploadedAt: r.uploaded_at,
    expiresAt: r.expires_at,
    daysLeft,
    refs: refList.length,
    refList: refList.map(r => ({ reportId: r.reportId, stockName: r.stockName, createdAt: r.createdAt })),
  };
}
