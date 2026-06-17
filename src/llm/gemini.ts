import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"
import { ReviewProvider } from "./provider"
import {
  ReviewPayload,
  REVIEW_TOOL_NAME,
  REVIEW_TOOL_DESCRIPTION,
  normalizeReviewPayload,
} from "./schema"
import { getGeminiKey } from "../utils/env"
import { getPrefStr } from "../utils/prefs"

// Gemini는 자체 SchemaType enum을 요구하므로 REVIEW_PARAMETERS를 Gemini 형식으로 재기술.
const GEMINI_PARAMETERS = {
  type: SchemaType.OBJECT,
  properties: {
    essence: { type: SchemaType.STRING },
    known: { type: SchemaType.STRING },
    gap: { type: SchemaType.STRING },
    why: { type: SchemaType.STRING },
    approach: { type: SchemaType.STRING },
    achievement: { type: SchemaType.STRING },
    how: { type: SchemaType.STRING },
    originality: { type: SchemaType.STRING },
    limitation: { type: SchemaType.STRING },
    novelty: { type: SchemaType.INTEGER },
    technical: { type: SchemaType.INTEGER },
    significance: { type: SchemaType.INTEGER },
    clarity: { type: SchemaType.INTEGER },
    overall: { type: SchemaType.INTEGER },
    verdict: { type: SchemaType.STRING },
  },
  required: [
    "essence", "known", "gap", "why", "approach", "achievement", "how",
    "originality", "limitation",
    "novelty", "technical", "significance", "clarity", "overall", "verdict",
  ],
}

export class GeminiProvider implements ReviewProvider {
  name = "gemini" as const

  isConfigured(): boolean {
    return !!getGeminiKey()
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<ReviewPayload> {
    const apiKey = getGeminiKey()
    const modelName = getPrefStr("GEMINI_MODEL") || "gemini-3.1-pro-preview"
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      tools: [
        {
          functionDeclarations: [
            {
              name: REVIEW_TOOL_NAME,
              description: REVIEW_TOOL_DESCRIPTION,
              parameters: GEMINI_PARAMETERS as any,
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY" as any,
          allowedFunctionNames: [REVIEW_TOOL_NAME],
        },
      },
    })

    const result = await model.generateContent(userPrompt)
    const calls = result.response.functionCalls?.()
    const call = calls && calls[0]
    if (!call?.args) {
      throw new Error("Gemini: no functionCall in response")
    }
    return normalizeReviewPayload(call.args)
  }
}
