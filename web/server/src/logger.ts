// 零依赖的本地文件日志：把 console 输出 tee 一份到 web/data/logs/server-YYYY-MM-DD.log，
// 终端输出保持不变；按天分文件，启动时清理过期日志。写入失败绝不影响主流程。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, "..", "..", "data", "logs");
const RETENTION_DAYS = 7;

function pad(n: number, w = 2): string { return String(n).padStart(w, "0"); }

// 用本地时间（A 股盘中排查更直观），格式 2026-06-12 21:58:01.123
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTs(d = new Date()): string {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function fmt(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function writeLine(level: string, args: unknown[]): void {
  try {
    const line = `${localTs()} [${level}] ${args.map(fmt).join(" ")}\n`;
    fs.appendFileSync(path.join(LOG_DIR, `server-${localDate()}.log`), line);
  } catch { /* 日志写入失败不影响主流程 */ }
}

function cleanupOldLogs(): void {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^server-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch { /* ignore */ }
}

export function setupFileLogging(): void {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { return; }
  cleanupOldLogs();
  const levels = [["log", "INFO"], ["info", "INFO"], ["warn", "WARN"], ["error", "ERROR"]] as const;
  for (const [method, level] of levels) {
    const orig = console[method].bind(console);
    console[method] = (...args: unknown[]) => { orig(...args); writeLine(level, args); };
  }
  // 崩溃原因落盘（终端照常打印），保持原有的退出语义
  process.on("uncaughtException", err => { console.error("uncaughtException:", err); process.exit(1); });
  process.on("unhandledRejection", reason => { console.error("unhandledRejection:", reason); process.exit(1); });
  console.log(`[Logger] File logging enabled: ${LOG_DIR}`);
}
