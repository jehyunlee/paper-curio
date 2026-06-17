import { config } from "../../package.json"

export { initLocale, getString }

/**
 * Initialize locale data. 이 플러그인은 한글 전용 fork가 아니라 ko/en 양쪽을 제공하되,
 * Zotero UI 언어를 따른다. (ko-KR 사용자는 한국어, 그 외 en-US)
 */
function initLocale() {
  const LocalizationCtor =
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  const l10n = new (LocalizationCtor as any)(
    [`${config.addonRef}-addon.ftl`],
    true,
  )
  addon.data.locale = { current: l10n }
}

function getString(localeString: string): string
function getString(localeString: string, branch: string): string
function getString(
  localeString: string,
  options: { branch?: string; args?: Record<string, unknown> },
): string
function getString(...inputs: any[]): string {
  if (inputs.length === 1) {
    return _getString(inputs[0])
  } else if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      return _getString(inputs[0], { branch: inputs[1] })
    } else {
      return _getString(inputs[0], inputs[1])
    }
  }
  throw new Error("Invalid arguments")
}

function _getString(
  localeString: string,
  options: { branch?: string; args?: Record<string, unknown> } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`
  const { branch, args } = options
  try {
    const pattern = addon.data.locale?.current.formatMessagesSync([
      { id: localStringWithPrefix, args },
    ])[0]
    if (!pattern) return localStringWithPrefix
    if (branch && pattern.attributes) {
      return pattern.attributes[branch] || localStringWithPrefix
    }
    return pattern.value || localStringWithPrefix
  } catch {
    return localStringWithPrefix
  }
}
