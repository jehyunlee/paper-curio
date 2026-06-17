import { getPaperMeta } from "../apis/zotero/item"
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts/review-prompt"
import { generateReview } from "../llm"
import { generateConnections } from "../llm/connections"
import { resolveOutputTarget } from "./pc-discovery"
import {
  nextNumber,
  findExisting,
  upsertEntry,
  mergeEntry,
  isPaperCurioEntry,
  buildConnectionCandidates,
  PaperIndexEntry,
} from "./papers-index"
import { getPref } from "../utils/prefs"
import { buildSlug } from "../utils/slugify"
import {
  buildReviewMarkdown,
  buildReviewBody,
  todayISO,
  overallScore,
} from "./review-md"
import { buildReviewHtml, ConnItem } from "../render/reviewHtml"
import { extractText, buildTextMd } from "../extract/text"
import { extractFigures } from "../extract/figures"
import { getPdfAttachmentKey } from "../extract/pdfjs"
import { getItemTopics } from "./categorize"
import { buildOriginalityMarkdown } from "../extract/originality"
import { joinPath, makeDir, writeText } from "../utils/fs"
import { pipeline as log } from "../utils/loggers"

export interface ProcessResult {
  slug: string
  title: string
  score: number
  provider: string
  indexHtmlPath: string
  source: string
  hadPdf: boolean
  figures: number
  connections: number
  skipped?: boolean
  skipReason?: "exists-native" | "exists-papercurio"
  overwritten?: boolean
}

export async function processItem(item: Zotero.Item): Promise<ProcessResult> {
  const meta = getPaperMeta(item)
  log("처리 시작", meta.title)

  // 1) 출력 위치 + 기존 review 존재 여부 (LLM 호출 전 — 비파괴)
  const target = await resolveOutputTarget()
  const existing = await findExisting(target.papersDir, {
    doi: meta.doi,
    zoteroKey: meta.key,
    title: meta.title,
  })
  const overwritePref = getPref("OVERWRITE_EXISTING") === true
  const existingIsOurs = existing ? isPaperCurioEntry(existing) : false
  const overwriteAllowed = !existing || overwritePref || existingIsOurs

  if (existing && !overwriteAllowed) {
    log("기존 review 발견 — 건너뜀 (native)", existing.slug)
    return {
      slug: existing.slug,
      title: meta.title,
      score: typeof existing.score === "number" ? existing.score : 0,
      provider: "-",
      indexHtmlPath: joinPath(target.papersDir, existing.slug, "index.html"),
      source: target.source,
      hadPdf: !!existing.has_pdf,
      figures: 0,
      connections: 0,
      skipped: true,
      skipReason: existingIsOurs ? "exists-papercurio" : "exists-native",
    }
  }

  // 2) PDF 전체 텍스트 (pdf.js 전 페이지 → fallback Zotero fulltext)
  const extracted = await extractText(item)
  const hasPdf = extracted.hasPdf
  log(`text source=${extracted.source}, ${extracted.text.length}자`)

  // 3) LLM review (Anthropic→OpenAI→Gemini)
  const { payload, provider } = await generateReview(
    SYSTEM_PROMPT,
    buildUserPrompt(meta, extracted.text),
  )

  // 4) 슬러그 결정
  const slug = existing
    ? existing.slug
    : buildSlug(await nextNumber(target.papersDir), meta.title)
  const slugDir = joinPath(target.papersDir, slug)
  await makeDir(slugDir)
  const paperNumber = parseInt(slug.split("_")[0], 10) || 0
  const reviewDate = todayISO()

  // 5) figures 추출 (pdf.js 캡션영역 crop → figures/figN.webp). 실패 시 빈 배열.
  const figures = await extractFigures(item, slugDir)

  // 6) 연관 논문 (후보 풀 1차 필터 → LLM tool-use). 실패/후보없음 → 빈 배열.
  let connections: ConnItem[] = []
  try {
    const candidates = await buildConnectionCandidates(target.papersDir, {
      slug,
      title: meta.title,
      authors: meta.authors,
      date: meta.date,
    })
    const conns = await generateConnections(
      { title: meta.title, essence: payload.essence },
      candidates,
    )
    connections = conns.map((c) => ({
      relation: c.relation,
      slug: c.slug,
      title: c.title,
      reason: c.reason,
    }))
  } catch (e) {
    log("connections 생성 실패(무시)", e)
  }

  // 7) text.md
  if (extracted.text) {
    await writeText(joinPath(slugDir, "text.md"), buildTextMd(extracted.text))
  }

  // topic은 Zotero collection 기반. category는 paper-curation classify에 위임.
  const topics = getItemTopics(item)
  const finalTopics = topics.length > 0 ? topics : ["uncategorized"]

  // 8) originality.md (원본 topic_modeling.py 경로: rule-based → "title. essence". LLM 없음, 헤더 없음)
  try {
    const originality = await buildOriginalityMarkdown({
      paperNumber,
      title: meta.title,
      textMd: extracted.text,
      abstract: meta.abstract,
      essence: payload.essence,
    })
    await writeText(joinPath(slugDir, "originality.md"), originality)
  } catch (e) {
    log("originality.md 생성 실패(무시)", e)
  }

  // 9) review.md (figure 임베드 + topic 포함)
  const reviewArgs = { meta, payload, provider, hasPdf, reviewDate, figures, topics: finalTopics }
  await writeText(joinPath(slugDir, "review.md"), buildReviewMarkdown(reviewArgs))

  // 10) index.html (review_to_html.py 포팅 렌더러 — 다른 논문과 서식 통일)
  const html = buildReviewHtml({
    frontmatter: {
      title: meta.title,
      authors: meta.authors,
      date: meta.date,
      doi: meta.doi,
      url: meta.url,
      scores: {
        novelty: payload.novelty,
        technical: payload.technical,
        significance: payload.significance,
        clarity: payload.clarity,
        overall: overallScore(payload),
      },
      essence: payload.essence,
    },
    body: buildReviewBody(reviewArgs),
    slug,
    zoteroKey: (await getPdfAttachmentKey(item)) || meta.key,
    connections,
  })
  const indexHtmlPath = joinPath(slugDir, "index.html")
  await writeText(indexHtmlPath, html)

  // 11) _papers_index.json (덮어쓰기면 기존 분류 메타 보존)
  // topic은 Zotero collection에서 부여. category/sub_category는 비워두고
  // paper-curation 다음 빌드의 classify_papers.py(HDBSCAN)가 정확히 채우도록 위임.
  const score = overallScore(payload)
  const fresh: PaperIndexEntry = {
    slug,
    title: meta.title,
    authors: meta.authors,
    date: meta.date,
    doi: meta.doi,
    topics: finalTopics,
    primary_topic: finalTopics[0],
    classifications: {},
    score,
    essence: payload.essence,
    has_pdf: hasPdf,
    has_figures: figures.length > 0,
    review_date: reviewDate,
    zotero_item_key: meta.key,
    tags: ["paper", "papercurio-generated", ...finalTopics],
  }
  await upsertEntry(target.papersDir, mergeEntry(existing, fresh))

  // 12) Zotero item 표시
  try {
    ztoolkit.ExtraField.setExtraField(item, "papercurio", `${slug};${reviewDate}`)
  } catch (e) {
    log("extra field 기록 실패(무시)", e)
  }

  log("처리 완료", slug, `score=${score}`, `fig=${figures.length}`, `conn=${connections.length}`)
  return {
    slug,
    title: meta.title,
    score,
    provider,
    indexHtmlPath,
    source: target.source,
    hadPdf: hasPdf,
    figures: figures.length,
    connections: connections.length,
    overwritten: !!existing,
  }
}
