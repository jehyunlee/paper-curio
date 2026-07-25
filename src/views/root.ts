import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { getSelectedRegularItems } from "../apis/zotero/item"
import { processItem } from "../core/pipeline"
import { hasAnyProvider, configuredProviders } from "../llm"
import { menu as log } from "../utils/loggers"
import { resolveOutputTarget, tryResolveOutputTarget } from "../core/pc-discovery"
import {
  deployViaBridge,
  compareViaBridge,
  runFullViaBridge,
  registerCollectionViaBridge,
  citedbyViaBridge,
} from "../extract/pybridge"
import { topicForCollection, resolveCollectionTopic } from "../core/categorize"
import { findExisting } from "../core/papers-index"
import { joinPath, pathExists, readJson } from "../utils/fs"
import { registerCitingPapers, attachAvailablePdfs } from "../apis/zotero/register"
import type { CitingPaper } from "../apis/zotero/register"
import { openChatForSelection, openComparativeStudy } from "./chat"

declare const Services: any

const MENU_ID = `${config.addonRef}-itemmenu-review`
const SEP_ID = `${config.addonRef}-itemmenu-sep`
const COMPARE_ID = `${config.addonRef}-itemmenu-compare`
const OPEN_REVIEW_ID = `${config.addonRef}-itemmenu-open-review`
const CHAT_ID = `${config.addonRef}-itemmenu-chat`
const COMPARE_STUDY_ID = `${config.addonRef}-itemmenu-compare-study`
const CITEDBY_ID = `${config.addonRef}-itemmenu-citedby`
const DEPLOY_ID = `${config.addonRef}-collectionmenu-deploy`
const RUN_FULL_ID = `${config.addonRef}-collectionmenu-runfull`
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
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: CITEDBY_ID,
    label: getString("itemmenu-citedby"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void onCitedbyCommand()
    },
  })
  // 메뉴 hover 말풍선 — XUL은 menupopup 내부의 tooltiptext를 표시하지 않는다
  // (메뉴 위에서는 툴팁 리스너가 억제됨). Firefox 북마크 메뉴처럼 전용
  // <tooltip> 팝업을 하이라이트 이벤트에 맞춰 직접 연다.
  attachMenuTip(CHAT_ID, getString("itemmenu-chat-tip"))
  attachMenuTip(COMPARE_STUDY_ID, getString("itemmenu-comparative-study-tip"))
  attachMenuTip(CITEDBY_ID, getString("itemmenu-citedby-tip"))
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
      // 화면 중앙에 띄우므로 마우스가 항목을 벗어날 때까지 유지되게 한다.
      tipEl.setAttribute("noautohide", "true")
      // 안내 텍스트는 <description> 자식으로 렌더한다. label 속성은 단행 + OS
      // 기본 크기라 폰트/줄바꿈/여백을 못 키운다. description은 CSS가 먹는다.
      const descEl = (doc as any).createXULElement("description")
      descEl.id = "papercurio-menu-tip-desc"
      descEl.style.cssText =
        "font-size: 2em; line-height: 1.5; max-width: 560px; " +
        "padding: 14px 18px; white-space: normal; margin: 0;"
      tipEl.appendChild(descEl)
      doc.documentElement?.appendChild(tipEl)
    }
    const desc = doc.getElementById("papercurio-menu-tip-desc") as any
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
    // Zotero 창이 놓인 모니터의 정중앙으로 이동. 해상도·모니터 원점과 무관.
    // (availLeft/availTop이 없으면 0으로 보수 처리 → 주 모니터 기준.)
    const recenter = () => {
      try {
        const s: any = win.screen || {}
        const sx = Number(s.availLeft) || 0
        const sy = Number(s.availTop) || 0
        const sw = Number(s.availWidth) || 1200
        const sh = Number(s.availHeight) || 800
        const r = tipEl.getBoundingClientRect?.() || { width: 0, height: 0 }
        const w = r.width || 400
        const h = r.height || 160
        tipEl.moveTo(
          Math.round(sx + (sw - w) / 2),
          Math.round(sy + (sh - h) / 2),
        )
      } catch {
        /* ignore */
      }
    }
    el.addEventListener("DOMMenuItemActive", (ev: Event) => {
      if (ev.target !== el) return
      if (timer) win.clearTimeout(timer)
      timer = win.setTimeout(() => {
        try {
          if (desc) desc.textContent = tip
          else tipEl.setAttribute("label", tip)
          const s: any = win.screen || {}
          const sx = Number(s.availLeft) || 0
          const sy = Number(s.availTop) || 0
          const sw = Number(s.availWidth) || 1200
          const sh = Number(s.availHeight) || 800
          // 대략 중앙에 먼저 띄운 뒤(크기 미상), 실제 크기를 재서 정확히 재중앙.
          tipEl.openPopupAtScreen(
            Math.round(sx + sw / 2 - 280),
            Math.round(sy + sh / 2 - 90),
            false,
          )
          win.setTimeout(recenter, 0)
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
    ztoolkit.Menu.unregister(CITEDBY_ID)
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
  ztoolkit.Menu.register("collection", {
    tag: "menuitem",
    id: RUN_FULL_ID,
    label: getString("collectionmenu-runfull"),
    icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    commandListener: () => {
      void onRunFullCommand()
    },
  })
  log("collection menu 등록 완료")
}

export function unregisterCollectionMenu(): void {
  try {
    ztoolkit.Menu.unregister(DEPLOY_ID)
    ztoolkit.Menu.unregister(RUN_FULL_ID)
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

/**
 * 선택 논문의 DOI 로 인용논문을 분석한다 (citedby).
 *
 * paper-curation 의 "같이 보면 좋은 논문"은 SPECTER2 유사도·코퍼스 내부 축이라
 * *이 논문을 인용한 새 논문*을 구조적으로 못 찾는다. citedby 가 그 인용축·
 * 시간축 공백을 메운다.
 *
 * 흐름: DOI 자동 추출(수동 입력 불필요) → 주제 입력(선택) → 브리지 실행 →
 * 자기완결 HTML 리포트를 브라우저로 열기 → (선택) 인용논문을 Zotero 에 일괄 등록.
 */
async function onCitedbyCommand(): Promise<void> {
  const targets = getSelectedRegularItems()
  if (!(await requirePaperCuration())) return
  if (targets.length !== 1) {
    toast(config.addonName)
      .createLine({
        type: "fail",
        text: getString("toast-citedby-select-one"),
        progress: 100,
      })
      .show()
      .startCloseTimer(4000)
    return
  }

  const item = targets[0]
  const doi = String(item.getField("DOI") || "").trim()
  if (!doi) {
    // DOI 가 없으면 인용 조회 자체가 불가능하다 (모든 소스가 DOI 기준).
    toast(config.addonName)
      .createLine({
        type: "fail",
        text: getString("toast-citedby-no-doi", {
          args: { title: item.getDisplayTitle().slice(0, 50) },
        }),
        progress: 100,
      })
      .show()
      .startCloseTimer(6000)
    return
  }

  const topic = promptForCitedbyTopic()
  if (topic === null) return // 사용자 취소

  const target = await resolveOutputTarget()
  // 코퍼스에 이 논문의 리뷰가 이미 있으면 그 폴더 아래에 산출물을 모은다.
  let slug = ""
  try {
    const entry = await findExisting(target.papersDir, {
      doi,
      zoteroKey: item.key,
      title: item.getDisplayTitle(),
    })
    slug = entry?.slug ?? ""
  } catch {
    /* 슬러그를 못 찾아도 진행 — docs/citedby/ 로 떨어진다 */
  }

  const pw = toast(config.addonName)
    .createLine({
      type: "default",
      text: getString("toast-citedby-running", { args: { doi } }),
      progress: 20,
    })
    .show()

  const r = await citedbyViaBridge(doi, target.root, { topic, slug })

  if (!r.ok) {
    pw.changeLine({
      type: "fail",
      text: getString("toast-citedby-fail", {
        args: { err: String(r.reason ?? "").slice(0, 160) },
      }),
      progress: 100,
    })
    pw.startCloseTimer(8000)
    return
  }

  pw.changeLine({
    type: "success",
    text: getString("toast-citedby-done", {
      args: {
        matched: r.matched ?? 0,
        total: r.total ?? 0,
        sec: Math.round(r.elapsedSec ?? 0),
      },
    }),
    progress: 100,
  })
  pw.startCloseTimer(6000)

  if (r.report) {
    try {
      ;(Zotero as any).launchFile(r.report)
    } catch (e) {
      log("citedby 리포트 열기 실패", e)
    }
  }

  await maybeRegisterCitingPapers(r.papersJson ?? "")
}

/** 주제 입력 프롬프트. 취소면 null, 비우면 "" (필터 없이 전체). */
function promptForCitedbyTopic(): string | null {
  const input = { value: "" }
  const ok = Services.prompt.prompt(
    Zotero.getMainWindow(),
    getString("citedby-topic-title"),
    getString("citedby-topic-msg"),
    input,
    null,
    { value: false },
  )
  if (!ok) return null
  return String(input.value || "").trim()
}

/**
 * 분석된 인용논문을 Zotero 에 등록할지 묻고, 승낙하면 일괄 등록한다.
 *
 * 등록하면 기존 리뷰 파이프라인(`run_full --mode curate --source zotero`)이
 * 그대로 이어받는다 — citedby → Zotero → 리뷰 루프가 닫힌다.
 * DOI/arXiv/제목 기준 중복은 건너뛴다. **컬렉션은 지정하지 않는다** — 인용논문은
 * 검색 결과이지 내가 고른 논문이 아니라, 원논문의 컬렉션에 섞으면 그 컬렉션의
 * 의미가 오염된다. 라이브러리 루트(Unfiled)에 두고 분류는 사용자가 판단한다.
 */
async function maybeRegisterCitingPapers(papersJson: string): Promise<void> {
  if (!papersJson) return
  let papers: CitingPaper[] = []
  try {
    if (!(await pathExists(papersJson))) return
    papers = await readJson<CitingPaper[]>(papersJson, [])
  } catch (e) {
    log("citedby papers JSON 읽기 실패", e)
    return
  }
  if (!papers.length) return

  const confirmed = Services.prompt.confirm(
    Zotero.getMainWindow(),
    getString("citedby-register-title"),
    getString("citedby-register-msg", { args: { n: papers.length } }),
  )
  if (!confirmed) return


  const pw = toast(config.addonName)
    .createLine({
      type: "default",
      text: getString("toast-citedby-register-running", {
        args: { done: 0, total: papers.length },
      }),
      progress: 5,
    })
    .show()

  try {
    const res = await registerCitingPapers(papers, (done, total) => {
      if (done % 10 === 0 || done === total) {
        pw.changeLine({
          type: "default",
          text: getString("toast-citedby-register-running", {
            args: { done, total },
          }),
          progress: Math.min(99, Math.round((done / total) * 100)),
        })
      }
    })
    pw.changeLine({
      type: "success",
      text: getString("toast-citedby-register-done", {
        args: { added: res.added, skipped: res.skipped, failed: res.failed },
      }),
      progress: 100,
    })
    pw.startCloseTimer(6000)
    await maybeAttachPdfs(res.items)
    return
  } catch (e) {
    log("citedby 등록 예외", e)
    pw.changeLine({
      type: "fail",
      text: getString("toast-citedby-register-fail", {
        args: { err: String(e).slice(0, 160) },
      }),
      progress: 100,
    })
  }
  pw.startCloseTimer(8000)
}

/**
 * 새로 등록한 항목에 OA PDF 를 붙일지 묻고, 승낙하면 첨부한다.
 *
 * Zotero 의 "Find Available PDF"(`addAvailablePDF`)를 그대로 쓰므로 DOI →
 * URL → Unpaywall 순으로 해석하고, 사용자가 설정한 기관 프록시도 탄다.
 * 유료 논문은 PDF 가 없는 게 정상이라 실패로 세지 않는다.
 *
 * 발행사 서버를 순차로 두드리므로 편당 ~1초가 걸린다 — 그래서 등록과 분리해
 * 따로 물어본다.
 */
async function maybeAttachPdfs(items: Zotero.Item[]): Promise<void> {
  if (!items.length) return

  const confirmed = Services.prompt.confirm(
    Zotero.getMainWindow(),
    getString("citedby-pdf-title"),
    getString("citedby-pdf-msg", { args: { n: items.length } }),
  )
  if (!confirmed) return

  const pw = toast(config.addonName)
    .createLine({
      type: "default",
      text: getString("toast-citedby-pdf-running", {
        args: { done: 0, total: items.length, attached: 0 },
      }),
      progress: 3,
    })
    .show()

  try {
    const res = await attachAvailablePdfs(items, (done, total, attached) => {
      pw.changeLine({
        type: "default",
        text: getString("toast-citedby-pdf-running", {
          args: { done, total, attached },
        }),
        progress: Math.min(99, Math.round((done / total) * 100)),
      })
    })
    pw.changeLine({
      type: res.attached > 0 ? "success" : "default",
      text: getString("toast-citedby-pdf-done", {
        args: {
          attached: res.attached,
          missing: res.missing,
          failed: res.failed,
        },
      }),
      progress: 100,
    })
  } catch (e) {
    log("citedby PDF 첨부 예외", e)
    pw.changeLine({
      type: "fail",
      text: getString("toast-citedby-pdf-fail", {
        args: { err: String(e).slice(0, 160) },
      }),
      progress: 100,
    })
  }
  pw.startCloseTimer(10000)
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

/** 컬렉션 우클릭 → run_full (curate/zotero, 주제분류·타임라인 포함, 배포 제외). */
async function onRunFullCommand(): Promise<void> {
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
  const target = await resolveOutputTarget()
  const { topic: resolvedTopic, mapped } = await resolveCollectionTopic(
    coll.name,
    target.root,
  )
  let topic = resolvedTopic
  if (!mapped) {
    // 신규(미등록) 컬렉션 — alias(topic)를 물어보고 config.json 에 등록 후 진행.
    const alias = promptForAlias(coll.name, resolvedTopic)
    if (!alias) return
    topic = alias
    const reg = await registerCollectionViaBridge(alias, coll.name, target.root)
    if (!reg.ok) {
      toast(config.addonName)
        .createLine({
          type: "fail",
          text: getString("toast-runfull-register-fail", {
            args: { name: coll.name, err: String(reg.reason ?? "") },
          }),
          progress: 100,
        })
        .show()
        .startCloseTimer(6000)
      return
    }
  }
  const pw = toast(config.addonName)
    .createLine({
      type: "default",
      text: getString("toast-runfull-env", { args: { topic } }),
      progress: 10,
    })
    .show()
  try {
    const r = await runFullViaBridge(topic, target.root, (stage) => {
      pw.changeLine({
        type: "default",
        text:
          stage === "run"
            ? getString("toast-runfull-running", { args: { topic } })
            : getString("toast-runfull-env", { args: { topic } }),
        progress: stage === "run" ? 50 : 20,
      })
    })
    if (r.ok) {
      pw.changeLine({
        type: "success",
        text: getString("toast-runfull-done", { args: { topic } }),
        progress: 100,
      })
    } else {
      const err = String(r.reason || r.tail || "")
      const text =
        r.reason === "no_python"
          ? getString("toast-runfull-no-python")
          : getString("toast-runfull-fail", {
              args: { topic, err },
            })
      pw.changeLine({ type: "fail", text, progress: 100 })
      log("run_full 실패", r.reason, r.tail)
    }
  } catch (e: any) {
    pw.changeLine({
      type: "fail",
      text: getString("toast-runfull-fail", {
        args: { topic, err: String(e?.message ?? e) },
      }),
      progress: 100,
    })
    log("onRunFullCommand 예외", e)
  }
  pw.startCloseTimer(15000)
}

/** 미등록 컬렉션의 topic alias 를 사용자에게 묻는다. 취소/빈값이면 null. */
function promptForAlias(collName: string, suggested: string): string | null {
  const input = { value: suggested }
  const ok = Services.prompt.prompt(
    Zotero.getMainWindow(),
    getString("runfull-alias-title"),
    getString("runfull-alias-msg", { args: { name: collName } }),
    input,
    null,
    { value: false },
  )
  if (!ok) return null
  const v = String(input.value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
  return v || null
}
