import { fs as log } from "../utils/loggers"
import { joinPath, makeDir } from "../utils/fs"
import { openPdf } from "./pdfjs"

declare const IOUtils: any

export interface ExtractedFigure {
  n: number
  caption: string
  file: string // figures/figN.webp
}

const MAX_FIGURES = 5
const RENDER_SCALE = 2.0
const MARGIN = 8 // PDF pt (원본 run_update_force MARGIN 정신)
const MIN_CROP_PX = 40

// ── 행렬 유틸 (pdf.js transform [a,b,c,d,e,f]) ──
type Mat = [number, number, number, number, number, number]
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
function matmul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}
function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
} // viewport px 좌표

function unionRect(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

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

/** operatorList를 훑어 이미지 XObject 배치 rect(viewport px) 수집 (PyMuPDF Source1 등가). */
function collectImageRects(opList: any, OPS: any, viewport: any): Rect[] {
  const rects: Rect[] = []
  let ctm: Mat = IDENTITY
  const stack: Mat[] = []
  const fnArray = opList.fnArray
  const argsArray = opList.argsArray
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === OPS.save) {
      stack.push(ctm)
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || IDENTITY
    } else if (fn === OPS.transform) {
      ctm = matmul(ctm, argsArray[i] as Mat)
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintJpegXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      // 현재 CTM이 단위 사각형 [0,1]² → user-space 배치로 매핑.
      const corners = [
        apply(ctm, 0, 0),
        apply(ctm, 1, 0),
        apply(ctm, 0, 1),
        apply(ctm, 1, 1),
      ]
      // user-space → viewport px
      const vpts = corners.map((c) => viewport.convertToViewportPoint(c[0], c[1]))
      const xs = vpts.map((p: number[]) => p[0])
      const ys = vpts.map((p: number[]) => p[1])
      const r: Rect = {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      }
      // 너무 작은(아이콘/로고) rect 제외
      if (r.x1 - r.x0 > 40 && r.y1 - r.y0 > 40) rects.push(r)
    }
  }
  return rects
}

interface Caption {
  n: number
  text: string
  rect: Rect
}

/** 텍스트 아이템을 같은 줄(y)로 묶어 "Figure N ..." 캡션 탐지 (pdf.js가 토큰을 쪼개는 문제 해결). */
function collectCaptions(tc: any, viewport: any): Caption[] {
  // 라인 그룹핑: viewport y로 정렬 후 인접 묶음
  const items = (tc.items as any[])
    .filter((it) => (it.str || "").trim() || it.transform)
    .map((it) => {
      const [vx, vy] = viewport.convertToViewportPoint(
        it.transform[4],
        it.transform[5],
      )
      const w = (it.width || 0) * (viewport.scale || 1)
      const h = (it.height || it.transform[3] || 10) * (viewport.scale || 1)
      return { str: it.str || "", x: vx, y: vy, w, h }
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const lines: { str: string; rect: Rect }[] = []
  let cur: typeof items = []
  let curY: number | null = null
  const flush = () => {
    if (!cur.length) return
    cur.sort((a, b) => a.x - b.x)
    const str = cur.map((c) => c.str).join("").replace(/\s+/g, " ").trim()
    const x0 = Math.min(...cur.map((c) => c.x))
    const x1 = Math.max(...cur.map((c) => c.x + c.w))
    const y0 = Math.min(...cur.map((c) => c.y - c.h))
    const y1 = Math.max(...cur.map((c) => c.y))
    lines.push({ str, rect: { x0, y0, x1, y1 } })
    cur = []
  }
  for (const it of items) {
    if (curY === null || Math.abs(it.y - curY) <= 4) {
      cur.push(it)
      curY = curY === null ? it.y : (curY + it.y) / 2
    } else {
      flush()
      cur = [it]
      curY = it.y
    }
  }
  flush()

  const capRe = /\b(?:Fig(?:ure)?\.?)\s*(\d+)\b[.:]?\s*(.*)/i
  const caps: Caption[] = []
  for (const ln of lines) {
    const m = ln.str.match(capRe)
    if (!m) continue
    if (!/^\s*(?:Fig|Figure)\b/i.test(ln.str)) continue // 캡션은 보통 줄 시작
    const n = parseInt(m[1], 10)
    if (!Number.isFinite(n)) continue
    caps.push({ n, text: ln.str, rect: ln.rect })
  }
  return caps
}

/**
 * 원본 알고리즘 재현: 캡션 위쪽의 그래픽 rect를 결합(hull) → margin → crop → render.
 * 그래픽 rect를 못 찾으면 캡션 위 영역으로 fallback (figure 누락 방지).
 */
export async function extractFigures(
  item: Zotero.Item,
  slugDir: string,
): Promise<ExtractedFigure[]> {
  const opened = await openPdf(item)
  if (!opened) return []
  const { doc, pdfjs } = opened
  const OPS = pdfjs.OPS

  try {
    const figuresDir = joinPath(slugDir, "figures")
    const found: { n: number; caption: string; bytes: Uint8Array }[] = []
    const maxPages = Math.min(doc.numPages, 30)

    for (let p = 1; p <= maxPages && found.length < MAX_FIGURES; p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const caps = collectCaptions(await page.getTextContent(), viewport)
      if (caps.length === 0) continue

      let imageRects: Rect[] = []
      try {
        imageRects = collectImageRects(
          await page.getOperatorList(),
          OPS,
          viewport,
        )
      } catch (e) {
        log("operatorList 실패 → 캡션영역 fallback", e)
      }

      const canvas = newCanvas(viewport.width, viewport.height)
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise

      for (const cap of caps) {
        if (found.length >= MAX_FIGURES || found.some((f) => f.n === cap.n))
          continue

        // 캡션 위쪽(작은 y) + 수평 overlap 있는 그래픽 rect들을 결합
        const above = imageRects.filter(
          (r) =>
            r.y1 <= cap.rect.y0 + 4 && // 캡션보다 위
            r.x1 > cap.rect.x0 - 20 &&
            r.x0 < cap.rect.x1 + 20, // 수평 겹침
        )
        let region: Rect
        if (above.length) {
          region = above.reduce((acc, r) => unionRect(acc, r))
          // 가장 가까운(아래쪽) 그래픽만 쓰도록 vgap 큰 것은 제외
          const nearestBottom = Math.max(...above.map((r) => r.y1))
          region = above
            .filter((r) => nearestBottom - r.y1 < viewport.height * 0.5)
            .reduce((acc, r) => unionRect(acc, r))
        } else {
          // fallback: 캡션 위 영역 (이전 캡션/페이지 상단까지)
          region = {
            x0: 0,
            y0: Math.max(0, cap.rect.y0 - viewport.height * 0.4),
            x1: viewport.width,
            y1: cap.rect.y0 - 2,
          }
        }
        const mpx = MARGIN * RENDER_SCALE
        const cx0 = Math.max(0, region.x0 - mpx)
        const cy0 = Math.max(0, region.y0 - mpx)
        const cx1 = Math.min(viewport.width, region.x1 + mpx)
        const cy1 = Math.min(viewport.height, region.y1 + mpx)
        const cw = cx1 - cx0
        const ch = cy1 - cy0
        if (cw < MIN_CROP_PX || ch < MIN_CROP_PX) continue

        const crop = newCanvas(cw, ch)
        crop.getContext("2d").drawImage(canvas, cx0, cy0, cw, ch, 0, 0, cw, ch)
        try {
          found.push({ n: cap.n, caption: cap.text, bytes: await canvasToWebp(crop) })
        } catch (e) {
          log(`fig${cap.n} webp 실패`, e)
        }
      }
    }

    if (found.length === 0) {
      log("figure 캡션 미발견 — 0개")
      return []
    }
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
