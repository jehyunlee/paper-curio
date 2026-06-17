/**
 * 파일시스템 래퍼. Zotero 7+/9의 IOUtils·PathUtils (Firefox 표준) 사용.
 * 전역으로 제공되므로 별도 import 불필요.
 */
declare const IOUtils: any
declare const PathUtils: any

export function joinPath(...parts: string[]): string {
  return PathUtils.join(...parts)
}

export function parentPath(p: string): string {
  return PathUtils.parent(p)
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    return await IOUtils.exists(p)
  } catch {
    return false
  }
}

export async function readText(p: string): Promise<string> {
  return await IOUtils.readUTF8(p)
}

export async function writeText(p: string, content: string): Promise<void> {
  await IOUtils.writeUTF8(p, content)
}

export async function makeDir(p: string): Promise<void> {
  await IOUtils.makeDirectory(p, { createAncestors: true, ignoreExisting: true })
}

export async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    if (!(await pathExists(p))) return fallback
    const raw = await readText(p)
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(p: string, data: unknown): Promise<void> {
  await writeText(p, JSON.stringify(data, null, 2))
}

/** 디렉토리 내 항목 이름 목록 (없으면 빈 배열). */
export async function listDir(p: string): Promise<string[]> {
  try {
    if (!(await pathExists(p))) return []
    const children: string[] = await IOUtils.getChildren(p)
    return children.map((c) => PathUtils.filename(c))
  } catch {
    return []
  }
}
