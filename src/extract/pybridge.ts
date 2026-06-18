import { getPrefStr } from "../utils/prefs"
import { getAnthropicKey, getGeminiKey } from "../utils/env"
import { joinPath, writeText } from "../utils/fs"
import { fs as log } from "../utils/loggers"
import type { PaperMeta } from "../apis/zotero/item"
import type { ConnItem } from "../render/reviewHtml"

declare const ChromeUtils: any
declare const PathUtils: any

export interface ExtractedFigure {
  n: number
  caption: string
  file: string // figures/figN.png
}

const DEFAULT_PYTHON = "/opt/homebrew/Caskroom/miniconda/base/envs/py312/bin/python"

function pythonPath(): string {
  return getPrefStr("PYTHON_PATH") || DEFAULT_PYTHON
}

/**
 * paper-curation 원본 함수를 호출하는 얇은 브리지. 임의 로직 없이 원본을 import해 그대로 실행.
 * argv: <pc_root> <subcommand> <args...>
 *  - figures <pdf> <slug_dir>   → run_update_force.extract_figures (+ raw를 .pc_figs.json에 보관)
 *  - text    <pdf> <slug_dir>   → run_update_force.extract_text
 *  - review  <slug_dir> <meta_json> → _to_item(meta) + run_update_force.write_review (text.md·figures 사용)
 *  - originality <slug_dir> <meta_json> → originality_extractor._extract_rule_based
 *  - connections <slug> <slug_dir> <topic> <meta_json> → specter2/compute_related/generate/sync
 *  - inject_frontmatter <slug> <topic> → inject_frontmatter.py build_frontmatter/…/inject_into_review
 *  - classify <slug> <topic> → classify_papers.classify_via_bundle (HDBSCAN approximate_predict)
 */
const BRIDGE_PY = `import sys, os, json

def _to_item(meta):
    # plugin PaperMeta(JSON) → write_review가 읽는 Zotero item dict
    creators = []
    for name in meta.get("authors", []):
        parts = str(name).split()
        if len(parts) >= 2:
            creators.append({"firstName": " ".join(parts[:-1]), "lastName": parts[-1]})
        elif parts:
            creators.append({"firstName": "", "lastName": parts[0]})
    return {
        "title": meta.get("title", ""),
        "creators": creators,
        "date": meta.get("date", ""),
        "DOI": meta.get("doi", ""),
        "abstractNote": meta.get("abstract", ""),
        "url": meta.get("url", ""),
        "key": meta.get("key", ""),
    }

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage"})); return
    pc_root, cmd = sys.argv[1], sys.argv[2]
    sys.path.insert(0, os.path.join(pc_root, "pipeline"))

    if cmd == "figures":
        pdf_path, slug_dir = sys.argv[3], sys.argv[4]
        import run_update_force as r
        figs = r.extract_figures(pdf_path, slug_dir) or []
        try:
            json.dump(figs, open(os.path.join(slug_dir, ".pc_figs.json"), "w"))
        except Exception:
            pass
        print(json.dumps({"figures": figs})); return

    if cmd == "text":
        pdf_path, slug_dir = sys.argv[3], sys.argv[4]
        import run_update_force as r
        r.extract_text(pdf_path, slug_dir)
        p = os.path.join(slug_dir, "text.md")
        print(json.dumps({"ok": os.path.exists(p) and os.path.getsize(p) >= 100})); return

    if cmd == "review":
        slug_dir, meta_json = sys.argv[3], sys.argv[4]
        import run_update_force as r
        meta = json.load(open(meta_json, encoding="utf-8"))
        item = _to_item(meta)
        figs = []
        fp = os.path.join(slug_dir, ".pc_figs.json")
        if os.path.exists(fp):
            try: figs = json.load(open(fp, encoding="utf-8"))
            except Exception: figs = []
        r.write_review(item, slug_dir, figs)
        p = os.path.join(slug_dir, "review.md")
        print(json.dumps({"ok": os.path.exists(p) and os.path.getsize(p) >= 200})); return

    if cmd == "originality":
        # topic_modeling.py 경로 그대로: abstract 창 → 전체 → "title. essence" (LLM 없음, 헤더 없음)
        slug_dir, meta_json = sys.argv[3], sys.argv[4]
        from lib.originality_extractor import _extract_rule_based, load_triggers
        meta = json.load(open(meta_json, encoding="utf-8"))
        tp = os.path.join(slug_dir, "text.md")
        full = open(tp, encoding="utf-8").read() if os.path.exists(tp) else ""
        triggers = load_triggers()
        abs_pos = full.lower().find("abstract")
        window = full[abs_pos:abs_pos + 1000] if abs_pos >= 0 else full[:1000]
        orig = _extract_rule_based(window, triggers) or _extract_rule_based(full, triggers)
        if not orig:
            orig = ("%s. %s" % (meta.get("title", ""), meta.get("essence", ""))).strip()
        open(os.path.join(slug_dir, "originality.md"), "w", encoding="utf-8").write(orig)
        print(json.dumps({"ok": bool(orig)})); return

    if cmd == "connections":
        # 원본 specter2 임베딩 + compute_related_candidates + generate_connections_from_candidates + sync.
        # outgoing만 (신규 논문 → 관련 논문). incoming은 paper-curation 전체 connections run에 위임.
        slug, slug_dir, topic, meta_json = sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6]
        try:
            import numpy as np
            meta = json.load(open(meta_json, encoding="utf-8"))
            docs_root = os.path.join(pc_root, "docs")
            topic_dir = os.path.join(docs_root, topic)
            cache_path = os.path.join(topic_dir, "_embeddings_cache.json")
            if not os.path.exists(cache_path):
                print(json.dumps({"ok": False, "reason": "no_cache", "connections": []})); return
            cache = json.load(open(cache_path, encoding="utf-8"))
            cached_slugs = list(cache["slugs"])
            cached_emb = np.asarray(cache["embeddings"], dtype=np.float32)

            # 신규 논문 임베드 텍스트: originality.md 우선, 없으면 "title. essence"
            op = os.path.join(slug_dir, "originality.md")
            if os.path.exists(op):
                text = open(op, encoding="utf-8").read().strip()
            else:
                text = ("%s. %s" % (meta.get("title", ""), meta.get("essence", ""))).strip()

            from lib import specter2_embed
            tag = getattr(specter2_embed, "EMBED_TAG", None)
            if tag and cache.get("embed_model") and cache["embed_model"] != tag:
                print(json.dumps({"ok": False, "reason": "tag_mismatch", "connections": []})); return
            new_vec = specter2_embed.embed_texts([text])  # (1,768)

            # 신규 벡터를 코퍼스에 splice (재실행 시 dict-merge로 교체, 정렬)
            slug_to_emb = dict(zip(cached_slugs, cached_emb))
            slug_to_emb[slug] = new_vec[0]
            slugs = sorted(slug_to_emb.keys())
            embeddings = np.asarray([slug_to_emb[s] for s in slugs], dtype=np.float32)

            from topic_modeling import (
                compute_related_candidates, generate_connections_from_candidates,
            )
            all_cand = compute_related_candidates(embeddings, slugs, top_k=5)
            cand = {slug: all_cand.get(slug, [])}
            if not cand[slug]:
                print(json.dumps({"ok": True, "connections": []})); return

            idx_path = os.path.join(docs_root, "papers", "_papers_index.json")
            all_papers = json.load(open(idx_path, encoding="utf-8"))
            wanted = set(s for s, _ in cand[slug]) | set([slug])
            topic_papers = [p for p in all_papers if p.get("slug") in wanted]
            if not any(p.get("slug") == slug for p in topic_papers):
                topic_papers.append({"slug": slug, "title": meta.get("title", ""),
                                     "essence": meta.get("essence", ""), "topics": [topic]})

            from anthropic import Anthropic
            client = Anthropic(timeout=180.0, max_retries=4)  # ANTHROPIC_API_KEY env
            conns = generate_connections_from_candidates(
                cand, topic_papers, client, priority_slugs=set([slug]))
            out = conns.get(slug, [])

            try:
                from lib.connections import sync_topic_connections
                sync_topic_connections(conns, topic, slugs, topic_dir, log=lambda *a: None)
            except Exception:
                pass  # 글로벌 동기화 실패해도 outgoing은 반환

            print(json.dumps({"ok": True, "connections": out})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e, "connections": []})); return

    if cmd == "inject_frontmatter":
        # 원본 inject_frontmatter.py의 per-paper 함수를 그대로 호출해 review.md에
        # schema-v1 frontmatter + Related Papers 섹션을 주입(본체 풀런과 동일).
        # PDF 조회는 --skip-zotero 동작과 동일하게 생략.
        slug, topic = sys.argv[3], sys.argv[4]
        try:
            import inject_frontmatter as inj
            idx_path = os.path.join(inj.PAPERS_DIR, "_papers_index.json")
            all_papers = json.load(open(idx_path, encoding="utf-8"))
            paper = next((p for p in all_papers if p.get("slug") == slug), None)
            if paper is None:
                print(json.dumps({"ok": False, "reason": "not_in_index"})); return
            md_path = os.path.join(inj.PAPERS_DIR, slug, "review.md")
            if not os.path.exists(md_path):
                print(json.dumps({"ok": False, "reason": "no_review"})); return
            conn_path = os.path.join(pc_root, "docs", topic, "_paper_connections.json")
            connections = {}
            if os.path.exists(conn_path):
                try: connections = json.load(open(conn_path, encoding="utf-8"))
                except Exception: connections = {}
            fm = inj.build_frontmatter(paper, connections, "", topic)
            fm_yaml = inj.frontmatter_to_yaml(fm)
            related = inj.build_related_section(slug, connections)
            inj.inject_into_review(md_path, fm_yaml, related)
            head = open(md_path, encoding="utf-8").read(3)
            print(json.dumps({"ok": head.startswith("---")})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e})); return

    if cmd == "classify":
        # 원본 classify_papers.classify_via_bundle 로 카테고리 배정. 토픽 이름이
        # 모델 있는 토픽과 다르면(예: slugify 로 'ai4s+scisci'→'ai4s-scisci')
        # +/- 변형·별칭으로 resolve. 결과는 논문 primary_topic 키 아래 저장해
        # inject_frontmatter 의 build_frontmatter 가 읽도록 한다.
        slug, topic = sys.argv[3], sys.argv[4]
        try:
            import tempfile
            import classify_papers as C
            from config_loader import get_topic_dir
            from topic_modeling import extract_originalities, compute_embeddings
            docs = os.path.join(pc_root, "docs")
            def _has_model(t):
                return bool(t) and os.path.exists(os.path.join(docs, t, "_hdbscan_model.joblib"))
            alias = {"science-of-science": "scisci", "ai-for-science": "ai4s"}
            cands = [topic, topic.replace("-", "+"), alias.get(topic, "")]
            model_topic = next((t for t in cands if _has_model(t)), None)
            if not model_topic:
                print(json.dumps({"ok": False, "reason": "no_model_topic:%s" % topic})); return
            idx_path = os.path.join(docs, "papers", "_papers_index.json")
            arr = json.load(open(idx_path, encoding="utf-8"))
            p = next((x for x in arr if x.get("slug") == slug), None)
            if p is None:
                print(json.dumps({"ok": False, "reason": "not_in_index"})); return
            bundle = C.load_bundle(str(get_topic_dir(model_topic)))
            origs = extract_originalities([p])
            if not origs:
                print(json.dumps({"ok": False, "reason": "no_originality"})); return
            tmp = tempfile.mktemp(suffix=".json")
            embs, _slugs = compute_embeddings(origs, tmp)
            try: os.remove(tmp)
            except Exception: pass
            primary, all_cats, sub, sub_map, _raw = C.classify_via_bundle(embs[0], bundle)
            cls = {"primary_category": primary, "all_categories": all_cats,
                   "sub_category": sub, "sub_categories": sub_map}
            ptopic = p.get("primary_topic") or topic
            p.setdefault("classifications", {})[ptopic] = cls
            json.dump(arr, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            print(json.dumps({"ok": True, "primary_category": primary, "model_topic": model_topic})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e})); return

    if cmd == "integrate":
        # 신규 논문을 토픽 뷰에 반영: Deep Research(build_search_index) + category
        # 페이지(build_topic_index) + network(generate_network) 재생성. 각 스크립트를
        # py312 서브프로세스로 실행(청크 임베딩 캐시 히트라 비용 낮음). cwd=pc_root.
        topic = sys.argv[3]
        import subprocess
        pipe = os.path.join(pc_root, "pipeline")
        steps = [
            ("build_search_index.py", ["--topic", topic]),
            ("build_topic_index.py", [topic]),
            ("generate_network.py", ["--topic", topic]),
        ]
        results = {}
        ok = True
        for script, sargs in steps:
            sp = os.path.join(pipe, script)
            if not os.path.exists(sp):
                results[script] = "missing"; ok = False; continue
            try:
                cp = subprocess.run([sys.executable, sp, *sargs], cwd=pc_root,
                                    capture_output=True, text=True, timeout=2400)
                results[script] = "ok" if cp.returncode == 0 else "fail:%d" % cp.returncode
                if cp.returncode != 0:
                    ok = False
            except Exception as e:
                results[script] = "error:%s" % e; ok = False
        print(json.dumps({"ok": ok, "results": results})); return

    print(json.dumps({"error": "unknown cmd: %s" % cmd}))

if __name__ == "__main__":
    main()
`

let _subprocess: any

async function getSubprocess(): Promise<any | null> {
  if (_subprocess !== undefined) return _subprocess
  try {
    const mod = await ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    )
    if (mod?.Subprocess) {
      _subprocess = mod.Subprocess
      return _subprocess
    }
  } catch {
    /* try jsm */
  }
  try {
    const mod = (ChromeUtils as any).import(
      "resource://gre/modules/Subprocess.jsm",
    )
    if (mod?.Subprocess) {
      _subprocess = mod.Subprocess
      return _subprocess
    }
  } catch {
    /* none */
  }
  _subprocess = null
  return null
}

async function ensureBridgeScript(): Promise<string> {
  const dir = joinPath(PathUtils.profileDir, "papercurio")
  const path = joinPath(dir, "pc_bridge.py")
  await writeText(path, BRIDGE_PY)
  return path
}

interface PyResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number
}

async function runPython(
  args: string[],
  env?: Record<string, string>,
): Promise<PyResult> {
  const Subprocess = await getSubprocess()
  if (!Subprocess) {
    return { ok: false, stdout: "", stderr: "Subprocess 모듈 접근 불가", code: -1 }
  }
  try {
    const opts: any = { command: pythonPath(), arguments: args, stderr: "pipe" }
    if (env && Object.keys(env).length) {
      opts.environment = env
      opts.environmentAppend = true // 기존 env(PATH 등) 보존하며 추가
    }
    const proc = await Subprocess.call(opts)
    const readAll = async (stream: any) => {
      let s = ""
      let c: string | null
      while ((c = await stream.readString())) s += c
      return s
    }
    const [stdout, stderr, status] = await Promise.all([
      readAll(proc.stdout),
      readAll(proc.stderr),
      proc.wait(),
    ])
    return { ok: status.exitCode === 0, stdout, stderr, code: status.exitCode }
  } catch (e) {
    return { ok: false, stdout: "", stderr: String(e), code: -1 }
  }
}

function lastJson(stdout: string): any {
  try {
    return JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() || "{}")
  } catch {
    return {}
  }
}

/** 원본 extract_figures → figures/figN.png. 실패 시 빈 배열. */
export async function extractFiguresViaBridge(
  pdfPath: string,
  slugDir: string,
  pcRoot: string,
): Promise<ExtractedFigure[]> {
  if (!pdfPath || !pcRoot) return []
  try {
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "figures", pdfPath, slugDir])
    if (!r.ok) {
      log("figure 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 300))
      return []
    }
    const figs: any[] = lastJson(r.stdout).figures || []
    return figs.map((f) => ({
      n: parseInt(f.name, 10) || 0,
      caption: String(f.caption || ""),
      file: `figures/fig${f.name}.png`,
    }))
  } catch (e) {
    log("extractFiguresViaBridge 예외", e)
    return []
  }
}

/** 원본 extract_text → text.md. 성공 여부 반환. */
export async function extractTextViaBridge(
  pdfPath: string,
  slugDir: string,
  pcRoot: string,
): Promise<boolean> {
  if (!pdfPath || !pcRoot) return false
  try {
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "text", pdfPath, slugDir])
    if (!r.ok) {
      log("text 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 300))
      return false
    }
    return !!lastJson(r.stdout).ok
  } catch (e) {
    log("extractTextViaBridge 예외", e)
    return false
  }
}

/**
 * 원본 write_review로 review.md 생성. ANTHROPIC_API_KEY를 env로 주입.
 * 키 없거나 실패 시 false (호출부가 TS 폴백).
 */
export async function writeReviewViaBridge(
  slugDir: string,
  meta: PaperMeta,
  pcRoot: string,
): Promise<boolean> {
  const key = getAnthropicKey()
  if (!key || !pcRoot) return false
  try {
    const metaPath = joinPath(slugDir, "_pc_meta.json")
    await writeText(metaPath, JSON.stringify(meta))
    const script = await ensureBridgeScript()
    const r = await runPython(
      [script, pcRoot, "review", slugDir, metaPath],
      { ANTHROPIC_API_KEY: key },
    )
    if (!r.ok) {
      log("review 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 300))
      return false
    }
    return !!lastJson(r.stdout).ok
  } catch (e) {
    log("writeReviewViaBridge 예외", e)
    return false
  }
}

/**
 * 원본 specter2/compute_related/generate/sync로 연관 논문(outgoing) 생성.
 * 캐시 없는 topic·tag 불일치·키 없음·실패 → null (호출부가 TS 폴백).
 * 반환 ConnItem은 title이 비어있을 수 있음(호출부에서 인덱스로 보강).
 */
export async function generateConnectionsViaBridge(
  topic: string,
  slug: string,
  slugDir: string,
  meta: PaperMeta & { essence?: string },
  pcRoot: string,
): Promise<ConnItem[] | null> {
  const key = getAnthropicKey()
  if (!key || !pcRoot || !topic) return null
  try {
    const metaPath = joinPath(slugDir, "_pc_conn.json")
    await writeText(metaPath, JSON.stringify(meta))
    const script = await ensureBridgeScript()
    const r = await runPython(
      [script, pcRoot, "connections", slug, slugDir, topic, metaPath],
      { ANTHROPIC_API_KEY: key },
    )
    if (!r.ok) {
      log("connections 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return null
    }
    const j = lastJson(r.stdout)
    if (!j.ok) {
      log("connections 브리지 ok=false", j.reason || "")
      return null
    }
    const arr: any[] = j.connections || []
    return arr.map((c) => ({
      relation: c.relation,
      slug: c.slug,
      title: c.title || "",
      reason: c.reason || "",
    }))
  } catch (e) {
    log("generateConnectionsViaBridge 예외", e)
    return null
  }
}

/**
 * 원본 originality 경로(_extract_rule_based → "title. essence")로 originality.md 생성.
 * LLM 없음 → 키 불필요. text.md가 먼저 있어야 함. 실패 시 false.
 */
export async function extractOriginalityViaBridge(
  slugDir: string,
  title: string,
  essence: string,
  pcRoot: string,
): Promise<boolean> {
  if (!pcRoot) return false
  try {
    const metaPath = joinPath(slugDir, "_pc_orig.json")
    await writeText(metaPath, JSON.stringify({ title, essence }))
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "originality", slugDir, metaPath])
    if (!r.ok) {
      log("originality 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return false
    }
    return !!lastJson(r.stdout).ok
  } catch (e) {
    log("extractOriginalityViaBridge 예외", e)
    return false
  }
}

/**
 * 원본 inject_frontmatter.py 함수로 review.md에 schema-v1 frontmatter +
 * Related Papers 섹션 주입(본체 풀런과 동일 출력). _papers_index.json에 해당
 * 엔트리가 먼저 있어야 함. paper-curation/모듈 없으면 false (review.md는 그대로).
 */
export async function injectFrontmatterViaBridge(
  slug: string,
  topic: string,
  pcRoot: string,
): Promise<boolean> {
  if (!pcRoot || !slug || !topic) return false
  try {
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "inject_frontmatter", slug, topic])
    if (!r.ok) {
      log("inject_frontmatter 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return false
    }
    const j = lastJson(r.stdout)
    if (!j.ok) log("inject_frontmatter ok=false", j.reason || "")
    return !!j.ok
  } catch (e) {
    log("injectFrontmatterViaBridge 예외", e)
    return false
  }
}

/**
 * 원본 classify_papers.classify_via_bundle 로 카테고리(primary/all/sub) 배정.
 * 토픽에 HDBSCAN 모델이 있어야 함(+/- 변형·별칭 resolve). 결과는 _papers_index 의
 * classifications[primary_topic] 에 기록 → 이후 inject_frontmatter 가 frontmatter 에 반영.
 * 모델 없거나 실패 시 false (분류 생략, 기존 동작과 동일).
 */
export async function classifyViaBridge(
  slug: string,
  topic: string,
  pcRoot: string,
): Promise<boolean> {
  if (!pcRoot || !slug || !topic) return false
  try {
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "classify", slug, topic])
    if (!r.ok) {
      log("classify 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return false
    }
    const j = lastJson(r.stdout)
    if (!j.ok) {
      log("classify ok=false", j.reason || "")
      return false
    }
    log(`classify OK: ${j.primary_category || ""} (model=${j.model_topic || ""})`)
    return true
  } catch (e) {
    log("classifyViaBridge 예외", e)
    return false
  }
}

/**
 * 신규 논문을 paper-curation 토픽 뷰에 반영 — Deep Research(build_search_index) +
 * category 페이지(build_topic_index) + network(generate_network) 재생성. GOOGLE/
 * GEMINI(임베딩)·ANTHROPIC 키를 env 로 주입. 일부라도 실패하면 false(무거우므로
 * 호출부가 무시하고 다음 paper-curation 풀런에 위임 가능).
 */
export async function integrateViaBridge(
  topic: string,
  pcRoot: string,
): Promise<boolean> {
  if (!pcRoot || !topic) return false
  try {
    const script = await ensureBridgeScript()
    const env: Record<string, string> = {}
    const g = getGeminiKey()
    if (g) {
      env.GOOGLE_API_KEY = g
      env.GEMINI_API_KEY = g
    }
    const a = getAnthropicKey()
    if (a) env.ANTHROPIC_API_KEY = a
    const r = await runPython([script, pcRoot, "integrate", topic], env)
    if (!r.ok) {
      log("integrate 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return false
    }
    const j = lastJson(r.stdout)
    log(`integrate ${j.ok ? "OK" : "부분실패"}: ${JSON.stringify(j.results || {})}`)
    return !!j.ok
  } catch (e) {
    log("integrateViaBridge 예외", e)
    return false
  }
}
