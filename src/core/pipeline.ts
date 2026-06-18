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
  readPapersIndex,
  PaperIndexEntry,
} from "./papers-index"
import { getPref } from "../utils/prefs"
import { buildSlug } from "../utils/slugify"
import { buildReviewMarkdown, todayISO } from "./review-md"
import { parseReviewMd } from "./review-parse"
import { buildReviewHtml, ConnItem } from "../render/reviewHtml"
import { extractText, buildTextMd } from "../extract/text"
import {
  extractFiguresViaBridge,
  extractTextViaBridge,
  writeReviewViaBridge,
  extractOriginalityViaBridge,
  generateConnectionsViaBridge,
  injectFrontmatterViaBridge,
  classifyViaBridge,
  integrateViaBridge,
} from "../extract/pybridge"
import { getPdfAttachmentKey, pdfFilePath } from "../extract/pdfjs"
import { getItemTopics } from "./categorize"
import { buildOriginalityMarkdown } from "../extract/originality"
import { joinPath, makeDir, writeText, readText, pathExists } from "../utils/fs"
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

  // 1) 출력 위치 + 기존 review 존재 여부 (작업 전 — 비파괴)
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

  // 2) 슬러그/폴더 먼저 (브리지가 이 폴더에 직접 기록)
  const slug = existing
    ? existing.slug
    : buildSlug(await nextNumber(target.papersDir), meta.title)
  const slugDir = joinPath(target.papersDir, slug)
  await makeDir(slugDir)
  const paperNumber = parseInt(slug.split("_")[0], 10) || 0
  const reviewDate = todayISO()
  const pdfPath = await pdfFilePath(item)
  const hasPdf = !!pdfPath

  // 3) text.md — 원본 extract_text(py312) 우선, 실패 시 TS(pdf.js).
  let textStr = ""
  const textOk =
    pdfPath && (await extractTextViaBridge(pdfPath, slugDir, target.root))
  if (textOk) {
    textStr = (await readText(joinPath(slugDir, "text.md")).catch(() => "")) || ""
    log(`text 원본 추출 OK (${textStr.length}자)`)
  } else {
    const ts = await extractText(item)
    textStr = ts.text
    if (textStr) await writeText(joinPath(slugDir, "text.md"), buildTextMd(textStr))
    log(`text TS 폴백 (${textStr.length}자)`)
  }

  // 4) figures — 원본 extract_figures(py312). figures/figN.png + .pc_figs.json.
  const figures = pdfPath
    ? await extractFiguresViaBridge(pdfPath, slugDir, target.root)
    : []

  // 5) review.md — 원본 write_review(py312, claude-haiku-4-5) 우선, 실패 시 TS 멀티프로바이더.
  let provider = "anthropic (write_review)"
  let reviewViaBridge = await writeReviewViaBridge(slugDir, meta, target.root)
  if (!reviewViaBridge) {
    log("review 브리지 미사용/실패 → TS 폴백")
    const { payload, provider: p } = await generateReview(
      SYSTEM_PROMPT,
      buildUserPrompt(meta, textStr),
    )
    provider = `${p} (TS)`
    await writeText(
      joinPath(slugDir, "review.md"),
      buildReviewMarkdown({
        meta,
        payload,
        provider: p,
        hasPdf,
        reviewDate,
        figures,
        topics: [],
      }),
    )
  }

  // 6) review.md 읽어 파싱 (브리지/TS 어느 쪽이 만들었든 통일 경로)
  const reviewPath = joinPath(slugDir, "review.md")
  const reviewContent = (await readText(reviewPath).catch(() => "")) || ""
  const parsed = parseReviewMd(reviewContent)

  // 7) originality.md — 원본 함수(_extract_rule_based) 브리지 우선, 실패 시 TS(동일 로직 포팅).
  try {
    const okBridge = await extractOriginalityViaBridge(
      slugDir,
      meta.title,
      parsed.essence,
      target.root,
    )
    if (!okBridge) {
      const originality = await buildOriginalityMarkdown({
        paperNumber,
        title: meta.title,
        textMd: textStr,
        abstract: meta.abstract,
        essence: parsed.essence,
      })
      await writeText(joinPath(slugDir, "originality.md"), originality)
    }
  } catch (e) {
    log("originality.md 생성 실패(무시)", e)
  }

  // topic은 Zotero collection 기반(캐노니컬: paper-curation config.json 역매핑).
  // category는 paper-curation classify에 위임.
  const topics = await getItemTopics(item, target.root)
  const finalTopics = topics.length > 0 ? topics : ["uncategorized"]
  const primaryTopic = finalTopics[0]

  // 8) 연관 논문 — 원본 specter2/compute_related/generate/sync(py312) 우선.
  //    캐시 있는 paper-curation 토픽(ai4s 등)만 동작 → 그 외/실패 시 TS 단일논문 LLM 폴백.
  let connections: ConnItem[] = []
  const bridgeConns = await generateConnectionsViaBridge(
    primaryTopic,
    slug,
    slugDir,
    { ...meta, essence: parsed.essence },
    target.root,
  )
  if (bridgeConns !== null) {
    // 원본 반환엔 title 없음 → 인덱스에서 보강
    const idx = await readPapersIndex(target.papersDir)
    const titleBySlug = new Map(idx.map((e) => [e.slug, e.title]))
    connections = bridgeConns.map((c) => ({
      ...c,
      title: c.title || titleBySlug.get(c.slug) || c.slug,
    }))
    log(`connections 원본(${primaryTopic}): ${connections.length}건`)
  } else {
    try {
      const candidates = await buildConnectionCandidates(target.papersDir, {
        slug,
        title: meta.title,
        authors: meta.authors,
        date: meta.date,
      })
      const conns = await generateConnections(
        { title: meta.title, essence: parsed.essence },
        candidates,
      )
      connections = conns.map((c) => ({
        relation: c.relation,
        slug: c.slug,
        title: c.title,
        reason: c.reason,
      }))
      log(`connections TS 폴백: ${connections.length}건`)
    } catch (e) {
      log("connections TS 폴백 실패(무시)", e)
    }
  }

  // 9) index.html — reviewHtml.ts(review_to_html 포팅)로 review.md를 렌더 + connections 주입.
  const html = buildReviewHtml({
    frontmatter: {
      title: parsed.title || meta.title,
      authors: parsed.authors.length ? parsed.authors : meta.authors,
      date: parsed.date || meta.date,
      doi: parsed.doi || meta.doi,
      url: parsed.url || meta.url,
      scores: parsed.scores,
      essence: parsed.essence,
    },
    body: parsed.body,
    slug,
    zoteroKey: (await getPdfAttachmentKey(item)) || meta.key,
    connections,
  })
  const indexHtmlPath = joinPath(slugDir, "index.html")
  await writeText(indexHtmlPath, html)

  // 10) _papers_index.json (덮어쓰기면 기존 분류 메타 보존)
  const score = parsed.scores.overall || 0
  const fresh: PaperIndexEntry = {
    slug,
    title: meta.title,
    authors: meta.authors,
    date: meta.date,
    doi: meta.doi,
    topics: finalTopics,
    primary_topic: finalTopics[0],
    classifications: {},
    scores: parsed.scores,
    score,
    essence: parsed.essence,
    has_pdf: hasPdf,
    has_figures: figures.length > 0,
    review_date: reviewDate,
    zotero_item_key: meta.key,
    tags: ["paper", "papercurio-generated", ...finalTopics],
  }
  await upsertEntry(target.papersDir, mergeEntry(existing, fresh))

  // 10.4) 카테고리 분류 — 원본 classify_papers.classify_via_bundle(HDBSCAN).
  //       _papers_index 기록 직후 실행(인덱스 엔트리를 읽어 classifications 갱신).
  //       토픽에 모델 없으면 skip(분류 비움) → 이후 paper-curation classify 에 위임.
  //       논문이 속한 모든 토픽에 대해 분류(각 토픽 모델 → 토픽별 classifications 키).
  for (const t of finalTopics) {
    if (t === "uncategorized") continue
    try {
      const classified = await classifyViaBridge(slug, t, target.root)
      log(`카테고리 분류[${t}] ${classified ? "OK" : "skip"}`)
    } catch (e) {
      log(`카테고리 분류[${t}] 실패(무시)`, e)
    }
  }

  // 10.5) review.md에 원본 frontmatter + Related Papers 주입 — 본체 풀런과 출력 일치.
  //       _papers_index.json 기록 뒤 실행(build_frontmatter가 인덱스 엔트리를 읽음).
  //       paper-curation/모듈 없으면 false → review.md는 본문만 유지(무시).
  try {
    const injected = await injectFrontmatterViaBridge(slug, primaryTopic, target.root)
    log(`frontmatter 주입 ${injected ? "OK" : "skip"}`)
  } catch (e) {
    log("frontmatter 주입 실패(무시)", e)
  }

  // 10.6) paper-curation 토픽 뷰 반영 — 논문이 속한 모든 토픽에 대해 Deep Research
  //       (검색 인덱스) + category 페이지 + network 재생성(논문당 즉시). 무거우므로
  //       실패해도 무시(다음 풀런이 반영). 토픽은 캐노니컬(모델 번들 보유) → Part A 보장.
  for (const t of finalTopics) {
    if (t === "uncategorized") continue
    try {
      const integrated = await integrateViaBridge(t, target.root)
      log(`토픽 반영[${t}] ${integrated ? "OK" : "skip/부분"}`)
    } catch (e) {
      log(`토픽 반영[${t}] 실패(무시)`, e)
    }
  }

  // 11) Zotero item 표시
  try {
    ztoolkit.ExtraField.setExtraField(item, "papercurio", `${slug};${reviewDate}`)
  } catch (e) {
    log("extra field 기록 실패(무시)", e)
  }

  log(
    "처리 완료",
    slug,
    `score=${score}`,
    `fig=${figures.length}`,
    `conn=${connections.length}`,
    `review=${reviewViaBridge ? "원본" : "TS"}`,
  )
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
