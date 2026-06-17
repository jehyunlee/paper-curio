import { fs as log } from "../utils/loggers"
import { joinPath, makeDir } from "../utils/fs"
import { openPdf } from "./pdfjs"

declare const IOUtils: any

export interface ExtractedFigure {
  n: number
  caption: string
  file: string // figures/figN.webp (review.md/index.html 참조 경로)
}

const MAX_FIGURES = 5
const RENDER_SCALE = 2.0
const MARGIN = 24 // viewport px

function newCanvas(w: number, h: number): any {
  const doc = (Zotero.getMainWindow() as any).document
  const c = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

function canvasToWebp(canvas: any): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob: any) => {
        if (!blob) return reject(new Error("toBlob null"))
        resolve(new Uint8Array(await blob.arrayBuffer()))
      },
      "image/webp",
      0.9,
    )
  })
}

/**
 * "Figure N" 캡션 위쪽 영역을 잘라 figN.webp 저장 (옵션 B: 캡션 기반 영역 crop).
 * pdf.js 접근 불가/오류 시 빈 배열 — 파이프라인 계속 진행.
 */
export async function extractFigures(
  item: Zotero.Item,
  slugDir: string,
): Promise<ExtractedFigure[]> {
  const opened = await openPdf(item)
  if (!opened) return []
  const { doc } = opened

  try {
    const figuresDir = joinPath(slugDir, "figures")
    const found: { n: number; caption: string; bytes: Uint8Array }[] = []
    const maxPages = Math.min(doc.numPages, 30)
    const capRe = /^(?:Fig(?:ure)?\.?)\s*(\d+)[.:]?\s*(.*)$/i

    for (let p = 1; p <= maxPages && found.length < MAX_FIGURES; p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const tc = await page.getTextContent()

      const caps: { n: number; caption: string; yTop: number }[] = []
      for (const it of tc.items as any[]) {
        const str = (it.str || "").trim()
        const m = str.match(capRe)
        if (!m) continue
        const n = parseInt(m[1], 10)
        if (!Number.isFinite(n)) continue
        const yPdf = it.transform?.[5] ?? 0
        const yView = viewport.height - yPdf * RENDER_SCALE
        caps.push({ n, caption: str, yTop: yView })
      }
      if (caps.length === 0) continue

      const canvas = newCanvas(viewport.width, viewport.height)
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise

      for (const cap of caps) {
        if (found.length >= MAX_FIGURES) break
        if (found.some((f) => f.n === cap.n)) continue
        const cropTop = Math.max(0, cap.yTop - viewport.height * 0.45)
        const cropBottom = Math.max(cropTop + 10, cap.yTop - MARGIN)
        const cropH = cropBottom - cropTop
        if (cropH < 40) continue
        const crop = newCanvas(viewport.width, cropH)
        crop
          .getContext("2d")
          .drawImage(canvas, 0, cropTop, viewport.width, cropH, 0, 0, viewport.width, cropH)
        try {
          found.push({ n: cap.n, caption: cap.caption, bytes: await canvasToWebp(crop) })
        } catch (e) {
          log(`fig${cap.n} webp 인코딩 실패`, e)
        }
      }
    }

    if (found.length === 0) return []
    await makeDir(figuresDir)
    found.sort((a, b) => a.n - b.n)
    const result: ExtractedFigure[] = []
    for (const f of found) {
      const fname = `fig${f.n}.webp`
      await IOUtils.write(joinPath(figuresDir, fname), f.bytes)
      result.push({ n: f.n, caption: f.caption, file: `figures/${fname}` })
    }
    log(`figure ${result.length}개 추출`)
    return result
  } catch (e) {
    log("extractFigures 실패 — 건너뜀", e)
    return []
  }
}
