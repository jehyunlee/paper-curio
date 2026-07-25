import { getPrefStr, setPref } from "./prefs"
import { llm as log } from "./loggers"

/** OS 환경변수 1개 읽기 (Zotero/Firefox nsIEnvironment 경유). */
export function getOSEnv(name: string): string {
  try {
    const envSvc = (Components as any).classes[
      "@mozilla.org/process/environment;1"
    ].getService((Components as any).interfaces.nsIEnvironment) as any
    const v = envSvc.get(name)
    return v && typeof v === "string" ? v.trim() : ""
  } catch {
    return ""
  }
}

/** env > pref 우선순위로 키 해결. */
function resolveKey(envName: string, prefName: string): string {
  const envVal = getOSEnv(envName)
  if (envVal) return envVal
  return getPrefStr(prefName)
}

export function getAnthropicKey(): string {
  return resolveKey("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")
}
export function getOpenAIKey(): string {
  return resolveKey("OPENAI_API_KEY", "OPENAI_API_KEY")
}
export function getGeminiKey(): string {
  return (
    resolveKey("GEMINI_API_KEY", "GEMINI_API_KEY") ||
    getOSEnv("GOOGLE_API_KEY")
  )
}

// ── Citedby 문헌 DB ──────────────────────────────────────────────────────
//
// Zotero.app 을 Finder 로 띄우면 셸 환경변수를 물려받지 못한다. 터미널에
// SCOPUS_API_KEY 를 설정해 뒀어도 플러그인에서는 안 보이므로, pref 폴백이
// 없으면 Zotero 경로의 citedby 는 Scopus 를 영영 못 쓴다.

/** Scopus(Elsevier) API 키 — 서지·피인용수 조회. */
export function getScopusKey(): string {
  return (
    resolveKey("SCOPUS_API_KEY", "SCOPUS_API_KEY") ||
    getOSEnv("ELSEVIER_API_KEY")
  )
}

/** Scopus 기관 토큰 — 원격 접속에서 entitlement 를 실어 준다(선택). */
export function getScopusInstToken(): string {
  return resolveKey("SCOPUS_INST_TOKEN", "SCOPUS_INST_TOKEN")
}

/** Semantic Scholar 키 (선택 — rate limit 완화). */
export function getS2Key(): string {
  return resolveKey("S2_API_KEY", "S2_API_KEY")
}

/** OpenAlex/Crossref polite pool 이메일 (선택 — 있으면 우선 처리된다). */
export function getOpenAlexEmail(): string {
  return (
    resolveKey("OPENALEX_EMAIL", "OPENALEX_EMAIL") ||
    getOSEnv("CROSSREF_EMAIL")
  )
}

/**
 * 시작 시 OS 환경변수 → pref 주입. env가 source of truth.
 * (preferences UI에서 사용자가 본 값이 환경변수와 일치하도록.)
 */
export function injectEnvSecrets() {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
                   "SCOPUS_API_KEY", "SCOPUS_INST_TOKEN", "S2_API_KEY",
                   "OPENALEX_EMAIL"]) {
    const env = getOSEnv(k)
    if (env) {
      setPref(k, env)
      log(`${k} 환경변수 → pref 주입 (${env.length}자)`)
    }
  }
  // GOOGLE_API_KEY → GEMINI_API_KEY 별칭
  const g = getOSEnv("GOOGLE_API_KEY")
  if (g && !getOSEnv("GEMINI_API_KEY")) {
    setPref("GEMINI_API_KEY", g)
    log(`GOOGLE_API_KEY 환경변수 → GEMINI_API_KEY pref 주입`)
  }
}
