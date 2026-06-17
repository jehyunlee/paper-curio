import { getPaperMeta } from "../apis/zotero/item"
import { getAttachmentFulltext } from "../apis/zotero/attachment"
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts/review-prompt"
import { generateReview } from "../llm"
import { resolveOutputTarget } from "./pc-discovery"
import {
  nextNumber,
  findExisting,
  upsertEntry,
  mergeEntry,
  isPaperCurioEntry,
  PaperIndexEntry,
} from "./papers-index"
import { getPref } from "../utils/prefs"
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
  skipped?: boolean
  skipReason?: "exists-native" | "exists-papercurio"
  overwritten?: boolean
}

/** 단일 Zotero item → review.md + index.html 생성 + 인덱스 갱신. */
export async function processItem(item: Zotero.Item): Promise<ProcessResult> {
  const meta = getPaperMeta(item)
  log("처리 시작", meta.title)

  // 1) 출력 위치 + 기존 review 존재 여부 먼저 확인 (LLM 호출 전에 — 비용 절약 + 비파괴)
  const target = await resolveOutputTarget()
  const existing = await findExisting(target.papersDir, {
    doi: meta.doi,
    zoteroKey: meta.key,
    title: meta.title,
  })

  const overwritePref = getPref("OVERWRITE_EXISTING") === true
  const existingIsOurs = existing ? isPaperCurioEntry(existing) : false
  // 덮어쓰기 허용 조건: 설정이 켜졌거나, Paper Curio가 직접 만든 review(=redo)일 때
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
      skipped: true,
      skipReason: existingIsOurs ? "exists-papercurio" : "exists-native",
    }
  }

  // 2) 본문 텍스트 (Zotero fulltext 인덱스)
  const { text, hasPdf } = await getAttachmentFulltext(item)

  // 3) LLM review 생성 (Anthropic→OpenAI→Gemini)
  const { payload, provider } = await generateReview(
    SYSTEM_PROMPT,
    buildUserPrompt(meta, text),
  )

  // 4) 슬러그 — 기존 있으면 재사용, 없으면 새 번호
  const slug = existing
    ? existing.slug
    : buildSlug(await nextNumber(target.papersDir), meta.title)
  const slugDir = joinPath(target.papersDir, slug)
  await makeDir(slugDir)

  const reviewDate = todayISO()

  // 5) review.md
  await writeText(
    joinPath(slugDir, "review.md"),
    buildReviewMarkdown({ meta, payload, provider, hasPdf, reviewDate }),
  )

  // 6) index.html
  const html = renderIndexHtml(meta, payload, { provider, reviewDate })
  const indexHtmlPath = joinPath(slugDir, "index.html")
  await writeText(indexHtmlPath, html)

  // 7) _papers_index.json — 덮어쓰기면 기존 분류 메타 보존(merge)
  const score = overallScore(payload)
  const fresh: PaperIndexEntry = {
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
  await upsertEntry(target.papersDir, mergeEntry(existing, fresh))

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
    overwritten: !!existing,
  }
}
