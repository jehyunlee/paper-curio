import { getPrefStr, setPref, clearPref } from "./prefs"

/** Shared OS credential IDs; preferences contain references, never values. */
export const CREDENTIAL_PROVIDERS: Record<string, string> = {
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
  GEMINI_API_KEY: "google",
  SCOPUS_API_KEY: "scopus",
  SCOPUS_INST_TOKEN: "scopus-inst",
  S2_API_KEY: "semantic-scholar",
  SPRINGER_META_API_KEY: "springer",
}
const credentialValues = new Map<string, string>()

export function getOSEnv(name: string): string {
  try {
    const envSvc = (Components as any).classes[
      "@mozilla.org/process/environment;1"
    ].getService((Components as any).interfaces.nsIEnvironment)
    const value = envSvc.get(name)
    return typeof value === "string" ? value.trim() : ""
  } catch {
    return ""
  }
}

function key(provider: string, ...envNames: string[]): string {
  for (const name of envNames) {
    const value = getOSEnv(name)
    if (value) return value
  }
  return credentialValues.get(provider) || ""
}

export function getAnthropicKey(): string {
  return key("anthropic", "ANTHROPIC_API_KEY")
}
export function getOpenAIKey(): string {
  return key("openai", "OPENAI_API_KEY")
}
export function getGeminiKey(): string {
  return key("google", "GOOGLE_API_KEY", "GEMINI_API_KEY")
}
export function getScopusKey(): string {
  return key("scopus", "SCOPUS_API_KEY", "ELSEVIER_API_KEY")
}
export function getScopusInstToken(): string {
  return key("scopus-inst", "SCOPUS_INST_TOKEN")
}
export function getS2Key(): string {
  return key("semantic-scholar", "S2_API_KEY")
}
export function getSpringerMetaKey(): string {
  return key(
    "springer",
    "SPRINGER_META_API_KEY",
    "NATURESPRINGERMETA_API_KEY",
    "NATURESPRINTERMETA_API_KEY",
  )
}
export function getOpenAlexEmail(): string {
  return (
    getOSEnv("OPENALEX_EMAIL") ||
    getOSEnv("CROSSREF_EMAIL") ||
    getPrefStr("OPENALEX_EMAIL")
  )
}

/** Missing OS runtime never blocks keyless reading or environment-injected AI. */
export async function loadSharedCredentials(root: string): Promise<void> {
  const { credentialViaBridge } = await import("../extract/pybridge")
  for (const provider of Object.values(CREDENTIAL_PROVIDERS)) {
    try {
      const result = await credentialViaBridge(root, "read", provider)
      credentialValues.set(provider, result.value || "")
    } catch {
      credentialValues.delete(provider)
    }
  }
}

export async function saveSharedCredential(
  root: string,
  field: string,
  value: string,
): Promise<void> {
  const provider = CREDENTIAL_PROVIDERS[field]
  if (!provider) throw new Error("Unsupported credential field")
  const { credentialViaBridge } = await import("../extract/pybridge")
  const result = await credentialViaBridge(
    root,
    value ? "write" : "delete",
    provider,
    value,
  )
  if (result.reference !== `credential:${provider}`)
    throw new Error("Unexpected credential reference")
  if (value) {
    setPref(`${field}_CREDENTIAL_REF`, result.reference)
    credentialValues.set(provider, value)
  } else {
    clearPref(`${field}_CREDENTIAL_REF`)
    credentialValues.delete(provider)
  }
  // Remove the obsolete plaintext preference only after secure storage succeeds.
  clearPref(field)
}
