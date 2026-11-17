/**
 * Review queue status in the Zotero main window.
 *
 * Zotero closes progress popups on unrelated actions, so the queue's state
 * lives in a badge in the title bar instead: it shows while reviews run and
 * stays after the batch ends until clicked. Clicking opens the per-paper
 * status list; a popup closed by Zotero can be reopened the same way.
 */
import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { reviewErrorMessage } from "../utils/reviewError"
import {
  acknowledgeQueue,
  onQueueChange,
  queueBusy,
  queueFinishProgress,
  queueJobs,
  queueUnacknowledged,
  ReviewJob,
} from "../core/reviewQueue"

const BADGE_ID = `${config.addonRef}-review-status`
const HTML = "http://www.w3.org/1999/xhtml"

const windows = new Set<Window>()
let stopListening: (() => void) | undefined
let popup:
  | {
      window: ReturnType<typeof newPopup>
      lines: number
    }
  | undefined

function newPopup() {
  return new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: false,
    closeTime: -1,
    closeOtherProgressWindows: false,
  })
}

const SETTLED = ["done", "partial", "skipped", "failed", "cancelled"]

function counts() {
  const jobs = queueJobs()
  const by = (states: string[]) =>
    jobs.filter((job) => states.includes(job.state)).length
  return {
    total: jobs.length,
    settled: by(SETTLED),
    ok: by(["done"]),
    fail: by(["partial", "failed"]),
  }
}

/** One status line for the badge. */
export function badgeText(): string {
  const c = counts()
  const finish = queueFinishProgress()
  if (finish?.stage === "connections") {
    return getString("review-status-connecting", {
      args: { done: finish.done, total: finish.total },
    })
  }
  if (finish?.stage === "views") {
    return getString("review-status-views", { args: { total: finish.total } })
  }
  if (queueBusy()) {
    return getString("review-status-running", {
      args: { done: c.settled, total: c.total },
    })
  }
  const text = getString("review-status-finished", {
    args: { ok: c.ok, total: c.total },
  })
  return c.fail
    ? `${text} ${getString("review-status-failed", { args: { fail: c.fail } })}`
    : text
}

/** One paper's line in the status list and tooltip. */
export function jobLine(job: ReviewJob): {
  type: "default" | "success" | "fail"
  text: string
  progress: number
} {
  const title = job.title
  const r = job.result
  switch (job.state) {
    case "queued":
      return {
        type: "default",
        text: getString("review-job-queued", { args: { title } }),
        progress: 0,
      }
    case "reviewing":
      return {
        type: "default",
        text: getString("review-job-reviewing", { args: { title } }),
        progress: 30,
      }
    case "registered":
      return {
        type: "default",
        text: getString("review-job-registered", { args: { title } }),
        progress: 60,
      }
    case "connecting":
      return {
        type: "default",
        text: getString("review-job-connecting", { args: { title } }),
        progress: 80,
      }
    case "done":
      return {
        type: "success",
        text: getString("toast-done-line", {
          args: { title, score: r?.score ?? "n/a" },
        }),
        progress: 100,
      }
    case "skipped":
      return {
        type: "default",
        text: getString("toast-skipped", { args: { title } }),
        progress: 100,
      }
    case "cancelled":
      return {
        type: "default",
        text: getString("review-job-cancelled", { args: { title } }),
        progress: 100,
      }
    case "partial": {
      const key =
        r?.recovery === "retry-connections"
          ? "review-connections-failed"
          : r?.recovery === "retry-views"
            ? "review-views-failed"
            : "review-bookkeeping-failed"
      return {
        type: "default",
        text: `${title}: ${getString(key)} ${r?.indexHtmlPath ?? ""} (${r?.recovery ?? "failed"}${r?.connectionError ? `; ${r.connectionError}` : ""})`,
        progress: 100,
      }
    }
    default:
      return {
        type: "fail",
        text: getString("toast-fail", {
          args: { title, err: reviewErrorMessage(job.error) },
        }),
        progress: 100,
      }
  }
}

function render(): void {
  const visible = queueBusy() || queueUnacknowledged()
  const text = visible ? badgeText() : ""
  const tip = queueJobs()
    .map((job) => jobLine(job).text)
    .join("\n")
  for (const win of windows) {
    const badge = win.document.getElementById(BADGE_ID) as HTMLElement | null
    if (!badge) continue
    badge.hidden = !visible
    const busy = queueBusy()
    const c = counts()
    badge.style.background = busy
      ? "rgba(64,120,220,.14)"
      : c.fail
        ? "rgba(220,60,60,.16)"
        : "rgba(40,160,80,.16)"
    const spinner = badge.querySelector(".pc-spinner") as HTMLElement | null
    if (spinner) spinner.hidden = !busy
    const label = badge.querySelector(".pc-label")
    if (label) label.textContent = text
    badge.title = `${tip}\n\n${getString("review-status-tip")}`
  }
  refreshPopup()
}

function refreshPopup(): void {
  if (!popup) return
  const jobs = queueJobs()
  try {
    for (let i = 0; i < jobs.length; i++) {
      const line = jobLine(jobs[i])
      if (i < popup.lines) popup.window.changeLine({ idx: i, ...line })
      else {
        popup.window.createLine(line)
        popup.lines++
      }
    }
    popup.window.changeHeadline(`${config.addonName} — ${badgeText()}`)
  } catch {
    popup = undefined
  }
}

/**
 * Per-paper status list; reopens when Zotero has closed the previous one.
 * Only opening it from the badge counts as having seen a finished batch.
 */
export function showReviewStatus(acknowledge = false): void {
  const jobs = queueJobs()
  if (!jobs.length) return
  try {
    ;(popup?.window as any)?.close?.()
  } catch {
    /* already closed */
  }
  const win = newPopup()
  for (const job of jobs) win.createLine(jobLine(job))
  win.changeHeadline(`${config.addonName} — ${badgeText()}`)
  win.show()
  popup = { window: win, lines: jobs.length }
  try {
    ;(win as any).win?.addEventListener?.("unload", () => {
      if (popup?.window === win) popup = undefined
    })
  } catch {
    /* ignore */
  }
  if (acknowledge && !queueBusy()) acknowledgeQueue()
}

export function registerReviewStatus(win: Window): void {
  const doc = win.document
  if (doc.getElementById(BADGE_ID)) return
  const bar = doc.getElementById("zotero-title-bar")
  if (!bar) return
  const badge = doc.createElementNS(HTML, "div") as HTMLDivElement
  badge.id = BADGE_ID
  badge.hidden = true
  badge.setAttribute("role", "button")
  badge.style.cssText =
    "display:flex;align-items:center;gap:6px;padding:2px 10px;margin:0 6px;" +
    "border-radius:11px;font-size:12px;cursor:pointer;white-space:nowrap;" +
    "-moz-window-dragging:no-drag"
  const spinner = doc.createElementNS(HTML, "span") as HTMLSpanElement
  spinner.className = "pc-spinner"
  spinner.style.cssText =
    "width:10px;height:10px;border-radius:50%;border:2px solid currentColor;" +
    "border-right-color:transparent;display:inline-block"
  spinner.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 900, iterations: Infinity },
  )
  const label = doc.createElementNS(HTML, "span") as HTMLSpanElement
  label.className = "pc-label"
  badge.append(spinner, label)
  badge.addEventListener("click", () => showReviewStatus(true))
  const sync = doc.getElementById("zotero-tb-sync")
  if (sync?.parentNode === bar) bar.insertBefore(badge, sync)
  else bar.append(badge)
  windows.add(win)
  stopListening ??= onQueueChange(render)
  render()
}

export function unregisterReviewStatus(win?: Window): void {
  for (const target of win ? [win] : [...windows]) {
    target.document?.getElementById(BADGE_ID)?.remove()
    windows.delete(target)
  }
  if (!windows.size) {
    stopListening?.()
    stopListening = undefined
  }
}
