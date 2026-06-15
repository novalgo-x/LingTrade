import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, unlinkSync } from "node:fs";
import type { Response } from "express";
import { getDb } from "../db/connection.js";
import { extractText } from "../../../../src/knowledge/fileParser.js";
import { buildKnowledgeDigestPrompt } from "../../../../src/knowledge/knowledgePrompt.js";
import type { KnowledgeDocument, KnowledgeInsight } from "../../../../src/domain/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KB_DIR = path.resolve(__dirname, "..", "..", "..", "data", "knowledge");

mkdirSync(KB_DIR, { recursive: true });

/** 读取所有已就绪的知识库文档摘要，供投研流水线注入。 */
export function loadReadyInsights(): KnowledgeInsight[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT insight_json FROM kb_files WHERE status = 'ready' AND insight_json IS NOT NULL")
    .all() as Array<{ insight_json: string }>;
  const insights: KnowledgeInsight[] = [];
  for (const row of rows) {
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
    } catch { /* 跳过无法解析的记录 */ }
  }
  return insights;
}

// ── LLM helper ──

interface ChatCompletionResponse {
  choices: Array<{ message?: { content?: string } }>;
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  // 1) 直接是 JSON 对象
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  // 2) ```json ... ``` 代码块
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence?.[1]) {
    try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  }
  // 3) 从混合文本中提取第一个 { 到与之配对的 }（处理 LLM 输出的前导思考文字）
  const extracted = extractBalancedJson(trimmed);
  if (extracted) return JSON.parse(extracted);
  // 4) 兜底：直接 parse，让调用方捕获错误
  return JSON.parse(trimmed);
}

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function callLlm(systemPrompt: string, userPrompt: string): Promise<unknown> {
  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL ?? "deepseek-chat";
  const apiKey = process.env.LLM_API_KEY ?? "";
  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS ?? "60000") || 60000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const guardedSystem = systemPrompt + `

【输出硬性要求 — 必须严格遵守，违反将导致解析失败】
1. 直接输出纯 JSON 对象，以 { 开头、以 } 结尾。
2. 禁止任何前导说明、思考过程、结尾备注或 Markdown 代码块标记（如 \`\`\`json）。
3. 禁止使用任何工具调用语法或 XML 标签（如 <write_to_file>、<content>、<path> 等）。
4. JSON 字符串值内部如需强调或引用某词，必须使用中文引号「」或『』，绝对不能使用英文双引号 "，否则会破坏 JSON 结构。`;

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: guardedSystem },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const payload = await res.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM response empty");
    try {
      return parseJsonObject(content);
    } catch (parseErr) {
      console.error(`[KB] JSON 解析失败，原始返回前 800 字符:\n${content.slice(0, 800)}`);
      throw parseErr;
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── SSE broadcasting ──

const kbSubscribers = new Map<number, Set<Response>>();

function broadcastKbEvent(fileId: number, event: string, data: unknown): void {
  const subs = kbSubscribers.get(fileId);
  if (!subs) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    res.write(payload);
    if (event === "complete" || event === "error") res.end();
  }
  if (event === "complete" || event === "error") kbSubscribers.delete(fileId);
}

export function subscribeToKbProgress(fileId: number, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const db = getDb();
  const row = db.prepare("SELECT status, progress, progress_step, error_message FROM kb_files WHERE id = ?")
    .get(fileId) as { status: string; progress: number; progress_step: string; error_message: string | null } | undefined;

  if (!row) { res.write(`event: error\ndata: ${JSON.stringify({ message: "File not found" })}\n\n`); res.end(); return; }

  res.write(`event: progress\ndata: ${JSON.stringify({ progress: row.progress, step: row.progress_step })}\n\n`);

  if (row.status === "ready") { res.write(`event: complete\ndata: ${JSON.stringify({ fileId })}\n\n`); res.end(); return; }
  if (row.status === "failed") { res.write(`event: error\ndata: ${JSON.stringify({ message: row.error_message })}\n\n`); res.end(); return; }

  let subs = kbSubscribers.get(fileId);
  if (!subs) { subs = new Set(); kbSubscribers.set(fileId, subs); }
  subs.add(res);
  res.on("close", () => { subs!.delete(res); if (subs!.size === 0) kbSubscribers.delete(fileId); });
}

// ── Processing queue ──

const queue: number[] = [];
let processing = false;

export function enqueueKbFile(fileId: number): void {
  queue.push(fileId);
  if (!processing) drainQueue();
}

async function drainQueue(): Promise<void> {
  processing = true;
  while (queue.length > 0) {
    const fileId = queue.shift()!;
    await processKbFile(fileId);
  }
  processing = false;
}

function updateKb(fileId: number, fields: Record<string, unknown>): void {
  const db = getDb();
  const keys = Object.keys(fields);
  const sets = keys.map(k => `${k} = ?`).join(", ");
  db.prepare(`UPDATE kb_files SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map(k => fields[k]), fileId);
}

async function processKbFile(fileId: number): Promise<void> {
  const db = getDb();
  const row = db.prepare("SELECT filename, original_name, file_type FROM kb_files WHERE id = ?")
    .get(fileId) as { filename: string; original_name: string; file_type: string } | undefined;
  if (!row) return;

  const filePath = path.join(KB_DIR, row.filename);

  try {
    updateKb(fileId, { status: "processing", progress: 0, progress_step: "读取文件内容" });
    broadcastKbEvent(fileId, "progress", { progress: 0, step: "读取文件内容" });

    const text = await extractText(filePath);
    updateKb(fileId, { progress: 20, progress_step: "解析文档结构" });
    broadcastKbEvent(fileId, "progress", { progress: 20, step: "解析文档结构" });

    const doc: KnowledgeDocument = {
      filePath,
      author: "用户上传",
      title: path.basename(row.original_name, path.extname(row.original_name)),
      publishDate: new Date().toISOString().slice(0, 10),
      content: text,
    };

    updateKb(fileId, { progress: 30, progress_step: "构建分析请求" });
    broadcastKbEvent(fileId, "progress", { progress: 30, step: "构建分析请求" });

    const prompt = buildKnowledgeDigestPrompt(doc);

    updateKb(fileId, { progress: 50, progress_step: "AI 提取关键观点" });
    broadcastKbEvent(fileId, "progress", { progress: 50, step: "AI 提取关键观点" });

    const fallback: KnowledgeInsight = {
      author: doc.author, title: doc.title, publishDate: doc.publishDate,
      marketOutlook: "文档内容待分析。", sectorViews: [], stockMentions: [],
      keyPoints: ["原始文档已加载但未经 LLM 提炼"], riskFactors: [], investmentThemes: [],
      summary: text.slice(0, 500),
    };

    let insight: KnowledgeInsight;
    try {
      const raw = await callLlm(prompt.systemPrompt, prompt.userPrompt);
      insight = { ...fallback, ...(raw as Partial<KnowledgeInsight>) };
      insight.author = doc.author;
      insight.title = doc.title;
      insight.publishDate = doc.publishDate;
    } catch (llmErr) {
      console.error(`[KB] LLM failed for file ${fileId}:`, llmErr);
      insight = fallback;
    }

    updateKb(fileId, { progress: 80, progress_step: "生成标签与索引" });
    broadcastKbEvent(fileId, "progress", { progress: 80, step: "生成标签与索引" });

    const tags = [
      ...insight.investmentThemes.slice(0, 3),
      ...insight.sectorViews.slice(0, 2).map(s => s.split(":")[0]?.trim() ?? s),
    ].filter(Boolean);

    updateKb(fileId, {
      status: "ready", progress: 100, progress_step: "完成",
      insight_json: JSON.stringify(insight),
      tags_json: JSON.stringify(tags),
    });
    broadcastKbEvent(fileId, "complete", { fileId });

    console.log(`[KB] Processed file ${fileId}: ${row.original_name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateKb(fileId, { status: "failed", error_message: msg, progress_step: "处理失败" });
    broadcastKbEvent(fileId, "error", { message: msg });
    console.error(`[KB] Failed to process file ${fileId}:`, msg);
  }
}

// ── Cleanup ──

export function resetStuckKbFiles(): void {
  const db = getDb();
  const result = db.prepare(
    "UPDATE kb_files SET status = 'failed', error_message = 'Server restarted during processing' WHERE status IN ('queued', 'processing')"
  ).run();
  if (result.changes > 0) console.log(`[KB] Reset ${result.changes} stuck file(s)`);
}

export function cleanupExpiredKbFiles(): void {
  const db = getDb();
  const now = new Date().toISOString();
  const expired = db.prepare("SELECT id, filename FROM kb_files WHERE expires_at < ?").all(now) as Array<{ id: number; filename: string }>;

  for (const file of expired) {
    try { unlinkSync(path.join(KB_DIR, file.filename)); } catch {}
  }

  const result = db.prepare("DELETE FROM kb_files WHERE expires_at < ?").run(now);
  if (result.changes > 0) console.log(`[KB] Cleaned up ${result.changes} expired file(s)`);
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startKbCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredKbFiles, 24 * 60 * 60 * 1000);
}
