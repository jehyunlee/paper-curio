#!/usr/bin/env node
// Publish the current build as a GitHub release with one XPI per Zotero major,
// then refresh the auto-update manifest hosted on the long-lived `release` tag.
//
//   npm run build && npm test && npm run release
//
// Uses the authenticated `gh` CLI. Refuses to overwrite an existing version
// tag so historical releases (e.g. v0.10.0 for Zotero 9 only) stay intact.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DIST_ROOT, TARGET_ORDER, resolveTarget } from "./targets.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const version = pkg.version
const tag = `v${version}`
const isPreRelease = version.includes("-")
const manifestTag = "release"
const manifestName = isPreRelease ? "update-beta.json" : "update.json"

function gh(args, opts = {}) {
  const result = spawnSync("gh", args, { cwd: root, encoding: "utf8", ...opts })
  if (result.status !== 0 && !opts.allowFailure) {
    console.error(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
  return result
}

const xpis = TARGET_ORDER.map((key) => path.join(root, DIST_ROOT, `${resolveTarget(key).xpiName}.xpi`))
const manifest = path.join(root, DIST_ROOT, manifestName)
for (const file of [...xpis, manifest]) {
  if (!fs.existsSync(file)) {
    console.error(`missing ${path.relative(root, file)} — run \`npm run build\` first`)
    process.exit(1)
  }
}

const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim()
if (dirty) {
  console.error("working tree is not clean; commit before releasing")
  process.exit(1)
}

if (gh(["release", "view", tag], { allowFailure: true }).status === 0) {
  console.error(`release ${tag} already exists; bump package.json version first`)
  process.exit(1)
}

const notes = [
  `Paper Curio ${version}`,
  "",
  "| Zotero | Download |",
  "|---|---|",
  ...TARGET_ORDER.map((key) => {
    const name = `${resolveTarget(key).xpiName}.xpi`
    return `| ${key}.x | [${name}](https://github.com/jehyunlee/paper-curio/releases/download/${tag}/${name}) |`
  }),
  "",
  "Install the file that matches your Zotero major version. Both share the same source and features.",
].join("\n")

gh([
  "release", "create", tag, ...xpis,
  "--title", `${tag} — Zotero ${TARGET_ORDER.join(" / ")}`,
  "--notes", notes,
  ...(isPreRelease ? ["--prerelease"] : ["--latest"]),
])
console.log(`created ${tag} with ${xpis.map((f) => path.basename(f)).join(", ")}`)

if (gh(["release", "view", manifestTag], { allowFailure: true }).status !== 0) {
  gh([
    "release", "create", manifestTag,
    "--title", "Release Manifest",
    "--notes", "Hosts update.json for Zotero auto-update. Do not delete.",
    "--prerelease",
  ])
}
gh(["release", "upload", manifestTag, manifest, "--clobber"])
console.log(`refreshed ${manifestName} on the ${manifestTag} tag`)
