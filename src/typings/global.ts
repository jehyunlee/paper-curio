declare global {
  const __env__: "production" | "development"
  const _globalThis: {
    [key: string]: any
    Zotero: _ZoteroTypes.Zotero
    ztoolkit: ZToolkit
    addon: typeof addon
  }
  type ZToolkit = import("../settings/addon").CustomToolkit
  const ztoolkit: ZToolkit
  const rootURI: string
  const addon: import("../settings/addon").Addon
}

export {}
