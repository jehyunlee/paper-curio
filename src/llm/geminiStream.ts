/**
 * Gemini streamGenerateContent(SSE) 직접 호출.
 *
 * `@google/generative-ai`의 generateContentStream은 `TextDecoderStream`과
 * `new ReadableStream`을 쓰는데, Zotero 플러그인 샌드박스(Cu.Sandbox의
 * wantGlobalProperties)에는 둘 다 없어 "TextDecoderStream is not defined"로
 * 실패한다. 샌드박스가 보장하는 fetch + body.getReader() + TextDecoder만 쓴다.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export interface GeminiContent {
  role: string
  parts: { text: string }[]
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
}

export interface GeminiStreamResult {
  finishReason: string
  usageMetadata: GeminiUsageMetadata
}

export interface GeminiStreamRequest {
  apiKey: string
  model: string
  systemInstruction: string
  contents: GeminiContent[]
  onText: (text: string) => void
  fetchImpl?: typeof fetch
}

function modelPath(model: string): string {
  return model.includes("/") ? model : `models/${model}`
}

function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body)
    const err = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error
    if (err?.message) return String(err.message)
  } catch {
    // 본문이 JSON이 아니면 원문 일부를 쓴다.
  }
  return body.slice(0, 500)
}

function chunkText(chunk: any): string {
  const parts = chunk?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ""
  let text = ""
  for (const part of parts) {
    if (part && !part.thought && typeof part.text === "string") text += part.text
  }
  return text
}

export async function streamGeminiContent(
  req: GeminiStreamRequest,
): Promise<GeminiStreamResult> {
  const doFetch = req.fetchImpl ?? fetch
  const url = `${GEMINI_BASE_URL}/${modelPath(req.model)}:streamGenerateContent?alt=sse`
  const response = await doFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": req.apiKey,
    },
    body: JSON.stringify({
      contents: req.contents,
      systemInstruction: {
        role: "system",
        parts: [{ text: req.systemInstruction }],
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `Gemini API ${response.status} ${response.statusText}: ${errorMessage(body)}`,
    )
  }
  if (!response.body) throw new Error("Gemini streaming response body가 없습니다")

  const result: GeminiStreamResult = { finishReason: "", usageMetadata: {} }
  let dataLines: string[] = []

  const dispatch = () => {
    if (!dataLines.length) return
    const data = dataLines.join("\n")
    dataLines = []
    let chunk: any
    try {
      chunk = JSON.parse(data)
    } catch {
      throw new Error(`Gemini streaming JSON 파싱 실패: ${data.slice(0, 200)}`)
    }
    if (chunk?.error) {
      throw new Error(`Gemini API error: ${chunk.error.message || JSON.stringify(chunk.error)}`)
    }
    if (chunk?.usageMetadata) result.usageMetadata = chunk.usageMetadata
    const finish = chunk?.candidates?.[0]?.finishReason
    if (finish) result.finishReason = String(finish)
    const text = chunkText(chunk)
    if (text) req.onText(text)
  }

  const handleLine = (line: string) => {
    if (line === "") {
      dispatch()
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(line.startsWith("data: ") ? 6 : 5))
    }
    // event:/id:/retry:/주석 줄은 Gemini가 쓰지 않으므로 무시한다.
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline = buffer.search(/\r?\n/)
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(buffer[newline] === "\r" ? newline + 2 : newline + 1)
        handleLine(line)
        newline = buffer.search(/\r?\n/)
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
  if (buffer) handleLine(buffer)
  dispatch()
  return result
}
