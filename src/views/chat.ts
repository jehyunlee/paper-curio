import { marked } from "marked"
import katex from "katex"
import { DialogHelper, FilePickerHelper } from "zotero-plugin-toolkit"
import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { getSelectedRegularItems } from "../apis/zotero/item"
import { extractTextCached } from "../extract/text"
import {
  availableChatModels,
  chatComplete,
  estimateCost,
  ChatMsg,
  ChatProvider,
} from "../llm/chat"
import { menu as log } from "../utils/loggers"
import { tryResolveOutputTarget } from "../core/pc-discovery"
import { findExisting } from "../core/papers-index"
import { loadRelatedForSlug, RelatedPaper } from "../core/related"
import {
  joinPath,
  writeText,
  makeDir,
  pathExists,
  readText,
  listDir,
  readBinaryBase64,
} from "../utils/fs"
import { getPrefStr, setPref } from "../utils/prefs"

const MAX_CTX_CHARS = 120_000

const CHAT_CSS = `
.pc-root { display:flex; flex-direction:column; gap:10px; width:100%; box-sizing:border-box; padding:8px 10px 12px;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Noto Sans KR",Segoe UI,sans-serif; color:#111827; }
.pc-header { display:flex; align-items:center; gap:10px; }
.pc-select { flex:0 1 auto; max-width:62%; font-size:13px; padding:6px 9px; border:1px solid #e5e7eb;
  border-radius:10px; background:#fff; color:#111827; }
.pc-cost { margin-left:auto; font-size:11.5px; color:#98a2b3; white-space:nowrap; cursor:help; }
.pc-log { height:calc(100vh - 210px); min-height:160px; overflow-y:auto; border:1px solid #eef0f2;
  border-radius:16px; padding:14px; background:#fbfbfc; display:flex; flex-direction:column; gap:10px; }
.pc-msg { max-width:88%; padding:9px 13px; border-radius:16px; font-size:13.5px; line-height:1.62; overflow-wrap:anywhere; }
.pc-msg.user { align-self:flex-end; background:#2563eb; color:#fff; border-bottom-right-radius:6px; white-space:pre-wrap; }
.pc-msg.ai { align-self:flex-start; background:#fff; color:#111827; border:1px solid #eef0f2; border-bottom-left-radius:6px; }
.pc-msg.err { align-self:flex-start; background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; white-space:pre-wrap; }
.pc-msg > :first-child { margin-top:0; } .pc-msg > :last-child { margin-bottom:0; }
.pc-msg p { margin:0 0 8px; }
.pc-msg pre { background:#0f172a; color:#e2e8f0; padding:10px 12px; border-radius:12px; overflow-x:auto; font-size:12px; line-height:1.5; }
.pc-msg code { background:rgba(148,163,184,.20); padding:1px 5px; border-radius:6px; font-size:12.5px; }
.pc-msg pre code { background:none; padding:0; }
.pc-msg ul, .pc-msg ol { margin:4px 0 8px; padding-left:20px; } .pc-msg li { margin:2px 0; }
.pc-msg h1,.pc-msg h2,.pc-msg h3,.pc-msg h4 { margin:8px 0 6px; font-size:15px; line-height:1.35; }
.pc-msg a { color:#2563eb; text-decoration:underline; }
.pc-msg blockquote { margin:4px 0; padding:2px 12px; border-left:3px solid #e5e7eb; color:#475467; }
.pc-msg table { border-collapse:collapse; margin:6px 0; font-size:12.5px; }
.pc-msg th,.pc-msg td { border:1px solid #e5e7eb; padding:4px 8px; }
.pc-msg .katex-display { margin:6px 0; overflow-x:auto; overflow-y:hidden; }
.pc-composer { display:flex; gap:8px; align-items:flex-end; }
.pc-input { flex:1 1 auto; width:100%; box-sizing:border-box; resize:none; min-height:64px; max-height:120px;
  padding:11px 14px; border:1px solid #e5e7eb; border-radius:16px; font-family:inherit; font-size:13.5px; line-height:1.5; outline:none; }
.pc-input:focus { border-color:#93c5fd; box-shadow:0 0 0 3px rgba(37,99,235,.12); }
.pc-actions { display:flex; gap:8px; align-items:flex-end; }
.pc-btn { width:46px; height:46px; flex:0 0 auto; border:none; border-radius:14px; font-size:17px; font-weight:600;
  cursor:pointer; display:grid; place-items:center; transition:background .15s ease, color .15s ease; font-family:inherit; }
.pc-btn-primary { background:#2563eb; color:#fff; }
.pc-btn-primary:hover { background:#1d4ed8; }
.pc-btn-primary:disabled { background:#bfdbfe; cursor:default; }
.pc-btn-ghost { background:#f3f4f6; color:#667085; }
.pc-btn-ghost:hover { background:#e5e7eb; color:#111827; }
.pc-export { display:flex; gap:5px; align-items:center; margin-left:8px; }
.pc-exp { font-size:11px; padding:4px 8px; border-radius:8px; border:1px solid #e5e7eb; background:#f9fafb; color:#667085; cursor:pointer; font-family:inherit; }
.pc-exp:hover { background:#eef0f2; color:#111827; }
.pc-msg img.pc-fig { max-width:100%; border:1px solid #eef0f2; border-radius:10px; margin:6px 0; cursor:zoom-in; display:block; }
`

const EXPORT_HTML_CSS = `
body { max-width: 860px; margin: 24px auto; padding: 0 18px; font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR",Segoe UI,sans-serif; color:#111827; line-height:1.65; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
.meta { color:#98a2b3; font-size:12px; margin:0 0 6px; }
.papers { color:#475467; font-size:13px; background:#f8fafc; border:1px solid #eef0f2; border-radius:10px; padding:10px 14px; margin:0 0 18px; }
.turn { margin: 14px 0; }
.turn .role { font-weight:600; font-size:12.5px; color:#667085; margin-bottom:4px; }
.turn.user pre.u { white-space:pre-wrap; background:#eff6ff; border:1px solid #dbeafe; color:#1e3a8a; border-radius:10px; padding:10px 13px; font-family:inherit; font-size:14px; }
.turn.ai { background:#fff; border:1px solid #eef0f2; border-radius:10px; padding:6px 14px; }
pre { background:#0f172a; color:#e2e8f0; padding:10px 12px; border-radius:10px; overflow-x:auto; }
code { background:rgba(148,163,184,.20); padding:1px 5px; border-radius:6px; }
pre code { background:none; padding:0; }
table { border-collapse:collapse; margin:8px 0; } th,td { border:1px solid #e5e7eb; padding:5px 9px; }
blockquote { border-left:3px solid #e5e7eb; margin:6px 0; padding:2px 12px; color:#475467; }
img { max-width:100%; }
`

type ChatLang = "ko" | "en"

/** 채팅 답변 언어 (pref CHAT_LANG, 기본 ko). 창의 EN/KO 버튼과 환경설정이 공유. */
function getChatLang(): ChatLang {
  return getPrefStr("CHAT_LANG") === "en" ? "en" : "ko"
}
function setChatLang(l: ChatLang): void {
  setPref("CHAT_LANG", l)
}
/** system 뒤에 덧붙일 출력 언어 지시. */
function langDirective(l: ChatLang): string {
  return l === "en"
    ? "\n\n[Output language] Answer in English. Keep technical terms, model/dataset names, and equations in their original form."
    : "\n\n[출력 언어] 반드시 한국어로 답하세요. 단, 기술 용어·모델명·데이터셋·수식 등은 원문(영문) 그대로 유지합니다."
}

/** Comparative Chat 시드 질문 (답변 언어에 맞춰 선택). */
const COMPARE_SEED: Record<ChatLang, { single: string; multi: string }> = {
  ko: {
    single:
      "이 논문의 독창성, 한계, 학문적 의의를 분석해줘. 이미 연결된 관련 연구(있는 경우)와 비교해 무엇이 진짜 새롭고 무엇이 부족한지, 이 연구가 관련 문헌들 사이에서 어떤 위치에 있는지 구체적 근거와 함께 짚어줘.",
    multi:
      "선택한 논문들을 서로 비교하고(공통점·차이점, 그리고 상호 관계: 누가 무엇을 발전/대체/보완하는지), 각 논문에 이미 연결된 관련 연구(있는 경우)와 함께 놓고 독창성, 한계, 학문적 의의를 분석해줘. 핵심 비교는 표로 정리해줘.",
  },
  en: {
    single:
      "Analyze this paper's originality, limitations, and scholarly significance. Compare it against the already-connected related papers (if any): what is genuinely new, what falls short, and where this work sits within the related literature. Be specific and state the basis.",
    multi:
      "Compare the selected papers with each other (commonalities, differences, and how they relate — who extends, replaces, or complements whom), then situate them against each paper's already-connected related papers to analyze originality, limitations, and scholarly significance. Summarize the core comparison as a table.",
  },
}
function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  )
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
    })
  } catch {
    return escapeHtml((display ? "$$" : "$") + tex + (display ? "$$" : "$"))
  }
}

/** LLM 마크다운 → 안전한 HTML. 수식($$…$$, \[…\], \(…\), $…$)은 마스킹 후 KaTeX 렌더. */
function renderMarkdown(md: string): string {
  const store: { t: string; d: boolean }[] = []
  const mask = (t: string, d: boolean) => {
    store.push({ t, d })
    return `@@PCMATH${store.length - 1}@@`
  }
  const masked = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, t) => mask(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t) => mask(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t) => mask(t, false))
    .replace(/\$(\S[^\n$]*?)\$/g, (_m, t) => mask(t, false))

  let html = ""
  try {
    html = String((marked as any).parse(masked, { breaks: true, headerIds: false, mangle: false }))
  } catch {
    html = escapeHtml(md)
  }
  html = html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?(<\/\s*\1\s*>|$)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|data):[^"']*\2/gi, '$1="#"')
  return html.replace(/@@PCMATH(\d+)@@/g, (_m, i) => {
    const e = store[Number(i)]
    return e ? renderMath(e.t, e.d) : ""
  })
}

function toastLine(type: "default" | "success" | "fail", text: string, ms = 4000) {
  new ztoolkit.ProgressWindow(config.addonName, { closeOnClick: true, closeTime: -1 })
    .createLine({ type, text, progress: 100 })
    .show()
    .startCloseTimer(ms)
}

function paperMeta(item: Zotero.Item): { title: string; authors: string; year: string; doi: string } {
  const title = item.getDisplayTitle()
  let authors = ""
  try {
    const names = (item.getCreators() || [])
      .map((c: any) => c.lastName || c.name || "")
      .filter(Boolean)
    authors = names.slice(0, 3).join(", ") + (names.length > 3 ? " et al." : "")
  } catch {
    /* ignore */
  }
  const year = (String(item.getField("date") || "").match(/\d{4}/) || [""])[0]
  const doi = String(item.getField("DOI") || "")
  return { title, authors, year, doi }
}

interface ChatFig {
  /** 마커 키 — "fig:3" 또는 다중 논문 "fig:P2:3" */
  key: string
  num: number
  caption: string
  /** file:// URL (채팅 내 표시용) */
  url: string
  path: string
  /** 볼트 상대 경로 (papers/slug/figures/figN.webp — Obsidian embed용) */
  rel: string
}

interface ChatPaper {
  meta: { title: string; authors: string; year: string; doi: string }
  text: string
  pages: number
  slug?: string
  figs?: ChatFig[]
}

/** 본문 텍스트에서 Figure N 캡션 추출 (없으면 "Figure N"). */
function captionFor(text: string, num: number): string {
  const m = text.match(
    new RegExp(
      `(?:figure|fig\\.?|그림)\\s*${num}\\s*[.:\\-]?\\s*([^\\n]{5,140})`,
      "i",
    ),
  )
  return m ? `Figure ${num}: ${m[1].trim()}` : `Figure ${num}`
}

function pathToFileUrl(p: string): string {
  try {
    const u = (Zotero as any).File?.pathToFileURI?.(p)
    if (u) return u
  } catch {
    /* fallthrough */
  }
  return "file://" + encodeURI(p.replace(/\\/g, "/"))
}

/**
 * 논문 1편의 채팅 컨텍스트 구성.
 * enhanced(코퍼스 감지): text.md 우선(이미 추출돼 있어 빠르고, ODL이면 구조가
 * 더 좋음) + figures 목록(인라인 그림 마커용).
 * light: 프로파일 캐시된 pdf.js 추출 (재오픈 즉시).
 */
async function buildChatPaper(
  item: Zotero.Item,
  target: { papersDir: string; root: string } | null,
  idx: number,
  multi: boolean,
): Promise<ChatPaper> {
  const paper: ChatPaper = { meta: paperMeta(item), text: "", pages: 0 }

  if (target) {
    try {
      const entry = await findExisting(target.papersDir, {
        doi: String(item.getField("DOI") || ""),
        zoteroKey: item.key,
        title: item.getDisplayTitle(),
      })
      if (entry?.slug) paper.slug = entry.slug
    } catch (e) {
      log("findExisting 실패", e)
    }
  }

  // 1) 코퍼스 text.md 우선
  if (target && paper.slug) {
    try {
      const tp = joinPath(target.papersDir, paper.slug, "text.md")
      if (await pathExists(tp)) {
        const t = (await readText(tp)).trim()
        if (t.length > 500) paper.text = t
      }
    } catch (e) {
      log("corpus text.md 읽기 실패", e)
    }
  }
  // 2) 없으면 캐시된 PDF 추출
  if (!paper.text) {
    try {
      const ex = await extractTextCached(item)
      paper.text = ex.text
      paper.pages = ex.pages
    } catch (e) {
      log("chat PDF 추출 실패", e)
    }
  }

  // 3) 코퍼스 figures → 인라인 그림 마커 후보
  if (target && paper.slug) {
    try {
      const fdir = joinPath(target.papersDir, paper.slug, "figures")
      const files = (await listDir(fdir))
        .filter((f) => /^fig\d+\.(webp|png|jpe?g)$/i.test(f))
        .sort(
          (a, b) =>
            parseInt((a.match(/\d+/) as RegExpMatchArray)[0], 10) -
            parseInt((b.match(/\d+/) as RegExpMatchArray)[0], 10),
        )
      const figs: ChatFig[] = []
      for (const f of files) {
        const num = parseInt((f.match(/\d+/) as RegExpMatchArray)[0], 10)
        const p = joinPath(fdir, f)
        figs.push({
          key: multi ? `fig:P${idx + 1}:${num}` : `fig:${num}`,
          num,
          caption: captionFor(paper.text, num),
          url: pathToFileUrl(p),
          path: p,
          rel: `papers/${paper.slug}/figures/${f}`,
        })
      }
      if (figs.length) paper.figs = figs
    } catch (e) {
      log("corpus figures 읽기 실패", e)
    }
  }
  return paper
}

/** 논문(들) + 이미 연결된 관련 연구 → system 프롬프트. */
function buildSystemText(
  papers: ChatPaper[],
  related: RelatedPaper[],
  perPaperChars: number,
): { systemText: string; anyText: boolean } {
  const multi = papers.length > 1
  let anyText = false
  const parts: string[] = [
    "당신은 학술 논문 분석 도우미입니다. 아래에 제공된 논문(들)과 이미 연결된 관련 연구를 근거로 " +
      "정확하고 구체적으로 답하세요. 본문에 없는 내용은 추측임을 명시하고, 가능하면 근거(섹션/그림/수식)를 " +
      "밝히세요. 답변은 읽기 좋은 마크다운으로, 수식은 LaTeX($…$ 또는 $$…$$)로 표기합니다.",
  ]
  papers.forEach((p, i) => {
    const tag = multi ? `P${i + 1}` : ""
    const metaBlock = [
      `제목: ${p.meta.title}`,
      p.meta.authors ? `저자: ${p.meta.authors}` : "",
      p.meta.year ? `연도: ${p.meta.year}` : "",
      p.meta.doi ? `DOI: ${p.meta.doi}` : "",
    ]
      .filter(Boolean)
      .join("\n")
    const head = multi
      ? `=== 분석 대상 논문 ${tag} (${i + 1}/${papers.length}) ===`
      : "=== 논문 메타 ==="
    parts.push(`${head}\n${metaBlock}`)
    if (p.text) {
      anyText = true
      const cut = p.text.length > perPaperChars
      const body = cut ? p.text.slice(0, perPaperChars) : p.text
      parts.push(
        `--- ${multi ? tag + " " : ""}전문${cut ? " (분량 초과로 일부 생략)" : ""} ---\n${body}`,
      )
    } else {
      parts.push(
        `--- ${multi ? tag + " " : ""}전문 ---\n(PDF 텍스트를 추출하지 못했습니다.)`,
      )
    }
  })
  if (related.length) {
    const rel = related
      .map((r, i) => {
        const relLabel = r.relation ? ` · 관계: ${r.relation}` : ""
        const why = r.reason ? `\n연결 이유: ${r.reason}` : ""
        const sum = r.summary ? `\n요약: ${r.summary}` : ""
        return `[R${i + 1}] ${r.title}${relLabel}${why}${sum}`
      })
      .join("\n\n")
    parts.push(
      "=== 이미 연결된 관련 연구 (connected papers) ===\n" +
        "아래는 위 논문(들)에 이미 연결돼 있는 문헌들의 요약이다. 비교 근거로 사용하라.\n\n" +
        rel,
    )
  }
  const allFigs = papers.flatMap((p) => p.figs || [])
  if (allFigs.length) {
    parts.push(
      "=== 표시 가능한 그림 (마커) ===\n" +
        "아래 그림 마커를 답변 본문의 적절한 위치에 **단독 줄**로 출력하면 그 자리에 실제 그림이 " +
        "사용자에게 표시된다. 질문과 직접 관련된 그림만 사용하고 남용하지 말 것. 마커 형식을 그대로 지킬 것.\n\n" +
        allFigs.map((f) => `[${f.key}] ${f.caption}`).join("\n"),
    )
  }
  return { systemText: parts.join("\n\n"), anyText }
}

interface OpenChatOptions {
  papers: ChatPaper[]
  related: RelatedPaper[]
  seed?: string
  titleLabel: string
  greeting?: string
}

/** 공용 채팅 다이얼로그. seed가 있으면 열자마자 그 질문을 스트리밍으로 실행한다. */
async function openChat(opts: OpenChatOptions): Promise<void> {
  const models = availableChatModels()
  const primaryBudget = opts.related.length ? 78_000 : MAX_CTX_CHARS
  const perPaper = Math.max(
    8_000,
    Math.floor(primaryBudget / Math.max(1, opts.papers.length)),
  )
  const { systemText, anyText } = buildSystemText(
    opts.papers,
    opts.related,
    perPaper,
  )

  const messages: ChatMsg[] = []
  let busy = false
  let totalIn = 0
  let totalOut = 0
  let totalCost = 0
  let currentLang: ChatLang = getChatLang()

  // ── 인라인 그림 (enhanced: 코퍼스 figures 마커 치환) ──
  const figMap = new Map<string, ChatFig>()
  for (const p of opts.papers) for (const f of p.figs || []) figMap.set(f.key, f)

  function resolveFigs(md: string): string {
    if (!figMap.size) return md
    return md.replace(/\[(fig:(?:P\d+:)?\d+)\]/g, (m, key) => {
      const f = figMap.get(key)
      if (!f) return m
      return `<img class="pc-fig" src="${f.url}" data-fp="${escapeHtml(f.path)}" alt="${escapeHtml(f.caption)}" title="${escapeHtml(f.caption)}">`
    })
  }

  function hookFigs(el: HTMLElement) {
    el.querySelectorAll("img.pc-fig").forEach((img) => {
      img.addEventListener("load", () => pinnedScroll(), { once: true })
      img.addEventListener("click", () => {
        const fp = img.getAttribute("data-fp")
        if (fp) (Zotero as any).launchFile(fp)
      })
    })
  }

  const dialog = new DialogHelper(1, 1)

  const optionChildren = models.map((m) => ({
    tag: "option",
    namespace: "html",
    properties: { value: `${m.provider}|${m.model}`, textContent: m.label },
  }))

  dialog.addCell(0, 0, {
    tag: "div",
    namespace: "html",
    classList: ["pc-root"],
    children: [
      { tag: "style", namespace: "html", properties: { textContent: CHAT_CSS } },
      {
        tag: "div",
        namespace: "html",
        classList: ["pc-header"],
        children: [
          { tag: "select", namespace: "html", id: "pc-chat-model", classList: ["pc-select"], children: optionChildren },
          { tag: "button", namespace: "html", id: "pc-chat-lang", classList: ["pc-exp"], attributes: { title: getString("chat-lang-title") }, properties: { textContent: "KO" } },
          {
            tag: "span",
            namespace: "html",
            id: "pc-chat-cost",
            classList: ["pc-cost"],
            attributes: { title: getString("chat-cost-title") },
            properties: {
              textContent: getString("chat-cost", { args: { cost: "0.0000", in: "0", out: "0" } }),
            },
          },
          {
            tag: "div",
            namespace: "html",
            classList: ["pc-export"],
            children: [
              { tag: "button", namespace: "html", id: "pc-exp-md", classList: ["pc-exp"], attributes: { title: getString("chat-export-md") }, properties: { textContent: "MD" } },
              { tag: "button", namespace: "html", id: "pc-exp-html", classList: ["pc-exp"], attributes: { title: getString("chat-export-html") }, properties: { textContent: "HTML" } },
              { tag: "button", namespace: "html", id: "pc-exp-obs", classList: ["pc-exp"], attributes: { title: getString("chat-export-obsidian") }, properties: { textContent: "OB" } },
            ],
          },
        ],
      },
      { tag: "div", namespace: "html", id: "pc-chat-log", classList: ["pc-log"] },
      {
        tag: "div",
        namespace: "html",
        classList: ["pc-composer"],
        children: [
          {
            tag: "textarea",
            namespace: "html",
            id: "pc-chat-input",
            classList: ["pc-input"],
            attributes: { rows: "3", placeholder: getString("chat-input-placeholder") },
          },
          {
            tag: "div",
            namespace: "html",
            classList: ["pc-actions"],
            children: [
              {
                tag: "button",
                namespace: "html",
                id: "pc-send",
                classList: ["pc-btn", "pc-btn-primary"],
                attributes: { title: getString("chat-send") },
                properties: { textContent: "➤" },
              },
              {
                tag: "button",
                namespace: "html",
                id: "pc-close",
                classList: ["pc-btn", "pc-btn-ghost"],
                attributes: { title: getString("chat-close") },
                properties: { textContent: "✕" },
              },
            ],
          },
        ],
      },
    ],
  })

  function doc(): Document {
    return dialog.window.document
  }

  let stickToBottom = true

  /** stickToBottom이 true일 때만 맨 아래로. 사용자가 위로 올리면 자동 스크롤 정지. */
  function pinnedScroll() {
    const logEl = doc().getElementById("pc-chat-log") as HTMLElement | null
    if (logEl && stickToBottom) logEl.scrollTop = logEl.scrollHeight
  }
  function forceScrollBottom() {
    const logEl = doc().getElementById("pc-chat-log") as HTMLElement | null
    if (logEl) {
      stickToBottom = true
      logEl.scrollTop = logEl.scrollHeight
    }
  }
  function updateCost() {
    const el = doc().getElementById("pc-chat-cost")
    if (el)
      el.textContent = getString("chat-cost", {
        args: {
          cost: totalCost.toFixed(4),
          in: totalIn.toLocaleString(),
          out: totalOut.toLocaleString(),
        },
      })
  }

  function setBusy(on: boolean) {
    busy = on
    const btn = doc().getElementById("pc-send") as HTMLButtonElement | null
    if (btn) {
      btn.disabled = on
      btn.textContent = on ? "…" : "➤"
    }
  }

  function appendBubble(role: "user" | "assistant" | "error", content: string) {
    const logEl = doc().getElementById("pc-chat-log") as HTMLElement | null
    if (!logEl) return
    const cls = role === "user" ? "user" : role === "error" ? "err" : "ai"
    const bubble = dialog.createElement(doc(), "div", {
      namespace: "html",
      classList: ["pc-msg", cls],
    }) as HTMLElement
    if (role === "assistant") {
      bubble.innerHTML = renderMarkdown(resolveFigs(content))
      hookFigs(bubble)
    } else bubble.textContent = content
    logEl.appendChild(bubble)
    pinnedScroll()
  }

  function appendAssistantStreaming() {
    const logEl = doc().getElementById("pc-chat-log") as HTMLElement | null
    const bubble = dialog.createElement(doc(), "div", {
      namespace: "html",
      classList: ["pc-msg", "ai"],
    }) as HTMLElement
    if (logEl) logEl.appendChild(bubble)
    pinnedScroll()
    const win: any = dialog.window
    let latest = ""
    let timer: any = null
    const flush = () => {
      timer = null
      // 스트리밍 중 (거의) 실시간 마크다운/수식 렌더. 미완성 구문($…, ```)은
      // 다음 조각이 오면 자동 보정된다.
      bubble.innerHTML = renderMarkdown(resolveFigs(latest))
      hookFigs(bubble)
      pinnedScroll()
    }
    return {
      update(acc: string) {
        latest = acc
        if (timer == null) timer = win.setTimeout(flush, 80) // ~80ms throttle
      },
      finalize(md: string) {
        if (timer != null) {
          win.clearTimeout(timer)
          timer = null
        }
        latest = md
        bubble.innerHTML = renderMarkdown(resolveFigs(md))
        hookFigs(bubble)
        pinnedScroll()
      },
      remove() {
        if (timer != null) win.clearTimeout(timer)
        bubble.remove()
      },
    }
  }

  /** 질문 1턴 실행 (스트리밍). 사용자 말풍선 + 스트리밍 답변 + 비용 갱신. */
  async function runTurn(question: string): Promise<void> {
    if (busy) return
    const sel = doc().getElementById("pc-chat-model") as HTMLSelectElement | null
    if (!sel) return
    const [provider, model] = sel.value.split("|") as [ChatProvider, string]

    appendBubble("user", question)
    forceScrollBottom()
    messages.push({ role: "user", content: question })
    setBusy(true)
    const streamBubble = appendAssistantStreaming()
    let acc = ""
    try {
      const res = await chatComplete(provider, model, systemText + langDirective(currentLang), messages, (delta) => {
        acc += delta
        streamBubble.update(acc)
      })
      const answer = res.text || acc || getString("chat-empty-reply")
      messages.push({ role: "assistant", content: answer })
      streamBubble.finalize(answer)
      const u = res.usage
      totalIn += u.input + (u.cacheWrite || 0) + (u.cacheRead || 0)
      totalOut += u.output
      totalCost += estimateCost(model, u.input, u.output, u.cacheWrite || 0, u.cacheRead || 0)
      updateCost()
    } catch (e: any) {
      if (acc) streamBubble.finalize(acc)
      else streamBubble.remove()
      appendBubble("error", String(e?.message ?? e))
      log("chat 호출 실패", e)
    } finally {
      setBusy(false)
      ;(doc().getElementById("pc-chat-input") as HTMLTextAreaElement | null)?.focus()
    }
  }

  async function onSend(): Promise<void> {
    if (busy) return
    const input = doc().getElementById("pc-chat-input") as HTMLTextAreaElement | null
    if (!input) return
    const question = (input.value || "").trim()
    if (!question) return
    input.value = ""
    await runTurn(question)
  }

  // ── 내보내기 (.md / .html / Obsidian) ──────────────────────────────
  function nowStamp(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  function exportTitle(): string {
    return opts.papers.length === 1 ? opts.papers[0].meta.title : `${opts.papers.length} papers`
  }
  function safeBaseName(): string {
    const base =
      (opts.papers[0]?.meta.title || "chat")
        .replace(/[^\w가-힣 -]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 60) || "chat"
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    return `PaperCurio-${base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  }
  function papersMdList(wiki: boolean): string {
    return opts.papers
      .map((p, i) => {
        const tag = opts.papers.length > 1 ? `[P${i + 1}] ` : ""
        if (wiki && p.slug) return `- ${tag}[[papers/${p.slug}/review]] — ${p.meta.title}`
        const bits = [p.meta.authors, p.meta.year].filter(Boolean).join(", ")
        const doi = p.meta.doi ? ` · DOI: ${p.meta.doi}` : ""
        return `- ${tag}${p.meta.title}${bits ? ` — ${bits}` : ""}${doi}`
      })
      .join("\n")
  }
  function figsForExport(md: string, mode: "md" | "obsidian"): string {
    if (!figMap.size) return md
    return md.replace(/\[(fig:(?:P\d+:)?\d+)\]/g, (m, key) => {
      const f = figMap.get(key)
      if (!f) return m
      return mode === "obsidian" ? `![[${f.rel}]]` : `![${f.caption}](${f.url})`
    })
  }
  function conversationMd(mode: "md" | "obsidian" = "md"): string {
    return messages
      .map((m) =>
        m.role === "user"
          ? `### 🧑 User\n\n${m.content}`
          : `### 🤖 Assistant\n\n${figsForExport(m.content, mode)}`,
      )
      .join("\n\n")
  }
  function buildMarkdown(): string {
    const relBlock = opts.related.length
      ? "\n\n**Connected related papers**\n" +
        opts.related.map((r) => `- ${r.relation ? r.relation + ": " : ""}${r.title}`).join("\n")
      : ""
    return (
      `# Paper Curio Chat — ${exportTitle()}\n\n*${nowStamp()}*\n\n` +
      `**Papers**\n${papersMdList(false)}${relBlock}\n\n---\n\n` +
      conversationMd() +
      "\n"
    )
  }
  function buildObsidianMd(): string {
    const links = opts.papers
      .filter((p) => p.slug)
      .map((p) => `  - "[[papers/${p.slug}/review]]"`)
      .join("\n")
    const fm =
      "---\n" +
      `title: "Paper Curio Chat — ${exportTitle().replace(/"/g, "'")}"\n` +
      `date: ${new Date().toISOString()}\n` +
      "type: paper-curio-chat\n" +
      "tags:\n  - paper-curio\n  - chat\n" +
      (links ? `papers:\n${links}\n` : "") +
      "---\n\n"
    const relBlock = opts.related.length
      ? "\n\n## Connected related papers\n" +
        opts.related
          .map((r) => `- [[papers/${r.slug}/review]] — ${r.relation ? r.relation + ": " : ""}${r.reason || r.title}`)
          .join("\n")
      : ""
    return (
      fm +
      `# Paper Curio Chat — ${exportTitle()}\n\n## Papers\n${papersMdList(true)}${relBlock}\n\n## Conversation\n\n` +
      conversationMd("obsidian") +
      "\n"
    )
  }
  async function buildHtml(): Promise<string> {
    // 그림 → data URI 임베드 (독립 실행 HTML)
    const dataUri = new Map<string, string>()
    for (const f of figMap.values()) {
      const b64 = await readBinaryBase64(f.path)
      if (!b64) continue
      const mime = /\.png$/i.test(f.path)
        ? "image/png"
        : /\.jpe?g$/i.test(f.path)
          ? "image/jpeg"
          : "image/webp"
      dataUri.set(f.url, `data:${mime};base64,${b64}`)
    }
    const turns = messages
      .map((m) => {
        const role = m.role === "user" ? "🧑 User" : "🤖 Assistant"
        const cls = m.role === "user" ? "user" : "ai"
        let body =
          m.role === "user" ? `<pre class="u">${escapeHtml(m.content)}</pre>` : renderMarkdown(resolveFigs(m.content))
        for (const [u, dURI] of dataUri) body = body.split(u).join(dURI)
        return `<div class="turn ${cls}"><div class="role">${role}</div>${body}</div>`
      })
      .join("\n")
    const papersHtml = escapeHtml(papersMdList(false)).replace(/\n/g, "<br>")
    return (
      '<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      `<title>${escapeHtml("Paper Curio Chat — " + exportTitle())}</title>\n` +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">\n' +
      `<style>${EXPORT_HTML_CSS}</style></head><body>\n` +
      `<h1>Paper Curio Chat — ${escapeHtml(exportTitle())}</h1>\n` +
      `<p class="meta">${escapeHtml(nowStamp())}</p>\n` +
      `<div class="papers">${papersHtml}</div>\n` +
      `<div class="conv">\n${turns}\n</div>\n</body></html>\n`
    )
  }
  async function exportFile(kind: "md" | "html"): Promise<void> {
    if (!messages.length) {
      toastLine("fail", getString("chat-export-empty"))
      return
    }
    try {
      const filters: [string, string][] =
        kind === "md" ? [["Markdown (*.md)", "*.md"]] : [["HTML (*.html)", "*.html"]]
      const picked = await new FilePickerHelper(
        getString("chat-export-save"),
        "save",
        filters,
        `${safeBaseName()}.${kind}`,
      ).open()
      if (!picked) return
      const content = kind === "md" ? buildMarkdown() : await buildHtml()
      await writeText(String(picked), content)
      toastLine("success", getString("chat-export-done", { args: { path: String(picked) } }))
    } catch (e: any) {
      toastLine("fail", getString("chat-export-fail", { args: { err: String(e?.message ?? e) } }))
      log("chat export 실패", e)
    }
  }
  async function exportObsidian(): Promise<void> {
    if (!messages.length) {
      toastLine("fail", getString("chat-export-empty"))
      return
    }
    try {
      const t = await tryResolveOutputTarget()
      if (!t) {
        toastLine("fail", getString("chat-export-need-pc"), 6000)
        return
      }
      const dir = joinPath(t.root, "docs", "PaperCurio Chats")
      await makeDir(dir)
      const path = joinPath(dir, `${safeBaseName()}.md`)
      await writeText(path, buildObsidianMd())
      toastLine("success", getString("chat-export-obsidian-done", { args: { path } }))
      try {
        ;(Zotero as any).launchURL?.(`obsidian://open?path=${encodeURIComponent(path)}`)
      } catch {
        /* Obsidian 미설치/미등록 볼트 — 파일은 저장됨 */
      }
    } catch (e: any) {
      toastLine("fail", getString("chat-export-fail", { args: { err: String(e?.message ?? e) } }))
      log("obsidian export 실패", e)
    }
  }

  dialog.setDialogData({
    loadCallback: () => {
      try {
        const d = doc()
        const link = dialog.createElement(d, "link", {
          namespace: "html",
          attributes: {
            rel: "stylesheet",
            href: `chrome://${config.addonRef}/content/katex/katex.min.css`,
          },
        })
        d.documentElement.appendChild(link)
        ;(d.getElementById("pc-send") as HTMLButtonElement | null)?.addEventListener("click", () => void onSend())
        ;(d.getElementById("pc-close") as HTMLButtonElement | null)?.addEventListener("click", () => dialog.window.close())
        const input = d.getElementById("pc-chat-input") as HTMLTextAreaElement | null
        input?.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault()
            void onSend()
          }
        })
        ;(d.getElementById("pc-exp-md") as HTMLButtonElement | null)?.addEventListener("click", () => void exportFile("md"))
        ;(d.getElementById("pc-exp-html") as HTMLButtonElement | null)?.addEventListener("click", () => void exportFile("html"))
        ;(d.getElementById("pc-exp-obs") as HTMLButtonElement | null)?.addEventListener("click", () => void exportObsidian())
        const _log = d.getElementById("pc-chat-log") as HTMLElement | null
        _log?.addEventListener("scroll", () => {
          if (!_log) return
          // 맨 아래 근처(24px 이내)면 자동 스크롤 유지, 위로 올리면 정지.
          stickToBottom =
            _log.scrollHeight - _log.scrollTop - _log.clientHeight < 24
        })
        const langBtn = d.getElementById("pc-chat-lang") as HTMLButtonElement | null
        if (langBtn) {
          langBtn.textContent = currentLang.toUpperCase()
          langBtn.addEventListener("click", () => {
            currentLang = currentLang === "ko" ? "en" : "ko"
            setChatLang(currentLang)
            langBtn.textContent = currentLang.toUpperCase()
          })
        }
        if (opts.greeting) appendBubble("assistant", opts.greeting)
        if (!anyText) appendBubble("error", getString("chat-no-pdf-note"))
        if (opts.seed) void runTurn(opts.seed)
        else input?.focus()
      } catch (e) {
        log("chat loadCallback 실패", e)
      }
    },
  })

  const mw: any = Zotero.getMainWindow()
  const availH = Number(mw?.screen?.availHeight) || 900
  const availW = Number(mw?.screen?.availWidth) || 1200
  dialog.open(opts.titleLabel, {
    width: Math.min(1000, Math.max(700, Math.round(availW * 0.55))),
    height: Math.max(360, Math.round(availH / 2)),
    centerscreen: true,
    resizable: true,
  })
}

/** 우클릭 → 선택 논문(들)을 컨텍스트로 멀티턴 AI 대화창을 연다. */
export async function openChatForSelection(): Promise<void> {
  const targets = getSelectedRegularItems()
  if (targets.length === 0) {
    toastLine("fail", getString("toast-no-items"))
    return
  }
  if (availableChatModels().length === 0) {
    toastLine("fail", getString("toast-no-provider"), 6000)
    return
  }

  const pw = new ztoolkit.ProgressWindow(config.addonName, { closeOnClick: true, closeTime: -1 })
    .createLine({ type: "default", text: getString("toast-chat-extracting", { args: { title: targets[0].getDisplayTitle() } }), progress: 10 })
    .show()

  const target = await tryResolveOutputTarget()
  const papers: ChatPaper[] = []
  for (let i = 0; i < targets.length; i++) {
    pw.changeLine({
      type: "default",
      text: getString("toast-chat-extracting", { args: { title: targets[i].getDisplayTitle() } }),
      progress: Math.round(((i + 1) / targets.length) * 100),
    })
    papers.push(await buildChatPaper(targets[i], target, i, targets.length > 1))
  }
  const totalChars = papers.reduce((s, p) => s + p.text.length, 0)
  pw.changeLine({
    type: totalChars ? "success" : "default",
    text: totalChars
      ? papers.length === 1
        ? getString("toast-chat-ready", { args: { chars: totalChars, pages: papers[0].pages } })
        : getString("toast-chat-ready-multi", { args: { n: papers.length, chars: totalChars } })
      : getString("toast-chat-no-pdf"),
    progress: 100,
  })
  pw.startCloseTimer(3000)

  const titleLabel =
    papers.length === 1
      ? getString("chat-title", { args: { title: papers[0].meta.title } })
      : getString("chat-title-multi", { args: { n: papers.length } })
  const greeting =
    papers.length === 1
      ? getString("chat-greeting", { args: { title: papers[0].meta.title } })
      : getString("chat-greeting-multi", { args: { n: papers.length } })
  await openChat({ papers, related: [], titleLabel, greeting })
}

/** 우클릭 → 선택 논문(들) + 이미 연결된 관련 연구로 비교 분석을 AI Chat으로 연다. */
export async function openComparativeStudy(): Promise<void> {
  const targets = getSelectedRegularItems()
  if (targets.length === 0) {
    toastLine("fail", getString("toast-no-items"))
    return
  }
  if (availableChatModels().length === 0) {
    toastLine("fail", getString("toast-no-provider"), 6000)
    return
  }

  const pw = new ztoolkit.ProgressWindow(config.addonName, { closeOnClick: true, closeTime: -1 })
    .createLine({ type: "default", text: getString("toast-chat-extracting", { args: { title: targets[0].getDisplayTitle() } }), progress: 5 })
    .show()

  const target = await tryResolveOutputTarget()
  const papers: ChatPaper[] = []
  const selectedSlugs = new Set<string>()
  for (let i = 0; i < targets.length; i++) {
    const it = targets[i]
    pw.changeLine({
      type: "default",
      text: getString("toast-chat-extracting", { args: { title: it.getDisplayTitle() } }),
      progress: Math.round(((i + 1) / targets.length) * 70),
    })
    const paper = await buildChatPaper(it, target, i, targets.length > 1)
    papers.push(paper)
    if (paper.slug) selectedSlugs.add(paper.slug)
  }

  // 이미 저장된 연결만 로드(생성하지 않음). 선택 논문 자기 자신 제외, slug 기준 dedupe.
  const relatedMap = new Map<string, RelatedPaper>()
  if (target) {
    pw.changeLine({ type: "default", text: getString("toast-compare-gather-related"), progress: 82 })
    const perPaperCap = targets.length > 1 ? 6 : 12
    for (const p of papers) {
      if (!p.slug) continue
      try {
        const rels = await loadRelatedForSlug(target.papersDir, p.slug, { maxPapers: perPaperCap })
        for (const r of rels) {
          if (selectedSlugs.has(r.slug) || relatedMap.has(r.slug)) continue
          relatedMap.set(r.slug, r)
        }
      } catch (e) {
        log("related 로드 실패", e)
      }
    }
  }
  const related = [...relatedMap.values()]
  pw.changeLine({
    type: "success",
    text: target
      ? getString("toast-compare-related-found", { args: { n: related.length } })
      : getString("toast-compare-light"),
    progress: 100,
  })
  pw.startCloseTimer(target ? 3500 : 6000)

  const seed =
    papers.length > 1
      ? COMPARE_SEED[getChatLang()].multi
      : COMPARE_SEED[getChatLang()].single
  const titleLabel = getString("compare-title", { args: { n: papers.length } })
  await openChat({ papers, related, seed, titleLabel })
}
