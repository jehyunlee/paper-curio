import { getPaperMeta } from "../apis/zotero/item"
import { resolveOutputTarget } from "./pc-discovery"
import {
  nextNumber,
  findExisting,
  isPaperCurioEntry,
  PaperIndexEntry,
} from "./papers-index"
import { getPref, getPrefStr } from "../utils/prefs"
import { buildSlug } from "../utils/slugify"
import { todayISO } from "./review-md"
import { parseReviewMd } from "./review-parse"
import {
  localReviewViaBridge,
  LocalReviewRequest,
  corpusViaBridge,
  featureViaBridge,
} from "../extract/pybridge"
import { pdfFilePath } from "../extract/pdfjs"
import { getItemTopics } from "./categorize"
import { joinPath, readText, pathExists } from "../utils/fs"
import { getString } from "../utils/locale"
import { pipeline as log } from "../utils/loggers"
import { ReviewTaskError, reviewStatusError } from "../utils/reviewError"

export interface ProcessResult {
  status: "completed" | "partial" | "skipped"
  recovery?:
    | "retry-registration"
    | "retry-zotero-marker"
    | "retry-connections"
    | "retry-views"
  slug: string
  title: string
  score?: number
  provider: string
  indexHtmlPath: string
  source: string
  hadPdf: boolean
  figures: number
  connections: number
  connectionProcessing?: "completed" | "failed" | "not-started"
  connectionError?: string
  bibliography?: "sidecar-only"
  bookkeeping?: "completed" | "failed"
  skipped?: boolean
  skipReason?: "exists-native"
  overwritten?: boolean
}

export interface ReviewRunOptions {
  signal?: AbortSignal
  regenerate?: boolean
}

function checkReviewActive(options: ReviewRunOptions): void {
  if (options.signal?.aborted) {
    const error = new Error("Review restart requested")
    error.name = "AbortError"
    throw error
  }
}

/**
 * One paper end to end: review, register, related papers and views. The
 * review queue instead runs `reviewItem` for several papers at once and
 * `finishReviews` once for the batch.
 */
export async function processItem(
  item: Zotero.Item,
  options: ReviewRunOptions = {},
): Promise<ProcessResult> {
  checkReviewActive(options)
  const reviewed = await reviewItem(item, options)
  if (!isRegistered(reviewed)) return reviewed
  checkReviewActive(options)
  const target = await resolveOutputTarget()
  const [finished] = await finishReviews(target.root, target.papersDir, [
    reviewed,
  ])
  return finished
}

/** Registered in the corpus, so related papers and views can follow. */
export function isRegistered(r: ProcessResult): boolean {
  return r.status !== "skipped" && r.recovery !== "retry-registration"
}

/**
 * Review one paper and register it with its views deferred. Reviews of
 * different papers may run concurrently: each holds only a shared corpus
 * lease, and the engine locks its own output directory.
 */
export async function reviewItem(
  item: Zotero.Item,
  options: ReviewRunOptions = {},
): Promise<ProcessResult> {
  const meta = getPaperMeta(item)
  const target = await resolveOutputTarget()
  const existing = await findExisting(target.papersDir, {
    doi: meta.doi,
    zoteroKey: meta.key,
    title: meta.title,
  })
  checkReviewActive(options)
  const overwriteAllowed =
    options.regenerate === true || getPref("OVERWRITE_EXISTING") === true
  let slug = existing
    ? existing.slug
    : buildSlug(await nextNumber(target.papersDir), meta.title)
  const slugDir = joinPath(target.papersDir, slug)
  let indexHtmlPath = joinPath(slugDir, "index.html")
  const skipped = (reason: ProcessResult["skipReason"]): ProcessResult => ({
    status: "skipped",
    slug,
    title: meta.title,
    score: existing?.score || 0,
    provider: "-",
    indexHtmlPath,
    source: target.source,
    hadPdf: !!existing?.has_pdf,
    figures: 0,
    connections: 0,
    skipped: true,
    skipReason: reason,
  })
  if (
    existing &&
    !isPaperCurioEntry(existing) &&
    !overwriteAllowed &&
    (await pathExists(indexHtmlPath))
  ) {
    return skipped("exists-native")
  }

  const pdfPath = await pdfFilePath(item)
  checkReviewActive(options)
  if (!pdfPath) throw new ReviewTaskError("needs-pdf")
  const request: LocalReviewRequest = {
    schema_version: 1,
    feature: "review",
    pdf_path: pdfPath,
    output_dir: slugDir,
    overwrite: overwriteAllowed,
    ...(options.regenerate ? { regenerate: true } : {}),
    item: {
      key: meta.key,
      title: meta.title,
      creators: item.getCreatorsJSON(),
      date: meta.date,
      DOI: meta.doi,
      abstractNote: meta.abstract,
      url: meta.url,
      publicationTitle: meta.journal,
    },
  }
  const configuredProvider = getPrefStr("REVIEW_PROVIDER") || "anthropic"
  if (!["anthropic", "openai", "google"].includes(configuredProvider)) {
    throw new Error("Unsupported review provider")
  }
  request.provider = configuredProvider as LocalReviewRequest["provider"]
  request.credential_ref = `credential:${configuredProvider}`
  const plan = await localReviewViaBridge(target.root, request, false)
  checkReviewActive(options)
  if (!["ready", "exists"].includes(plan.status)) {
    throw reviewStatusError(plan.status)
  }
  const reservation = await corpusViaBridge(target.root, {
    op: "reserve",
    papers_dir: target.papersDir,
    identity: { key: meta.key, doi: meta.doi, title: meta.title },
  })
  if (
    typeof reservation.slug !== "string" ||
    typeof reservation.token !== "string"
  ) {
    throw new Error("Invalid corpus reservation")
  }
  slug = reservation.slug
  request.output_dir = joinPath(target.papersDir, slug)
  request.reservation_token = reservation.token
  indexHtmlPath = joinPath(request.output_dir, "index.html")
  let registered = false
  try {
    checkReviewActive(options)
    const finalPlan = await localReviewViaBridge(target.root, request, false)
    checkReviewActive(options)
    if (!["ready", "exists"].includes(finalPlan.status)) {
      throw reviewStatusError(finalPlan.status)
    }
    // Review Generation is the execution action. Keep both preflight checks,
    // but do not interrupt its nonmodal progress window with a second prompt.
    const result = await localReviewViaBridge(target.root, request, true)
    // Do not interrupt Python's atomic publication; stop at this safe boundary.
    checkReviewActive(options)
    if (!["completed", "exists"].includes(result.status) || !result.outputs) {
      const partial =
        result.partial?.review_ready && result.partial.review
          ? ` — ${getString("review-partial-saved")} ${result.partial.review}`
          : ""
      throw new Error(
        `${result.status}: ${result.error || getString("review-execution-failed")}${partial}`,
      )
    }
    let score: number | undefined
    let bookkeeping: "completed" | "failed" = "completed"
    try {
      const parsed = parseReviewMd(await readText(result.outputs.review))
      const topics = await getItemTopics(item, target.root)
      const finalTopics = topics.length ? topics : ["uncategorized"]
      const sidecar =
        result.status === "exists"
          ? JSON.parse(await readText(result.outputs.sidecar))
          : null
      const reviewDate = sidecar
        ? typeof sidecar.captured_at === "string"
          ? sidecar.captured_at.slice(0, 10)
          : ""
        : todayISO()
      score = parsed.scores.overall
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
        has_pdf: true,
        has_figures: (result.figures || 0) > 0,
        review_date: reviewDate,
        zotero_item_key: meta.key,
        tags: ["paper", "papercurio-generated", ...finalTopics],
        bibliography_status: "sidecar-only",
      }
      checkReviewActive(options)
      await corpusViaBridge(target.root, {
        op: "register",
        papers_dir: target.papersDir,
        slug,
        token: reservation.token,
        entry: { ...fresh, classifications: undefined },
        defer_views: true,
      })
      registered = true
      checkReviewActive(options)
      await ztoolkit.ExtraField.setExtraField(
        item,
        "papercurio",
        `${slug};${reviewDate}`,
      )
    } catch {
      checkReviewActive(options)
      bookkeeping = "failed"
      log("review files ready; local index/marker update failed", slug)
    }
    log("review registered", slug)
    return {
      status: bookkeeping === "failed" ? "partial" : "completed",
      recovery:
        bookkeeping === "failed"
          ? registered
            ? "retry-zotero-marker"
            : "retry-registration"
          : undefined,
      slug,
      title: meta.title,
      score,
      provider: `${result.provider} (${result.model})`,
      indexHtmlPath: result.outputs.html,
      source: target.source,
      hadPdf: true,
      figures: result.figures || 0,
      connections: 0,
      connectionProcessing: "not-started",
      bibliography: "sidecar-only",
      bookkeeping,
      overwritten: !!existing,
    }
  } finally {
    if (!registered) {
      try {
        await corpusViaBridge(target.root, {
          op: "cancel",
          papers_dir: target.papersDir,
          slug,
          token: reservation.token,
        })
      } catch {
        log("Owned corpus reservation could not be released", slug)
      }
    }
  }
}

const CONNECTION_STATUSES = [
  "needs-key",
  "needs-runtime",
  "insufficient-data",
  "budget-exceeded",
  "budget-unavailable",
]

/**
 * Related papers for each registered review, then one view pass for the
 * whole batch. Every paper of the batch is registered before any connection
 * is computed, so new papers can be each other's related papers. Needs the
 * exclusive corpus lease: no review may be running.
 */
export type FinishProgress =
  | { stage: "connections"; done: number; total: number }
  | { stage: "views"; total: number }

export async function finishReviews(
  root: string,
  papersDir: string,
  reviewed: ProcessResult[],
  onProgress?: (progress: FinishProgress) => void,
): Promise<ProcessResult[]> {
  const results = reviewed.map((r) => ({ ...r }))
  for (const [done, r] of results.entries()) {
    onProgress?.({ stage: "connections", done, total: results.length })
    try {
      const connected = await featureViaBridge(
        root,
        {
          schema_version: 1,
          feature: "related-papers",
          params: { slug: r.slug, defer_views: true },
        },
        true,
      )
      if (
        connected.status !== "completed" ||
        !Number.isInteger(connected.related_count) ||
        connected.related_count < 0
      ) {
        r.connectionError = CONNECTION_STATUSES.includes(connected.status)
          ? connected.status
          : "failed"
        throw new Error("Connection processing incomplete")
      }
      r.connections = connected.related_count
      r.connectionProcessing = "completed"
    } catch {
      r.connectionProcessing = "failed"
      r.connectionError ??= "failed"
      log("review preserved; related-paper processing requires retry", r.slug)
    }
  }
  let viewsOk = false
  onProgress?.({ stage: "views", total: results.length })
  try {
    await corpusViaBridge(root, {
      op: "refresh_views",
      papers_dir: papersDir,
      slugs: results.map((r) => r.slug),
    })
    viewsOk = true
  } catch {
    log(
      "reviews preserved; topic view refresh requires retry",
      results.map((r) => r.slug),
    )
  }
  for (const r of results) {
    if (r.recovery === "retry-zotero-marker") continue
    if (r.connectionProcessing !== "completed") {
      r.status = "partial"
      r.recovery = "retry-connections"
    } else if (!viewsOk) {
      r.status = "partial"
      r.recovery = "retry-views"
    }
  }
  return results
}
