import { getPaperMeta } from "../apis/zotero/item"
import { getAttachmentFulltext } from "../apis/zotero/attachment"
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts/review-prompt"
import { generateReview } from "../llm"
import { resolveOutputTarget } from "./pc-discovery"
import {
  nextNumber,
  findExisting,
  upsertEntry,
  PaperIndexEntry,
} from "./papers-index"
import { buildSlug } from "../utils/slugify"
import { buildReviewMarkdown, todayISO, overallScore } from "./review-md"
import { renderIndexHtml } from "./html-renderer"
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
}

/** 단일 Zotero item → review.md + index.html 생성 + 인덱스 갱신. */
export async function processItem(item: Zotero.Item): Promise<ProcessResult> {
  const meta = getPaperMeta(item)
  log("처리 시작", meta.title)

  // 1) 본문 텍스트 (Zotero fulltext 인덱스)
  const { text, hasPdf } = await getAttachmentFulltext(item)

  // 2) LLM review 생성 (Anthropic→OpenAI→Gemini)
  const { payload, provider } = await generateReview(
    SYSTEM_PROMPT,
    buildUserPrompt(meta, text),
  )

  // 3) 출력 위치 결정
  const target = await resolveOutputTarget()

  // 4) 슬러그 — 기존(같은 DOI/Zotero key) 있으면 재사용, 없으면 새 번호
  const existing = await findExisting(target.papersDir, {
    doi: meta.doi,
    zoteroKey: meta.key,
  })
  const slug = existing
    ? existing.slug
    : buildSlug(await nextNumber(target.papersDir), meta.title)

  const slugDir = joinPath(target.papersDir, slug)
  await makeDir(slugDir)

  const reviewDate = todayISO()

  // 5) review.md
  const md = buildReviewMarkdown({
    meta,
    payload,
    provider,
    hasPdf,
    reviewDate,
  })
  await writeText(joinPath(slugDir, "review.md"), md)

  // 6) index.html
  const html = renderIndexHtml(meta, payload, { provider, reviewDate })
  const indexHtmlPath = joinPath(slugDir, "index.html")
  await writeText(indexHtmlPath, html)

  // 7) _papers_index.json
  const score = overallScore(payload)
  const entry: PaperIndexEntry = {
    slug,
    title: meta.title,
    authors: meta.authors,
    date: meta.date,
    doi: meta.doi,
    topics: ["uncategorized"],
    primary_topic: "uncategorized",
    classifications: {},
    score,
    essence: payload.essence,
    has_pdf: hasPdf,
    has_figures: false,
    review_date: reviewDate,
    zotero_item_key: meta.key,
    tags: ["paper", "papercurio-generated"],
  }
  await upsertEntry(target.papersDir, entry)

  // 8) Zotero item에 처리 표시 (extra field)
  try {
    ztoolkit.ExtraField.setExtraField(item, "papercurio", `${slug};${reviewDate}`)
  } catch (e) {
    log("extra field 기록 실패(무시)", e)
  }

  log("처리 완료", slug, `score=${score}`, `provider=${provider}`)
  return {
    slug,
    title: meta.title,
    score,
    provider,
    indexHtmlPath,
    source: target.source,
    hadPdf: hasPdf,
  }
}
