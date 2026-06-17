import { config } from "../../package.json"

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
}
