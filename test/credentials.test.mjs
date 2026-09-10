import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const dir = await mkdtemp(join(tmpdir(), "pc-credentials-"))
try {
  await build({
    entryPoints: ["src/utils/env.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "env.mjs"),
    plugins: [
      {
        name: "credential-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /prefs$/ }, () => ({
            path: "prefs",
            namespace: "mock",
          }))
          builder.onResolve({ filter: /pybridge$/ }, () => ({
            path: "bridge",
            namespace: "mock",
          }))
          builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
            loader: "js",
            contents:
              path === "prefs"
                ? `
        export const getPrefStr = (name) => globalThis.state.prefs[name] || '';
        export const setPref = (name,value) => { globalThis.state.writes.push([name,value]); globalThis.state.prefs[name] = value; };
        export const clearPref = (name) => { delete globalThis.state.prefs[name] };
      `
                : `
        export const credentialViaBridge = async (_, op, provider, value) => {
          globalThis.state.calls.push({op,provider,value});
          if (globalThis.state.fail) throw new Error('OS keyring unavailable');
          if (op === 'write') globalThis.state.store[provider] = value;
          if (op === 'delete') delete globalThis.state.store[provider];
          return {reference:'credential:'+provider,value:globalThis.state.store[provider] || ''};
        };
      `,
          }))
        },
      },
    ],
  })
  globalThis.state = {
    prefs: { ANTHROPIC_API_KEY: "old-unused-secret" },
    writes: [],
    calls: [],
    store: {},
    env: {},
  }
  globalThis.Components = {
    classes: {
      "@mozilla.org/process/environment;1": {
        getService: () => ({ get: (name) => state.env[name] || "" }),
      },
    },
    interfaces: { nsIEnvironment: {} },
  }
  const api = await import(join(dir, "env.mjs"))
  assert.equal(
    api.getAnthropicKey(),
    "",
    "plaintext preferences must never resolve as active credentials",
  )
  await api.saveSharedCredential("/pc", "ANTHROPIC_API_KEY", "OS-SECRET")
  assert.equal(api.getAnthropicKey(), "OS-SECRET")
  assert.equal(state.prefs.ANTHROPIC_API_KEY, undefined)
  assert.deepEqual(state.writes, [
    ["ANTHROPIC_API_KEY_CREDENTIAL_REF", "credential:anthropic"],
  ])
  state.env.ANTHROPIC_API_KEY = "ENV-SECRET"
  assert.equal(api.getAnthropicKey(), "ENV-SECRET")
  assert.equal(
    state.writes.some(([, value]) => value.includes("SECRET")),
    false,
  )
  state.env = {}
  await api.loadSharedCredentials("/pc")
  assert.equal(api.getAnthropicKey(), "OS-SECRET")
  state.fail = true
  await assert.rejects(
    api.saveSharedCredential("/pc", "OPENAI_API_KEY", "NEVER-STORE"),
    /unavailable/,
  )
  assert.equal(state.prefs.OPENAI_API_KEY_CREDENTIAL_REF, undefined)
  assert.equal(api.getOpenAIKey(), "")
  state.fail = false
  await api.saveSharedCredential("/pc", "ANTHROPIC_API_KEY", "")
  assert.equal(api.getAnthropicKey(), "")
  assert.equal(state.prefs.ANTHROPIC_API_KEY_CREDENTIAL_REF, undefined)
  await assert.rejects(
    api.saveSharedCredential("/pc", "UNSUPPORTED", "bad"),
    /Unsupported/,
  )
  console.log(
    "PASS: OS-only credential persistence, env precedence, ref-only settings, no plaintext fallback, exact deletion",
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}
