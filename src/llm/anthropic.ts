import Anthropic from "@anthropic-ai/sdk"
import { ReviewProvider } from "./provider"
import {
  ReviewPayload,
  REVIEW_TOOL_NAME,
  REVIEW_TOOL_DESCRIPTION,
  REVIEW_PARAMETERS,
  normalizeReviewPayload,
} from "./schema"
import { getAnthropicKey } from "../utils/env"
import { getPrefStr } from "../utils/prefs"

export class AnthropicProvider implements ReviewProvider {
  name = "anthropic" as const

  isConfigured(): boolean {
    return !!getAnthropicKey()
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<ReviewPayload> {
    const apiKey = getAnthropicKey()
    const model =
      getPrefStr("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001"
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [
        {
          name: REVIEW_TOOL_NAME,
          description: REVIEW_TOOL_DESCRIPTION,
          input_schema: REVIEW_PARAMETERS as any,
        },
      ],
      tool_choice: { type: "tool", name: REVIEW_TOOL_NAME },
    })

    const block = resp.content.find((b: any) => b.type === "tool_use") as any
    if (!block || !block.input) {
      throw new Error("Anthropic: no tool_use block in response")
    }
    return normalizeReviewPayload(block.input)
  }
}
