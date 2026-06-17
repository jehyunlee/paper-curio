const SLUG_MAX_TOTAL = 60 // paper-curation 관찰값: prefix 포함 ~60자
const PREFIX_DIGITS = 3

/**
 * 제목 → 파일시스템 안전 슬러그 본문 (한글·영숫자·대시·언더스코어).
 * paper-curation 패턴: 소문자, 공백→_, 특수문자 제거.
 */
export function sanitizeTitle(title: string, maxLen: number): string {
  return (title || "untitled")
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, "") // 영숫자/_/한글/대시/공백
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, maxLen)
    .replace(/_$/, "")
}

/** NNN_title 형식 슬러그. number는 0패딩 3자리(초과 시 그대로). */
export function buildSlug(num: number, title: string): string {
  const prefix = String(num).padStart(PREFIX_DIGITS, "0")
  const body = sanitizeTitle(title, SLUG_MAX_TOTAL - prefix.length - 1)
  return `${prefix}_${body}`
}
