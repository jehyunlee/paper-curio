import { zotero as log } from "../../utils/loggers"

/**
 * item의 PDF 첨부 본문 텍스트를 Zotero 내장 fulltext 인덱스에서 가져온다.
 * (PyMuPDF 등 외부 파서 없이 — Zotero가 이미 색인한 텍스트 활용)
 * 없으면 빈 문자열.
 */
export async function getAttachmentFulltext(
  item: Zotero.Item,
): Promise<{ text: string; hasPdf: boolean }> {
  try {
    const best = await item.getBestAttachment()
    let pdf: Zotero.Item | false = best && best.isPDFAttachment?.() ? best : false

    if (!pdf) {
      const ids = item.getAttachments()
      for (const id of ids) {
        const att = Zotero.Items.get(id) as Zotero.Item
        if (att && (att as any).isPDFAttachment?.()) {
          pdf = att
          break
        }
      }
    }
    if (!pdf) return { text: "", hasPdf: false }

    // attachmentText: Zotero가 색인한 fulltext (없으면 빈 문자열/색인 트리거)
    let text = ""
    try {
      text = ((await (pdf as any).attachmentText) as string) || ""
    } catch (e) {
      log("attachmentText 읽기 실패", e)
    }
    return { text, hasPdf: true }
  } catch (e) {
    log("getAttachmentFulltext 실패", e)
    return { text: "", hasPdf: false }
  }
}
