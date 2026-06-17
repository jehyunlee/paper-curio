import { getPrefStr } from "../utils/prefs"
import { getAnthropicKey } from "../utils/env"
import { joinPath, writeText } from "../utils/fs"
import { fs as log } from "../utils/loggers"
import type { PaperMeta } from "../apis/zotero/item"

declare const ChromeUtils: any
declare const PathUtils: any

export interface ExtractedFigure {
  n: number
  caption: string
  file: string // figures/figN.png
}

const DEFAULT_PYTHON = "/opt/homebrew/Caskroom/miniconda/base/envs/py312/bin/python"

function pythonPath(): string {
  return getPrefStr("PYTHON_PATH") || DEFAULT_PYTHON
}

/**
 * paper-curation 원본 함수를 호출하는 얇은 브리지. 임의 로직 없이 원본을 import해 그대로 실행.
 * argv: <pc_root> <subcommand> <args...>
 *  - figures <pdf> <slug_dir>   → run_update_force.extract_figures (+ raw를 .pc_figs.json에 보관)
 *  - text    <pdf> <slug_dir>   → run_update_force.extract_text
 *  - review  <slug_dir> <meta_json> → _to_item(meta) + run_update_force.write_review (text.md·figures 사용)
 */
const BRIDGE_PY = `import sys, os, json

def _to_item(meta):
    # plugin PaperMeta(JSON) → write_review가 읽는 Zotero item dict
    creators = []
    for name in meta.get("authors", []):
        parts = str(name).split()
        if len(parts) >= 2:
            creators.append({"firstName": " ".join(parts[:-1]), "lastName": parts[-1]})
        elif parts:
            creators.append({"firstName": "", "lastName": parts[0]})
    return {
        "title": meta.get("title", ""),
        "creators": creators,
        "date": meta.get("date", ""),
        "DOI": meta.get("doi", ""),
        "abstractNote": meta.get("abstract", ""),
        "url": meta.get("url", ""),
        "key": meta.get("key", ""),
    }

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage"})); return
    pc_root, cmd = sys.argv[1], sys.argv[2]
    sys.path.insert(0, os.path.join(pc_root, "pipeline"))

    if cmd == "figures":
        pdf_path, slug_dir = sys.argv[3], sys.argv[4]
        import run_update_force as r
        figs = r.extract_figures(pdf_path, slug_dir) or []
        try:
            json.dump(figs, open(os.path.join(slug_dir, ".pc_figs.json"), "w"))
        except Exception:
            pass
        print(json.dumps({"figures": figs})); return

    if cmd == "text":
        pdf_path, slug_dir = sys.argv[3], sys.argv[4]
        import run_update_force as r
        r.extract_text(pdf_path, slug_dir)
        p = os.path.join(slug_dir, "text.md")
        print(json.dumps({"ok": os.path.exists(p) and os.path.getsize(p) >= 100})); return

    if cmd == "review":
        slug_dir, meta_json = sys.argv[3], sys.argv[4]
        import run_update_force as r
        meta = json.load(open(meta_json, encoding="utf-8"))
        item = _to_item(meta)
        figs = []
        fp = os.path.join(slug_dir, ".pc_figs.json")
        if os.path.exists(fp):
            try: figs = json.load(open(fp, encoding="utf-8"))
            except Exception: figs = []
        r.write_review(item, slug_dir, figs)
        p = os.path.join(slug_dir, "review.md")
        print(json.dumps({"ok": os.path.exists(p) and os.path.getsize(p) >= 200})); return

    if cmd == "originality":
        # topic_modeling.py 경로 그대로: abstract 창 → 전체 → "title. essence" (LLM 없음, 헤더 없음)
        slug_dir, meta_json = sys.argv[3], sys.argv[4]
        from lib.originality_extractor import _extract_rule_based, load_triggers
        meta = json.load(open(meta_json, encoding="utf-8"))
        tp = os.path.join(slug_dir, "text.md")
        full = open(tp, encoding="utf-8").read() if os.path.exists(tp) else ""
        triggers = load_triggers()
        abs_pos = full.lower().find("abstract")
        window = full[abs_pos:abs_pos + 1000] if abs_pos >= 0 else full[:1000]
        orig = _extract_rule_based(window, triggers) or _extract_rule_based(full, triggers)
        if not orig:
            orig = ("%s. %s" % (meta.get("title", ""), meta.get("essence", ""))).strip()
        open(os.path.join(slug_dir, "originality.md"), "w", encoding="utf-8").write(orig)
        print(json.dumps({"ok": bool(orig)})); return

    print(json.dumps({"error": "unknown cmd: %s" % cmd}))

if __name__ == "__main__":
    main()
`

let _subprocess: any

async function getSubprocess(): Promise<any | null> {
  if (_subprocess !== undefined) return _subprocess
  try {
    const mod = await ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    )
    if (mod?.Subprocess) {
      _subprocess = mod.Subprocess
      return _subprocess
    }
  } catch {
    /* try jsm */
  }
  try {
    const mod = (ChromeUtils as any).import(
      "resource://gre/modules/Subprocess.jsm",
    )
    if (mod?.Subprocess) {
      _subprocess = mod.Subprocess
      return _subprocess
    }
  } catch {
    /* none */
  }
  _subprocess = null
  return null
}

async function ensureBridgeScript(): Promise<string> {
  const dir = joinPath(PathUtils.profileDir, "papercurio")
  const path = joinPath(dir, "pc_bridge.py")
  await writeText(path, BRIDGE_PY)
  return path
}

interface PyResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number
}

async function runPython(
  args: string[],
  env?: Record<string, string>,
): Promise<PyResult> {
  const Subprocess = await getSubprocess()
  if (!Subprocess) {
    return { ok: false, stdout: "", stderr: "Subprocess 모듈 접근 불가", code: -1 }
  }
  try {
    const opts: any = { command: pythonPath(), arguments: args, stderr: "pipe" }
    if (env && Object.keys(env).length) {
      opts.environment = env
      opts.environmentAppend = true // 기존 env(PATH 등) 보존하며 추가
    }
    const proc = await Subprocess.call(opts)
    const readAll = async (stream: any) => {
      let s = ""
      let c: string | null
      while ((c = await stream.readString())) s += c
      return s
    }
    const [stdout, stderr, status] = await Promise.all([
      readAll(proc.stdout),
      readAll(proc.stderr),
      proc.wait(),
    ])
    return { ok: status.exitCode === 0, stdout, stderr, code: status.exitCode }
  } catch (e) {
    return { ok: false, stdout: "", stderr: String(e), code: -1 }
  }
}

function lastJson(stdout: string): any {
  try {
    return JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() || "{}")
  } catch {
    return {}
  }
}

/** 원본 extract_figures → figures/figN.png. 실패 시 빈 배열. */
export async function extractFiguresViaBridge(
  pdfPath: string,
  slugDir: string,
  pcRoot: string,
): Promise<ExtractedFigure[]> {
  if (!pdfPath || !pcRoot) return []
  try {
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "figures", pdfPath, slugDir])
    if (!r.ok) {
      log("figure 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 300))
      return []
    }
    const figs: any[] = lastJson(r.stdout).figures || []
    return figs.map((f) => ({
      n: parseInt(f.name, 10) || 0,
      caption: String(f.caption || ""),
      file: `figures/fig${f.name}.png`,
    }))
  } catch (e) {
    log("extractFiguresViaBridge 예외", e)
    return []
  }
}

/** 원본 extract_text → text.md. 성공 여부 반환. */
export async function extractTextViaBridge(
  pdfPath: string,
  slugDir: string,
  pcRoot: string,
): Promise<boolean> {
  if (!pdfPath || !pcRoot) return false
  try {
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "text", pdfPath, slugDir])
    if (!r.ok) {
      log("text 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 300))
      return false
    }
    return !!lastJson(r.stdout).ok
  } catch (e) {
    log("extractTextViaBridge 예외", e)
    return false
  }
}

/**
 * 원본 write_review로 review.md 생성. ANTHROPIC_API_KEY를 env로 주입.
 * 키 없거나 실패 시 false (호출부가 TS 폴백).
 */
export async function writeReviewViaBridge(
  slugDir: string,
  meta: PaperMeta,
  pcRoot: string,
): Promise<boolean> {
  const key = getAnthropicKey()
  if (!key || !pcRoot) return false
  try {
    const metaPath = joinPath(slugDir, "_pc_meta.json")
    await writeText(metaPath, JSON.stringify(meta))
    const script = await ensureBridgeScript()
    const r = await runPython(
      [script, pcRoot, "review", slugDir, metaPath],
      { ANTHROPIC_API_KEY: key },
    )
    if (!r.ok) {
      log("review 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 300))
      return false
    }
    return !!lastJson(r.stdout).ok
  } catch (e) {
    log("writeReviewViaBridge 예외", e)
    return false
  }
}

/**
 * 원본 originality 경로(_extract_rule_based → "title. essence")로 originality.md 생성.
 * LLM 없음 → 키 불필요. text.md가 먼저 있어야 함. 실패 시 false.
 */
export async function extractOriginalityViaBridge(
  slugDir: string,
  title: string,
  essence: string,
  pcRoot: string,
): Promise<boolean> {
  if (!pcRoot) return false
  try {
    const metaPath = joinPath(slugDir, "_pc_orig.json")
    await writeText(metaPath, JSON.stringify({ title, essence }))
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "originality", slugDir, metaPath])
    if (!r.ok) {
      log("originality 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return false
    }
    return !!lastJson(r.stdout).ok
  } catch (e) {
    log("extractOriginalityViaBridge 예외", e)
    return false
  }
}
