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
  // paper-curation native 엔트리가 가진 추가 필드 (보존 대상)
  [extra: string]: unknown
}

/** 제목 정규화 (소문자, 영숫자·한글만) — DOI/key 없는 중복 탐지용. */
function normTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^\w가-힣]/g, "")
}

/** Paper Curio가 생성한 엔트리인지 (vs paper-curation native). */
export function isPaperCurioEntry(e: PaperIndexEntry): boolean {
  return Array.isArray(e.tags) && e.tags.includes("papercurio-generated")
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

/**
 * 기존 엔트리 검색. 우선순위: zotero_item_key → DOI → 정규화 제목.
 * (중복 방지/덮어쓰기 판단용)
 */
export async function findExisting(
  papersDir: string,
  opts: { doi?: string; zoteroKey?: string; title?: string },
): Promise<PaperIndexEntry | undefined> {
  const idx = await readPapersIndex(papersDir)
  const byKey =
    opts.zoteroKey &&
    idx.find((e) => e.zotero_item_key && e.zotero_item_key === opts.zoteroKey)
  if (byKey) return byKey
  const byDoi = opts.doi && idx.find((e) => e.doi && e.doi === opts.doi)
  if (byDoi) return byDoi
  if (opts.title) {
    const nt = normTitle(opts.title)
    if (nt) {
      const byTitle = idx.find((e) => normTitle(e.title) === nt)
      if (byTitle) return byTitle
    }
  }
  return undefined
}

/**
 * 덮어쓰기 시 인덱스 엔트리 머지: 기존 엔트리의 분류·figure 등 풍부한 필드는
 * 보존하고, Paper Curio가 새로 만든 필드(score·essence·review_date·tags 등)만 갱신.
 */
export function mergeEntry(
  existing: PaperIndexEntry | undefined,
  fresh: PaperIndexEntry,
): PaperIndexEntry {
  if (!existing) return fresh
  return {
    ...existing, // classifications, topics, primary_topic, pdf_path, has_figures, text_md_sha256 등 보존
    title: fresh.title,
    authors: fresh.authors,
    date: fresh.date,
    doi: fresh.doi || existing.doi,
    score: fresh.score,
    essence: fresh.essence,
    has_pdf: fresh.has_pdf,
    review_date: fresh.review_date,
    zotero_item_key: fresh.zotero_item_key || existing.zotero_item_key,
    tags: Array.from(
      new Set([...(existing.tags || []), ...fresh.tags]),
    ),
  }
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
