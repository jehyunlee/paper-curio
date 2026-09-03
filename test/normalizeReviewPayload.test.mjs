/**
 * emit_review 응답 정규화 계약.
 *
 * Sonnet 5 는 `emit_review` 를 호출하면서 스키마를 채우는 대신 XML 태그 리뷰를
 * 한 필드에 통째로 밀어넣는다. paper-curation 이 이 모델로 갈아탄 뒤
 * **509편의 review.md 가 깨져** `salvage_reviews.py` 로 복구해야 했다
 * (docs/papers/ 아래 review.md.broken.bak 509개가 그 흔적이다).
 * 여기서 고정하는 세 형태는 run_update_force._salvage_review_data 가 실제로
 * 관측한 것과 같다.
 *
 * Run:  npm test
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { execSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "pc-schema-"))
writeFileSync(join(dir, "schema.ts"), readFileSync("src/llm/schema.ts", "utf8"))
execSync(
  `npx esbuild ${join(dir, "schema.ts")} --format=esm ` +
    `--outfile=${join(dir, "schema.mjs")} --log-level=error`,
)
const { normalizeReviewPayload } = await import(join(dir, "schema.mjs"))

const full = (o) => ({
  essence: "e", known: "k", gap: "g", why: "w", approach: "a",
  achievement: "ach", how: "h", originality: "o", limitation: "l",
  verdict: "v", novelty: 4, technical: 4, significance: 4, clarity: 4,
  overall: 4, ...o,
})

let pass = 0
let fail = 0
const t = (name, fn) => {
  try {
    fn()
    console.log("  ok   " + name)
    pass++
  } catch (e) {
    console.log("  FAIL " + name + " — " + e.message)
    fail++
  }
}
const eq = (a, b, m) => {
  if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
}

t("모드 A: 전부 essence 에 몰아넣고 꼬리에 </invoke>", () => {
  const r = normalizeReviewPayload(
    full({
      essence:
        "<essence>E1</essence><achievement>A1</achievement><how>H1</how>" +
        "<originality>O1</originality><limitation>L1</limitation>" +
        "<verdict>V1</verdict></invoke>",
    }),
  )
  eq(r.essence, "E1", "essence")
  eq(r.achievement, "A1", "achievement")
  eq(r.verdict, "V1", "verdict")
})

t("모드 B: 나머지 필드가 <parameter name=…> 문법으로", () => {
  const r = normalizeReviewPayload(
    full({
      known: '<parameter name="known">K2</parameter>',
      how: '<parameter name="how">H2</parameter>',
    }),
  )
  eq(r.known, "K2", "known")
  eq(r.how, "H2", "how")
})

t("모드 C: 멀쩡한 필드 + essence 안의 잔해 — 남의 본문이 붙어 남지 않는다", () => {
  const r = normalizeReviewPayload(
    full({
      essence: 'real essence text<parameter name="known">KNOWN TEXT</parameter>',
    }),
  )
  eq(r.essence, "real essence text", "essence")
  eq(r.known, "KNOWN TEXT", "known")
})

t("정상 응답은 건드리지 않는다", () => {
  const r = normalizeReviewPayload(full({ essence: "clean essence" }))
  eq(r.essence, "clean essence", "essence")
  eq(r.known, "k", "known")
})

t("필수 필드가 비면 여전히 throw — 다음 provider 로 폴백해야 한다", () => {
  let threw = false
  try {
    normalizeReviewPayload(full({ achievement: "" }))
  } catch {
    threw = true
  }
  if (!threw) throw new Error("throw 하지 않음")
})

t("점수는 1..5 로 clamp, 비수치는 3", () => {
  const r = normalizeReviewPayload(full({ novelty: 9, clarity: "x", overall: 0 }))
  eq(r.novelty, 5, "novelty")
  eq(r.clarity, 3, "clarity")
  eq(r.overall, 1, "overall")
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
