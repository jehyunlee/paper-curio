// Supported Zotero majors. Every release ships one XPI per entry so a user on
// either major can install and auto-update without touching the other line.
export const TARGETS = {
  9: { minVersion: "6.999", maxVersion: "9.*" },
  10: { minVersion: "10.0", maxVersion: "10.*" },
}

export const TARGET_ORDER = ["9", "10"]
export const XPI_BASENAME = "paper-curio"
export const DIST_ROOT = "build"

export function resolveTarget(raw) {
  const key = String(raw ?? "").trim()
  if (!Object.hasOwn(TARGETS, key)) {
    throw new Error(
      `ZOTERO_TARGET must be one of ${TARGET_ORDER.join(", ")} (got "${key}"). ` +
        `Use \`npm run build\` to build every target.`,
    )
  }
  return {
    key,
    xpiName: `${XPI_BASENAME}-zotero${key}`,
    dist: `${DIST_ROOT}/zotero${key}`,
    ...TARGETS[key],
  }
}

/**
 * Merge per-target update manifests into one. Zotero picks the entry whose
 * `applications.zotero` range contains its own version, so the entries must
 * not overlap. Entries are ordered by target so the file is stable.
 */
export function mergeUpdateManifests(addonId, perTarget) {
  const updates = []
  for (const key of TARGET_ORDER) {
    const doc = perTarget[key]
    if (!doc) throw new Error(`missing update manifest for Zotero ${key}`)
    const list = doc?.addons?.[addonId]?.updates
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`update manifest for Zotero ${key} has no entries`)
    }
    const entry = list[list.length - 1]
    const range = entry.applications?.zotero ?? {}
    const expected = TARGETS[key]
    if (range.strict_min_version !== expected.minVersion || range.strict_max_version !== expected.maxVersion) {
      throw new Error(
        `Zotero ${key} entry has range ${JSON.stringify(range)}, expected ${JSON.stringify(expected)}`,
      )
    }
    if (typeof entry.update_hash !== "string" || !entry.update_hash.startsWith("sha512:")) {
      throw new Error(`Zotero ${key} entry lacks a sha512 update_hash`)
    }
    updates.push(entry)
  }
  const versions = new Set(updates.map((u) => u.version))
  if (versions.size !== 1) {
    throw new Error(`targets disagree on version: ${[...versions].join(", ")}`)
  }
  return { addons: { [addonId]: { updates } } }
}
