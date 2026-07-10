import { getPrefStr } from "../utils/prefs"
import { getOSEnv } from "../utils/env"
import { joinPath, pathExists, makeDir } from "../utils/fs"
import { discovery as log } from "../utils/loggers"

export interface OutputTarget {
  /** review 폴더들이 들어갈 papers 디렉토리 (…/docs/papers). */
  papersDir: string
  /** paper-curation 루트 (fallback이면 사용자 지정 루트). */
  root: string
  source: "pref" | "env" | "autodetect" | "fallback"
}

/** paper-curation 루트인지 검증: docs/papers 존재. */
async function isValidRoot(root: string): Promise<boolean> {
  if (!root) return false
  return await pathExists(joinPath(root, "docs", "papers"))
}

function homeDir(): string {
  return getOSEnv("HOME") || ""
}

function candidatePaths(): string[] {
  const home = homeDir()
  if (!home) return []
  const docs = joinPath(home, "Documents")
  const note = joinPath(docs, "내노트북")
  return [
    joinPath(note, "paper-curation"),
    joinPath(docs, "paper-curation"),
    joinPath(home, "paper-curation"),
    joinPath(home, "dev", "paper-curation"),
    joinPath(home, "code", "paper-curation"),
    joinPath(home, "work", "paper-curation"),
    joinPath(note, "01_Work", "01_Devs", "paper-curation"),
    joinPath(note, "01_Work", "01_Devs", "AX", "paper-curation"),
  ]
}

/**
 * 출력 디렉토리 결정.
 * 1) pref PAPER_CURATION_ROOT  2) env PAPER_CURATION_DIR/ROOT
 * 3) 후보 경로 자동 탐색  4) pref OUTPUT_FALLBACK_DIR (없으면 생성)
 */
export async function resolveOutputTarget(): Promise<OutputTarget> {
  // 1) Pref
  const prefRoot = getPrefStr("PAPER_CURATION_ROOT")
  if (prefRoot && (await isValidRoot(prefRoot))) {
    log("source=pref", prefRoot)
    return {
      papersDir: joinPath(prefRoot, "docs", "papers"),
      root: prefRoot,
      source: "pref",
    }
  }

  // 2) Env
  const envRoot =
    getOSEnv("PAPER_CURATION_DIR") || getOSEnv("PAPER_CURATION_ROOT")
  if (envRoot && (await isValidRoot(envRoot))) {
    log("source=env", envRoot)
    return {
      papersDir: joinPath(envRoot, "docs", "papers"),
      root: envRoot,
      source: "env",
    }
  }

  // 3) Autodetect
  for (const c of candidatePaths()) {
    if (await isValidRoot(c)) {
      log("source=autodetect", c)
      return {
        papersDir: joinPath(c, "docs", "papers"),
        root: c,
        source: "autodetect",
      }
    }
  }

  // 4) Fallback — 사용자 지정 경로에 docs/papers 구조 생성
  const fallback = getPrefStr("OUTPUT_FALLBACK_DIR")
  if (fallback) {
    const papersDir = joinPath(fallback, "docs", "papers")
    await makeDir(papersDir)
    log("source=fallback", papersDir)
    return { papersDir, root: fallback, source: "fallback" }
  }

  throw new Error(
    "paper-curation 경로를 찾을 수 없습니다. Settings → Paper Curio에서 " +
      "paper-curation 경로 또는 fallback 출력 경로를 지정하세요.",
  )
}

/**
 * resolveOutputTarget의 non-throwing 버전. 코퍼스(또는 fallback) 경로가 없으면
 * null — 경량(light) 모드. 채팅 등 core 기능은 null이어도 동작해야 한다.
 */
export async function tryResolveOutputTarget(): Promise<OutputTarget | null> {
  try {
    return await resolveOutputTarget()
  } catch {
    return null
  }
}
