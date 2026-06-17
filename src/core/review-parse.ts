/**
 * review.md (브리지 write_review 또는 TS 생성) → reviewHtml 입력으로 파싱.
 * frontmatter(YAML 일부) + body('## ' 이하 섹션)로 분리.
 */

export interface ParsedReview {
  title: string
  authors: string[]
  date: string
  doi: string
  url: string
  essence: string
  scores: {
    novelty: number
    technical: number
    significance: number
    clarity: number
    overall: number
  }
  body: string // 첫 '## ' 섹션부터 끝까지
}

function unquote(s: string): string {
  const t = (s || "").trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  return t
}

function scalar(fm: string, key: string): string {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))
  return m ? unquote(m[1]) : ""
}

function numUnder(fm: string, parent: string, key: string): number {
  // parent:\n  key: value  형태
  const block = fm.match(new RegExp(`^${parent}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, "m"))
  if (!block) return 0
  const m = block[1].match(new RegExp(`^[ \\t]+${key}:\\s*([0-9.]+)`, "m"))
  return m ? parseFloat(m[1]) : 0
}

function listUnder(fm: string, key: string): string[] {
  const block = fm.match(new RegExp(`^${key}:\\s*\\n((?:[ \\t]*-.*\\n?)*)`, "m"))
  if (!block) return []
  return block[1]
    .split("\n")
    .map((l) => l.replace(/^[ \t]*-\s*/, "").trim())
    .filter(Boolean)
    .map(unquote)
}

interface BodySignals {
  novelty?: number
  technical?: number
  significance?: number
  clarity?: number
  overall?: number
  essence?: string
}

/**
 * paper-curation inject_frontmatter.py `_read_review_body_signals` 1:1 포팅.
 * 원본 write_review(브리지) 출력은 YAML frontmatter가 없고 점수·essence가 본문
 * (`## Evaluation` 리스트, `## Essence` 섹션)에 들어간다. frontmatter가 비었을 때
 * 본문에서 이 값들을 복구하기 위한 폴백.
 */
function bodySignals(content: string): BodySignals {
  // 기존 frontmatter가 있으면 제거해 regex가 frontmatter 문자열을 잡지 않게.
  let c = content
  if (c.startsWith("---")) {
    const end = c.indexOf("\n---", 3)
    if (end !== -1) c = c.slice(end + 4)
  }
  const out: BodySignals = {}
  // Scores: "- Novelty: 4/5"  (원본 regex: rf"{label}\D*(\d+(?:\.\d+)?)\s*/\s*5")
  type ScoreKey = "novelty" | "technical" | "significance" | "clarity" | "overall"
  const labels: Array<[string, ScoreKey]> = [
    ["Novelty", "novelty"],
    ["Technical Soundness", "technical"],
    ["Significance", "significance"],
    ["Clarity", "clarity"],
    ["Overall", "overall"],
  ]
  for (const [label, key] of labels) {
    const m = c.match(new RegExp(`${label}\\D*(\\d+(?:\\.\\d+)?)\\s*/\\s*5`))
    if (m) out[key] = parseFloat(m[1])
  }
  // Essence: "## Essence" 아래 첫 비-figure 라인들 (원본: re.DOTALL, ![ 또는 * 시작 제외)
  const em = c.match(/##\s*Essence\s*\n([\s\S]+?)(?=\n##|$)/)
  if (em) {
    const lines = em[1]
      .split("\n")
      .map((ln) => ln.trim())
      .filter((ln) => ln && !ln.startsWith("![") && !ln.startsWith("*"))
    if (lines.length) out.essence = lines.join(" ").slice(0, 500)
  }
  return out
}

export function parseReviewMd(content: string): ParsedReview {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/)
  const fm = fmMatch ? fmMatch[1] : ""
  const after = fmMatch ? content.slice(fmMatch[0].length) : content

  // body = 첫 '## ' 섹션부터 (그 앞의 '# 제목', '> 저자', '---'는 reviewHtml이 frontmatter로 재구성)
  const secIdx = after.search(/^##\s/m)
  const body = secIdx >= 0 ? after.slice(secIdx) : after

  // 원본 write_review(브리지) 출력은 frontmatter가 없어 scores·essence가 본문에만 있다.
  // frontmatter에 값이 있으면 그것을, 없으면(=0/빈값) 본문 신호를 사용한다.
  const sig = bodySignals(content)
  const pick = (key: keyof typeof sig) =>
    numUnder(fm, "scores", key as string) || (sig[key] as number) || 0

  return {
    title: scalar(fm, "title"),
    authors: listUnder(fm, "authors"),
    date: scalar(fm, "date"),
    doi: scalar(fm, "doi"),
    url: scalar(fm, "url"),
    essence: scalar(fm, "essence") || sig.essence || "",
    scores: {
      novelty: pick("novelty"),
      technical: pick("technical"),
      significance: pick("significance"),
      clarity: pick("clarity"),
      overall: pick("overall"),
    },
    body,
  }
}
