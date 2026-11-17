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
  const handler = root.match(
    /async function onReviewCommand\(\): Promise<void> \{[\s\S]*?\n\}/,
  )
  assert.ok(handler, "Review Generation hands papers to the queue")
  const compiled = await transform(handler[0], { loader: "ts" })
  let active = new Set()
  let choice = 1
  let prompts = 0
  const enqueued = []
  const restarted = []
  let statusShown = 0
  let toasts = 0
  const selected = [
    { key: "A", getDisplayTitle: () => "Paper A" },
    { key: "B", getDisplayTitle: () => "Paper B" },
  ]
  const invoke = new Function(
    "Services",
    "Zotero",
    "getString",
    "getSelectedRegularItems",
    "requirePaperCuration",
    "activeKeys",
    "enqueueReviews",
    "restartReviews",
    "showReviewStatus",
    "queueJobs",
    "queueBusy",
    "toast",
    "config",
    compiled.code + "\nreturn onReviewCommand;",
  )(
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
    async () => true,
    () => active,
    (items) => {
      enqueued.push(items.map((item) => item.key))
      for (const item of items) active.add(item.key)
      return items.map(() => new Promise(() => {}))
    },
    (keys) => restarted.push([...keys]),
    () => statusShown++,
    () => [...active],
    () => true,
    () => {
      toasts++
      const line = {
        createLine: () => line,
        show: () => line,
        startCloseTimer: () => line,
      }
      return line
    },
    { addonName: "Paper Curio" },
  )
  await invoke()
  assert.deepEqual(enqueued, [["A", "B"]])
  assert.equal(prompts, 0, "Starting a review never opens a modal")
  assert.equal(toasts, 1)
  await invoke()
  assert.equal(enqueued.length, 1, "Queued papers are not queued twice")
  assert.equal(prompts, 1)
  assert.deepEqual(restarted, [], "Wait leaves queued work unchanged")
  assert.equal(statusShown, 1, "A repeated click shows the queue status")
  choice = 0
  await invoke()
  assert.deepEqual(restarted, [["A", "B"]], "Restart regenerates the selection")
  active = new Set(["A"])
  await invoke()
  assert.deepEqual(
    enqueued[1],
    ["B"],
    "Only papers not already queued are added",
  )
  console.log(
    "PASS: actionable review codes have both locales; arbitrary exception details remain private",
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
