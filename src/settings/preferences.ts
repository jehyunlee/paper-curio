import { config } from "../../package.json"
import { getString } from "../utils/locale"
import { tryResolveOutputTarget } from "../core/pc-discovery"

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
