// Every release must ship one XPI per supported Zotero major with a merged
// auto-update manifest whose entries do not overlap. Checks the merge logic in
// isolation, then the real artifacts when a build is present.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { TARGETS, TARGET_ORDER, mergeUpdateManifests, resolveTarget } from "../scripts/targets.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const ID = pkg.config.addonID

function entry(key, overrides = {}) {
  return {
    addons: {
      [ID]: {
        updates: [
          {
            version: "1.2.3",
            update_link: `https://example.test/v1.2.3/paper-curio-zotero${key}.xpi`,
            update_hash: "sha512:" + "0".repeat(128),
            applications: {
              zotero: {
                strict_min_version: TARGETS[key].minVersion,
                strict_max_version: TARGETS[key].maxVersion,
              },
            },
            ...overrides,
          },
        ],
      },
    },
  }
}

// resolveTarget
assert.equal(resolveTarget("9").xpiName, "paper-curio-zotero9")
assert.equal(resolveTarget("10").xpiName, "paper-curio-zotero10")
assert.equal(resolveTarget("9").maxVersion, "9.*")
assert.equal(resolveTarget("10").maxVersion, "10.*")
assert.notEqual(resolveTarget("9").dist, resolveTarget("10").dist)
assert.throws(() => resolveTarget(""), /ZOTERO_TARGET/)
assert.throws(() => resolveTarget("11"), /ZOTERO_TARGET/)

// Zotero 9 and 10 ranges must not overlap; otherwise a Zotero 9 install could
// be offered the Zotero 10 build.
assert.equal(TARGETS[9].maxVersion, "9.*")
assert.equal(TARGETS[10].minVersion, "10.0")

// mergeUpdateManifests
const merged = mergeUpdateManifests(ID, { 9: entry("9"), 10: entry("10") })
assert.deepEqual(Object.keys(merged.addons), [ID])
assert.equal(merged.addons[ID].updates.length, 2)
assert.equal(merged.addons[ID].updates[0].applications.zotero.strict_max_version, "9.*")
assert.equal(merged.addons[ID].updates[1].applications.zotero.strict_max_version, "10.*")
assert.throws(() => mergeUpdateManifests(ID, { 9: entry("9") }), /missing update manifest for Zotero 10/)
assert.throws(
  () => mergeUpdateManifests(ID, { 9: entry("9"), 10: entry("10", { version: "9.9.9" }) }),
  /disagree on version/,
)
assert.throws(
  () => mergeUpdateManifests(ID, { 9: entry("9"), 10: entry("9") }),
  /Zotero 10 entry has range/,
)
assert.throws(
  () => mergeUpdateManifests(ID, { 9: entry("9", { update_hash: undefined }), 10: entry("10") }),
  /sha512/,
)

// Source manifest keeps placeholders so a target-less build can never ship a
// hardcoded range.
const source = JSON.parse(fs.readFileSync(path.join(root, "addon/manifest.json"), "utf8"))
assert.equal(source.applications.zotero.strict_min_version, "__zoteroMinVersion__")
assert.equal(source.applications.zotero.strict_max_version, "__zoteroMaxVersion__")

// Real artifacts, when present.
const updatePath = path.join(root, "build/update.json")
if (fs.existsSync(updatePath)) {
  const doc = JSON.parse(fs.readFileSync(updatePath, "utf8"))
  const updates = doc.addons[ID].updates
  assert.equal(updates.length, TARGET_ORDER.length)
  for (const [i, key] of TARGET_ORDER.entries()) {
    const t = resolveTarget(key)
    const u = updates[i]
    assert.equal(u.version, pkg.version)
    assert.ok(u.update_link.endsWith(`/v${pkg.version}/${t.xpiName}.xpi`), u.update_link)
    assert.equal(u.applications.zotero.strict_min_version, t.minVersion)
    assert.equal(u.applications.zotero.strict_max_version, t.maxVersion)
    const xpi = path.join(root, "build", `${t.xpiName}.xpi`)
    assert.ok(fs.existsSync(xpi), `missing ${xpi}`)
    const digest = createHash("sha512").update(fs.readFileSync(xpi)).digest("hex")
    assert.equal(u.update_hash, `sha512:${digest}`, `hash mismatch for ${t.xpiName}`)
    const built = JSON.parse(fs.readFileSync(path.join(root, t.dist, "addon/manifest.json"), "utf8"))
    assert.equal(built.version, pkg.version)
    assert.equal(built.applications.zotero.strict_min_version, t.minVersion)
    assert.equal(built.applications.zotero.strict_max_version, t.maxVersion)
  }
  console.log(`PASS: build artifacts for Zotero ${TARGET_ORDER.join(" and ")} match update.json`)
} else {
  console.log("SKIP: no build/update.json (run npm run build to check artifacts)")
}
console.log("PASS: dual Zotero target resolution and update manifest merge")
