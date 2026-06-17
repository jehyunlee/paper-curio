import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { getSelectedRegularItems } from "../apis/zotero/item"
import { processItem } from "../core/pipeline"
import { hasAnyProvider, configuredProviders } from "../llm"
import { menu as log } from "../utils/loggers"

const MENU_ID = `${config.addonRef}-itemmenu-review`
const SEP_ID = `${config.addonRef}-itemmenu-sep`

/** onMainWindowLoad에서 호출. 우클릭(item) 컨텍스트 메뉴에 단일 항목 등록. */
export function registerItemMenu(): void {
  ztoolkit.Menu.register("item", { tag: "menuseparator", id: SEP_ID })
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: MENU_ID,
    label: getString("itemmenu-review"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void onReviewCommand()
    },
  })
  log("item menu 등록 완료")
}

export function unregisterItemMenu(): void {
  try {
    ztoolkit.Menu.unregister(MENU_ID)
    ztoolkit.Menu.unregister(SEP_ID)
  } catch {
    /* ignore */
  }
}

function toast(headline: string) {
  return new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
}

async function onReviewCommand(): Promise<void> {
  const targets = getSelectedRegularItems()

  if (targets.length === 0) {
    toast(config.addonName)
      .createLine({
        type: "fail",
        text: getString("toast-no-items"),
        progress: 100,
      })
      .show()
      .startCloseTimer(4000)
    return
  }

  // provider 미설정 → 안내
  if (!hasAnyProvider()) {
    toast(config.addonName)
      .createLine({
        type: "fail",
        text: getString("toast-no-provider"),
        progress: 100,
      })
      .show()
      .startCloseTimer(6000)
    return
  }
  log("configured providers:", configuredProviders().join(", "))

  // ── 단일 ──
  if (targets.length === 1) {
    const item = targets[0]
    const title = item.getDisplayTitle()
    const pw = toast(config.addonName)
      .createLine({
        type: "default",
        text: getString("toast-running", { args: { title } }),
        progress: 20,
      })
      .show()
    try {
      const r = await processItem(item)
      if (r.skipped) {
        pw.changeLine({
          type: "default",
          text: getString("toast-skipped", { args: { title: r.title } }),
          progress: 100,
        })
      } else {
        pw.changeLine({
          type: "success",
          text: getString("toast-done-one", {
            args: { title: r.title, score: r.score, provider: r.provider },
          }),
          progress: 100,
        })
      }
    } catch (e: any) {
      pw.changeLine({
        type: "fail",
        text: getString("toast-fail", {
          args: { title, err: String(e?.message ?? e) },
        }),
        progress: 100,
      })
      log("단일 처리 실패", e)
    }
    pw.startCloseTimer(8000)
    return
  }

  // ── 다중 (순차) ──
  const N = targets.length
  let ok = 0,
    fail = 0,
    abort = 0,
    skip = 0
  let aborted = false

  const pw = new ztoolkit.ProgressWindow(
    `${config.addonName} — ${getString("toast-batch-header", { args: { n: N } })}`,
    { closeOnClick: false, closeTime: -1 },
  )
  for (const it of targets) {
    pw.createLine({
      type: "default",
      text: getString("toast-pending", { args: { title: it.getDisplayTitle() } }),
      progress: 0,
    })
  }
  pw.show()
  try {
    ;(pw as any).window?.addEventListener("unload", () => {
      aborted = true
    })
  } catch {
    /* ignore */
  }

  for (let i = 0; i < N; i++) {
    if (aborted) {
      abort = N - i
      break
    }
    const item = targets[i]
    const title = item.getDisplayTitle()
    pw.changeLine({
      idx: i,
      type: "default",
      text: getString("toast-running-batch", {
        args: { i: i + 1, n: N, title },
      }),
      progress: 50,
    })
    try {
      const r = await processItem(item)
      if (r.skipped) {
        skip++
        pw.changeLine({
          idx: i,
          type: "default",
          text: getString("toast-skipped", { args: { title: r.title } }),
          progress: 100,
        })
      } else {
        ok++
        pw.changeLine({
          idx: i,
          type: "success",
          text: getString("toast-done-line", {
            args: { title: r.title, score: r.score },
          }),
          progress: 100,
        })
      }
    } catch (e: any) {
      fail++
      pw.changeLine({
        idx: i,
        type: "fail",
        text: getString("toast-fail", {
          args: { title, err: String(e?.message ?? e) },
        }),
        progress: 100,
      })
      log(`다중 처리 실패 [${item.id}]`, e)
    }
  }

  pw.changeHeadline(
    getString("toast-batch-summary", { args: { ok, fail, skip, abort } }),
  )
  pw.startCloseTimer(10000)
}
