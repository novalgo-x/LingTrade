import { assertLiveLlmConfig, type LlmConfig } from "../config.js";
import type { LlmProvider, LlmRequest } from "./llmProvider.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionChoice {
  message?: {
    content?: string;
  };
}

interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
}

function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  if (typeof value !== "object" || value === null || !("choices" in value)) return false;
  const choices = (value as { choices?: unknown }).choices;
  return Array.isArray(choices);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (!match?.[1]) return JSON.parse(trimmed);
  return JSON.parse(match[1]);
}

// 个别 OpenAI 兼容网关会忽略 stream:false 强制返回 SSE 流，
// 此时按行聚合 data: 帧里的增量内容，等价于一次性响应
function aggregateSseContent(raw: string): string {
  let content = "";
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
      content += chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
    } catch { /* 跳过无法解析的帧 */ }
  }
  return content;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible";

  constructor(private readonly config: LlmConfig) {
    assertLiveLlmConfig(config);
  }

  async generateStructured<T>(request: LlmRequest, fallback: T): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const messages: ChatMessage[] = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ];

    try {
      const response = await fetch(joinUrl(this.config.baseUrl, "/v1/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.2,
          stream: false,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.error(`[LLM] ${response.status} task=${request.task}, prompt=${(request.userPrompt.length / 1024).toFixed(0)}KB: ${errBody.slice(0, 300)}`);
        throw new Error(`LLM request failed with status ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const rawBody = await response.text();
      let content: string | undefined;
      if (rawBody.trimStart().startsWith("data:") || rawBody.trimStart().startsWith("event:")) {
        content = aggregateSseContent(rawBody) || undefined;
      } else {
        const payload: unknown = JSON.parse(rawBody);
        if (!isChatCompletionResponse(payload)) {
          throw new Error("LLM response did not include choices array");
        }
        content = payload.choices[0]?.message?.content;
      }
      if (!content) {
        throw new Error("LLM response did not include message content");
      }
      try {
        return parseJsonObject(content) as T;
      } catch {
        console.error(`[warn] LLM 返回了无效 JSON，使用 fallback (task: ${request.task})`);
        return fallback;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.error(`[LLM] 请求超时 (${this.config.timeoutMs / 1000}s), task=${request.task}, model=${this.config.model}`);
        throw new Error(`LLM 请求超时（${this.config.timeoutMs / 1000} 秒），请检查网络或在设置中增大 LLM_TIMEOUT_MS`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
