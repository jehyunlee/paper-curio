import { marked } from "marked"
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
.pc-root { display:flex; flex-direction:column; gap:10px; width:100%; box-sizing:border-box; padding:2px 2px 4px;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Noto Sans KR",Segoe UI,sans-serif; color:#111827; }
.pc-header { display:flex; align-items:center; gap:10px; }
.pc-select { flex:0 1 auto; max-width:62%; font-size:13px; padding:6px 9px; border:1px solid #e5e7eb;
  border-radius:10px; background:#fff; color:#111827; }
.pc-cost { margin-left:auto; font-size:11.5px; color:#98a2b3; white-space:nowrap; cursor:help; }
.pc-log { flex:1 1 auto; height:52vh; min-height:240px; overflow-y:auto; border:1px solid #eef0f2;
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
.pc-composer { display:flex; gap:10px; align-items:stretch; }
.pc-input { flex:1 1 auto; width:100%; box-sizing:border-box; resize:vertical; min-height:66px; max-height:220px;
  padding:11px 14px; border:1px solid #e5e7eb; border-radius:16px; font-family:inherit; font-size:13.5px; line-height:1.5; outline:none; }
.pc-input:focus { border-color:#93c5fd; box-shadow:0 0 0 3px rgba(37,99,235,.12); }
.pc-actions { display:flex; flex-direction:column; gap:8px; justify-content:flex-end; }
.pc-btn { border:none; border-radius:999px; padding:10px 22px; font-size:13px; font-weight:600; cursor:pointer;
  transition:background .15s ease, color .15s ease, opacity .15s ease; font-family:inherit; }
.pc-btn-primary { background:#2563eb; color:#fff; }
.pc-btn-primary:hover { background:#1d4ed8; }
.pc-btn-primary:disabled { background:#bfdbfe; cursor:default; }
.pc-btn-ghost { background:transparent; color:#667085; }
.pc-btn-ghost:hover { background:#f3f4f6; color:#111827; }
`

/** LLM 마크다운 → 안전한 HTML (chrome 다이얼로그이므로 스크립트/이벤트 핸들러 제거). */
function renderMarkdown(md: string): string {
  let html = ""
  try {
    html = String((marked as any).parse(md, { breaks: true, headerIds: false, mangle: false }))
  } catch {
    return escapeHtml(md)
  }
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?(<\/\s*\1\s*>|$)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|data):[^"']*\2/gi, '$1="#"')
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  )
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
    "답변은 읽기 좋게 마크다운으로 작성하고, 사용자가 쓴 언어(한국어면 한국어)로 답합니다.\n\n" +
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
              { tag: "button", namespace: "html", id: "pc-send", classList: ["pc-btn", "pc-btn-primary"], properties: { textContent: getString("chat-send") } },
              { tag: "button", namespace: "html", id: "pc-close", classList: ["pc-btn", "pc-btn-ghost"], properties: { textContent: getString("chat-close") } },
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
      btn.textContent = on ? getString("chat-thinking") : getString("chat-send")
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
    try {
      const res = await chatComplete(provider, model, systemText, messages)
      const answer = res.text || getString("chat-empty-reply")
      messages.push({ role: "assistant", content: answer })
      appendBubble("assistant", answer)
      totalIn += res.usage.input
      totalOut += res.usage.output
      totalCost += estimateCost(model, res.usage.input, res.usage.output)
      updateCost()
    } catch (e: any) {
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

  dialog.open(getString("chat-title", { args: { title: meta.title } }), {
    width: 900,
    height: 720,
    centerscreen: true,
    resizable: true,
  })
}
