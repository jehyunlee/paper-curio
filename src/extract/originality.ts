/**
 * Originality extraction from paper text.
 * Faithful TypeScript port of paper-curation/pipeline/lib/originality_extractor.py
 * (the no-embedding, rule-based + LLM-fallback path used by topic_modeling.py).
 *
 * Strategy:
 *   1. Primary: rule-based trigger matching (free, instant)
 *   2. Fallback: LLM (injected `llmFallback` callback) when rule-based finds nothing
 *   3. Self-learning (trigger JSON auto-append) is a NO-OP stub here — the Zotero
 *      plugin never writes to bundled files. See `_updateTriggers` below.
 *
 * Pure functions only — no Zotero global API, no LLM SDK imports.
 */

import triggers from "./originality_triggers.json"

// ── Public contract ──

export interface OriginalityInput {
  paperNumber: number // 슬러그 앞 NNN (헤더 '# {N}번 논문'에 사용)
  title: string
  textMd: string // text.md 본문 (PDF 평문)
  abstract?: string
}

// ── Trigger loading ──

interface LoadedTriggers {
  categories: Record<string, string[]>
  all: string[]
}

/**
 * Load trigger categories (keys starting with "rule_base_") and a flat unique list.
 * Mirrors Python `load_triggers`; reads the bundled JSON via resolveJsonModule.
 */
function loadTriggers(): LoadedTriggers {
  const data = triggers as Record<string, unknown>
  const categories: Record<string, string[]> = {}
  for (const key of Object.keys(data)) {
    if (key.startsWith("rule_base_")) {
      categories[key] = data[key] as string[]
    }
  }
  const allSet = new Set<string>()
  for (const words of Object.values(categories)) {
    for (const w of words) allSet.add(w)
  }
  return { categories, all: Array.from(allSet) }
}

// ── Metadata leak strip ──
// originality 텍스트에 PDF 추출 잔재(DOI, arXiv id, URL, HTML 태그)가 섞여 들어가면
// 다운스트림 키워드 추출 시 *클러스터 구별 단어*로 부각되어 품질을 망친다.
// 모든 추출 경로의 마지막에서 적용.
const _LEAK_PATTERNS: RegExp[] = [
  // URL — 뒤따르는 DOI/arXiv 패턴이 URL 안에 포함돼 있어도 먼저 제거
  /https?:\/\/\S+/gi,
  // arXiv ID (arXiv:2407.09811v1 / 2407.09811v1 / abs/2407.09811)
  /\b(?:arXiv:|abs\/)?\d{4}\.\d{4,5}(?:v\d+)?\b/gi,
  // DOI (10.NNNN/...)
  /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi,
  // HTML 태그 (<br>, <p>, <span>, ...)
  /<[a-zA-Z][^>]*>/g,
]

/**
 * Remove URL/arXiv/DOI/HTML leaks from extracted originality text.
 * Idempotent. Returns the cleaned text with collapsed whitespace.
 * 1:1 port of Python `_strip_metadata_leaks`.
 */
export function _strip_metadata_leaks(text: string): string {
  if (!text) return text
  for (const pat of _LEAK_PATTERNS) {
    text = text.replace(pat, " ")
  }
  // re.sub(r"\s+([,.;:?!])", r"\1", text)
  text = text.replace(/\s+([,.;:?!])/g, "$1")
  // re.sub(r"\s+", " ", text).strip()
  text = text.replace(/\s+/g, " ").trim()
  return text
}

// ── Sentence splitting ──

/**
 * Split text into sentences after Unicode NFKD normalization.
 * Mirrors Python `split_sentences` (incl. ligature/nbsp/copyright handling).
 */
function splitSentences(text: string): string[] {
  // unicodedata.normalize("NFKD", text)
  let normalized = text.normalize("NFKD")
  normalized = normalized
    .replace(/©/g, " ") // copyright symbol
    .replace(/ /g, " ") // non-breaking space (\xa0)
    .replace(/\n/g, " ")
  normalized = normalized.replace(/\s+/g, " ").trim()
  // re.split(r'(?<=[.!?])\s+', text)
  const sentences = normalized.split(/(?<=[.!?])\s+/)
  return sentences.map((s) => s.trim()).filter((s) => s.length > 10)
}

// ── Rule-based extraction ──

// Strong novelty signals
const _STRONG_NOVELTY: ReadonlySet<string> = new Set([
  "for the first time",
  "unprecedented",
  "pioneering",
  "state-of-the-art",
  "cutting-edge",
  "innovative",
])

const _STRICT_AUTHORSHIP: ReadonlySet<string> = new Set([
  "we ",
  " our ",
  "this study",
  "this paper",
  "this work",
  "this article",
  "this research",
  "this report",
  "this investigation",
  "in this study",
  "in this work",
  "in this paper",
  "here ",
  "herein",
  "the paper ",
  "the study ",
  "the work ",
  "the article ",
  "the present study",
  "the present work",
  "the present paper",
  "the current study",
  "the current work",
  "the current paper",
])

const _REFERENTIAL_STARTS: readonly string[] = ["it ", "its ", "this ", "these ", "such ", "the "]

// Stop triggers (too broad to learn) — only used by the (stubbed) self-learning path.
const _STOP_TRIGGERS: ReadonlySet<string> = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "must", "need", "also",
  "not", "no", "but", "and", "or", "if", "then", "than", "that", "this",
  "these", "those", "it", "its", "they", "their", "them",
  "with", "from", "into", "for", "of", "on", "in", "at",
  "to", "by", "as", "about", "between", "through", "during",
  "more", "most", "very", "much", "many", "some", "any", "all",
  "based on", "due to", "in order to", "according to",
  "important", "significant", "recent", "various", "different",
  "however", "therefore", "thus", "hence", "moreover",
  "data", "method", "model", "system", "paper", "study", "research",
])

/**
 * Rule-based originality extraction with strict co-occurrence.
 * 1:1 port of Python `_extract_rule_based`.
 */
export function _extract_rule_based(text: string, loaded: LoadedTriggers): string {
  if (!text || !text.trim()) return ""

  const contentCategories: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(loaded.categories)) {
    if (!k.includes("authorship")) contentCategories[k] = v
  }

  const sentences = splitSentences(text)
  let firstOrigIdx: number | null = null

  for (let i = 0; i < sentences.length; i++) {
    const sLower = sentences[i].toLowerCase()
    const hasStrong = anyIncludes(sLower, _STRONG_NOVELTY)
    const hasAuthorship = anyIncludes(sLower, _STRICT_AUTHORSHIP)
    let hasContent = false
    if (hasAuthorship) {
      outer: for (const words of Object.values(contentCategories)) {
        for (const w of words) {
          if (sLower.includes(w)) {
            hasContent = true
            break outer
          }
        }
      }
    }
    if (hasStrong || (hasAuthorship && hasContent)) {
      firstOrigIdx = i
      break
    }
  }

  if (firstOrigIdx === null) return ""

  let startIdx = firstOrigIdx
  if (firstOrigIdx > 0) {
    const sLower = sentences[firstOrigIdx].toLowerCase().replace(/^\s+/, "")
    if (_REFERENTIAL_STARTS.some((ref) => sLower.startsWith(ref))) {
      startIdx = firstOrigIdx - 1
    }
  }

  return _strip_metadata_leaks(sentences.slice(startIdx).join(". "))
}

function anyIncludes(haystack: string, needles: ReadonlySet<string>): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true
  }
  return false
}

// ── LLM Fallback ──

/**
 * Fallback prompt — copied verbatim from the Python `LLM_PROMPT`.
 * `{text}` is substituted at call time. The actual LLM call is delegated to the
 * injected `llmFallback` callback; this module never imports an LLM SDK.
 */
export const LLM_PROMPT = `Given the following scientific paper text, identify sentences
that describe the paper's originality, novelty, or unique contribution.

Return a JSON object with:
{
  "originality_sentences": ["exact sentence 1 from text", "exact sentence 2", ...],
  "trigger_phrases": ["phrase that signals originality 1", "phrase 2", ...]
}

Rules:
- "originality_sentences" must be EXACT copies of sentences from the text (no paraphrasing).
- "trigger_phrases" must be 1-3 word phrases FROM those sentences that signal authorship or novelty
  (e.g., "we report", "novel approach", "for the first time").
- Each trigger_phrase should be lowercase.
- If no originality is found, return empty lists.

Text:
{text}
`

interface LlmParsed {
  originality_sentences?: string[]
  trigger_phrases?: string[]
}

/**
 * Parse JSON from an LLM response, stripping ```json fences.
 * 1:1 port of Python `_parse_json_response`.
 */
function parseJsonResponse(text: string): LlmParsed {
  text = text.trim()
  if (text.startsWith("```")) {
    const firstNl = text.includes("\n") ? text.indexOf("\n") : text.length
    text = text.slice(firstNl + 1)
    if (text.includes("```")) {
      text = text.slice(0, text.lastIndexOf("```"))
    }
    text = text.trim()
  }
  return JSON.parse(text) as LlmParsed
}

/**
 * LLM-based originality extraction, delegating the model call to `llmFallback`.
 * Returns [strippedText, triggerPhrases]. On any failure → ["", []].
 * Port of Python `_llm_fallback` (SDK call replaced by injected callback).
 */
async function llmFallbackExtract(
  text: string,
  llmFallback: (prompt: string) => Promise<string>,
): Promise<[string, string[]]> {
  try {
    const raw = await llmFallback(LLM_PROMPT.replace("{text}", text))
    const result = parseJsonResponse(raw)
    const sentences = result.originality_sentences ?? []
    const phrases = result.trigger_phrases ?? []
    const out = sentences.length ? sentences.join(". ") : ""
    return [_strip_metadata_leaks(out), phrases]
  } catch {
    return ["", []]
  }
}

/**
 * Self-learning trigger append — NO-OP STUB.
 *
 * The Python original appended LLM-discovered triggers back into
 * originality_triggers.json (`_update_triggers`). The Zotero plugin bundles the
 * trigger JSON read-only and never writes to disk, so this is intentionally a
 * no-op. Kept for porting parity; always returns 0.
 */
function _updateTriggers(_loaded: LoadedTriggers, _newTriggers: string[]): number {
  // intentionally does nothing — plugin must not mutate bundled assets.
  // (Stop-trigger filtering / verb heuristics from the Python version are dropped
  //  since nothing is persisted.)
  void _STOP_TRIGGERS // referenced to document the dropped filter; no-op
  return 0
}

// ── Orchestration ──

/**
 * Extract originality body text: rule-based first, LLM fallback if empty.
 * Self-learning is stubbed (see `_updateTriggers`).
 *
 * Mirrors Python `extract_originality`, but the input-shaping that
 * topic_modeling.py performs (find "abstract" → first ~1000 chars, then retry
 * on full text, then title/essence fallback) is folded in here so callers can
 * pass raw text.md.
 */
async function extractOriginalityBody(
  input: OriginalityInput,
  loaded: LoadedTriggers,
  llmFallback?: (prompt: string) => Promise<string>,
): Promise<string> {
  const full = input.textMd || ""

  // topic_modeling.py: locate "abstract", take first ~1000 chars from there.
  const absPos = full.toLowerCase().indexOf("abstract")
  const window = absPos >= 0 ? full.slice(absPos, absPos + 1000) : full.slice(0, 1000)

  // 1. Rule-based on the abstract window, then on the full text.
  let result = _extract_rule_based(window, loaded)
  if (!result) {
    result = _extract_rule_based(full, loaded)
  }
  if (result) return result

  // 2. LLM fallback (only if a callback is injected). Uses the abstract window
  //    to keep the prompt small, matching topic_modeling's first-1000-chars input.
  if (llmFallback) {
    const llmInput = window || full
    const [llmResult, newTriggers] = await llmFallbackExtract(llmInput, llmFallback)
    // 3. Self-learning — stubbed no-op.
    _updateTriggers(loaded, newTriggers)
    if (llmResult) return llmResult
  }

  // Minimal fallback: abstract / first sentence / title.
  // (topic_modeling.py uses `title. essence`; essence isn't available here, so we
  //  fall back to abstract, then the first usable sentence, then the title.)
  const abstract = (input.abstract || "").trim()
  if (abstract) return _strip_metadata_leaks(abstract)

  const sentences = splitSentences(full)
  if (sentences.length) return _strip_metadata_leaks(sentences[0])

  return _strip_metadata_leaks(input.title || "")
}

/**
 * Build the full originality.md content (header + extracted body).
 *
 * @param input        Paper number, title, text.md body, optional abstract.
 * @param llmFallback  Optional async callback that takes the fully-rendered
 *                     prompt and returns the raw LLM response text. When absent,
 *                     only rule-based extraction (plus the minimal abstract/
 *                     first-sentence fallback) is used.
 * @returns            The complete originality.md content as a string.
 */
export async function buildOriginalityMarkdown(
  input: OriginalityInput,
  llmFallback?: (prompt: string) => Promise<string>,
): Promise<string> {
  const loaded = loadTriggers()
  const body = await extractOriginalityBody(input, loaded, llmFallback)
  const header = `# ${input.paperNumber}번 논문`
  return `${header}\n\n${body}\n`
}
