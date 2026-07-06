/**
 * 멀티턴 대화 백엔드. review 생성용 generateReview와 별개로, 사용자가 논문 PDF를
 * 컨텍스트로 자유롭게 질의응답하는 채팅에 쓴다. provider별 SDK를 직접 호출한다.
 */
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getAnthropicKey, getOpenAIKey, getGeminiKey } from "../utils/env"
import { getPrefStr } from "../utils/prefs"
import { llm as log } from "../utils/loggers"

export type ChatProvider = "anthropic" | "openai" | "gemini"

export interface ChatMsg {
  role: "user" | "assistant"
  content: string
}

export interface ChatUsage {
  input: number
  output: number
}

export interface ChatResult {
  text: string
  usage: ChatUsage
}

export interface ChatModelOption {
  provider: ChatProvider
  model: string
  label: string
}

const CURATED: Record<ChatProvider, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"],
  openai: ["gpt-5.5", "gpt-5", "gpt-4.1"],
  gemini: ["gemini-3.1-pro-preview", "gemini-3.5-flash"],
}

const PROVIDER_LABEL: Record<ChatProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
}

/**
 * 모델별 대략 단가 (USD / 1M 토큰, input/output). 공시가 기반 추정치이며 실제
 * 청구액과 다를 수 있다. 미등록 모델은 접두어 매칭 → 기본값 순으로 폴백.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus": { in: 15, out: 75 },
  "claude-sonnet": { in: 3, out: 15 },
  "claude-haiku": { in: 1, out: 5 },
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-4.1": { in: 2, out: 8 },
  "gemini-3.1-pro": { in: 1.25, out: 10 },
  "gemini-3.5-flash": { in: 0.3, out: 2.5 },
  "gemini-3.1-flash": { in: 0.3, out: 2.5 },
}
const DEFAULT_PRICE = { in: 3, out: 15 }

function priceFor(model: string): { in: number; out: number } {
  if (PRICES[model]) return PRICES[model]
  for (const prefix of Object.keys(PRICES)) {
    if (model.startsWith(prefix)) return PRICES[prefix]
  }
  return DEFAULT_PRICE
}

/** 누적 토큰 → 예상 비용(USD). */
export function estimateCost(model: string, inTok: number, outTok: number): number {
  const p = priceFor(model)
  return (inTok * p.in + outTok * p.out) / 1_000_000
}

function keyFor(p: ChatProvider): string {
  return p === "anthropic"
    ? getAnthropicKey()
    : p === "openai"
      ? getOpenAIKey()
      : getGeminiKey()
}

function prefModel(p: ChatProvider): string {
  return getPrefStr(
    p === "anthropic"
      ? "ANTHROPIC_MODEL"
      : p === "openai"
        ? "OPENAI_MODEL"
        : "GEMINI_MODEL",
  )
}

/** 설정된 provider들의 선택 가능한 (provider, model) 목록. pref 지정 모델을 맨 앞에. */
export function availableChatModels(): ChatModelOption[] {
  const out: ChatModelOption[] = []
  ;(["anthropic", "openai", "gemini"] as ChatProvider[]).forEach((p) => {
    if (!keyFor(p)) return
    const models: string[] = []
    const pref = prefModel(p)
    if (pref) models.push(pref)
    for (const m of CURATED[p]) if (!models.includes(m)) models.push(m)
    for (const m of models) {
      out.push({ provider: p, model: m, label: `${PROVIDER_LABEL[p]} · ${m}` })
    }
  })
  return out
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

/** 멀티턴 대화 1턴. system(논문 컨텍스트) + 히스토리 → 답변 + 토큰 usage. */
export async function chatComplete(
  provider: ChatProvider,
  model: string,
  system: string,
  messages: ChatMsg[],
): Promise<ChatResult> {
  const key = keyFor(provider)
  if (!key) throw new Error(`${PROVIDER_LABEL[provider]} API key가 설정되지 않았습니다.`)

  if (provider === "anthropic") {
    const c = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
    const r = await c.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })
    const block = (r.content || []).find((b: any) => b.type === "text") as any
    return {
      text: block?.text || "",
      usage: { input: num(r.usage?.input_tokens), output: num(r.usage?.output_tokens) },
    }
  }

  if (provider === "openai") {
    const c = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })
    const r = await c.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    })
    return {
      text: r.choices?.[0]?.message?.content || "",
      usage: {
        input: num((r as any).usage?.prompt_tokens),
        output: num((r as any).usage?.completion_tokens),
      },
    }
  }

  // gemini
  const genAI = new GoogleGenerativeAI(key)
  const gm = genAI.getGenerativeModel({ model, systemInstruction: system })
  const r = await gm.generateContent({
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  })
  const um = (r.response as any)?.usageMetadata || {}
  let text = ""
  try {
    text = r.response.text() || ""
  } catch (e) {
    log("gemini chat 응답 파싱 실패", e)
  }
  return {
    text,
    usage: {
      input: num(um.promptTokenCount),
      output: num(um.candidatesTokenCount) + num(um.thoughtsTokenCount),
    },
  }
}
