import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { getSelectedRegularItems } from "../apis/zotero/item"
import { processItem } from "../core/pipeline"
import { hasAnyProvider, configuredProviders } from "../llm"
import { menu as log } from "../utils/loggers"
import { resolveOutputTarget, tryResolveOutputTarget } from "../core/pc-discovery"
import { deployViaBridge, compareViaBridge } from "../extract/pybridge"
import { topicForCollection } from "../core/categorize"
import { findExisting } from "../core/papers-index"
import { joinPath, pathExists } from "../utils/fs"
import { openChatForSelection, openComparativeStudy } from "./chat"

const MENU_ID = `${config.addonRef}-itemmenu-review`
const SEP_ID = `${config.addonRef}-itemmenu-sep`
const COMPARE_ID = `${config.addonRef}-itemmenu-compare`
const OPEN_REVIEW_ID = `${config.addonRef}-itemmenu-open-review`
const CHAT_ID = `${config.addonRef}-itemmenu-chat`
const COMPARE_STUDY_ID = `${config.addonRef}-itemmenu-compare-study`
const DEPLOY_ID = `${config.addonRef}-collectionmenu-deploy`
const COMPARE_MAX = 6

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
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: OPEN_REVIEW_ID,
    label: getString("itemmenu-open-review"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void onOpenReviewCommand()
    },
  })
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: CHAT_ID,
    label: getString("itemmenu-chat"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void openChatForSelection()
    },
  })
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: COMPARE_STUDY_ID,
    label: getString("itemmenu-comparative-study"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void openComparativeStudy()
    },
  })
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: COMPARE_ID,
    label: getString("itemmenu-comparison"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void onCompareCommand()
    },
  })
  // 메뉴 hover 말풍선 — XUL은 menupopup 내부의 tooltiptext를 표시하지 않는다
  // (메뉴 위에서는 툴팁 리스너가 억제됨). Firefox 북마크 메뉴처럼 전용
  // <tooltip> 팝업을 하이라이트 이벤트에 맞춰 직접 연다.
  attachMenuTip(CHAT_ID, getString("itemmenu-chat-tip"))
  attachMenuTip(COMPARE_STUDY_ID, getString("itemmenu-comparative-study-tip"))
  log("item menu 등록 완료")
}

/** menuitem hover(DOMMenuItemActive) 시 전용 tooltip 팝업 표시. */
function attachMenuTip(id: string, tip: string): void {
  try {
    const doc = Zotero.getMainWindow()?.document as Document | undefined
    const el = doc?.getElementById(id) as any
    if (!doc || !el) return
    let tipEl = doc.getElementById("papercurio-menu-tip") as any
    if (!tipEl) {
      tipEl = (doc as any).createXULElement("tooltip")
      tipEl.id = "papercurio-menu-tip"
      doc.documentElement?.appendChild(tipEl)
    }
    const win: any = doc.defaultView
    let timer: any = null
    const hide = () => {
      if (timer) {
        win.clearTimeout(timer)
        timer = null
      }
      try {
        tipEl.hidePopup()
      } catch {
        /* ignore */
      }
    }
    el.addEventListener("DOMMenuItemActive", (ev: Event) => {
      if (ev.target !== el) return
      if (timer) win.clearTimeout(timer)
      timer = win.setTimeout(() => {
        try {
          tipEl.setAttribute("label", tip)
          tipEl.openPopup(el, "end_before", 6, 0, false, false)
        } catch {
          /* ignore */
        }
      }, 350)
    })
    el.addEventListener("DOMMenuItemInactive", hide)
    el.addEventListener("command", hide)
    el.parentElement?.addEventListener("popuphidden", hide)
  } catch (e) {
    log("menu tip attach 실패", e)
  }
}

export function unregisterItemMenu(): void {
  try {
    ztoolkit.Menu.unregister(MENU_ID)
    ztoolkit.Menu.unregister(OPEN_REVIEW_ID)
    ztoolkit.Menu.unregister(CHAT_ID)
    ztoolkit.Menu.unregister(COMPARE_STUDY_ID)
    ztoolkit.Menu.unregister(COMPARE_ID)
    ztoolkit.Menu.unregister(SEP_ID)
    Zotero.getMainWindow()?.document?.getElementById("papercurio-menu-tip")?.remove()
  } catch {
    /* ignore */
  }
}

/** 컬렉션 우클릭 메뉴: 이 컬렉션을 웹(Cloudflare)에 배포. */
export function registerCollectionMenu(): void {
  ztoolkit.Menu.register("collection", {
    tag: "menuitem",
    id: DEPLOY_ID,
    label: getString("collectionmenu-deploy"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void onDeployCommand()
    },
  })
  log("collection menu 등록 완료")
}

export function unregisterCollectionMenu(): void {
  try {
    ztoolkit.Menu.unregister(DEPLOY_ID)
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

/** 코퍼스 필요 기능 가드 — paper-curation(또는 fallback) 미설정 시 안내 토스트. */
async function requirePaperCuration(): Promise<boolean> {
  if (await tryResolveOutputTarget()) return true
  toast(config.addonName)
    .createLine({ type: "fail", text: getString("toast-need-pc"), progress: 100 })
    .show()
    .startCloseTimer(8000)
  return false
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
  if (!(await requirePaperCuration())) return

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

/** 선택 논문의 이미 생성된 review HTML(index.html)을 브라우저로 연다. 생성은 하지 않음. */
async function onOpenReviewCommand(): Promise<void> {
  const targets = getSelectedRegularItems()
  if (!(await requirePaperCuration())) return
  if (targets.length === 0) {
    toast(config.addonName)
      .createLine({ type: "fail", text: getString("toast-no-items"), progress: 100 })
      .show()
      .startCloseTimer(4000)
    return
  }

  const target = await resolveOutputTarget()
  let opened = 0
  let missing = 0
  for (const it of targets) {
    try {
      const entry = await findExisting(target.papersDir, {
        doi: String(it.getField("DOI") || ""),
        zoteroKey: it.key,
        title: it.getDisplayTitle(),
      })
      const htmlPath = entry?.slug
        ? joinPath(target.papersDir, entry.slug, "index.html")
        : null
      if (htmlPath && (await pathExists(htmlPath))) {
        ;(Zotero as any).launchFile(htmlPath)
        opened++
      } else {
        missing++
      }
    } catch (e) {
      missing++
      log("open review 실패", e)
    }
  }

  toast(config.addonName)
    .createLine({
      type: opened > 0 ? "success" : "fail",
      text:
        opened > 0
          ? getString("toast-open-review-opened", { args: { opened, missing } })
          : getString("toast-open-review-none"),
      progress: 100,
    })
    .show()
    .startCloseTimer(opened > 0 ? 4000 : 6000)
}
/** 2편 이상 선택 → (리뷰 없는 논문은 자동 생성) → 비교 HTML → 브라우저 오픈. */
async function onCompareCommand(): Promise<void> {
  const targets = getSelectedRegularItems()
  if (!(await requirePaperCuration())) return
  if (targets.length < 2 || targets.length > COMPARE_MAX) {
    toast(config.addonName)
      .createLine({
        type: "fail",
        text: getString(
          targets.length < 2 ? "toast-compare-need-two" : "toast-compare-too-many",
          { args: { max: COMPARE_MAX } },
        ),
        progress: 100,
      })
      .show()
      .startCloseTimer(5000)
    return
  }

  const target = await resolveOutputTarget()
  // 선택 순서가 P1, P2, ... 번호가 되므로 슬롯으로 순서를 보존한다.
  const slotSlugs: (string | null)[] = []
  const pending: { idx: number; item: Zotero.Item }[] = []
  for (const it of targets) {
    const entry = await findExisting(target.papersDir, {
      doi: String(it.getField("DOI") || ""),
      zoteroKey: it.key,
      title: it.getDisplayTitle(),
    })
    if (entry?.slug) {
      slotSlugs.push(entry.slug)
    } else {
      slotSlugs.push(null)
      pending.push({ idx: slotSlugs.length - 1, item: it })
    }
  }

  // 리뷰 자동 생성에는 LLM provider 가 필요하다 (Review 커맨드와 동일 가드).
  if (pending.length && !hasAnyProvider()) {
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

  const pw = toast(config.addonName)
    .createLine({
      type: "default",
      text: pending.length
        ? getString("toast-compare-prereview", { args: { n: pending.length } })
        : getString("toast-compare-running", { args: { n: targets.length } }),
      progress: 10,
    })
    .show()

  // 리뷰 없는 논문은 기존 리뷰 파이프라인으로 먼저 생성 (순차).
  for (let i = 0; i < pending.length; i++) {
    const { idx, item } = pending[i]
    const title = item.getDisplayTitle()
    pw.changeLine({
      type: "default",
      text: getString("toast-running-batch", {
        args: { i: i + 1, n: pending.length, title },
      }),
      progress: 10 + Math.round((40 * i) / pending.length),
    })
    try {
      const r = await processItem(item)
      slotSlugs[idx] = r.slug
    } catch (e: any) {
      pw.changeLine({
        type: "fail",
        text: getString("toast-compare-prereview-fail", {
          args: { title, err: String(e?.message ?? e) },
        }),
        progress: 100,
      })
      log("compare 사전 리뷰 실패", e)
      pw.startCloseTimer(10000)
      return
    }
  }

  const slugs = slotSlugs.filter((s): s is string => !!s)
  pw.changeLine({
    type: "default",
    text: getString("toast-compare-running", { args: { n: slugs.length } }),
    progress: 55,
  })
  try {
    const r = await compareViaBridge(slugs, target.root)
    if (r.ok && r.html) {
      pw.changeLine({
        type: "success",
        text: getString("toast-compare-done"),
        progress: 100,
      })
      ;(Zotero as any).launchFile(r.html)
    } else {
      pw.changeLine({
        type: "fail",
        text: getString("toast-compare-fail", {
          args: { err: String(r.reason ?? "") },
        }),
        progress: 100,
      })
    }
  } catch (e: any) {
    pw.changeLine({
      type: "fail",
      text: getString("toast-compare-fail", {
        args: { err: String(e?.message ?? e) },
      }),
      progress: 100,
    })
    log("onCompareCommand 예외", e)
  }
  pw.startCloseTimer(8000)
}

async function onDeployCommand(): Promise<void> {
  const pane =
    (Zotero as any).getActiveZoteroPane?.() ?? (globalThis as any).ZoteroPane
  const coll = pane?.getSelectedCollection?.()
  if (!(await requirePaperCuration())) return
  if (!coll) {
    toast(config.addonName)
      .createLine({
        type: "fail",
        text: getString("toast-deploy-no-collection"),
        progress: 100,
      })
      .show()
      .startCloseTimer(4000)
    return
  }
  const target = await resolveOutputTarget()
  const topic = await topicForCollection(coll.name, target.root)
  const pw = toast(config.addonName)
    .createLine({
      type: "default",
      text: getString("toast-deploy-running", { args: { topic } }),
      progress: 30,
    })
    .show()
  try {
    const r = await deployViaBridge(topic, target.root)
    if (r.ok) {
      pw.changeLine({
        type: "success",
        text: getString("toast-deploy-done", { args: { topic } }),
        progress: 100,
      })
    } else {
      const text =
        r.reason === "no_cf_credentials"
          ? getString("toast-deploy-no-cf")
          : getString("toast-deploy-fail", {
              args: { topic, err: String(r.reason ?? "") },
            })
      pw.changeLine({ type: "fail", text, progress: 100 })
      log("deploy 실패", r.reason, r.tail)
    }
  } catch (e: any) {
    pw.changeLine({
      type: "fail",
      text: getString("toast-deploy-fail", {
        args: { topic, err: String(e?.message ?? e) },
      }),
      progress: 100,
    })
    log("onDeployCommand 예외", e)
  }
  pw.startCloseTimer(12000)
}
