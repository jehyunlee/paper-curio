import OpenAI from "openai"
import { ReviewProvider } from "./provider"
import {
  ReviewPayload,
  REVIEW_TOOL_NAME,
  REVIEW_TOOL_DESCRIPTION,
  REVIEW_PARAMETERS,
  normalizeReviewPayload,
} from "./schema"
import { getOpenAIKey } from "../utils/env"
import { getPrefStr } from "../utils/prefs"

export class OpenAIProvider implements ReviewProvider {
  name = "openai" as const

  isConfigured(): boolean {
    return !!getOpenAIKey()
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<ReviewPayload> {
    const apiKey = getOpenAIKey()
    const model = getPrefStr("OPENAI_MODEL") || "gpt-4o-mini"
    const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })

    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: REVIEW_TOOL_NAME,
            description: REVIEW_TOOL_DESCRIPTION,
            parameters: REVIEW_PARAMETERS as any,
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: REVIEW_TOOL_NAME },
      },
    })

    const call = resp.choices?.[0]?.message?.tool_calls?.[0]
    if (!call?.function?.arguments) {
      throw new Error("OpenAI: no tool_call arguments in response")
    }
    let parsed: any
    try {
      parsed = JSON.parse(call.function.arguments)
    } catch (e) {
      throw new Error(`OpenAI: tool_call arguments not valid JSON: ${e}`)
    }
    return normalizeReviewPayload(parsed)
  }
}
