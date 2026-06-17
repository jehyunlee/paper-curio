import { ReviewProvider, AggregateProviderError } from "./provider"
import { ReviewPayload } from "./schema"
import { AnthropicProvider } from "./anthropic"
import { OpenAIProvider } from "./openai"
import { GeminiProvider } from "./gemini"
import { llm as log } from "../utils/loggers"

export { ReviewPayload } from "./schema"
export { AggregateProviderError } from "./provider"

/** Anthropic → OpenAI → Gemini 순. */
function chain(): ReviewProvider[] {
  return [new AnthropicProvider(), new OpenAIProvider(), new GeminiProvider()]
}

/** 설정된 provider가 하나라도 있는지. */
export function hasAnyProvider(): boolean {
  return chain().some((p) => p.isConfigured())
}

/** 설정된 provider 이름 목록 (사용자 안내용). */
export function configuredProviders(): string[] {
  return chain()
    .filter((p) => p.isConfigured())
    .map((p) => p.name)
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
): Promise<T> {
  let lastErr: any
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      // 인증/모델 오류(4xx)는 retry 무의미 → 즉시 폴백
      const status = e?.status ?? e?.statusCode
      if (status && status >= 400 && status < 500 && status !== 429) throw e
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
      }
    }
  }
  throw lastErr
}

/**
 * review 생성. Anthropic → OpenAI → Gemini 폴백.
 * 각 provider는 2회 retry 후 다음으로. 전부 실패 시 AggregateProviderError.
 */
export async function generateReview(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ payload: ReviewPayload; provider: string }> {
  const attempts: { provider: string; error: string }[] = []

  for (const p of chain()) {
    if (!p.isConfigured()) {
      attempts.push({ provider: p.name, error: "API key 없음" })
      continue
    }
    try {
      log(`시도: ${p.name}`)
      const payload = await withRetry(() => p.generate(systemPrompt, userPrompt))
      log(`성공: ${p.name}`)
      return { payload, provider: p.name }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      attempts.push({ provider: p.name, error: msg })
      log(`${p.name} 실패 → 폴백`, msg)
    }
  }
  throw new AggregateProviderError(attempts)
}
