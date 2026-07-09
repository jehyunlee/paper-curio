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
  /** 캐시 생성(쓰기) 토큰 — 첫 턴에 system(논문)을 캐시에 적재할 때. */
  cacheWrite?: number
  /** 캐시 적중(읽기) 토큰 — 후속 턴에 캐시된 system을 재사용할 때. */
  cacheRead?: number
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

/**
 * 누적 토큰 → 예상 비용(USD). 캐시 토큰은 Anthropic 5분 ephemeral 캐시 기준
 * (write ≈ 1.25× input, read ≈ 0.1× input)으로 환산한다. 추정치.
 */
export function estimateCost(
  model: string,
  inTok: number,
  outTok: number,
  cacheWrite = 0,
  cacheRead = 0,
): number {
  const p = priceFor(model)
  return (
    (inTok * p.in +
      outTok * p.out +
      cacheWrite * p.in * 1.25 +
      cacheRead * p.in * 0.1) /
    1_000_000
  )
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

/**
 * 멀티턴 대화 1턴. system(논문 컨텍스트) + 히스토리 → 답변 + 토큰 usage.
 *
 * onDelta가 주어지면 스트리밍으로 호출하고 생성되는 텍스트 조각을 그때그때
 * 콜백으로 흘려보낸다(없으면 완성본만 한 번에 반환). Anthropic은 system(논문
 * 전문) 블록에 ephemeral prompt caching을 걸어, 5분 내 후속 질문이 같은 논문을
 * 매번 다시 처리하지 않고 캐시에서 재사용하도록 한다(입력비 ~1/10).
 */
export async function chatComplete(
  provider: ChatProvider,
  model: string,
  system: string,
  messages: ChatMsg[],
  onDelta?: (delta: string) => void,
): Promise<ChatResult> {
  const key = keyFor(provider)
  if (!key) throw new Error(`${PROVIDER_LABEL[provider]} API key가 설정되지 않았습니다.`)

  if (provider === "anthropic") {
    const c = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
    const params = {
      model,
      max_tokens: 4096,
      // system을 content 블록 배열로 주고 cache_control을 걸어야 캐싱된다.
      // 논문 전문이 여기 실리므로 캐시 효과가 가장 크다.
      system: [
        {
          type: "text" as const,
          text: system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }
    const stream = c.messages.stream(params)
    if (onDelta) stream.on("text", (t: string) => onDelta(t))
    const final = await stream.finalMessage()
    const block = (final.content || []).find((b: any) => b.type === "text") as any
    const u: any = final.usage || {}
    return {
      text: block?.text || "",
      usage: {
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheWrite: num(u.cache_creation_input_tokens),
        cacheRead: num(u.cache_read_input_tokens),
      },
    }
  }

  if (provider === "openai") {
    const c = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })
    const msgs = [
      { role: "system" as const, content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ]
    if (onDelta) {
      // OpenAI는 프롬프트 캐싱이 자동(>1024토큰)이라 별도 파라미터가 없다.
      const s = await c.chat.completions.create({
        model,
        messages: msgs,
        stream: true,
        stream_options: { include_usage: true },
      })
      let text = ""
      let usage: any = {}
      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          text += delta
          onDelta(delta)
        }
        if ((chunk as any).usage) usage = (chunk as any).usage
      }
      return {
        text,
        usage: {
          input: num(usage.prompt_tokens),
          output: num(usage.completion_tokens),
        },
      }
    }
    const r = await c.chat.completions.create({ model, messages: msgs })
    return {
      text: r.choices?.[0]?.message?.content || "",
      usage: {
        input: num((r as any).usage?.prompt_tokens),
        output: num((r as any).usage?.completion_tokens),
      },
    }
  }

  // gemini — 명시적 캐싱은 별도 CachedContent 흐름이 필요해 여기선 생략
  // (Gemini 2.5+ 는 implicit caching이 자동 적용됨).
  const genAI = new GoogleGenerativeAI(key)
  const gm = genAI.getGenerativeModel({ model, systemInstruction: system })
  const req = {
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  }
  if (onDelta) {
    const result = await gm.generateContentStream(req)
    let text = ""
    for await (const chunk of result.stream) {
      let d = ""
      try {
        d = chunk.text() || ""
      } catch {
        d = ""
      }
      if (d) {
        text += d
        onDelta(d)
      }
    }
    const final = await result.response
    const um: any = (final as any)?.usageMetadata || {}
    return {
      text,
      usage: {
        input: num(um.promptTokenCount),
        output: num(um.candidatesTokenCount) + num(um.thoughtsTokenCount),
      },
    }
  }
  const r = await gm.generateContent(req)
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
