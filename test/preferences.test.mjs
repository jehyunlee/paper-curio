import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
const directory = await mkdtemp(join(tmpdir(), "pc-prefs-test-"))
try {
  await build({
    entryPoints: ["src/settings/preferences.ts"],
    bundle: true,
    format: "esm",
    outfile: join(directory, "prefs.mjs"),
    plugins: [
      {
        name: "host",
        setup(builder) {
          builder.onResolve(
            { filter: /utils\/locale|core\/pc-discovery|utils\/env/ },
            ({ path }) => ({ path, namespace: "fixture" }),
          )
          builder.onLoad(
            { filter: /.*/, namespace: "fixture" },
            ({ path }) => ({
              loader: "js",
              contents: path.endsWith("locale")
                ? "export const getString=id=>id"
                : path.endsWith("pc-discovery")
                  ? "export const tryResolveOutputTarget=async()=>{if(globalThis.fixture.barrier)await globalThis.fixture.barrier;return {root:'/repo'}}"
                  : "export const CREDENTIAL_PROVIDERS={ANTHROPIC_API_KEY:'anthropic'}; export const loadSharedCredentials=async()=>{}; export const saveSharedCredential=async(root,field,value)=>globalThis.fixture.saved.push({root,field,value})",
            }),
          )
        },
      },
    ],
  })
  globalThis.fixture = { saved: [], buttons: [] }
  globalThis.addon = { data: {} }
  const input = { value: "", after() {} }
  const document = {
    getElementById: () => null,
    querySelector: () => input,
    createElementNS: (_, tag) => {
      const element = {
        disabled: false,
        setAttribute() {},
        addEventListener(_, fn) {
          this.listener = fn
        },
      }
      if (tag === "button") fixture.buttons.push(element)
      return element
    },
  }
  const { onPrefsLoad } = await import(join(directory, "prefs.mjs"))
  onPrefsLoad({ document })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const button = fixture.buttons[0]
  let release
  fixture.barrier = new Promise((resolve) => {
    release = resolve
  })
  input.value = "first-value"
  const first = button.listener()
  assert.equal(button.disabled, true)
  input.value = "new-unsaved-value"
  const second = button.listener()
  release()
  await Promise.all([first, second])
  assert.deepEqual(fixture.saved, [
    { root: "/repo", field: "ANTHROPIC_API_KEY", value: "first-value" },
  ])
  assert.equal(input.value, "new-unsaved-value")
  assert.equal(button.disabled, false)
  console.log(
    "PASS: credential save snapshots input before awaits and rejects duplicate clicks",
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
