import { ReviewPayload } from "./schema"

export interface ReviewProvider {
  name: "anthropic" | "openai" | "gemini"
  /** API key가 있으면 true. */
  isConfigured(): boolean
  /** review 생성. 실패 시 throw → 다음 프로바이더로 폴백. */
  generate(systemPrompt: string, userPrompt: string): Promise<ReviewPayload>
}

export class AggregateProviderError extends Error {
  constructor(public attempts: { provider: string; error: string }[]) {
    super(
      "모든 LLM provider 실패:\n" +
        attempts.map((a) => `  - ${a.provider}: ${a.error}`).join("\n"),
    )
    this.name = "AggregateProviderError"
  }
}
