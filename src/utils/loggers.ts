function createLogger(category: string) {
  return function (...messages: any) {
    try {
      ztoolkit.log(`[papercurio/${category}]`, ...messages)
    } catch {
      // ztoolkit not ready yet
    }
  }
}

export const menu = createLogger("menu")
export const pipeline = createLogger("pipeline")
export const llm = createLogger("llm")
export const fs = createLogger("fs")
export const discovery = createLogger("discovery")
export const zotero = createLogger("zotero")
