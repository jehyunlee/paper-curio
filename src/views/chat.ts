import { marked } from "marked"
import katex from "katex"
import { DialogHelper } from "zotero-plugin-toolkit"
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
`

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

/** 우클릭 → 선택 논문 PDF를 컨텍스트로 멀티턴 AI 대화창을 연다. */
export async function openChatForSelection(): Promise<void> {
  const targets = getSelectedRegularItems()
  if (targets.length === 0) {
    toastLine("fail", getString("toast-no-items"))
    return
  }
  const models = availableChatModels()
  if (models.length === 0) {
    toastLine("fail", getString("toast-no-provider"), 6000)
    return
  }

  const item = targets[0]
  const meta = paperMeta(item)

  const pw = new ztoolkit.ProgressWindow(config.addonName, { closeOnClick: true, closeTime: -1 })
    .createLine({
      type: "default",
      text: getString("toast-chat-extracting", { args: { title: meta.title } }),
      progress: 30,
    })
    .show()

  let extracted
  try {
    extracted = await extractText(item)
  } catch (e) {
    log("chat PDF 추출 실패", e)
    extracted = { text: "", source: "none" as const, pages: 0, hasPdf: false }
  }
  const rawText = extracted.text || ""
  const truncated = rawText.length > MAX_CTX_CHARS
  const text = truncated ? rawText.slice(0, MAX_CTX_CHARS) : rawText

  pw.changeLine({
    type: rawText ? "success" : "default",
    text: rawText
      ? getString("toast-chat-ready", { args: { chars: text.length, pages: extracted.pages || 0 } })
      : getString("toast-chat-no-pdf"),
    progress: 100,
  })
  pw.startCloseTimer(3000)

  const metaBlock = [
    `제목: ${meta.title}`,
    meta.authors ? `저자: ${meta.authors}` : "",
    meta.year ? `연도: ${meta.year}` : "",
    meta.doi ? `DOI: ${meta.doi}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  const systemText =
    "당신은 학술 논문 분석 도우미입니다. 아래 논문을 근거로 사용자 질문에 정확하고 구체적으로 답하세요. " +
    "본문에 없는 내용은 추측임을 명시하고, 가능하면 어느 부분(섹션/그림/수식)에 근거했는지 밝히세요. " +
    "답변은 읽기 좋게 마크다운으로 작성하고, 수식은 LaTeX($…$ 또는 $$…$$)로 표기하세요. " +
    "사용자가 쓴 언어(한국어면 한국어)로 답합니다.\n\n" +
    `=== 논문 메타 ===\n${metaBlock}\n\n` +
    (text
      ? `=== 논문 전문${truncated ? " (분량 초과로 일부 생략) " : ""} ===\n${text}`
      : "=== 논문 전문 ===\n(PDF 텍스트를 추출하지 못했습니다. 사용자가 제공하는 정보로 답하세요.)")

  const messages: ChatMsg[] = []
  let busy = false
  let totalIn = 0
  let totalOut = 0
  let totalCost = 0

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
    logEl.scrollTop = logEl.scrollHeight
  }

  /**
   * 스트리밍 답변용 빈 assistant 말풍선. 조각이 도착할 때마다 raw 텍스트로 live
   * 갱신하고(빠름), 완료 시 마크다운/수식으로 최종 렌더한다.
   */
  function appendAssistantStreaming() {
    const logEl = doc().getElementById("pc-chat-log") as HTMLElement | null
    const bubble = dialog.createElement(doc(), "div", {
      namespace: "html",
      classList: ["pc-msg", "ai"],
    }) as HTMLElement
    bubble.style.whiteSpace = "pre-wrap"
    if (logEl) {
      logEl.appendChild(bubble)
      logEl.scrollTop = logEl.scrollHeight
    }
    const scroll = () => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight
    }
    return {
      update(acc: string) {
        bubble.textContent = acc
        scroll()
      },
      finalize(md: string) {
        bubble.style.whiteSpace = ""
        bubble.innerHTML = renderMarkdown(md)
        scroll()
      },
      remove() {
        bubble.remove()
      },
    }
  }

  async function onSend(): Promise<void> {
    if (busy) return
    const sel = doc().getElementById("pc-chat-model") as HTMLSelectElement | null
    const input = doc().getElementById("pc-chat-input") as HTMLTextAreaElement | null
    if (!sel || !input) return
    const question = (input.value || "").trim()
    if (!question) return
    const [provider, model] = sel.value.split("|") as [ChatProvider, string]

    input.value = ""
    appendBubble("user", question)
    messages.push({ role: "user", content: question })
    setBusy(true)
    const streamBubble = appendAssistantStreaming()
    let acc = ""
    try {
      const res = await chatComplete(provider, model, systemText, messages, (delta) => {
        acc += delta
        streamBubble.update(acc)
      })
      const answer = res.text || acc || getString("chat-empty-reply")
      messages.push({ role: "assistant", content: answer })
      streamBubble.finalize(answer)
      const u = res.usage
      // 표시용 input은 캐시 토큰까지 합산(실제 처리량), 비용은 캐시 할인 반영.
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
      input.focus()
    }
  }

  dialog.setDialogData({
    loadCallback: () => {
      try {
        const d = doc()
        // KaTeX 글리프 스타일 (chrome 번들)
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
        appendBubble("assistant", getString("chat-greeting", { args: { title: meta.title } }))
        if (!rawText) appendBubble("error", getString("chat-no-pdf-note"))
        input?.focus()
      } catch (e) {
        log("chat loadCallback 실패", e)
      }
    },
  })

  const mw: any = Zotero.getMainWindow()
  const availH = Number(mw?.screen?.availHeight) || 900
  const availW = Number(mw?.screen?.availWidth) || 1200
  dialog.open(getString("chat-title", { args: { title: meta.title } }), {
    width: Math.min(1000, Math.max(700, Math.round(availW * 0.55))),
    height: Math.max(360, Math.round(availH / 2)),
    centerscreen: true,
    resizable: true,
  })
}
