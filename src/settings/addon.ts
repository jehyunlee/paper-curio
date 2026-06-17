import hooks from "./hooks"
import { config } from "../../package.json"
import {
  BasicTool,
  unregister,
  UITool,
  MenuManager,
  ProgressWindowHelper,
  ExtraFieldTool,
} from "zotero-plugin-toolkit"

export class Addon {
  public data: {
    alive: boolean
    env: "development" | "production"
    ztoolkit: CustomToolkit
    locale?: {
      current: any
    }
    prefs?: {
      window: Window
    }
  }
  public hooks: typeof hooks
  public api: object

  constructor() {
    const ztoolkit = new CustomToolkit()
    this.data = {
      alive: true,
      env: __env__,
      ztoolkit,
    }
    this.hooks = hooks
    this.api = {}
  }
}

export class CustomToolkit extends BasicTool {
  UI: UITool
  Menu: MenuManager
  ProgressWindow: typeof ProgressWindowHelper
  ExtraField: ExtraFieldTool

  constructor() {
    super()
    this.UI = new UITool(this)
    this.Menu = new MenuManager(this)
    this.ProgressWindow = ProgressWindowHelper
    this.ProgressWindow.setIconURI(
      "default",
      `chrome://${config.addonRef}/content/icons/favicon.png`,
    )
    this.ExtraField = new ExtraFieldTool(this)
  }

  unregisterAll() {
    unregister(this)
  }
}
