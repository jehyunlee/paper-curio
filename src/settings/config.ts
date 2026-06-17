import { BasicTool } from "zotero-plugin-toolkit"
import { config } from "../../package.json"
import { Addon } from "./addon"

export default function globalConfig() {
  const basicTool = new BasicTool()

  function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void
  function defineGlobal(name: string, getter: () => any): void
  function defineGlobal(name: string, getter?: () => any) {
    Object.defineProperty(_globalThis, name, {
      get() {
        return getter ? getter() : basicTool.getGlobal(name)
      },
    })
  }

  if (!(basicTool.getGlobal("Zotero") as any)[config.addonInstance]) {
    defineGlobal("console", () => {
      const window = basicTool.getGlobal("Zotero").getMainWindow() as any
      return window.console
    })
    defineGlobal("window")
    defineGlobal("document")
    defineGlobal("ZoteroPane")
    defineGlobal("Zotero_Tabs")
    defineGlobal("AbortController")
    defineGlobal("FormData")

    _globalThis.addon = new Addon()
    defineGlobal("ztoolkit", () => {
      return _globalThis.addon.data.ztoolkit
    })
    ;(Zotero as any)[config.addonInstance] = addon
  }
}
