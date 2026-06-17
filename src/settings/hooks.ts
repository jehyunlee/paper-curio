import { config } from "../../package.json"
import { initLocale } from "../utils/locale"
import { injectEnvSecrets } from "../utils/env"
import { registerPrefs, onPrefsLoad } from "./preferences"
import { registerItemMenu, unregisterItemMenu } from "../views/root"
import { pipeline as log } from "../utils/loggers"

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ])
  initLocale()
  injectEnvSecrets()
  registerPrefs()

  // 이미 열린 메인 윈도우에 메뉴 등록
  const win = Zotero.getMainWindow()
  if (win) onMainWindowLoad(win)
}

async function onMainWindowLoad(_win: Window): Promise<void> {
  try {
    registerItemMenu()
  } catch (e) {
    log("registerItemMenu 실패", e)
  }
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  unregisterItemMenu()
  ztoolkit.unregisterAll()
}

function onShutdown(): void {
  unregisterItemMenu()
  ztoolkit.unregisterAll()
  addon.data.alive = false
  // @ts-ignore
  delete Zotero[config.addonInstance]
}

/** preferences pane 이벤트 디스패치. */
function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") {
    onPrefsLoad(data.window)
  }
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onShutdown,
  onPrefsEvent,
}
