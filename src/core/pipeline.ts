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
} from "../extract/pybridge"
import { pdfFilePath } from "../extract/pdfjs"
import { getItemTopics } from "./categorize"
import { joinPath, readText, pathExists } from "../utils/fs"
import { getString } from "../utils/locale"
import { pipeline as log } from "../utils/loggers"

declare const Services: any

export interface ProcessResult {
  status: "completed" | "partial" | "skipped"
  recovery?: "retry-registration" | "retry-zotero-marker"
  slug: string
  title: string
  score?: number
  provider: string
  indexHtmlPath: string
  source: string
  hadPdf: boolean
  figures: number
  connections: number
  bibliography?: "sidecar-only"
  bookkeeping?: "completed" | "failed"
  skipped?: boolean
  skipReason?: "exists-native" | "exists-papercurio" | "cancelled"
  overwritten?: boolean
}

let reviewInProgress = false

/** Serialize desktop writes; the engine separately locks each output directory. */
export async function processItem(item: Zotero.Item): Promise<ProcessResult> {
  if (reviewInProgress) throw new Error(getString("review-already-running"))
  reviewInProgress = true
  try {
    return await processLocalItem(item)
  } finally {
    reviewInProgress = false
  }
}

/** The review action executes only the shared local-review capability. */
async function processLocalItem(item: Zotero.Item): Promise<ProcessResult> {
  const meta = getPaperMeta(item)
  const target = await resolveOutputTarget()
  const existing = await findExisting(target.papersDir, {
    doi: meta.doi,
    zoteroKey: meta.key,
    title: meta.title,
  })
  const overwriteAllowed =
    getPref("OVERWRITE_EXISTING") === true ||
    (!!existing && isPaperCurioEntry(existing))
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
  if (existing && !overwriteAllowed && (await pathExists(indexHtmlPath))) {
    return skipped("exists-native")
  }

  const pdfPath = await pdfFilePath(item)
  if (!pdfPath) throw new Error(getString("review-needs-pdf"))
  const request: LocalReviewRequest = {
    schema_version: 1,
    feature: "review",
    pdf_path: pdfPath,
    output_dir: slugDir,
    overwrite: overwriteAllowed,
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
  const cap = getPrefStr("REVIEW_MAX_COST_USD")
  if (cap) {
    const inputRate = getPrefStr("REVIEW_INPUT_RATE")
    const outputRate = getPrefStr("REVIEW_OUTPUT_RATE")
    request.budget = {
      max_cost_usd: Number(cap),
      max_output_tokens: 4000,
      ...(inputRate ? { input_per_million_usd: Number(inputRate) } : {}),
      ...(outputRate ? { output_per_million_usd: Number(outputRate) } : {}),
    }
  }
  const plan = await localReviewViaBridge(target.root, request, false)
  if (plan.status === "exists") return skipped("exists-native")
  if (plan.status !== "ready") {
    throw new Error(
      `${plan.status}: ${plan.error || getString("review-preflight-failed")}`,
    )
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
    const finalPlan = await localReviewViaBridge(target.root, request, false)
    if (!["ready", "exists"].includes(finalPlan.status)) {
      throw new Error(
        `${finalPlan.status}: ${finalPlan.error || getString("review-preflight-failed")}`,
      )
    }
    const confirmed = Services.prompt.confirm(
      Zotero.getMainWindow(),
      "Paper Curio — Review",
      getString("review-plan-confirm", { args: { title: meta.title } }) +
        "\n\nOutput: " +
        request.output_dir +
        "\n\n" +
        JSON.stringify(finalPlan, null, 2),
    )
    if (!confirmed) return skipped("cancelled")
    const result = await localReviewViaBridge(target.root, request, true)
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
      await corpusViaBridge(target.root, {
        op: "register",
        papers_dir: target.papersDir,
        slug,
        token: reservation.token,
        entry: { ...fresh, classifications: undefined },
      })
      registered = true
      await ztoolkit.ExtraField.setExtraField(
        item,
        "papercurio",
        `${slug};${reviewDate}`,
      )
    } catch {
      bookkeeping = "failed"
      log("review files ready; local index/marker update failed", slug)
    }
    log("review completed; bibliography integration pending", slug)
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
      bibliography: "sidecar-only",
      bookkeeping,
      overwritten: !!existing,
      skipped: result.status === "exists",
      skipReason: result.status === "exists" ? "exists-papercurio" : undefined,
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
