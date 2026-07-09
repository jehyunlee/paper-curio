import { marked } from "marked"
import katex from "katex"
import { DialogHelper, FilePickerHelper } from "zotero-plugin-toolkit"
import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { getSelectedRegularItems } from "../apis/zotero/item"
import { extractText } from "../extract/text"
import {
  availableChatModels,
  chatComplete,
  estimateCost,
  ChatMsg,
  ChatProvider,
} from "../llm/chat"
import { menu as log } from "../utils/loggers"
import { resolveOutputTarget } from "../core/pc-discovery"
import { findExisting } from "../core/papers-index"
import { loadRelatedForSlug, RelatedPaper } from "../core/related"
import { joinPath, writeText, makeDir } from "../utils/fs"
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

interface ChatPaper {
  meta: { title: string; authors: string; year: string; doi: string }
  text: string
  pages: number
  slug?: string
}

/** 논문 1편의 PDF 텍스트 + 메타 추출 (실패해도 메타로 진행). */
async function extractPaper(item: Zotero.Item): Promise<ChatPaper> {
  const meta = paperMeta(item)
  let extracted
  try {
    extracted = await extractText(item)
  } catch (e) {
    log("chat PDF 추출 실패", e)
    extracted = { text: "", source: "none" as const, pages: 0, hasPdf: false }
  }
  return { meta, text: extracted.text || "", pages: extracted.pages || 0 }
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
    if (role === "assistant") bubble.innerHTML = renderMarkdown(content)
    else bubble.textContent = content
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
      bubble.innerHTML = renderMarkdown(latest)
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
        bubble.innerHTML = renderMarkdown(md)
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
  function conversationMd(): string {
    return messages
      .map((m) => (m.role === "user" ? `### 🧑 User\n\n${m.content}` : `### 🤖 Assistant\n\n${m.content}`))
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
      conversationMd() +
      "\n"
    )
  }
  function buildHtml(): string {
    const turns = messages
      .map((m) => {
        const role = m.role === "user" ? "🧑 User" : "🤖 Assistant"
        const cls = m.role === "user" ? "user" : "ai"
        const body =
          m.role === "user" ? `<pre class="u">${escapeHtml(m.content)}</pre>` : renderMarkdown(m.content)
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
      const content = kind === "md" ? buildMarkdown() : buildHtml()
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
      const t = await resolveOutputTarget()
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

  const papers: ChatPaper[] = []
  for (let i = 0; i < targets.length; i++) {
    pw.changeLine({
      type: "default",
      text: getString("toast-chat-extracting", { args: { title: targets[i].getDisplayTitle() } }),
      progress: Math.round(((i + 1) / targets.length) * 100),
    })
    papers.push(await extractPaper(targets[i]))
  }

  try {
    const t = await resolveOutputTarget()
    for (let i = 0; i < targets.length; i++) {
      const entry = await findExisting(t.papersDir, {
        doi: String(targets[i].getField("DOI") || ""),
        zoteroKey: targets[i].key,
        title: targets[i].getDisplayTitle(),
      })
      if (entry?.slug) papers[i].slug = entry.slug
    }
  } catch (e) {
    log("slug 확인 실패", e)
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

  const target = await resolveOutputTarget()
  const papers: ChatPaper[] = []
  const slugByItem: (string | null)[] = []
  const selectedSlugs = new Set<string>()
  for (let i = 0; i < targets.length; i++) {
    const it = targets[i]
    pw.changeLine({
      type: "default",
      text: getString("toast-chat-extracting", { args: { title: it.getDisplayTitle() } }),
      progress: Math.round(((i + 1) / targets.length) * 70),
    })
    papers.push(await extractPaper(it))
    let slug: string | null = null
    try {
      const entry = await findExisting(target.papersDir, {
        doi: String(it.getField("DOI") || ""),
        zoteroKey: it.key,
        title: it.getDisplayTitle(),
      })
      slug = entry?.slug || null
    } catch (e) {
      log("findExisting 실패", e)
    }
    slugByItem.push(slug)
    if (slug) selectedSlugs.add(slug)
    if (slug) papers[i].slug = slug
  }

  // 이미 저장된 연결만 로드(생성하지 않음). 선택 논문 자기 자신 제외, slug 기준 dedupe.
  pw.changeLine({ type: "default", text: getString("toast-compare-gather-related"), progress: 82 })
  const relatedMap = new Map<string, RelatedPaper>()
  const perPaperCap = targets.length > 1 ? 6 : 12
  for (const slug of slugByItem) {
    if (!slug) continue
    try {
      const rels = await loadRelatedForSlug(target.papersDir, slug, { maxPapers: perPaperCap })
      for (const r of rels) {
        if (selectedSlugs.has(r.slug) || relatedMap.has(r.slug)) continue
        relatedMap.set(r.slug, r)
      }
    } catch (e) {
      log("related 로드 실패", e)
    }
  }
  const related = [...relatedMap.values()]
  pw.changeLine({
    type: "success",
    text: getString("toast-compare-related-found", { args: { n: related.length } }),
    progress: 100,
  })
  pw.startCloseTimer(3500)

  const seed =
    papers.length > 1
      ? COMPARE_SEED[getChatLang()].multi
      : COMPARE_SEED[getChatLang()].single
  const titleLabel = getString("compare-title", { args: { n: papers.length } })
  await openChat({ papers, related, seed, titleLabel })
}
