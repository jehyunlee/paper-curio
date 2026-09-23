import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const output = process.argv[2]
if (!output) throw new Error("Output bundle path required")
const registryPath = resolve(
  "../../../../paper-curation/pipeline/features.json",
)
const manifest = JSON.parse(await readFile(registryPath, "utf8"))
await build({
  entryPoints: ["src/views/features.ts"],
  bundle: true,
  format: "iife",
  globalName: "FeatureUI",
  outfile: output,
  plugins: [
    {
      name: "zotero-host-fixture",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          if (!importer) return
          if (path === "../render/featureReport") return
          if (path === "../utils/reviewError")
            return { path: resolve("src/utils/reviewError.ts") }
          if (path === "./locale")
            return { path: "../utils/locale", namespace: "fixture" }
          return { path, namespace: "fixture" }
        })
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
          const modules = {
            "zotero-plugin-toolkit": `export class FilePickerHelper { async open(){return null} }
        export class DialogHelper {
          constructor(){this.window=window;this.cells=[]}
          addCell(_,__,cell){this.cells.push(cell)}
          setDialogData(data){this.data=data}
          open(){ for(const cell of this.cells){const div=document.createElement('div');div.id=cell.id;document.body.append(div)};this.data.loadCallback() }
        }`,
            "../extract/pybridge": `const manifest=${JSON.stringify(manifest)};
          export async function featureViaBridge(_,request,execute){
            if(!request)return manifest;
            window.fixtureCalls.push({request:structuredClone(request),execute:!!execute});
            if(!execute && window.planBarrier) await window.planBarrier;
            return {schema_version:1,feature:request.feature,status:execute?'completed':'ready',provider:request.provider,steps:['selected-only'],outputs:execute?['fixture-result']:[],cost:{status:'none'}};
          }`,
            "../core/pc-discovery":
              "export const resolveOutputTarget=async()=>({root:'/fixture',papersDir:'/fixture/docs/papers'})",
            "../apis/zotero/item":
              "export const getSelectedRegularItems=()=>window.fixtureSelectedItems || [{key:'ABCD1234',getDisplayTitle:()=> 'Evidence source'}]; export const getPaperMeta=()=>({key:'ABCD1234',title:'Evidence source',doi:''})",
            "../core/papers-index":
              "export const findExisting=async()=>({slug:'001_Evidence',primary_topic:'demo'})",
            "../extract/pdfjs":
              "export const pdfFilePath=async()=>'/fixture/source.pdf'",
            "../extract/text":
              "export const extractTextCached=async()=>({text:'The measured sample contains 12 records. Evidence is limited to this observation.'})",
            "../utils/locale": "export const getString=(id)=>id",
            "../utils/fs":
              "export const writeText=async(path,text)=>{window.fixtureExport={path,text}}",
            "../core/pipeline":
              "import {ReviewTaskError} from '../utils/reviewError'; export const processItem=async(item)=>{(window.reviewAttemptKeys ||= []).push(item.key);if(window.fixtureReviewErrorCode)throw new ReviewTaskError(window.fixtureReviewErrorCode);return {status:'completed'}}",
          }
          if (!(path in modules)) throw new Error("Unmocked module " + path)
          return { loader: "js", contents: modules[path] }
        })
      },
    },
  ],
})
console.log(output)
