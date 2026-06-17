import { config } from "../../package.json"

/** Get preference value. Wrapper of `Zotero.Prefs.get`. */
export function getPref(key: string): string | number | boolean | undefined {
  try {
    return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true) as
      | string
      | number
      | boolean
      | undefined
  } catch {
    return undefined
  }
}

/** Get preference as a trimmed string (empty string if unset). */
export function getPrefStr(key: string): string {
  const v = getPref(key)
  return typeof v === "string" ? v.trim() : v != null ? String(v) : ""
}

/** Set preference value. Wrapper of `Zotero.Prefs.set`. */
export function setPref(key: string, value: string | number | boolean) {
  return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true)
}

/** Clear preference value. Wrapper of `Zotero.Prefs.clear`. */
export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true)
}
