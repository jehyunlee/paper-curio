/**
 * 이미 저장돼 있는 연결(related papers)을 읽는다. 새 연결을 생성하지 않는다.
 * 소스: 각 논문 review.md의 "## Related Papers" 섹션(파이프라인이 주입해 둔 것).
 * 연결된 논문의 요약은 그 논문 review.md 본문(essence/originality/limitation 등)에서 얻는다.
 */
import { joinPath, pathExists, readText } from "../utils/fs"

export interface RelatedLink {
  slug: string
  /** review.md에 적힌 관계 라벨(예: "기반 연구", "다른 접근"). 이모지는 제거. */
  relation: string
  reason: string
}

export interface RelatedPaper {
  slug: string
  title: string
  relation: string
  reason: string
  /** 연결 논문 review.md에서 뽑은 압축 요약(비교용 컨텍스트). */
  summary: string
}

/** slug(`1234_Some_Title_Words`) → 사람이 읽는 대략 제목(리뷰가 없을 때 폴백). */
function slugToTitle(slug: string): string {
  return slug.replace(/^\d+_/, "").replace(/_/g, " ").trim()
}

/** review.md "## Related Papers" 섹션을 파싱해 이미 저장된 연결 목록을 돌려준다. */
export function parseRelatedLinks(reviewMd: string): RelatedLink[] {
  const sec = reviewMd.match(
    /\n##\s*Related Papers\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/,
  )
  if (!sec) return []
  const out: RelatedLink[] = []
  const seen = new Set<string>()
  for (const line of sec[1].split("\n")) {
    const lm = line.match(/\[\[papers\/([^\]/]+)\/review\]\]/)
    if (!lm) continue
    const slug = lm[1].trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    // 라벨: 줄 시작("- ", 이모지 포함)과 ":" 사이 텍스트에서 앞쪽 비문자(이모지) 제거.
    let relation = ""
    const before = line.slice(0, lm.index).replace(/^[\s-]*/, "")
    const cm = before.match(/^(.*?):\s*$/)
    if (cm) relation = cm[1].replace(/^[^\p{L}]+/u, "").trim()
    // 이유: 위키링크 뒤의 대시 이후 텍스트.
    const after = line.slice((lm.index || 0) + lm[0].length)
    const reason = after.replace(/^\s*[—–-]\s*/, "").trim()
    out.push({ slug, relation, reason })
  }
  return out
}

/** 연결 논문 review.md → {제목, 압축 요약}. frontmatter/이미지/Related 섹션 제거. */
export function extractReviewDigest(
  reviewMd: string,
  maxChars = 2400,
): { title: string; digest: string } {
  let title = ""
  const fm = reviewMd.match(/^---\n([\s\S]*?)\n---/)
  if (fm) {
    const tm = fm[1].match(/^title:\s*"?(.+?)"?\s*$/m)
    if (tm) title = tm[1].trim()
  }
  if (!title) {
    const hm = reviewMd.match(/^#\s+(.+)$/m)
    if (hm) title = hm[1].trim()
  }
  let body = reviewMd
    .replace(/^---\n[\s\S]*?\n---\n/, "") // frontmatter
    .replace(/\n##\s*Related Papers\s*\n[\s\S]*$/, "") // Related 섹션
    .replace(/^#\s+.+\n/, "") // 제목 헤딩
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 이미지
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (body.length > maxChars) body = body.slice(0, maxChars).trimEnd() + " …"
  return { title, digest: body }
}

/**
 * 한 논문(slug)에 이미 연결된 관련 연구들을 로드한다. 각 연결 논문의 review.md에서
 * 요약을 뽑아 함께 반환. review.md가 없으면 slug 기반 제목만 채운다.
 */
export async function loadRelatedForSlug(
  papersDir: string,
  slug: string,
  opts: { maxPapers?: number; maxCharsEach?: number } = {},
): Promise<RelatedPaper[]> {
  const reviewPath = joinPath(papersDir, slug, "review.md")
  if (!(await pathExists(reviewPath))) return []
  const md = await readText(reviewPath)
  const links = parseRelatedLinks(md).slice(0, opts.maxPapers ?? 12)
  const out: RelatedPaper[] = []
  for (const l of links) {
    let title = slugToTitle(l.slug)
    let summary = ""
    const rp = joinPath(papersDir, l.slug, "review.md")
    if (await pathExists(rp)) {
      const dg = extractReviewDigest(await readText(rp), opts.maxCharsEach ?? 2400)
      if (dg.title) title = dg.title
      summary = dg.digest
    }
    out.push({ slug: l.slug, title, relation: l.relation, reason: l.reason, summary })
  }
  return out
}
