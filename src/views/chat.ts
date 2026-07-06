import { DialogHelper } from "zotero-plugin-toolkit"
import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { getSelectedRegularItems } from "../apis/zotero/item"
import { extractText } from "../extract/text"
import { availableChatModels, chatComplete, ChatMsg, ChatProvider } from "../llm/chat"
import { menu as log } from "../utils/loggers"

const MAX_CTX_CHARS = 120_000

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
    const creators = item.getCreators() || []
    const names = creators
      .map((c: any) => c.lastName || c.name || "")
      .filter(Boolean)
    authors = names.slice(0, 3).join(", ") + (names.length > 3 ? " et al." : "")
  } catch {
    /* ignore */
  }
  const dateStr = String(item.getField("date") || "")
  const year = (dateStr.match(/\d{4}/) || [""])[0]
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

  // PDF 텍스트 추출 (진행 표시)
  const pw = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
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
      ? getString("toast-chat-ready", {
          args: { chars: text.length, pages: extracted.pages || 0 },
        })
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
    "사용자가 쓴 언어(한국어면 한국어)로 답합니다.\n\n" +
    `=== 논문 메타 ===\n${metaBlock}\n\n` +
    (text
      ? `=== 논문 전문${truncated ? " (분량 초과로 일부 생략) " : ""} ===\n${text}`
      : "=== 논문 전문 ===\n(PDF 텍스트를 추출하지 못했습니다. 사용자가 제공하는 정보로 답하세요.)")

  const messages: ChatMsg[] = []
  let busy = false

  const dialog = new DialogHelper(3, 1)

  dialog.addCell(
    0,
    0,
    {
      tag: "div",
      namespace: "html",
      styles: { display: "flex", gap: "8px", alignItems: "center", width: "100%" },
      children: [
        {
          tag: "label",
          namespace: "html",
          styles: { fontSize: "12px", fontWeight: "700", color: "#475467" },
          properties: { textContent: getString("chat-model-label") },
        },
        {
          tag: "select",
          namespace: "html",
          id: "pc-chat-model",
          styles: { flex: "1", fontSize: "13px", padding: "3px" },
          children: models.map((m) => ({
            tag: "option",
            namespace: "html",
            properties: { value: `${m.provider}|${m.model}`, textContent: m.label },
          })),
        },
        {
          tag: "span",
          namespace: "html",
          id: "pc-chat-status",
          styles: { fontSize: "12px", color: "#98a2b3", whiteSpace: "nowrap" },
        },
      ],
    },
    false,
  )

  dialog.addCell(1, 0, {
    tag: "div",
    namespace: "html",
    id: "pc-chat-log",
    styles: {
      height: "440px",
      overflowY: "auto",
      border: "1px solid #e5e7eb",
      borderRadius: "10px",
      padding: "10px",
      background: "#fafafa",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.5",
    },
  })

  dialog.addCell(
    2,
    0,
    {
      tag: "textarea",
      namespace: "html",
      id: "pc-chat-input",
      attributes: { rows: "3", placeholder: getString("chat-input-placeholder") },
      styles: { width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: "13px", padding: "6px" },
    },
    false,
  )

  dialog.addButton(getString("chat-send"), "pc-send", {
    noClose: true,
    callback: () => void onSend(),
  })
  dialog.addButton(getString("chat-close"), "pc-close")

  function doc(): Document {
    return dialog.window.document
  }

  function setStatus(text: string) {
    const el = doc().getElementById("pc-chat-status")
    if (el) el.textContent = text
  }

  function appendBubble(role: "user" | "assistant" | "error", content: string) {
    const logEl = doc().getElementById("pc-chat-log")
    if (!logEl) return
    const isUser = role === "user"
    const bg = role === "error" ? "#fee2e2" : isUser ? "#dbeafe" : "#ffffff"
    const border = role === "error" ? "#fecaca" : isUser ? "#bfdbfe" : "#e5e7eb"
    dialog.appendElement(
      {
        tag: "div",
        namespace: "html",
        styles: {
          alignSelf: isUser ? "flex-end" : "flex-start",
          maxWidth: "85%",
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: "10px",
          padding: "8px 10px",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          color: role === "error" ? "#991b1b" : "#111827",
        },
        properties: { textContent: content },
      },
      logEl as HTMLElement,
    )
    ;(logEl as HTMLElement).scrollTop = (logEl as HTMLElement).scrollHeight
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
    busy = true
    setStatus(getString("chat-thinking"))
    try {
      const reply = await chatComplete(provider, model, systemText, messages)
      const answer = reply || getString("chat-empty-reply")
      messages.push({ role: "assistant", content: answer })
      appendBubble("assistant", answer)
    } catch (e: any) {
      appendBubble("error", String(e?.message ?? e))
      log("chat 호출 실패", e)
    } finally {
      busy = false
      setStatus("")
      input.focus()
    }
  }

  dialog.setDialogData({
    loadCallback: () => {
      try {
        const input = doc().getElementById("pc-chat-input") as HTMLTextAreaElement | null
        input?.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault()
            void onSend()
          }
        })
        appendBubble(
          "assistant",
          getString("chat-greeting", { args: { title: meta.title } }),
        )
        setStatus(rawText ? "" : getString("chat-no-pdf-note"))
        input?.focus()
      } catch (e) {
        log("chat loadCallback 실패", e)
      }
    },
  })

  dialog.open(getString("chat-title", { args: { title: meta.title } }), {
    width: 760,
    height: 680,
    centerscreen: true,
    resizable: true,
  })
}
