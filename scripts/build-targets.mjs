#!/usr/bin/env node
// Build one XPI per supported Zotero major and merge their update manifests.
//
//   npm run build            -> build/paper-curio-zotero9.xpi
//                               build/paper-curio-zotero10.xpi
//                               build/update.json (+ update-beta.json)
//   npm run build -- 10      -> only the Zotero 10 target (no merged manifest)
//
// `zotero-plugin build` empties its dist directory on every run, so each
// target builds into build/zotero<N>/ and the artifacts are copied up.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DIST_ROOT, TARGET_ORDER, mergeUpdateManifests, resolveTarget } from "./targets.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const requested = process.argv.slice(2)
const keys = requested.length ? requested : TARGET_ORDER
const isPreRelease = pkg.version.includes("-")

for (const key of keys) {
  const target = resolveTarget(key)
  console.log(`\n=== Zotero ${key}: ${target.xpiName}.xpi ===`)
  const result = spawnSync("npx", ["zotero-plugin", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ZOTERO_TARGET: key, NODE_ENV: "production" },
  })
  if (result.status !== 0) {
    console.error(`build failed for Zotero ${key}`)
    process.exit(result.status ?? 1)
  }
  fs.copyFileSync(
    path.join(root, target.dist, `${target.xpiName}.xpi`),
    path.join(root, DIST_ROOT, `${target.xpiName}.xpi`),
  )
}

if (keys.length === TARGET_ORDER.length && TARGET_ORDER.every((k) => keys.includes(k))) {
  const perTarget = Object.fromEntries(
    TARGET_ORDER.map((key) => {
      const dist = resolveTarget(key).dist
      return [key, JSON.parse(fs.readFileSync(path.join(root, dist, "update-beta.json"), "utf8"))]
    }),
  )
  const merged = mergeUpdateManifests(pkg.config.addonID, perTarget)
  const text = JSON.stringify(merged, null, 2) + "\n"
  fs.writeFileSync(path.join(root, DIST_ROOT, "update-beta.json"), text)
  if (!isPreRelease) fs.writeFileSync(path.join(root, DIST_ROOT, "update.json"), text)
  console.log(`\nmerged update manifest: ${TARGET_ORDER.map((k) => `Zotero ${k}`).join(" + ")}`)
} else {
  console.log("\npartial build: merged update.json not written")
}
