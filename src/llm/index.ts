import { getAnthropicKey, getOpenAIKey, getGeminiKey } from "../utils/env"

/** Availability is not execution consent; callers select one provider explicitly. */
export function configuredProviders(): string[] {
  return [
    ["anthropic", getAnthropicKey()],
    ["openai", getOpenAIKey()],
    ["gemini", getGeminiKey()],
  ]
    .filter(([, key]) => !!key)
    .map(([name]) => name)
}

export function hasAnyProvider(): boolean {
  return configuredProviders().length > 0
}
