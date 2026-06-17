import { joinPath, readJson, writeJson, listDir } from "../utils/fs"

export interface PaperIndexEntry {
  slug: string
  title: string
  authors: string[]
  date: string
  doi: string
  topics: string[]
  primary_topic: string
  classifications: Record<string, unknown>
  score: number
  essence: string
  has_pdf: boolean
  has_figures: boolean
  review_date: string
  zotero_item_key: string
  tags: string[]
}

function indexPath(papersDir: string): string {
  return joinPath(papersDir, "_papers_index.json")
}

export async function readPapersIndex(
  papersDir: string,
): Promise<PaperIndexEntry[]> {
  const data = await readJson<PaperIndexEntry[]>(indexPath(papersDir), [])
  return Array.isArray(data) ? data : []
}

/**
 * 다음 번호 계산. _papers_index.json의 slug prefix 최대값 +1,
 * 인덱스가 비면 papersDir 내 폴더명을 스캔해서 보강.
 */
export async function nextNumber(papersDir: string): Promise<number> {
  let max = 0
  const idx = await readPapersIndex(papersDir)
  for (const e of idx) {
    const n = parseInt((e.slug || "").split("_")[0], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  // 폴더 스캔으로 보강 (인덱스 누락 케이스)
  const dirs = await listDir(papersDir)
  for (const d of dirs) {
    const n = parseInt(d.split("_")[0], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

/** DOI 또는 slug 기준 기존 엔트리 검색 (중복 방지/덮어쓰기 판단용). */
export async function findExisting(
  papersDir: string,
  opts: { doi?: string; zoteroKey?: string },
): Promise<PaperIndexEntry | undefined> {
  const idx = await readPapersIndex(papersDir)
  return idx.find(
    (e) =>
      (opts.doi && e.doi && e.doi === opts.doi) ||
      (opts.zoteroKey && e.zotero_item_key === opts.zoteroKey),
  )
}

/** 엔트리 추가/갱신 (slug·doi·zoteroKey 동일 항목은 교체). */
export async function upsertEntry(
  papersDir: string,
  entry: PaperIndexEntry,
): Promise<void> {
  const idx = await readPapersIndex(papersDir)
  const filtered = idx.filter(
    (e) =>
      e.slug !== entry.slug &&
      !(entry.doi && e.doi === entry.doi) &&
      !(entry.zotero_item_key && e.zotero_item_key === entry.zotero_item_key),
  )
  filtered.push(entry)
  await writeJson(indexPath(papersDir), filtered)
}
