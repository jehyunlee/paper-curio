import { getPrefStr } from "../utils/prefs"
import { joinPath, writeText } from "../utils/fs"
import { fs as log } from "../utils/loggers"

declare const ChromeUtils: any
declare const PathUtils: any

export interface ExtractedFigure {
  n: number
  caption: string
  file: string // figures/figN.png (review.md/index.html 참조 경로)
}

/** Mac 기본 py312 (paper-curation은 py3.12). 사용자는 PYTHON_PATH pref로 변경 가능. */
const DEFAULT_PYTHON = "/opt/homebrew/Caskroom/miniconda/base/envs/py312/bin/python"

function pythonPath(): string {
  return getPrefStr("PYTHON_PATH") || DEFAULT_PYTHON
}

/**
 * paper-curation 원본 함수를 호출하는 얇은 브리지. 임의 로직 없이 원본을 import해 그대로 실행.
 * argv: <pc_root> <subcommand> <args...>
 */
const BRIDGE_PY = `import sys, os, json

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: bridge.py <pc_root> <cmd> ..."}))
        return
    pc_root, cmd = sys.argv[1], sys.argv[2]
    pipeline = os.path.join(pc_root, "pipeline")
    sys.path.insert(0, pipeline)

    if cmd == "figures":
        pdf_path, slug_dir = sys.argv[3], sys.argv[4]
        import run_update_force as r  # 원본 모듈
        figs = r.extract_figures(pdf_path, slug_dir) or []
        print(json.dumps({"figures": figs}))
        return

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

/** 브리지 스크립트를 profile 디렉토리에 1회 기록하고 경로 반환. */
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

async function runPython(args: string[]): Promise<PyResult> {
  const Subprocess = await getSubprocess()
  if (!Subprocess) {
    return { ok: false, stdout: "", stderr: "Subprocess 모듈 접근 불가", code: -1 }
  }
  const py = pythonPath()
  try {
    const proc = await Subprocess.call({
      command: py,
      arguments: args,
      stderr: "pipe",
    })
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

/**
 * paper-curation 원본 extract_figures를 py312 subprocess로 실행 → figures/figN.png 생성.
 * 반환: review.md 임베드용 figure 목록. 실패 시 빈 배열(파이프라인 계속).
 */
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
    // stdout 마지막 JSON 라인 파싱
    const line = r.stdout.trim().split("\n").filter(Boolean).pop() || "{}"
    const parsed = JSON.parse(line)
    const figs: any[] = parsed.figures || []
    const result = figs.map((f) => ({
      n: parseInt(f.name, 10) || 0,
      caption: String(f.caption || ""),
      file: `figures/fig${f.name}.png`,
    }))
    log(`figure 브리지: ${result.length}개 (원본 extract_figures)`)
    return result
  } catch (e) {
    log("extractFiguresViaBridge 예외", e)
    return []
  }
}
