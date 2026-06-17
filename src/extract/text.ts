import { openPdf } from "./pdfjs"
import { getAttachmentFulltext } from "../apis/zotero/attachment"
import { fs as log } from "../utils/loggers"

export interface ExtractedText {
  text: string
  source: "pdfjs" | "zotero-fulltext" | "none"
  pages: number
  hasPdf: boolean
}

/**
 * PDF 전체 텍스트 추출.
 * 1차: pdf.js로 전 페이지 getTextContent (truncation 없음, PyMuPDF get_text 동급)
 * 2차: Zotero 내장 fulltext 인덱스 (pdf.js 접근 불가 시 — 단 pdfMaxPages 제한 있음)
 */
export async function extractText(item: Zotero.Item): Promise<ExtractedText> {
  // 1차: pdf.js 전 페이지
  const opened = await openPdf(item)
  if (opened) {
    try {
      const { doc } = opened
      const parts: string[] = []
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p)
        const tc = await page.getTextContent()
        // 같은 줄(y) 아이템은 공백, 줄바뀜은 개행으로 근사
        let line = ""
        let lastY: number | null = null
        const lines: string[] = []
        for (const it of tc.items as any[]) {
          const s = it.str ?? ""
          const y = it.transform?.[5]
          if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
            if (line.trim()) lines.push(line.trimEnd())
            line = ""
          }
          line += s + (it.hasEOL ? "\n" : " ")
          lastY = y
        }
        if (line.trim()) lines.push(line.trimEnd())
        parts.push(lines.join("\n"))
      }
      const text = parts.join("\n\n").replace(/[ \t]+\n/g, "\n").trim()
      if (text.length > 50) {
        log(`text 추출(pdf.js): ${doc.numPages}p, ${text.length}자`)
        return { text, source: "pdfjs", pages: doc.numPages, hasPdf: true }
      }
    } catch (e) {
      log("pdf.js 텍스트 추출 실패 → fulltext fallback", e)
    }
  }

  // 2차: Zotero fulltext
  const { text, hasPdf } = await getAttachmentFulltext(item)
  if (text && text.length > 0) {
    log(`text 추출(zotero-fulltext): ${text.length}자 (pdfMaxPages 제한 가능)`)
    return { text, source: "zotero-fulltext", pages: 0, hasPdf }
  }

  return { text: "", source: "none", pages: 0, hasPdf }
}

/** text.md 파일 내용 (현재는 평문 그대로; 헤더 없이 paper-curation text.md와 동일 평문). */
export function buildTextMd(text: string): string {
  return (text || "").trim() + "\n"
}
