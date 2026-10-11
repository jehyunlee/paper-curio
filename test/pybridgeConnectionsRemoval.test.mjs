import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bridge = fs.readFileSync(path.join(root, "src/extract/pybridge.ts"), "utf8")

assert.doesNotMatch(bridge, /generate_connections_from_candidates/)
assert.doesNotMatch(bridge, /if cmd == "connections":/)
assert.doesNotMatch(bridge, /if cmd == "sync_conns":/)

console.log("PASS: bridge has no Curio-side connection generation commands")
