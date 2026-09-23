import assert from "node:assert/strict"
import { build } from "esbuild"
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
  console.log(
    "PASS: actionable review codes have both locales; arbitrary exception details remain private",
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
