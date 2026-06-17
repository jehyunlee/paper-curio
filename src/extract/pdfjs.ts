import { fs as log } from "../utils/loggers"

declare const ChromeUtils: any
declare const IOUtils: any

let _pdfjs: any | null | undefined // undefined=미시도, null=실패, obj=성공

/**
 * Zotero 번들 pdf.js 핸들. 버전별 경로가 달라 후보를 순차 시도하고 캐시.
 * 실패 시 null → 호출부가 graceful degrade.
 */
export async function loadPdfjs(): Promise<any | null> {
  if (_pdfjs !== undefined) return _pdfjs
  const candidates = [
    "resource://zotero/reader/pdf/build/pdf.mjs",
    "resource://zotero/pdf-reader/pdf.mjs",
    "resource://gre/modules/pdfjs/pdf.mjs",
  ]
  for (const url of candidates) {
    try {
      const mod = await ChromeUtils.importESModule(url)
      const pdfjs = mod?.getDocument ? mod : mod?.default || mod
      if (pdfjs?.getDocument) {
        log("pdf.js 로드 성공:", url)
        _pdfjs = pdfjs
        return pdfjs
      }
    } catch {
      /* try next */
    }
  }
  log("pdf.js 로드 실패 — Zotero 버전별 경로 확인 필요")
  _pdfjs = null
  return null
}

/** item의 PDF 첨부 실제 파일 경로. */
export async function pdfFilePath(item: Zotero.Item): Promise<string | null> {
  try {
    const best = await item.getBestAttachment()
    let pdf: any = best && (best as any).isPDFAttachment?.() ? best : null
    if (!pdf) {
      for (const id of item.getAttachments()) {
        const att = Zotero.Items.get(id) as any
        if (att?.isPDFAttachment?.()) {
          pdf = att
          break
        }
      }
    }
    if (!pdf) return null
    return (await pdf.getFilePathAsync()) || null
  } catch (e) {
    log("pdfFilePath 실패", e)
    return null
  }
}

/** PDF 파일을 pdf.js 문서로 연다 (없으면 null). */
export async function openPdf(
  item: Zotero.Item,
): Promise<{ doc: any; pdfjs: any } | null> {
  const pdfjs = await loadPdfjs()
  if (!pdfjs) return null
  const path = await pdfFilePath(item)
  if (!path) {
    log("PDF 경로 없음")
    return null
  }
  try {
    const data = await IOUtils.read(path)
    const doc = await pdfjs.getDocument({ data }).promise
    return { doc, pdfjs }
  } catch (e) {
    log("openPdf 실패", e)
    return null
  }
}
