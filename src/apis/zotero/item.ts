/** Zotero item에서 paper-curation review에 필요한 메타데이터 추출. */

export interface PaperMeta {
  key: string
  title: string
  authors: string[]
  date: string // YYYY 또는 YYYY-MM-DD
  doi: string
  arxiv: string
  journal: string
  abstract: string
  url: string
}

export function getSelectedRegularItems(): Zotero.Item[] {
  const pane = Zotero.getActiveZoteroPane()
  const items = pane.getSelectedItems()
  return items.filter((it: Zotero.Item) => it.isRegularItem())
}

function creatorsToNames(item: Zotero.Item): string[] {
  try {
    const creators = item.getCreators() as any[]
    return creators
      .map((c) => {
        const last = c.lastName || ""
        const first = c.firstName || ""
        if (last && first) return `${first} ${last}`
        return last || first || c.name || ""
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function field(item: Zotero.Item, name: string): string {
  try {
    return (item.getField(name as any) as string) || ""
  } catch {
    return ""
  }
}

function extractArxiv(item: Zotero.Item): string {
  const url = field(item, "url")
  const extra = field(item, "extra")
  const m =
    url.match(/arxiv\.org\/abs\/([0-9.]+)/i) ||
    extra.match(/arxiv[:\s]+([0-9.]+)/i)
  return m ? m[1] : ""
}

export function getPaperMeta(item: Zotero.Item): PaperMeta {
  const dateRaw = field(item, "date")
  // Zotero date는 "2025-05-03" 또는 "2025" 등. 연도만이라도 보존.
  const date = dateRaw || ""
  const doi = field(item, "DOI")
  const url = field(item, "url") || (doi ? `https://doi.org/${doi}` : "")
  return {
    key: item.key,
    title: field(item, "title") || item.getDisplayTitle() || "Untitled",
    authors: creatorsToNames(item),
    date,
    doi,
    arxiv: extractArxiv(item),
    journal:
      field(item, "publicationTitle") ||
      field(item, "journalAbbreviation") ||
      field(item, "conferenceName") ||
      "",
    abstract: field(item, "abstractNote"),
    url,
  }
}
