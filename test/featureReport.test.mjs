import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { transform } from "esbuild"
const source = await readFile("src/render/featureReport.ts", "utf8")
const { code } = await transform(source, { loader: "ts", format: "esm" })
const { featureReportHtml } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
)
const html = featureReportHtml("Comparison", {
  provider: "anthropic",
  model: "claude-sonnet-5",
  outputs: ["/Users/private/work/review.md"],
  data: {
    claims: [
      {
        text: "<img src=x onerror=alert(1)> A result",
        source_id: "paper-1",
        quote:
          "Source quote /Users/private/source.pdf sk-ant-example-secret123",
      },
    ],
  },
})
assert.match(html, /<!doctype html>/)
assert.match(html, /Source: paper-1/)
assert.match(html, /Source quote/)
assert.doesNotMatch(
  html,
  /<img|onerror=alert\(1\)>|\/Users\/private|sk-ant-example-secret123/,
)
assert.match(html, /&lt;img/)
assert.match(html, /\[local path removed\]/)
assert.match(html, /\[credential removed\]/)
assert.doesNotMatch(html, /<script/)
console.log(
  "PASS: portable grounded report preserves quotes, escapes HTML and excludes private paths/credentials",
)
