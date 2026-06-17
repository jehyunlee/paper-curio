import { PaperMeta } from "../apis/zotero/item"
import { ReviewPayload } from "../llm/schema"
import { ExtractedFigure } from "../extract/figures"

/** YAML 큰따옴표 문자열 (내부 " 와 백슬래시 이스케이프). */
function y(s: string): string {
  return `"${(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`
}

export function todayISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** avg of 4 sub-scores (overall은 LLM이 직접 준 값 우선). */
export function overallScore(p: ReviewPayload): number {
  if (p.overall) return p.overall
  const avg = (p.novelty + p.technical + p.significance + p.clarity) / 4
  return Math.round(avg * 10) / 10
}

export interface BuildReviewArgs {
  meta: PaperMeta
  payload: ReviewPayload
  provider: string
  hasPdf: boolean
  reviewDate: string
  figures?: ExtractedFigure[]
}

/** Essence 섹션 상단에 들어갈 figure 마크다운 블록. */
function figureBlock(figures: ExtractedFigure[]): string {
  if (!figures || figures.length === 0) return ""
  return (
    figures
      .map((f) => `![Figure ${f.n}](${f.file})\n\n*${f.caption}*`)
      .join("\n\n") + "\n\n"
  )
}

/** review.md 본문('# 제목' 이하). index.html 렌더러에도 그대로 전달된다. */
export function buildReviewBody(args: BuildReviewArgs): string {
  const { meta, payload, figures = [] } = args
  const overall = overallScore(payload)
  const authorsLine = meta.authors.join(", ") || "(미상)"
  const urlLine = meta.url ? `[${meta.url}](${meta.url})` : "(없음)"

  return [
    "",
    `# ${meta.title}`,
    "",
    `> **저자**: ${authorsLine} | **날짜**: ${meta.date || "(미상)"} | **URL**: ${urlLine}`,
    "",
    "---",
    "",
    "## Essence",
    "",
    figureBlock(figures) + payload.essence,
    "",
    "## Motivation",
    "",
    `- **Known**: ${payload.known}`,
    `- **Gap**: ${payload.gap}`,
    `- **Why**: ${payload.why}`,
    `- **Approach**: ${payload.approach}`,
    "",
    "## Achievement",
    "",
    payload.achievement,
    "",
    "## How",
    "",
    payload.how,
    "",
    "## Originality",
    "",
    payload.originality,
    "",
    "## Limitation",
    "",
    payload.limitation,
    "",
    "## Evaluation",
    "",
    `- Novelty: ${payload.novelty}/5`,
    `- Technical Soundness: ${payload.technical}/5`,
    `- Significance: ${payload.significance}/5`,
    `- Clarity: ${payload.clarity}/5`,
    `- Overall: ${Math.round(overall)}/5`,
    "",
    `**총평**: ${payload.verdict}`,
    "",
  ].join("\n")
}

export function buildReviewMarkdown(args: BuildReviewArgs): string {
  const { meta, payload, provider, reviewDate } = args
  const overall = overallScore(payload)
  const authorsYaml = meta.authors.length
    ? meta.authors.map((a) => `  - ${y(a)}`).join("\n")
    : "  []"

  const frontmatter = [
    "---",
    `title: ${y(meta.title)}`,
    `authors:`,
    authorsYaml,
    `date: ${y(meta.date)}`,
    `doi: ${y(meta.doi)}`,
    `arxiv: ${y(meta.arxiv)}`,
    `journal: ${y(meta.journal)}`,
    `primary_topic: "uncategorized"`,
    `primary_category: ""`,
    `all_categories: []`,
    `sub_categories: {}`,
    `sub_category: ""`,
    `scores:`,
    `  novelty: ${payload.novelty.toFixed(1)}`,
    `  technical: ${payload.technical.toFixed(1)}`,
    `  significance: ${payload.significance.toFixed(1)}`,
    `  clarity: ${payload.clarity.toFixed(1)}`,
    `  overall: ${overall.toFixed(1)}`,
    `score: ${overall.toFixed(1)}`,
    `essence: ${y(payload.essence)}`,
    `tags:`,
    `  - "paper"`,
    `  - "papercurio-generated"`,
    `schema_version: "v1"`,
    `review_date: ${y(reviewDate)}`,
    `review_provider: ${y(provider)}`,
    "---",
  ].join("\n")

  return frontmatter + "\n" + buildReviewBody(args)
}
