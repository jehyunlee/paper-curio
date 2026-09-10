import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { tryResolveOutputTarget } from "../core/pc-discovery"
import {
  CREDENTIAL_PROVIDERS,
  saveSharedCredential,
  loadSharedCredentials,
} from "../utils/env"

/** Settings(환경설정)에 Paper Curio pane 등록. */
export function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: `chrome://${config.addonRef}/content/preferences.xhtml`,
    label: config.addonName,
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  })
}

/** preferences.xhtml 로드 시 호출. */
export function onPrefsLoad(window: Window) {
  addon.data.prefs = { window }
  void fillPcStatus(window)
  void bindCredentialFields(window)
}

async function bindCredentialFields(window: Window) {
  const root = (await tryResolveOutputTarget())?.root
  if (root) await loadSharedCredentials(root)
  for (const field of Object.keys(CREDENTIAL_PROVIDERS)) {
    const input = window.document.querySelector(
      `[data-credential="${field}"]`,
    ) as HTMLInputElement | null
    if (!input) continue
    input.value = ""
    const button = window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement
    button.textContent = getString("credential-save")
    button.type = "button"
    const status = window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    ) as HTMLSpanElement
    status.setAttribute("role", "status")
    input.after(button, status)
    button.addEventListener("click", async () => {
      if (button.disabled) return
      button.disabled = true
      const value = input.value.trim()
      try {
        const currentRoot = (await tryResolveOutputTarget())?.root
        if (!currentRoot) {
          status.textContent = getString("credential-runtime-needed")
          return
        }
        await saveSharedCredential(currentRoot, field, value)
        if (input.value.trim() === value) input.value = ""
        status.textContent = getString("credential-saved")
      } catch {
        status.textContent = getString("credential-save-failed")
      } finally {
        button.disabled = false
      }
    })
  }
}

/** paper-curation 연동 상태 표시 (light/enhanced 안내). */
async function fillPcStatus(window: Window) {
  try {
    const el = window.document.getElementById(
      "papercurio-pc-status",
    ) as HTMLElement | null
    if (!el) return
    const t = await tryResolveOutputTarget()
    el.textContent = t
      ? getString("pc-status-ok", { args: { path: t.root } })
      : getString("pc-status-missing")
    el.style.color = t ? "#1a7f37" : "#9a6700"
  } catch {
    /* ignore */
  }
}
