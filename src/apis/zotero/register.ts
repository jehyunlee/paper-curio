/**
 * 인용논문(citedby 결과)을 Zotero 라이브러리에 일괄 등록.
 *
 * citedby 는 **코퍼스 밖** 논문을 찾아낸다 — paper-curation 의 "같이 보면 좋은
 * 논문"(SPECTER2 유사도, 코퍼스 내부)이 구조적으로 못 잡는 축이다. 그래서
 * 분석 결과를 Zotero 에 넣어 두면 기존 리뷰 파이프라인
 * (`run_full --mode curate --source zotero`)으로 그대로 흘러간다.
 *
 * 중복 방지: DOI → arXiv ID → 정규화 제목 순으로 라이브러리를 조회해 이미
 * 있으면 건너뛴다. 사용자 라이브러리를 더럽히지 않는 게 최우선이라, 애매하면
 * 등록하지 않고 skip 으로 센다.
 */
import { zotero as log } from "../../utils/loggers"

export interface CitingPaper {
  title: string
  doi?: string
  arxiv_id?: string
  url?: string
  journal?: string
  year?: string
  authors?: string[]
  abstract?: string
  citation_count?: string
  source?: string
  originality?: string
  topic_reason?: string
}

export interface RegisterResult {
  added: number
  skipped: number
  failed: number
  /** 새로 만든 항목 — PDF 첨부 대상. 중복으로 건너뛴 항목은 포함하지 않는다. */
  items: Zotero.Item[]
}

export interface PdfResult {
  /** OA PDF 를 찾아 첨부한 건수 */
  attached: number
  /** 유료/미공개라 찾지 못한 건수 (실패가 아니라 정상적인 결과) */
  missing: number
  /** 네트워크·파싱 오류 */
  failed: number
}

/** 제목 비교 키 — 출처별 구두점·대소문자 차이를 흡수 (paper-curation 과 동일 규칙). */
function titleKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 60)
}

function normalizeDoi(doi: string): string {
  return (doi || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
}

/** 저자 문자열 → Zotero creator. "Lastname, F." 와 "First Last" 를 모두 흡수. */
function toCreator(name: string): {
  firstName: string
  lastName: string
  creatorType: string
} {
  const n = name.trim()
  if (n.includes(",")) {
    const [last, first] = n.split(",", 2)
    return {
      lastName: last.trim(),
      firstName: (first || "").trim(),
      creatorType: "author",
    }
  }
  const parts = n.split(/\s+/)
  if (parts.length === 1) {
    return { lastName: n, firstName: "", creatorType: "author" }
  }
  return {
    lastName: parts[parts.length - 1],
    firstName: parts.slice(0, -1).join(" "),
    creatorType: "author",
  }
}

/** 라이브러리에서 DOI 로 기존 항목을 찾는다. */
async function findByDoi(libraryID: number, doi: string): Promise<boolean> {
  if (!doi) return false
  try {
    const s = new (Zotero as any).Search()
    s.libraryID = libraryID
    s.addCondition("DOI", "is", doi)
    const ids = await s.search()
    return Array.isArray(ids) && ids.length > 0
  } catch (e) {
    log("DOI 조회 실패", e)
    return false
  }
}

/**
 * 라이브러리 전체의 (DOI, arXiv, 제목) 키 집합을 한 번에 만든다.
 *
 * 논문 수백 편을 편당 Search 로 조회하면 느리다. 한 번 훑어 메모리에 올리고
 * 대조하는 편이 훨씬 빠르고, 등록 중 추가되는 항목은 호출부가 로컬 집합에
 * 반영한다.
 */
async function buildExistingKeys(libraryID: number): Promise<{
  dois: Set<string>
  titles: Set<string>
  arxiv: Set<string>
}> {
  const dois = new Set<string>()
  const titles = new Set<string>()
  const arxiv = new Set<string>()
  try {
    const items: any[] = await (Zotero as any).Items.getAll(libraryID, true)
    for (const it of items) {
      try {
        if (!it.isRegularItem?.()) continue
        const doi = normalizeDoi(String(it.getField("DOI") || ""))
        if (doi) dois.add(doi)
        const t = titleKey(String(it.getField("title") || ""))
        if (t) titles.add(t)
        const extra = String(it.getField("extra") || "")
        const url = String(it.getField("url") || "")
        const m =
          url.match(/arxiv\.org\/abs\/([0-9.]+)/i) ||
          extra.match(/arxiv[:\s]+([0-9.]+)/i)
        if (m) arxiv.add(m[1])
      } catch {
        /* 항목 하나 실패가 전체를 막지 않게 */
      }
    }
  } catch (e) {
    log("라이브러리 인덱싱 실패 — DOI 개별 조회로 폴백", e)
  }
  return { dois, titles, arxiv }
}

/**
 * 인용논문을 Zotero 에 등록한다.
 *
 * @param papers    citedby 가 낸 papers JSON (서지 필드만 추려진 형태)
 * @param collectionID 넣을 컬렉션. 없으면 라이브러리 루트.
 * @param onProgress  (done, total) 진행 콜백
 */
export async function registerCitingPapers(
  papers: CitingPaper[],
  collectionID?: number,
  onProgress?: (done: number, total: number) => void,
): Promise<RegisterResult> {
  const libraryID = (Zotero as any).Libraries.userLibraryID
  const existing = await buildExistingKeys(libraryID)
  const indexed = existing.dois.size > 0 || existing.titles.size > 0

  const created: Zotero.Item[] = []
  let added = 0
  let skipped = 0
  let failed = 0
  const total = papers.length

  for (let i = 0; i < total; i++) {
    const p = papers[i]
    onProgress?.(i + 1, total)

    const title = (p.title || "").trim()
    if (!title) {
      skipped++
      continue
    }

    const doi = normalizeDoi(p.doi || "")
    const tkey = titleKey(title)
    const aid = (p.arxiv_id || "").trim()

    // 중복 판정 — 인덱싱이 됐으면 메모리 대조, 실패했으면 DOI 개별 조회.
    let duplicate = false
    if (indexed) {
      duplicate =
        (doi !== "" && existing.dois.has(doi)) ||
        (aid !== "" && existing.arxiv.has(aid)) ||
        (tkey !== "" && existing.titles.has(tkey))
    } else if (doi) {
      duplicate = await findByDoi(libraryID, doi)
    }
    if (duplicate) {
      skipped++
      continue
    }

    try {
      const item = new (Zotero as any).Item("journalArticle")
      item.libraryID = libraryID
      item.setField("title", title)
      if (doi) item.setField("DOI", doi)
      if (p.journal) item.setField("publicationTitle", p.journal)
      if (p.year) item.setField("date", p.year)
      if (p.abstract) item.setField("abstractNote", p.abstract)
      if (p.url) item.setField("url", p.url)
      else if (aid) item.setField("url", `https://arxiv.org/abs/${aid}`)

      // arXiv id 는 표준 필드가 없어 Extra 에 관례대로 넣는다.
      const extras: string[] = []
      if (aid) extras.push(`arXiv:${aid}`)
      if (p.source) extras.push(`citedby-source: ${p.source}`)
      if (extras.length) item.setField("extra", extras.join("\n"))

      if (p.authors?.length) item.setCreators(p.authors.map(toCreator))
      if (collectionID) item.addToCollection(collectionID)

      await item.saveTx()

      // 다음 논문이 같은 것을 다시 넣지 않도록 로컬 집합 갱신
      if (doi) existing.dois.add(doi)
      if (tkey) existing.titles.add(tkey)
      if (aid) existing.arxiv.add(aid)
      created.push(item)
      added++
    } catch (e) {
      log("등록 실패", title.slice(0, 60), e)
      failed++
    }
  }

  log(`citedby 등록 완료 — 추가 ${added} / 중복 ${skipped} / 실패 ${failed}`)
  return { added, skipped, failed, items: created }
}

/**
 * 등록한 항목에 OA PDF 를 찾아 붙인다 — Zotero 자체 "Find Available PDF" 사용.
 *
 * `Zotero.Attachments.addAvailablePDF()` 가 DOI → URL → Unpaywall(OA) 순으로
 * 해석기를 돌린다. 우리가 Unpaywall 을 다시 구현할 이유가 없고, 사용자가 설정한
 * 기관 프록시·커스텀 해석기까지 그대로 탄다.
 *
 * PDF 를 못 찾는 건 **실패가 아니다** — 유료 논문이면 정상적인 결과라
 * `missing` 으로 따로 센다.
 *
 * 발행사 서버를 두드리므로 항목 사이에 지연을 둔다 (Zotero 의 배치 API 도
 * 같은 도메인 요청에 1초 지연을 넣는다).
 */
export async function attachAvailablePdfs(
  items: Zotero.Item[],
  onProgress?: (done: number, total: number, attached: number) => void,
  delayMs = 1000,
): Promise<PdfResult> {
  const A = (Zotero as any).Attachments
  let attached = 0
  let missing = 0
  let failed = 0
  const total = items.length

  for (let i = 0; i < total; i++) {
    const item = items[i]
    try {
      // DOI/URL 이 전혀 없으면 해석기가 시도할 것도 없다.
      if (A.canFindPDFForItem && !A.canFindPDFForItem(item)) {
        missing++
      } else {
        const att = await A.addAvailablePDF(item)
        if (att) attached++
        else missing++
      }
    } catch (e) {
      log("PDF 첨부 실패", String(item.getField("title") || "").slice(0, 60), e)
      failed++
    }
    onProgress?.(i + 1, total, attached)
    if (delayMs > 0 && i < total - 1) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  log(`citedby PDF — 첨부 ${attached} / 없음 ${missing} / 오류 ${failed}`)
  return { attached, missing, failed }
}
