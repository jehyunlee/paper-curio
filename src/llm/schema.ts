/**
 * emit_review 구조화 출력 스키마. 3개 프로바이더(Anthropic/OpenAI/Gemini)가 공통으로 사용.
 * paper-curation v1 review 섹션과 1:1 매핑.
 */

export interface ReviewPayload {
  essence: string
  known: string
  gap: string
  why: string
  approach: string
  achievement: string
  how: string
  originality: string
  limitation: string
  novelty: number
  technical: number
  significance: number
  clarity: number
  overall: number
  verdict: string
}

export const REVIEW_TOOL_NAME = "emit_review"

export const REVIEW_TOOL_DESCRIPTION =
  "Emit a structured paper review compatible with the paper-curation v1 schema. " +
  "All narrative fields MUST be in Korean; technical jargon/proper nouns stay in English."

/** JSON Schema (draft-07 호환 subset). 세 프로바이더가 약간씩 다르게 wrap한다. */
export const REVIEW_PARAMETERS = {
  type: "object",
  properties: {
    essence: { type: "string", description: "핵심 1-2문장 요약 (한국어)" },
    known: { type: "string", description: "기존에 알려진 것" },
    gap: { type: "string", description: "기존 연구의 공백/한계" },
    why: { type: "string", description: "이 문제가 왜 중요한가" },
    approach: { type: "string", description: "저자들의 접근 방식 개요" },
    achievement: { type: "string", description: "주요 성과/기여 (마크다운 목록 가능)" },
    how: { type: "string", description: "방법론 핵심 (마크다운 bullet 가능)" },
    originality: { type: "string", description: "독창성" },
    limitation: { type: "string", description: "한계점" },
    novelty: { type: "integer", description: "참신성 1-5", minimum: 1, maximum: 5 },
    technical: { type: "integer", description: "기술적 깊이 1-5", minimum: 1, maximum: 5 },
    significance: { type: "integer", description: "중요도 1-5", minimum: 1, maximum: 5 },
    clarity: { type: "integer", description: "명료성 1-5", minimum: 1, maximum: 5 },
    overall: { type: "integer", description: "종합 1-5", minimum: 1, maximum: 5 },
    verdict: { type: "string", description: "한 줄 총평 (한국어)" },
  },
  required: [
    "essence", "known", "gap", "why", "approach", "achievement", "how",
    "originality", "limitation",
    "novelty", "technical", "significance", "clarity", "overall", "verdict",
  ],
  additionalProperties: false,
} as const

/** 응답 객체가 ReviewPayload 형태인지 검증 + 좌표 정규화(점수 clamp). */
export function normalizeReviewPayload(raw: any): ReviewPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("emit_review returned non-object")
  }
  const str = (v: any) => (typeof v === "string" ? v : v == null ? "" : String(v))
  const score = (v: any) => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n)) return 3
    return Math.min(5, Math.max(1, n))
  }
  const required = [
    "essence", "achievement", "how", "originality", "limitation", "verdict",
  ]
  for (const k of required) {
    if (!str(raw[k]).trim()) {
      throw new Error(`emit_review missing required field: ${k}`)
    }
  }
  return {
    essence: str(raw.essence),
    known: str(raw.known),
    gap: str(raw.gap),
    why: str(raw.why),
    approach: str(raw.approach),
    achievement: str(raw.achievement),
    how: str(raw.how),
    originality: str(raw.originality),
    limitation: str(raw.limitation),
    novelty: score(raw.novelty),
    technical: score(raw.technical),
    significance: score(raw.significance),
    clarity: score(raw.clarity),
    overall: score(raw.overall),
    verdict: str(raw.verdict),
  }
}
