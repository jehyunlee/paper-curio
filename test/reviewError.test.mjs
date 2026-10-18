import assert from "node:assert/strict"
import { build, transform } from "esbuild"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
const directory = await mkdtemp(join(tmpdir(), "pc-review-error-"))
try {
  await build({
    entryPoints: ["src/utils/reviewError.ts"],
    bundle: true,
    format: "esm",
    outfile: join(directory, "error.mjs"),
    plugins: [
      {
        name: "locale",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/locale$/ }, () => ({
            path: "locale",
            namespace: "fixture",
          }))
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const getString = key => key",
            loader: "js",
          }))
        },
      },
    ],
  })
  const { ReviewTaskError, reviewErrorMessage, reviewStatusError } =
    await import(join(directory, "error.mjs"))
  for (const code of [
    "no-selection",
    "needs-pdf",
    "needs-key",
    "needs-runtime",
    "insufficient-data",
    "budget-exceeded",
    "budget-unavailable",
    "failed",
    "corpus-busy",
    "corpus-invalid-slug",
    "corpus-invalid-index",
    "corpus-identity-conflict",
    "corpus-filesystem-error",
    "corpus-invalid-request",
  ]) {
    assert.match(
      reviewErrorMessage(new ReviewTaskError(code)),
      new RegExp(`\\[${code}\\]`),
    )
    for (const locale of ["en-US", "ko-KR"]) {
      const text = await readFile(`addon/locale/${locale}/addon.ftl`, "utf8")
      assert.ok(
        text.includes(`review-error-${code} = `),
        `${locale} missing ${code}`,
      )
    }
  }
  assert.equal(reviewStatusError("needs-key").code, "needs-key")
  const opaque = "opaque-sensitive-backend-value"
  assert.ok(!reviewErrorMessage(new Error(opaque)).includes(opaque))
  assert.ok(
    !reviewErrorMessage({ message: opaque, name: opaque }).includes(opaque),
  )
  assert.match(reviewErrorMessage(new ReferenceError(opaque)), /ReferenceError/)
  const root = await readFile("src/views/root.ts", "utf8")
  const helper = root.match(
    /function reviewProgressWindow\(headline: string\) \{[\s\S]*?\n\}/,
  )
  assert.ok(helper, "Review progress uses its own persistent window")
  const compiled = await transform(helper[0], { loader: "ts" })
  const windows = []
  const makeWindow = new Function(
    "ztoolkit",
    compiled.code + "\nreturn reviewProgressWindow;",
  )({
    ProgressWindow: class {
      constructor(headline, options) {
        this.headline = headline
        this.options = options
        windows.push(this)
      }
    },
  })
  const progress = makeWindow("Review Generation")
  assert.equal(progress.headline, "Review Generation")
  assert.equal(
    progress.options.closeOnClick,
    false,
    "Clicking progress must not dismiss an active review",
  )
  assert.equal(progress.options.closeTime, -1, "No timer until review finishes")
  assert.equal(
    progress.options.closeOtherProgressWindows,
    false,
    "Do not close Zotero's other tasks",
  )
  assert.equal(windows.length, 1)
  const guard = root.match(
    /async function onReviewCommand\(\): Promise<void> \{[\s\S]*?\n\}/,
  )
  assert.ok(guard)
  const guardedCode = await transform("let activeReviewRun;\n" + guard[0], {
    loader: "ts",
  })
  let starts = 0
  let finish
  let fail = false
  let choice = 1
  let prompts = 0
  let closed = 0
  let workers = 0
  const runs = []
  const selected = [{ getDisplayTitle: () => "Original paper" }]
  const invoke = new Function(
    "runReviewCommand",
    "Services",
    "Zotero",
    "getString",
    "getSelectedRegularItems",
    guardedCode.code + "\nreturn onReviewCommand;",
  )(
    async (run) => {
      starts++
      if (fail) throw new Error("preflight failed")
      assert.equal(
        workers,
        0,
        "Restart must wait for previous worker and cleanup",
      )
      workers++
      runs.push({
        signal: run.controller.signal,
        regenerate: run.regenerate,
        targets: run.targets,
      })
      run.progress = {
        changeLine() {},
        close() {
          closed++
        },
      }
      await new Promise((resolve) => {
        finish = resolve
      })
      workers--
    },
    {
      prompt: {
        BUTTON_POS_0: 1,
        BUTTON_POS_1: 256,
        BUTTON_TITLE_IS_STRING: 127,
        BUTTON_POS_1_DEFAULT: 16777216,
        confirmEx(_window, _title, _message, flags, restart, wait) {
          prompts++
          assert.ok(flags & 16777216, "Waiting is the default choice")
          assert.equal(restart, "review-restart")
          assert.equal(wait, "review-wait")
          return choice
        },
      },
    },
    { getMainWindow: () => ({}) },
    (key) => key,
    () => selected,
  )
  const active = invoke()
  await invoke()
  assert.equal(
    starts,
    1,
    "Repeated click leaves the active task and progress window alone",
  )
  assert.equal(prompts, 1)
  assert.equal(
    runs[0].signal.aborted,
    false,
    "Wait leaves active work unchanged",
  )
  choice = 0
  await invoke()
  await invoke()
  assert.equal(
    starts,
    1,
    "Restart does not run in parallel or queue duplicates",
  )
  assert.equal(runs[0].signal.aborted, true)
  finish()
  await new Promise(setImmediate)
  assert.equal(starts, 2)
  assert.equal(runs[1].regenerate, true)
  assert.equal(
    runs[1].targets,
    selected,
    "Restart retains the active paper selection",
  )
  assert.equal(closed, 1)
  finish()
  await active
  fail = true
  await assert.rejects(invoke(), /preflight failed/)
  fail = false
  const retry = invoke()
  assert.equal(
    starts,
    4,
    "The menu becomes usable again after success or failure",
  )
  finish()
  await retry
  const reviewHandler = root.slice(
    root.indexOf("async function runReviewCommand"),
    root.indexOf("async function onOpenReviewCommand"),
  )
  assert.equal(
    (reviewHandler.match(/reviewProgressWindow\(/g) || []).length,
    2,
    "Both single and batch reviews persist",
  )
  assert.ok(
    reviewHandler.includes("pw.startCloseTimer(8000)"),
    "Finished single review still closes automatically",
  )
  console.log(
    "PASS: actionable review codes have both locales; arbitrary exception details remain private",
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
