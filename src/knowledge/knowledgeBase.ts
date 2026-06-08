import { readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import type { KnowledgeDocument, KnowledgeInsight } from "../domain/types.js";
import type { LlmProvider } from "../llm/llmProvider.js";
import { extractText } from "./fileParser.js";
import { buildKnowledgeDigestPrompt } from "./knowledgePrompt.js";

const SUPPORTED_EXTENSIONS = new Set([".doc", ".docx", ".pdf", ".txt", ".md"]);
const CACHE_SUFFIX = ".insight.json";

function extractDateFromFilename(filename: string): string {
  const ymd = filename.match(/(\d{4})[年\-_.](\d{2})[月\-_.](\d{2})[日]?/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const compact = filename.match(/(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return "unknown";
}

function extractTitleFromFilename(filename: string): string {
  const name = basename(filename, extname(filename));
  return name
    .replace(/【[^】]*】/g, "")
    .replace(/_\d{8}_\d{6}$/, "")
    .replace(/^\s+|\s+$/g, "")
    || name;
}

async function scanFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await scanFiles(fullPath));
    } else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

async function loadCachedInsight(filePath: string): Promise<{ insight: KnowledgeInsight; mtime: number } | null> {
  const cachePath = filePath + CACHE_SUFFIX;
  try {
    const raw = await readFile(cachePath, "utf-8");
    return JSON.parse(raw) as { insight: KnowledgeInsight; mtime: number };
  } catch {
    return null;
  }
}

async function saveCachedInsight(filePath: string, insight: KnowledgeInsight, mtime: number): Promise<void> {
  const cachePath = filePath + CACHE_SUFFIX;
  await writeFile(cachePath, JSON.stringify({ insight, mtime }, null, 2), "utf-8");
}

export async function loadKnowledgeDocuments(kbDir: string): Promise<KnowledgeDocument[]> {
  const files = await scanFiles(kbDir);
  const docs: KnowledgeDocument[] = [];
  for (const filePath of files) {
    try {
      const content = await extractText(filePath);
      const parentDir = basename(dirname(filePath));
      docs.push({
        filePath,
        author: parentDir === basename(kbDir) ? "unknown" : parentDir,
        title: extractTitleFromFilename(basename(filePath)),
        publishDate: extractDateFromFilename(basename(filePath)),
        content,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[warn] 知识库文件解析失败: ${filePath} — ${msg}`);
    }
  }
  return docs;
}

export async function digestKnowledgeBase(
  kbDir: string,
  llm: LlmProvider,
  onProgress?: (msg: string) => void,
): Promise<KnowledgeInsight[]> {
  const docs = await loadKnowledgeDocuments(kbDir);
  if (docs.length === 0) return [];

  const insights: KnowledgeInsight[] = [];
  for (const doc of docs) {
    const fileStat = await stat(doc.filePath);
    const mtime = fileStat.mtimeMs;

    const cached = await loadCachedInsight(doc.filePath);
    if (cached && cached.mtime === mtime) {
      insights.push(cached.insight);
      onProgress?.(`缓存命中: ${doc.title}`);
      continue;
    }

    onProgress?.(`正在整理: ${doc.title} (${doc.author})`);
    const fallback: KnowledgeInsight = {
      author: doc.author,
      title: doc.title,
      publishDate: doc.publishDate,
      marketOutlook: "文档内容待 LLM 整理分析。",
      sectorViews: [],
      stockMentions: [],
      keyPoints: ["原始文档已加载但未经 LLM 提炼"],
      riskFactors: [],
      investmentThemes: [],
      summary: doc.content.slice(0, 500),
    };

    const prompt = buildKnowledgeDigestPrompt(doc);
    const insight = await llm.generateStructured<KnowledgeInsight>(
      { task: "knowledge_digest", ...prompt },
      fallback,
    );
    insight.author = doc.author;
    insight.title = doc.title;
    insight.publishDate = doc.publishDate;

    await saveCachedInsight(doc.filePath, insight, mtime);
    insights.push(insight);
  }

  return insights;
}
