import { openPdf, pdfFilePath } from "./pdfjs"
import { getAttachmentFulltext } from "../apis/zotero/attachment"
import {
  joinPath,
  makeDir,
  profileDataDir,
  readJson,
  statFile,
  writeJson,
} from "../utils/fs"
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

/**
 * extractText + 로컬 캐시. PDF(mtime+size) 서명이 같으면 프로파일 캐시에서 즉시
 * 반환 — 채팅 재오픈 시 pdf.js 전체 파싱 지연 제거 (light 모드 체감속도 핵심).
 */
export async function extractTextCached(
  item: Zotero.Item,
): Promise<ExtractedText> {
  const key = (item as any).key || String(item.id)
  const dir = profileDataDir("textcache")
  const cachePath = joinPath(dir, `${key}.json`)

  let sig = "nopdf"
  try {
    const p = await pdfFilePath(item)
    if (p) {
      const st = await statFile(p)
      if (st) sig = `${st.mtime}:${st.size}`
    }
  } catch {
    /* ignore */
  }

  const hit = await readJson<{
    sig?: string
    text?: string
    source?: string
    pages?: number
    hasPdf?: boolean
  } | null>(cachePath, null)
  if (hit && hit.sig === sig && (hit.text || "").length > 50) {
    log(`text 캐시 적중: ${key} (${(hit.text as string).length}자)`)
    return {
      text: hit.text as string,
      source: (hit.source as ExtractedText["source"]) || "pdfjs",
      pages: hit.pages || 0,
      hasPdf: hit.hasPdf ?? true,
    }
  }

  const r = await extractText(item)
  if (r.text) {
    try {
      await makeDir(dir)
      await writeJson(cachePath, { sig, ...r })
    } catch (e) {
      log("text 캐시 저장 실패", e)
    }
  }
  return r
}
