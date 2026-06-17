import { getPrefStr } from "../utils/prefs"
import { zotero as log } from "../utils/loggers"

/**
 * topic slug 변환 (paper-curation category_slug 정신: 소문자, 공백→하이픈, & → and, 쉼표 제거).
 */
function slugifyTopic(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/,/g, "")
    .replace(/[^\w가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** pref COLLECTION_TOPIC_MAP (JSON: {"AI for Science":"ai4s", ...}) 파싱. */
function collectionTopicMap(): Record<string, string> {
  const raw = getPrefStr("COLLECTION_TOPIC_MAP")
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === "object" ? obj : {}
  } catch {
    return {}
  }
}

/**
 * item이 속한 Zotero collection(들) → topic 목록.
 * 매핑 pref에 있으면 매핑값, 없으면 collection명을 slugify. 부모 collection도 포함.
 * 비면 빈 배열 (호출부가 uncategorized 폴백).
 */
export function getItemTopics(item: Zotero.Item): string[] {
  const map = collectionTopicMap()
  const topics: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    if (!name) return
    const topic = map[name] || slugifyTopic(name)
    if (topic && !seen.has(topic)) {
      seen.add(topic)
      topics.push(topic)
    }
  }
  try {
    const collIds = item.getCollections() as number[]
    for (const id of collIds) {
      let coll: any = Zotero.Collections.get(id)
      // 부모 collection까지 따라 올라감
      let guard = 0
      while (coll && guard < 10) {
        add(coll.name)
        coll = coll.parentID ? Zotero.Collections.get(coll.parentID) : null
        guard++
      }
    }
  } catch (e) {
    log("getItemTopics 실패", e)
  }
  return topics
}
