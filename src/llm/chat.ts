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

/** 멀티턴 대화 1턴. system(논문 컨텍스트) + 히스토리 → assistant 답변 텍스트. */
export async function chatComplete(
  provider: ChatProvider,
  model: string,
  system: string,
  messages: ChatMsg[],
): Promise<string> {
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
    return block?.text || ""
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
    return r.choices?.[0]?.message?.content || ""
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
  try {
    return r.response.text() || ""
  } catch (e) {
    log("gemini chat 응답 파싱 실패", e)
    return ""
  }
}
