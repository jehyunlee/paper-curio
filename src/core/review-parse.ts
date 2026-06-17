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

export function parseReviewMd(content: string): ParsedReview {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/)
  const fm = fmMatch ? fmMatch[1] : ""
  const after = fmMatch ? content.slice(fmMatch[0].length) : content

  // body = 첫 '## ' 섹션부터 (그 앞의 '# 제목', '> 저자', '---'는 reviewHtml이 frontmatter로 재구성)
  const secIdx = after.search(/^##\s/m)
  const body = secIdx >= 0 ? after.slice(secIdx) : after

  return {
    title: scalar(fm, "title"),
    authors: listUnder(fm, "authors"),
    date: scalar(fm, "date"),
    doi: scalar(fm, "doi"),
    url: scalar(fm, "url"),
    essence: scalar(fm, "essence"),
    scores: {
      novelty: numUnder(fm, "scores", "novelty"),
      technical: numUnder(fm, "scores", "technical"),
      significance: numUnder(fm, "scores", "significance"),
      clarity: numUnder(fm, "scores", "clarity"),
      overall: numUnder(fm, "scores", "overall"),
    },
    body,
  }
}
