import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The desktop review queue: parallel reviews, one finish pass per batch.
const dir = await mkdtemp(join(tmpdir(), "pc-review-queue-"))
const modules = {
  "./pipeline": `
    export const isRegistered = (r) => r.status !== "skipped" && r.recovery !== "retry-registration";
    export const reviewItem = async (item, options) => {
      const s = globalThis.q;
      s.running++; s.peak = Math.max(s.peak, s.running);
      s.reviewCalls.push({ key: item.key, regenerate: options.regenerate });
      if (s.finishing) s.overlap = true;
      try {
        await new Promise((resolve, reject) => {
          s.release[item.key] = resolve;
          options.signal.addEventListener("abort", () => {
            const e = new Error("abort"); e.name = "AbortError"; reject(e);
          });
        });
      } finally { s.running--; }
      if (s.fail.has(item.key)) throw new Error("review failed");
      if (s.skip.has(item.key)) return { status: "skipped", slug: item.key };
      return { status: "completed", slug: "S_" + item.key };
    };
    export const finishReviews = async (root, papersDir, reviewed, onProgress) => {
      const s = globalThis.q;
      s.finishing = true;
      s.finishCalls.push(reviewed.map((r) => r.slug));
      onProgress?.({ stage: "connections", done: 0, total: reviewed.length });
      await new Promise((resolve) => (s.releaseFinish = resolve));
      s.finishing = false;
      return reviewed.map((r) => ({ ...r, connectionProcessing: "completed" }));
    };`,
  "./pc-discovery":
    "export const resolveOutputTarget = async () => ({ root: '/pc', papersDir: '/pc/docs/papers' })",
  "../utils/loggers": "export const pipeline = () => {}",
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
const item = (key) => ({ key, getDisplayTitle: () => `Paper ${key}` })

try {
  await build({
    entryPoints: ["src/core/reviewQueue.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "queue.mjs"),
    plugins: [
      {
        name: "isolate",
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, ({ path, importer }) => {
            if (!importer) return
            assert.ok(path in modules, `Unexpected dependency: ${path}`)
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
  globalThis.q = {
    running: 0,
    peak: 0,
    reviewCalls: [],
    finishCalls: [],
    release: {},
    fail: new Set(["E"]),
    skip: new Set(["D"]),
    finishing: false,
    overlap: false,
  }
  const q = globalThis.q
  const Q = await import(join(dir, "queue.mjs"))

  const first = Q.enqueueReviews(["A", "B", "C", "D", "E"].map(item))
  await tick()
  assert.equal(q.running, Q.MAX_PARALLEL, "Up to three reviews at once")
  assert.ok(Q.queueBusy())
  assert.equal(
    Q.enqueueReviews([item("A")]).length,
    0,
    "A queued paper is not added twice",
  )

  // Restart a running review: it stops and starts over regenerating.
  assert.equal(Q.restartReviews(new Set(["B"])).length, 1)
  await tick()
  assert.deepEqual(
    q.reviewCalls.filter((c) => c.key === "B").map((c) => c.regenerate),
    [false, true],
  )

  for (const key of ["A", "C", "B", "D", "E"]) {
    while (!q.release[key]) await tick()
    q.release[key]()
    delete q.release[key]
    await tick()
  }
  while (!q.releaseFinish) await tick()
  assert.equal(q.peak, Q.MAX_PARALLEL)
  assert.deepEqual(
    q.finishCalls,
    [["S_A", "S_B", "S_C"]],
    "One related-paper/view pass for every registered review",
  )
  assert.equal(Q.queueFinishProgress().stage, "connections")

  // Queued during the finish pass: waits for the exclusive pass to end.
  const late = Q.enqueueReviews([item("F")])
  await tick()
  assert.equal(q.running, 0, "No review runs during the finish pass")
  q.releaseFinish()
  q.releaseFinish = undefined
  const settled = await Promise.all(first)
  assert.deepEqual(
    settled.map((job) => [job.key, job.state]),
    [
      ["A", "done"],
      ["B", "done"],
      ["C", "done"],
      ["D", "skipped"],
      ["E", "failed"],
    ],
  )
  assert.ok(Q.queueBusy(), "The late paper keeps the batch active")
  while (!q.release.F) await tick()
  q.release.F()
  while (!q.releaseFinish) await tick()
  assert.deepEqual(q.finishCalls[1], ["S_F"])
  q.releaseFinish()
  assert.equal((await late[0]).state, "done")
  assert.equal(q.overlap, false)

  // A finished batch stays visible until acknowledged.
  assert.equal(Q.queueBusy(), false)
  assert.equal(Q.queueUnacknowledged(), true)
  Q.acknowledgeQueue()
  assert.equal(Q.queueUnacknowledged(), false)

  // The next batch starts fresh.
  Q.enqueueReviews([item("G")])
  assert.deepEqual(
    Q.queueJobs().map((job) => job.key),
    ["G"],
  )
  console.log(
    "PASS: review queue — parallel cap, dedupe, restart, one finish pass, no review during finish, acknowledgement",
  )
  process.exit(0)
} finally {
  await rm(dir, { recursive: true, force: true })
}
