import { getPrefStr } from "../utils/prefs"
import { readJson, joinPath } from "../utils/fs"
import { zotero as log } from "../utils/loggers"

/**
 * topic slug 변환 (paper-curation category_slug 정신: 소문자, 공백→하이픈, & → and, 쉼표 제거).
 * 폴백 전용 — 캐노니컬 토픽 별칭(ai4s/scisci/ai4s+scisci)은 config.json 역매핑이 우선.
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
 * paper-curation config.json 의 zotero.collections({topic: collectionName})를
 * 역매핑해 {collectionName → topic} 를 만든다 (원문/소문자/slugify 세 키 모두 등록).
 * 이게 캐노니컬 진실(ai4s/scisci/ai4s+scisci 같은 임의 별칭 포함)이라, 컬렉션명을
 * 기계적으로 slugify 하던 폴백보다 우선해서 토픽 멤버십을 paper-curation 과 일치시킨다.
 */
async function pcCollectionTopicMap(pcRoot?: string): Promise<Record<string, string>> {
  if (!pcRoot) return {}
  try {
    const cfg = await readJson<any>(joinPath(pcRoot, "config.json"), {})
    const colls = (cfg && cfg.zotero && cfg.zotero.collections) || {}
    const inv: Record<string, string> = {}
    for (const topic of Object.keys(colls)) {
      const name = colls[topic]
      if (typeof name === "string" && name) {
        inv[name] = topic
        inv[name.toLowerCase()] = topic
        inv[slugifyTopic(name)] = topic
      }
    }
    return inv
  } catch (e) {
    log("config.json collections 읽기 실패", e)
    return {}
  }
}

/**
 * item이 속한 Zotero collection(들) → topic 목록. 부모 collection도 따라 올라가며 포함.
 * 우선순위: pref COLLECTION_TOPIC_MAP → paper-curation config.json(zotero.collections)
 * 역매핑(캐노니컬) → slugify 폴백. config/pref 로 매핑된 캐노니컬 토픽(모델 번들이 있는
 * ai4s/scisci 등)을 앞에 두어 primary_topic 이 임의 sub-collection 이름이 아니라 진짜
 * 토픽이 되게 한다. 비면 빈 배열(호출부가 uncategorized 폴백).
 */
/** Collection display name -> paper-curation topic (config reverse map first,
 *  else slugified name). Mirrors getItemTopics' resolution for a collection. */
export async function topicForCollection(
  name: string,
  pcRoot?: string,
): Promise<string> {
  return (await resolveCollectionTopic(name, pcRoot)).topic
}

/**
 * topicForCollection 과 같되, topic 이 config/pref 매핑에서 왔는지(mapped=true)
 * 아니면 slugify 폴백인지(mapped=false — 즉 아직 등록 안 된 신규 컬렉션) 함께 반환.
 */
export async function resolveCollectionTopic(
  name: string,
  pcRoot?: string,
): Promise<{ topic: string; mapped: boolean }> {
  const pref = collectionTopicMap()
  const pc = await pcCollectionTopicMap(pcRoot)
  const found =
    pref[name] ||
    pref[name.toLowerCase()] ||
    pc[name] ||
    pc[name.toLowerCase()] ||
    pc[slugifyTopic(name)]
  if (found) return { topic: found, mapped: true }
  return { topic: slugifyTopic(name), mapped: false }
}

export async function getItemTopics(
  item: Zotero.Item,
  pcRoot?: string,
): Promise<string[]> {
  const prefMap = collectionTopicMap()
  const pcMap = await pcCollectionTopicMap(pcRoot)
  const canon: string[] = []
  const other: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    if (!name) return
    const mapped = prefMap[name] || pcMap[name] || pcMap[(name || "").toLowerCase()]
    const topic = mapped || slugifyTopic(name)
    if (!topic || seen.has(topic)) return
    seen.add(topic)
    ;(mapped ? canon : other).push(topic)
  }
  try {
    const collIds = item.getCollections() as number[]
    for (const id of collIds) {
      let coll: any = Zotero.Collections.get(id)
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
  return [...canon, ...other]
}
