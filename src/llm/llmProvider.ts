export interface LlmRequest {
  task: "knowledge_digest" | "knowledge_relevance_filter" | "stock_analysis" | "sentiment" | "research_report" | "bull_debate" | "bear_debate" | "decision";
  systemPrompt: string;
  userPrompt: string;
  /** 外部取消信号；触发后会中断在途请求。 */
  signal?: AbortSignal | undefined;
}

export interface LlmProvider {
  readonly name: string;
  generateStructured<T>(request: LlmRequest, fallback: T): Promise<T>;
}
