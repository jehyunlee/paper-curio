import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import vm from "node:vm"

// Zotero 플러그인 샌드박스(Cu.Sandbox wantGlobalProperties)에 맞춰
// TextDecoderStream / ReadableStream / TransformStream 없이 실행한다.
const directory = await mkdtemp(join(tmpdir(), "pc-gemini-stream-"))
try {
  const outfile = join(directory, "gemini.js")
  await build({
    entryPoints: ["src/llm/geminiStream.ts"],
    bundle: true,
    format: "iife",
    globalName: "geminiStream",
    outfile,
  })
  const source = await readFile(outfile, "utf8")

  function fakeResponse(chunks, init = {}) {
    const bytes = chunks.map((c) =>
      typeof c === "string" ? new TextEncoder().encode(c) : c,
    )
    let i = 0
    let released = false
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
      body: {
        getReader: () => ({
          read: async () =>
            i < bytes.length
              ? { done: false, value: bytes[i++] }
              : { done: true, value: undefined },
          releaseLock: () => {
            released = true
          },
        }),
      },
      text: async () => init.text ?? "",
      get released() {
        return released
      },
    }
  }

  function load(fetchImpl) {
    const context = vm.createContext({ TextDecoder, fetch: fetchImpl })
    vm.runInContext(source, context)
    assert.equal(vm.runInContext("typeof TextDecoderStream", context), "undefined")
    assert.equal(vm.runInContext("typeof ReadableStream", context), "undefined")
    return context.geminiStream
  }

  // 1) 정상 스트림: 청크 경계가 UTF-8 멀티바이트/줄 중간에 걸치고, CRLF 혼용
  const event1 = JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: "생각", thought: true }, { text: "안녕 " }],
        },
      },
    ],
  })
  const event2 = JSON.stringify({
    candidates: [{ content: { parts: [{ text: "세계" }] }, finishReason: "MAX_TOKENS" }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, thoughtsTokenCount: 2 },
  })
  const wire = new TextEncoder().encode(`data: ${event1}\r\n\r\ndata: ${event2}\n\n`)
  const splitAt = [7, wire.indexOf(0xec) + 1, wire.length - 30, wire.length - 1]
  const pieces = []
  let prev = 0
  for (const at of splitAt) {
    pieces.push(wire.slice(prev, at))
    prev = at
  }
  pieces.push(wire.slice(prev))

  let seenRequest
  const okResponse = fakeResponse(pieces)
  const ok = load(async (url, init) => {
    seenRequest = { url, init }
    return okResponse
  })
  const deltas = []
  const result = await ok.streamGeminiContent({
    apiKey: "KEY",
    model: "gemini-2.5-flash",
    systemInstruction: "SYS",
    contents: [{ role: "user", parts: [{ text: "Q" }] }],
    onText: (d) => deltas.push(d),
  })
  assert.deepEqual(deltas, ["안녕 ", "세계"])
  assert.equal(result.finishReason, "MAX_TOKENS")
  assert.deepEqual(
    { ...result.usageMetadata },
    { promptTokenCount: 11, candidatesTokenCount: 4, thoughtsTokenCount: 2 },
  )
  assert.equal(okResponse.released, true)
  assert.equal(
    seenRequest.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
  )
  assert.equal(seenRequest.init.method, "POST")
  assert.equal(seenRequest.init.headers["x-goog-api-key"], "KEY")
  const body = JSON.parse(seenRequest.init.body)
  assert.deepEqual(body.systemInstruction, { role: "system", parts: [{ text: "SYS" }] })
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "Q" }] }])

  // 2) 마지막 이벤트 뒤 빈 줄 없이 스트림이 끝나도 처리
  const tail = load(async () =>
    fakeResponse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "끝" }] }, finishReason: "STOP" }] })}`]),
  )
  const tailDeltas = []
  const tailResult = await tail.streamGeminiContent({
    apiKey: "K", model: "models/gemini-x", systemInstruction: "", contents: [],
    onText: (d) => tailDeltas.push(d),
  })
  assert.deepEqual(tailDeltas, ["끝"])
  assert.equal(tailResult.finishReason, "STOP")

  // 3) HTTP 오류는 API 메시지를 그대로 노출
  const failing = load(async () =>
    fakeResponse([], {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: JSON.stringify({ error: { message: "Quota exceeded for free tier" } }),
    }),
  )
  await assert.rejects(
    failing.streamGeminiContent({
      apiKey: "K", model: "m", systemInstruction: "", contents: [], onText: () => {},
    }),
    /Gemini API 429 Too Many Requests: Quota exceeded for free tier/,
  )

  // 4) 스트림 도중 error 이벤트
  const midError = load(async () =>
    fakeResponse([`data: ${JSON.stringify({ error: { message: "boom" } })}\n\n`]),
  )
  await assert.rejects(
    midError.streamGeminiContent({
      apiKey: "K", model: "m", systemInstruction: "", contents: [], onText: () => {},
    }),
    /Gemini API error: boom/,
  )

  console.log("geminiStream tests passed")
} finally {
  await rm(directory, { recursive: true, force: true })
}
