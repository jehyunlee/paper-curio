import { PaperMeta } from "../apis/zotero/item"

export const SYSTEM_PROMPT =
  "You are a scientific paper reviewer producing reviews in the paper-curation v1 schema. " +
  "All narrative fields MUST be written in Korean (한국어), but technical jargon, library/model names, " +
  "equations, metrics, and proper nouns MUST stay in English. " +
  "Output ONLY via the emit_review tool/function call — never plain text. " +
  "Keep 'essence' to 1-2 sentences. Be concise but specific and grounded in the provided paper. " +
  "Do not invent results that are not supported by the abstract or body text."

const MAX_BODY_CHARS = 12000

export function buildUserPrompt(meta: PaperMeta, bodyText: string): string {
  const body = (bodyText || "").substring(0, MAX_BODY_CHARS)
  return [
    "다음 논문을 분석하고 emit_review 도구를 호출해 모든 필드를 채워라.",
    "모든 서술 필드는 한국어. jargon(라이브러리·모델명·수식·지표·고유명사)은 원문 영문 유지.",
    "",
    `제목: ${meta.title}`,
    `저자: ${meta.authors.join(", ") || "(미상)"}`,
    `연도: ${meta.date || "(미상)"}`,
    `DOI: ${meta.doi || "(없음)"}`,
    `arXiv: ${meta.arxiv || "(없음)"}`,
    `저널/학회: ${meta.journal || "(없음)"}`,
    "",
    `Abstract:\n${meta.abstract || "(없음)"}`,
    "",
    body
      ? `본문 (발췌, 최대 ${MAX_BODY_CHARS}자):\n${body}`
      : "본문 텍스트 없음 — Abstract와 메타데이터만으로 최대한 분석하되, 근거 부족한 부분은 한계로 명시.",
  ].join("\n")
}
