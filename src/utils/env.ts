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

/**
 * 시작 시 OS 환경변수 → pref 주입. env가 source of truth.
 * (preferences UI에서 사용자가 본 값이 환경변수와 일치하도록.)
 */
export function injectEnvSecrets() {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
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
