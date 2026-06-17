import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"
import { getAnthropicKey, getOpenAIKey, getGeminiKey } from "../utils/env"
import { getPrefStr } from "../utils/prefs"
import { llm as log } from "../utils/loggers"

export type Relation =
  | "alternative"
  | "extension"
  | "foundation"
  | "counterpoint"
  | "application"

const RELATIONS: Relation[] = [
  "alternative",
  "extension",
  "foundation",
  "counterpoint",
  "application",
]

export interface ConnCandidate {
  slug: string
  title: string
  essence: string
  date: string
}

export interface ConnectionResult {
  slug: string
  title: string
  relation: Relation
  reason: string
}

const TOOL_NAME = "emit_connections"
const TOOL_DESC =
  "Emit semantic connections from the target paper to candidate papers in the user's library. " +
  "Pick only genuinely related candidates (skip if none fit). reason는 한국어 한 문장."

const SYSTEM =
  "You find scholarly connections between a target paper and a candidate list. " +
  "relation 의미: foundation=대상이 후보를 기반으로 함, extension=대상이 후보의 후속/확장, " +
  "alternative=같은 문제의 다른 접근, counterpoint=반론·비판, application=응용 사례. " +
  "관련 없으면 포함하지 말 것. reason은 한국어 한 문장(전문용어 영문 유지)."

const PARAMETERS = {
  type: "object",
  properties: {
    connections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string", description: "후보의 정확한 slug" },
          relation: { type: "string", enum: RELATIONS },
          reason: { type: "string", description: "연결 이유 (한국어 한 문장)" },
        },
        required: ["slug", "relation", "reason"],
      },
    },
  },
  required: ["connections"],
} as const

function buildUserPrompt(
  target: { title: string; essence: string },
  candidates: ConnCandidate[],
): string {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. [slug: ${c.slug}] ${c.title} (${c.date})\n   essence: ${c.essence.slice(0, 200)}`,
    )
    .join("\n")
  return [
    `대상 논문:\n제목: ${target.title}\nessence: ${target.essence}`,
    "",
    `후보 목록 (이 중 진짜 관련된 것만, slug 정확히 사용):`,
    list,
  ].join("\n")
}

function validate(
  raw: any,
  candidates: ConnCandidate[],
): ConnectionResult[] {
  const bySlug = new Map(candidates.map((c) => [c.slug, c]))
  const arr = Array.isArray(raw?.connections) ? raw.connections : []
  const out: ConnectionResult[] = []
  const seen = new Set<string>()
  for (const c of arr) {
    const cand = bySlug.get(c?.slug)
    if (!cand) continue // 환각 slug 방지
    const rel = RELATIONS.includes(c?.relation) ? c.relation : "alternative"
    const key = `${rel}:${c.slug}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      slug: cand.slug,
      title: cand.title,
      relation: rel,
      reason: String(c?.reason || "").trim(),
    })
  }
  return out
}

async function viaAnthropic(sys: string, user: string): Promise<any> {
  const client = new Anthropic({
    apiKey: getAnthropicKey(),
    dangerouslyAllowBrowser: true,
  })
  const resp = await client.messages.create({
    model: getPrefStr("ANTHROPIC_MODEL") || "claude-sonnet-4-6",
    max_tokens: 2048,
    system: sys,
    messages: [{ role: "user", content: user }],
    tools: [
      { name: TOOL_NAME, description: TOOL_DESC, input_schema: PARAMETERS as any },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  })
  const block = resp.content.find((b: any) => b.type === "tool_use") as any
  if (!block?.input) throw new Error("Anthropic: no tool_use")
  return block.input
}

async function viaOpenAI(sys: string, user: string): Promise<any> {
  const client = new OpenAI({
    apiKey: getOpenAIKey(),
    dangerouslyAllowBrowser: true,
  })
  const resp = await client.chat.completions.create({
    model: getPrefStr("OPENAI_MODEL") || "gpt-5",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    tools: [
      {
        type: "function",
        function: { name: TOOL_NAME, description: TOOL_DESC, parameters: PARAMETERS as any },
      },
    ],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  })
  const args = resp.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  if (!args) throw new Error("OpenAI: no tool_call")
  return JSON.parse(args)
}

async function viaGemini(sys: string, user: string): Promise<any> {
  const genAI = new GoogleGenerativeAI(getGeminiKey())
  const model = genAI.getGenerativeModel({
    model: getPrefStr("GEMINI_MODEL") || "gemini-3.1-pro-preview",
    systemInstruction: sys,
    tools: [
      {
        functionDeclarations: [
          {
            name: TOOL_NAME,
            description: TOOL_DESC,
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                connections: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      slug: { type: SchemaType.STRING },
                      relation: { type: SchemaType.STRING },
                      reason: { type: SchemaType.STRING },
                    },
                    required: ["slug", "relation", "reason"],
                  },
                },
              },
              required: ["connections"],
            } as any,
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: "ANY" as any,
        allowedFunctionNames: [TOOL_NAME],
      },
    },
  })
  const result = await model.generateContent(user)
  const call = result.response.functionCalls?.()?.[0]
  if (!call?.args) throw new Error("Gemini: no functionCall")
  return call.args
}

/**
 * 신규 논문 → 후보 풀에서 연관 논문 판정 (Anthropic→OpenAI→Gemini).
 * 후보 풀이 비었거나 전부 실패하면 빈 배열 (연결 없음 = 박스 생략).
 */
export async function generateConnections(
  target: { title: string; essence: string },
  candidates: ConnCandidate[],
): Promise<ConnectionResult[]> {
  if (candidates.length === 0) return []
  const user = buildUserPrompt(target, candidates)

  const chain: { name: string; configured: boolean; fn: () => Promise<any> }[] = [
    { name: "anthropic", configured: !!getAnthropicKey(), fn: () => viaAnthropic(SYSTEM, user) },
    { name: "openai", configured: !!getOpenAIKey(), fn: () => viaOpenAI(SYSTEM, user) },
    { name: "gemini", configured: !!getGeminiKey(), fn: () => viaGemini(SYSTEM, user) },
  ]
  for (const p of chain) {
    if (!p.configured) continue
    try {
      const raw = await p.fn()
      const result = validate(raw, candidates)
      log(`connections ${p.name}: ${result.length}건`)
      return result
    } catch (e) {
      log(`connections ${p.name} 실패 → 폴백`, e)
    }
  }
  return []
}
