import { defineConfig } from "zotero-plugin-scaffold"
import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill"
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill"
import pkg from "./package.json"
import { resolveTarget } from "./scripts/targets.mjs"

// One source tree, one XPI per supported Zotero major version.
// `ZOTERO_TARGET=9|10` selects the manifest range and the XPI name; the
// orchestrator in scripts/build-targets.mjs runs this config once per target
// and merges the per-target update manifests into build/update.json.
const target = resolveTarget(process.env.ZOTERO_TARGET)

export default defineConfig({
  source: ["src", "addon"],
  dist: target.dist,
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: target.xpiName,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.repository.url,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
      zoteroMinVersion: target.minVersion,
      zoteroMaxVersion: target.maxVersion,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        plugins: [
          NodeModulesPolyfillPlugin(),
          NodeGlobalsPolyfillPlugin({ buffer: true, process: true }),
        ],
        bundle: true,
        target: "firefox115",
        outfile: `${target.dist}/addon/chrome/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },
})
