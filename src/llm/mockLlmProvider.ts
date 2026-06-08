import type { LlmProvider, LlmRequest } from "./llmProvider.js";

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock-llm";

  async generateStructured<T>(_request: LlmRequest, fallback: T): Promise<T> {
    return fallback;
  }
}
