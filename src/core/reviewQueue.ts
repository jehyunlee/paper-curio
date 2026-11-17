/**
 * Desktop review queue.
 *
 * Reviews of different papers run concurrently (up to MAX_PARALLEL): each
 * holds only a shared corpus lease. Once no review is running, the papers
 * reviewed so far get their related papers and one topic-view refresh
 * together (`finishReviews`, exclusive lease). Papers queued meanwhile start
 * after that pass. A batch stays visible until the user acknowledges it, so
 * completion is never lost with a closed popup.
 */
import {
  reviewItem,
  finishReviews,
  isRegistered,
  FinishProgress,
  ProcessResult,
} from "./pipeline"
import { resolveOutputTarget } from "./pc-discovery"
import { pipeline as log } from "../utils/loggers"

export const MAX_PARALLEL = 3

export type JobState =
  | "queued"
  | "reviewing"
  | "registered"
  | "connecting"
  | "done"
  | "partial"
  | "skipped"
  | "failed"
  | "cancelled"

const ACTIVE: JobState[] = ["queued", "reviewing", "registered", "connecting"]

export interface ReviewJob {
  item: Zotero.Item
  key: string
  title: string
  state: JobState
  regenerate: boolean
  restart: boolean
  controller: AbortController
  result?: ProcessResult
  error?: unknown
  settled: Promise<ReviewJob>
  settle: (job: ReviewJob) => void
}

let jobs: ReviewJob[] = []
let running = 0
let finishing = false
let finishProgress: FinishProgress | undefined
let acknowledged = true
const listeners = new Set<() => void>()

export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function changed(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (e) {
      log("review queue listener failed", e)
    }
  }
}

export function isActive(job: ReviewJob): boolean {
  return ACTIVE.includes(job.state)
}

export function queueJobs(): readonly ReviewJob[] {
  return jobs
}

/** Related papers / view refresh pass in progress, if any. */
export function queueFinishProgress(): FinishProgress | undefined {
  return finishProgress
}

export function queueBusy(): boolean {
  return jobs.some(isActive)
}

/** A finished batch the user has not looked at yet. */
export function queueUnacknowledged(): boolean {
  return !acknowledged && jobs.length > 0 && !queueBusy()
}

export function acknowledgeQueue(): void {
  if (queueBusy()) return
  acknowledged = true
  changed()
}

/** Items already queued or in progress, by Zotero key. */
export function activeKeys(): Set<string> {
  return new Set(jobs.filter(isActive).map((job) => job.key))
}

/**
 * Add papers to the queue. Papers already queued or in progress are not
 * added twice. Resolves each job when it reaches a final state.
 */
export function enqueueReviews(
  items: Zotero.Item[],
  options: { regenerate?: boolean } = {},
): Promise<ReviewJob>[] {
  if (!queueBusy()) jobs = []
  acknowledged = false
  const active = activeKeys()
  const added: ReviewJob[] = []
  for (const item of items) {
    if (active.has(item.key)) continue
    active.add(item.key)
    let settle!: (job: ReviewJob) => void
    const settled = new Promise<ReviewJob>((resolve) => (settle = resolve))
    const job: ReviewJob = {
      item,
      key: item.key,
      title: item.getDisplayTitle(),
      state: "queued",
      regenerate: options.regenerate === true,
      restart: false,
      controller: new AbortController(),
      settled,
      settle,
    }
    jobs.push(job)
    added.push(job)
  }
  changed()
  pump()
  return added.map((job) => job.settled)
}

/**
 * Regenerate papers that are queued or still being reviewed. A running
 * review stops at its next safe boundary and starts over. Papers already
 * registered are past the point of restart and are returned unchanged.
 */
export function restartReviews(keys: Set<string>): ReviewJob[] {
  const restarted: ReviewJob[] = []
  for (const job of jobs) {
    if (!keys.has(job.key)) continue
    if (job.state === "queued") {
      job.regenerate = true
      restarted.push(job)
    } else if (job.state === "reviewing" && !job.restart) {
      job.restart = true
      job.controller.abort()
      restarted.push(job)
    }
  }
  changed()
  return restarted
}

function finish(job: ReviewJob, state: JobState): void {
  job.state = state
  job.settle(job)
}

function pump(): void {
  if (finishing) return
  while (running < MAX_PARALLEL) {
    const job = jobs.find((candidate) => candidate.state === "queued")
    if (!job) break
    void runReview(job)
  }
  if (
    running === 0 &&
    !jobs.some((job) => job.state === "queued") &&
    jobs.some((job) => job.state === "registered")
  ) {
    void runFinish()
  }
}

async function runReview(job: ReviewJob): Promise<void> {
  running++
  job.state = "reviewing"
  changed()
  try {
    const result = await reviewItem(job.item, {
      signal: job.controller.signal,
      regenerate: job.regenerate,
    })
    job.result = result
    if (result.status === "skipped") finish(job, "skipped")
    else if (!isRegistered(result)) finish(job, "partial")
    else job.state = "registered"
  } catch (e: any) {
    if (job.restart) {
      job.restart = false
      job.regenerate = true
      job.controller = new AbortController()
      job.state = "queued"
    } else if (e?.name === "AbortError") {
      finish(job, "cancelled")
    } else {
      job.error = e
      finish(job, "failed")
      log(`review failed [${job.key}]`, e)
    }
  } finally {
    running--
    changed()
    pump()
  }
}

async function runFinish(): Promise<void> {
  finishing = true
  const batch = jobs.filter((job) => job.state === "registered")
  for (const job of batch) job.state = "connecting"
  changed()
  try {
    const target = await resolveOutputTarget()
    const results = await finishReviews(
      target.root,
      target.papersDir,
      batch.map((job) => job.result as ProcessResult),
      (progress) => {
        finishProgress = progress
        changed()
      },
    )
    batch.forEach((job, i) => {
      job.result = results[i]
      finish(job, results[i].status === "completed" ? "done" : "partial")
    })
  } catch (e) {
    for (const job of batch) {
      job.error = e
      finish(job, "partial")
    }
    log("related papers / view refresh failed", e)
  } finally {
    finishing = false
    finishProgress = undefined
    changed()
    pump()
  }
}
