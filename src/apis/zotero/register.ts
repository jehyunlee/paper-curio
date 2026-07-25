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
  /** 소스가 준 완전한 날짜(YYYY-MM-DD). 없으면 year 로 폴백된 값. */
  date?: string
  year?: string
  volume?: string
  issue?: string
  pages?: string
  issn?: string
  publisher?: string
  language?: string
  /** 원 소스의 문헌 유형 (journal-article / preprint / posted-content 등). */
  item_type?: string
  authors?: string[]
  abstract?: string
  /** 대표 피인용수. 소스마다 세는 우주가 달라 출처·시점과 함께 기록한다. */
  citation_count?: string
  citation_source?: string
  citation_asof?: string
  /** OpenAlex 연차보정 백분위 (0~1) — 같은 해·분야 대비 상위 몇 %. */
  citation_percentile?: string
  /** 소스별 원값 {openalex: 52, crossref: 47, s2: 104} */
  citations_by_source?: Record<string, number>
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

/**
 * 원 소스의 문헌 유형 → Zotero 아이템 타입.
 *
 * Crossref(`journal-article`, `posted-content`), OpenAlex(`article`,
 * `preprint`), S2(`JournalArticle`, `Conference`) 가 각자 다른 어휘를 쓰므로
 * 소문자로 눌러 부분 문자열로 판정한다. 모르면 journalArticle 로 둔다.
 */
function zoteroItemType(raw?: string): string {
  const t = (raw || "").toLowerCase()
  if (!t) return "journalArticle"
  if (t.includes("posted-content") || t.includes("preprint")) return "preprint"
  if (t.includes("proceedings") || t.includes("conference")) return "conferencePaper"
  if (t.includes("book-chapter") || t.includes("bookchapter")) return "bookSection"
  if (t.includes("dissertation") || t.includes("thesis")) return "thesis"
  if (t.includes("report")) return "report"
  if (t.includes("dataset")) return "dataset"
  return "journalArticle"
}

/**
 * 아이템 타입에 없는 필드면 조용히 건너뛴다.
 *
 * `volume`/`ISSN` 은 journalArticle 에는 있지만 preprint 에는 없어, 그냥
 * `setField` 하면 예외가 나며 등록 자체가 실패한다. 서지 한 칸 때문에 논문을
 * 통째로 잃지 않도록 막는다.
 */
function setIfValid(item: any, field: string, value?: string): void {
  const v = (value || "").trim()
  if (!v) return
  try {
    item.setField(field, v)
  } catch {
    /* 이 아이템 타입에 없는 필드 — 무시 */
  }
}

/**
 * 피인용수를 Extra 줄로 만든다.
 *
 * Zotero 스키마에는 피인용수 필드가 없어 Extra 에 적는 게 관례다
 * (Zotero Citation Counts Manager 등이 쓰는 방식이라 검색·정렬에 걸린다).
 *
 * **반드시 출처와 시점을 함께 적는다.** 소스마다 세는 우주가 다르고(Scopus 는
 * Scopus 색인만, S2 는 프리프린트까지) 숫자는 시간이 지나면 낡는다. 실측에서
 * 같은 논문이 Crossref 47 / OpenAlex 52 / S2 104 로 갈렸다 — 출처 없는 숫자는
 * 나중에 해석이 불가능하다.
 */
function citationExtraLines(p: CitingPaper): string[] {
  const lines: string[] = []
  const n = (p.citation_count || "").trim()
  if (n && n !== "0") {
    const src = (p.citation_source || "").trim()
    const asof = (p.citation_asof || "").trim()
    const tag = [src, asof].filter(Boolean).join(", ")
    lines.push(tag ? `Citations: ${n} (${tag})` : `Citations: ${n}`)
  }

  // 연차보정 백분위 — 절대 피인용수는 분야·연차 편차가 커서 단독으로는
  // 오독하기 쉽다. "같은 해·분야 대비 상위 몇 %" 가 해석이 바로 된다.
  const pctRaw = parseFloat(p.citation_percentile || "")
  if (!Number.isNaN(pctRaw)) {
    const pct = pctRaw <= 1 ? pctRaw * 100 : pctRaw
    lines.push(`Citation percentile: ${pct.toFixed(1)} (OpenAlex, 연차보정)`)
  }

  // 소스별 원값 — 나중에 "이 숫자 뭐 기준이냐" 를 되묻지 않게 남긴다.
  const by = p.citations_by_source || {}
  const parts = Object.entries(by).map(([k, v]) => `${k} ${v}`)
  if (parts.length > 1) lines.push(`Citations by source: ${parts.join(" / ")}`)

  return lines
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
 * @param onProgress  (done, total) 진행 콜백
 *
 * NOTE: **컬렉션을 지정하지 않는다.** 인용논문은 내가 고른 논문이 아니라 검색
 * 결과라, 원논문이 속한 컬렉션(예: "AI Literacy")에 섞이면 그 컬렉션의 의미가
 * 오염된다. 라이브러리 루트(Unfiled)에 두고 분류는 사용자가 판단한다.
 */
export async function registerCitingPapers(
  papers: CitingPaper[],
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
      const item = new (Zotero as any).Item(zoteroItemType(p.item_type))
      item.libraryID = libraryID
      setIfValid(item, "title", title)
      setIfValid(item, "DOI", doi)
      setIfValid(item, "publicationTitle", p.journal)
      // 완전한 날짜를 우선 쓴다 — year 만 넣으면 Zotero Date 가 "2025" 로 남는다.
      setIfValid(item, "date", (p.date || p.year || "").trim())
      setIfValid(item, "volume", p.volume)
      setIfValid(item, "issue", p.issue)
      setIfValid(item, "pages", p.pages)
      setIfValid(item, "ISSN", p.issn)
      setIfValid(item, "language", p.language)
      setIfValid(item, "abstractNote", p.abstract)
      setIfValid(item, "url", p.url || (aid ? `https://arxiv.org/abs/${aid}` : ""))
      // preprint 아이템 타입에만 있는 필드 — 없으면 조용히 무시된다.
      if (aid) {
        setIfValid(item, "repository", "arXiv")
        setIfValid(item, "archiveID", `arXiv:${aid}`)
      }

      // 아이템 타입에 해당 필드가 없을 때를 대비해 Extra 에도 남긴다.
      // (journalArticle 에는 publisher 필드가 없다.)
      const extras: string[] = []
      if (aid) extras.push(`arXiv:${aid}`)
      if (p.publisher) extras.push(`Publisher: ${p.publisher}`)
      const cites = citationExtraLines(p)
      if (cites.length) extras.push(...cites)
      if (p.source) extras.push(`citedby-source: ${p.source}`)
      if (extras.length) setIfValid(item, "extra", extras.join("\n"))

      if (p.authors?.length) item.setCreators(p.authors.map(toCreator))

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
