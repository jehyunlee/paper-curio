import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, normalize } from "node:path"

const dir = await mkdtemp(join(tmpdir(), "pc-local-review-"))
const modules = {
  "../apis/zotero/item":
    "export const getPaperMeta = () => globalThis.state.meta",
  "./pc-discovery":
    "export const resolveOutputTarget = async () => ({ root: '/pc', papersDir: '/pc/docs/papers', source: 'pref' })",
  "./papers-index": `export const nextNumber = async () => 1;
    export const findExisting = async () => globalThis.state.existing;
    export const isPaperCurioEntry = () => !!globalThis.state.existing?.curio;`,
  "../utils/prefs":
    "export const getPref = () => false; export const getPrefStr = (key) => globalThis.state.prefs?.[key] || ''",
  "../utils/slugify": "export const buildSlug = () => '001_Paper'",
  "./review-md": "export const todayISO = () => '2026-09-10'",
  "./review-parse":
    "export const parseReviewMd = () => ({ scores: {overall: 4}, essence: 'e' })",
  "../extract/pybridge": `export const localReviewViaBridge = async (_, request, execute) => {
      globalThis.state.calls.push({request:structuredClone(request), execute});
      if (execute && globalThis.state.waitForReview) await globalThis.state.waitForReview;
      return execute ? globalThis.state.result :
        (request.reservation_token && globalThis.state.finalPlan) || globalThis.state.plan;
    };
    export const featureViaBridge = async (_, request, execute) => {
      if (!globalThis.state.entry) throw new Error('connections before registration');
      globalThis.state.featureCalls.push({request, execute});
      if (globalThis.state.connectionException) throw new Error('runtime unavailable');
      if (globalThis.state.waitForConnections) await globalThis.state.waitForConnections;
      return globalThis.state.connectionResult;
    };
    export const corpusViaBridge = async (_, request) => {
      globalThis.state.transactions.push(request.op);
      if (request.op === 'reserve') return {slug:'002_Reserved',token:'owned'};
      if (request.op === 'register') {
        if (globalThis.state.indexFailure) throw new Error('index failure');
        globalThis.state.entry = request.entry;
      }
      return {};
    }`,
  "../extract/pdfjs":
    "export const pdfFilePath = async () => globalThis.state.pdf",
  "./categorize": `export const getItemTopics = async () => {
    if (globalThis.state.topicFailure) throw new Error('topic failure');
    return ['topic'];
  }`,
  "../utils/fs": `export const joinPath = (...parts) => parts.join('/');
    export const readText = async (path) => {
      if (globalThis.state.readFailure) throw new Error('read failure');
      if (path?.endsWith('bibliography.json')) return JSON.stringify({captured_at:'2026-09-01T10:00:00'});
      return 'review';
    };
    export const pathExists = async () => true`,
  "../utils/locale": "export const getString = (id) => id",
  "../utils/loggers": "export const pipeline = () => {}",
}
try {
  await build({
    entryPoints: ["src/core/pipeline.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "pipeline.mjs"),
    plugins: [
      {
        name: "isolate-host",
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, ({ path, importer }) => {
            if (!importer) return
            if (path === "../utils/reviewError") return
            if (path === "./locale")
              return { path: "../utils/locale", namespace: "mock" }
            assert.ok(
              path in modules,
              `Unexpected dependency in minimal review: ${path}`,
            )
            return { path, namespace: "mock" }
          })
          builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
            contents: modules[path],
            loader: "ts",
          }))
        },
      },
    ],
  })
  globalThis.Zotero = { getMainWindow: () => ({}) }
  globalThis.Services = {
    prompt: {
      confirm: () => {
        throw new Error("Review Generation must not open a modal confirmation")
      },
    },
  }
  globalThis.ztoolkit = {
    ExtraField: {
      setExtraField: async () => {
        if (state.markerFailure) throw new Error("marker persistence failed")
      },
    },
  }
  const { processItem } = await import(join(dir, "pipeline.mjs"))
  const creators = [
    { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
    { name: "Research Consortium", creatorType: "author" },
  ]
  const item = {
    getCreatorsJSON: () => creators,
    getCreators: () => {
      throw new Error(
        "Internal creator records must not cross the API boundary",
      )
    },
  }
  const reset = () =>
    (globalThis.state = {
      meta: {
        key: "ABC12345",
        title: "Paper",
        authors: ["Ada Lovelace"],
        date: "2026",
        doi: "10.1/example",
        journal: "Journal",
        abstract: "Abstract",
        url: "https://example.test",
      },
      pdf: "/pdf/paper.pdf",
      calls: [],
      transactions: [],
      featureCalls: [],
      connectionResult: { status: "completed", related_count: 3 },
      plan: { status: "ready" },
      result: {
        status: "completed",
        provider: "anthropic",
        model: "claude-sonnet-5",
        outputs: {
          review: "/out/review.md",
          html: "/out/index.html",
          text: "/out/text.md",
          sidecar: "/out/bibliography.json",
        },
      },
    })
  reset()
  const done = await processItem(item)
  assert.deepEqual(
    state.calls.map((x) => x.execute),
    [false, false, true],
  )
  assert.deepEqual(state.calls[1].request.item.creators, creators)
  assert.equal(state.calls[1].request.item.publicationTitle, "Journal")
  assert.equal(done.bibliography, "sidecar-only")
  assert.equal(state.entry.bibliography_status, "sidecar-only")
  assert.equal(done.indexHtmlPath, "/out/index.html")
  assert.deepEqual(state.transactions, ["reserve", "register"])
  assert.equal(
    state.calls[1].request.output_dir,
    "/pc/docs/papers/002_Reserved",
  )
  assert.equal(state.entry.classifications, undefined)
  assert.equal(done.connections, 3)
  assert.equal(done.connectionProcessing, "completed")
  assert.deepEqual(state.featureCalls, [
    {
      execute: true,
      request: {
        schema_version: 1,
        feature: "related-papers",
        params: { slug: "002_Reserved" },
      },
    },
  ])
  reset()
  state.prefs = {
    REVIEW_MAX_COST_USD: "0.000001",
    REVIEW_INPUT_RATE: "999",
    REVIEW_OUTPUT_RATE: "999",
  }
  await processItem(item)
  assert.ok(
    state.calls.every(({ request }) => !("budget" in request)),
    "Retired cost preferences cannot limit reviews",
  )

  reset()
  const earlyAbort = new AbortController()
  earlyAbort.abort()
  await assert.rejects(processItem(item, { signal: earlyAbort.signal }), {
    name: "AbortError",
  })
  assert.equal(state.calls.length, 0)

  reset()
  const restartController = new AbortController()
  let finishOldReview
  state.waitForReview = new Promise((resolve) => {
    finishOldReview = resolve
  })
  const oldReview = processItem(item, { signal: restartController.signal })
  await new Promise(setImmediate)
  restartController.abort()
  await assert.rejects(
    processItem(item),
    /review-already-running/,
    "Keep lock until active Python stage completes",
  )
  finishOldReview()
  await assert.rejects(oldReview, { name: "AbortError" })
  assert.deepEqual(
    state.transactions,
    ["reserve", "cancel"],
    "Release owned reservation before restart",
  )
  assert.equal(
    state.featureCalls.length,
    0,
    "Retired run must not start downstream work",
  )
  reset()
  state.existing = { slug: "001_Existing", score: 4, has_pdf: true }
  const restarted = await processItem(item, { regenerate: true })
  assert.equal(restarted.status, "completed")
  assert.ok(
    state.calls.every(({ request }) => request.overwrite && request.regenerate),
    "Explicit restart bypasses saved review cache",
  )

  reset()
  state.result.status = "exists"
  const recovered = await processItem(item)
  assert.equal(recovered.status, "completed")
  assert.equal(recovered.connectionProcessing, "completed")
  assert.deepEqual(state.transactions, ["reserve", "register"])
  assert.equal(state.entry.review_date, "2026-09-01")

  reset()
  state.existing = { slug: "001_Existing", curio: true }
  state.plan = { status: "exists" }
  state.result.status = "exists"
  assert.equal((await processItem(item)).connections, 3)
  assert.ok(state.calls.every(({ request }) => request.overwrite === false))

  for (const response of [
    { status: "needs-key" },
    { status: "failed" },
    { status: "completed" },
    { status: "completed", related_count: -1 },
  ]) {
    reset()
    state.connectionResult = response
    const pendingLinks = await processItem(item)
    assert.equal(pendingLinks.status, "partial")
    assert.equal(pendingLinks.recovery, "retry-connections")
    assert.equal(pendingLinks.connectionProcessing, "failed")
    assert.equal(
      pendingLinks.connectionError,
      response.status === "needs-key" ? "needs-key" : "failed",
    )
    assert.equal(pendingLinks.indexHtmlPath, "/out/index.html")
    assert.deepEqual(
      state.transactions,
      ["reserve", "register"],
      "Keep committed review after enrichment failure",
    )
  }
  reset()
  state.connectionException = true
  assert.equal((await processItem(item)).recovery, "retry-connections")
  reset()
  state.connectionResult = { status: "completed", related_count: 0 }
  assert.equal(
    (await processItem(item)).status,
    "completed",
    "A successful all-unrelated judgment is valid",
  )

  reset()
  let releaseConnections
  state.waitForConnections = new Promise((resolve) => {
    releaseConnections = resolve
  })
  let finished = false
  const pendingProcessing = processItem(item).then((result) => {
    finished = true
    return result
  })
  await new Promise(setImmediate)
  assert.equal(state.featureCalls.length, 1)
  assert.equal(
    finished,
    false,
    "Review UI must await the connection stage before declaring completion",
  )
  await assert.rejects(processItem(item), /review-already-running/)
  releaseConnections()
  assert.equal((await pendingProcessing).status, "completed")

  reset()
  const relationAbort = new AbortController()
  state.waitForConnections = new Promise((resolve) => {
    releaseConnections = resolve
  })
  const oldConnections = processItem(item, { signal: relationAbort.signal })
  await new Promise(setImmediate)
  relationAbort.abort()
  releaseConnections()
  await assert.rejects(oldConnections, { name: "AbortError" })
  assert.deepEqual(
    state.transactions,
    ["reserve", "register"],
    "Restart must preserve already committed reviews",
  )

  reset()
  const running = processItem(item)
  await assert.rejects(processItem(item), /review-already-running/)
  await running
  assert.deepEqual(
    state.calls.map((x) => x.execute),
    [false, false, true],
  )

  reset()
  state.indexFailure = true
  const pending = await processItem(item)
  assert.equal(pending.bookkeeping, "failed")
  assert.equal(pending.status, "partial")
  assert.equal(pending.recovery, "retry-registration")
  assert.equal(pending.indexHtmlPath, "/out/index.html")
  assert.deepEqual(state.transactions, ["reserve", "register", "cancel"])
  assert.equal(
    state.featureCalls.length,
    0,
    "Never enrich an unregistered review",
  )

  reset()
  state.markerFailure = true
  const markerPartial = await processItem(item)
  assert.equal(markerPartial.status, "partial")
  assert.equal(markerPartial.recovery, "retry-zotero-marker")
  assert.deepEqual(state.transactions, ["reserve", "register"])
  assert.equal(
    markerPartial.connectionProcessing,
    "completed",
    "Marker failure must not prevent connection processing",
  )

  for (const failure of ["readFailure", "topicFailure"]) {
    reset()
    state[failure] = true
    const readyFiles = await processItem(item)
    assert.equal(readyFiles.bookkeeping, "failed")
    assert.equal(readyFiles.score, undefined)
    assert.equal(readyFiles.indexHtmlPath, "/out/index.html")
    assert.equal(state.entry, undefined)
  }

  reset()
  state.plan = { status: "needs-key", error: "ANTHROPIC_API_KEY" }
  await assert.rejects(processItem(item), /needs-key/)
  assert.equal(state.calls.length, 1)
  assert.equal(state.entry, undefined)

  reset()
  state.finalPlan = { status: "budget-exceeded" }
  await assert.rejects(processItem(item), /budget-exceeded/)
  assert.equal(state.calls.length, 2)
  assert.equal(state.entry, undefined)
  assert.deepEqual(state.transactions, ["reserve", "cancel"])
  assert.equal(
    state.featureCalls.length,
    0,
    "Failed final preflight must not run related-paper calls",
  )

  reset()
  state.pdf = null
  await assert.rejects(processItem(item), /needs-pdf/)
  assert.equal(state.calls.length, 0)

  reset()
  state.result = { status: "failed", error: "Anthropic failed" }
  await assert.rejects(processItem(item), /Anthropic failed/)
  assert.equal(state.calls.length, 3)
  assert.equal(state.entry, undefined)

  reset()
  state.result = {
    status: "failed",
    error: "HTML failed",
    partial: {
      review_ready: true,
      review: "/partial/review.md",
      cache_preserved: true,
    },
  }
  await assert.rejects(
    processItem(item),
    /review-partial-saved.*\/partial\/review.md/,
  )
  assert.equal(state.entry, undefined)

  reset()
  state.existing = { slug: "001_Existing", score: 4, has_pdf: true }
  assert.equal((await processItem(item)).skipped, true)
  assert.equal(state.calls.length, 0)
  console.log(
    "PASS: local review plan/execute, metadata, missing key/PDF, cancellation, failure isolation, existing review",
  )

  const bridgeModules = {
    "../utils/prefs":
      "export const getPref = () => false; export const getPrefStr = () => '/python312'; export const setPref = () => {}",
    "../utils/env": `export const getAnthropicKey = () => 'sentinel-anthropic-key';
      export const getGeminiKey = () => { throw new Error('unexpected Google key lookup') };
      export const getOpenAIKey = () => { throw new Error('unexpected OpenAI key lookup') };
      export const getScopusKey = getGeminiKey, getScopusInstToken = getGeminiKey,
        getS2Key = getGeminiKey, getOpenAlexEmail = getGeminiKey, getSpringerMetaKey = getGeminiKey`,
    "../utils/fs":
      "export const joinPath = (...parts) => parts.join('/'); export const writeText = async (path, value) => globalThis.bridge.files.set(path, value)",
    "../utils/loggers": "export const fs = () => {}",
    "../utils/locale": "export const getString = id => id",
  }
  await build({
    entryPoints: ["src/extract/pybridge.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "bridge.mjs"),
    plugins: [
      {
        name: "isolate-transport",
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, ({ path, importer }) => {
            if (!importer) return
            if (path === "../utils/reviewError") return
            if (path === "./locale")
              return { path: "../utils/locale", namespace: "mock" }
            assert.ok(
              path in bridgeModules,
              `Unexpected bridge import: ${path}`,
            )
            return { path, namespace: "mock" }
          })
          builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
            contents: bridgeModules[path],
            loader: "ts",
          }))
        },
      },
    ],
  })
  globalThis.bridge = {
    files: new Map(),
    exit: 0,
    response: {
      schema_version: 1,
      feature: "review",
      status: "ready",
      provider: "anthropic",
      model: "claude-sonnet-5",
    },
  }
  globalThis.PathUtils = { profileDir: "/profile" }
  globalThis.Zotero.Utilities = { randomString: () => "test-request" }
  globalThis.Zotero.File = {
    pathToFile: (path) => ({
      path,
      normalize() {
        this.path = normalize(this.path)
      },
    }),
  }
  globalThis.IOUtils = {
    exists: async () => true,
    makeDirectory: async () => {},
    remove: async (path) => bridge.files.delete(path),
  }
  globalThis.ChromeUtils = {
    importESModule: async () => ({
      Subprocess: {
        call: async (opts) => {
          bridge.opts = opts
          bridge.request = [...bridge.files.values()][0]
          const stream = (value) => {
            let read = false
            return {
              readString: async () => {
                if (read) return null
                read = true
                return value
              },
            }
          }
          return {
            stdout: stream(JSON.stringify(bridge.response)),
            stderr: stream("sentinel-anthropic-key raw process failure"),
            wait: async () => ({ exitCode: bridge.exit }),
          }
        },
      },
    }),
  }
  const { localReviewViaBridge, corpusViaBridge } = await import(
    join(dir, "bridge.mjs")
  )
  const request = {
    schema_version: 1,
    feature: "review",
    pdf_path: "/paper.pdf",
    output_dir: "/out",
    item: { title: "Paper" },
    overwrite: false,
  }
  assert.equal(
    (await localReviewViaBridge("/pc", request, false)).status,
    "ready",
  )
  assert.equal(
    bridge.opts.environment,
    undefined,
    "do not override fresh OS-store credentials with desktop cached keys",
  )
  assert.equal(bridge.opts.arguments.includes("--execute"), false)
  assert.equal(
    JSON.stringify(bridge.opts.arguments).includes("sentinel-anthropic-key"),
    false,
  )
  assert.equal(bridge.request.includes("sentinel-anthropic-key"), false)
  assert.equal(bridge.files.size, 0)

  bridge.exit = 1
  bridge.response = {
    schema_version: 1,
    op: "reserve",
    status: "failed",
    error_code: "invalid-slug",
    error: "DO-NOT-SHOW-RAW-BACKEND-TEXT",
  }
  await assert.rejects(
    corpusViaBridge("/pc", {
      op: "reserve",
      papers_dir: "/out",
      identity: { key: "A" },
    }),
    (error) =>
      error.code === "corpus-invalid-slug" &&
      !error.message.includes("DO-NOT-SHOW"),
  )
  assert.equal(bridge.files.size, 0)

  bridge.exit = 2
  bridge.response = {
    schema_version: 1,
    feature: "review",
    provider: "anthropic",
    model: "claude-sonnet-5",
    status: "needs-key",
  }
  assert.equal(
    (await localReviewViaBridge("/pc", request, false)).status,
    "needs-key",
  )
  bridge.response = { arbitrary: "sentinel-anthropic-key" }
  const malformed = await localReviewViaBridge("/pc", request, true)
  assert.equal(malformed.status, "failed")
  assert.equal(
    JSON.stringify(malformed).includes("sentinel-anthropic-key"),
    false,
  )
  assert.equal(bridge.opts.arguments.includes("--execute"), true)
  assert.equal(bridge.files.size, 0)
  bridge.exit = 0
  const validOutputs = {
    review: "/out/review.md",
    html: "/out/index.html",
    text: "/out/text.md",
    sidecar: "/out/bibliography.json",
  }
  bridge.response = {
    schema_version: 1,
    feature: "review",
    status: "completed",
    provider: "anthropic",
    model: "claude-sonnet-5",
    outputs: validOutputs,
  }
  assert.equal(
    (await localReviewViaBridge("/pc", request, true)).status,
    "completed",
  )
  bridge.response = {
    ...bridge.response,
    outputs: { ...validOutputs, review: "/foreign/review.md" },
  }
  assert.equal(
    (await localReviewViaBridge("/pc", request, true)).status,
    "failed",
  )
  for (const response of [
    null,
    {
      schema_version: 1,
      feature: "review",
      status: "completed",
      provider: "anthropic",
      model: "claude-sonnet-5",
      outputs: { review: "/out/review.md" },
    },
  ]) {
    bridge.response = response
    assert.equal(
      (await localReviewViaBridge("/pc", request, true)).status,
      "failed",
    )
    assert.equal(bridge.files.size, 0)
  }
  console.log(
    "PASS: bridge env-only key, plan/execute argv, blocked exit, malformed response, cleanup and secret isolation",
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}
