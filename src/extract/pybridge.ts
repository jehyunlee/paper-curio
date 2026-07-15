import { getPref, getPrefStr, setPref } from "../utils/prefs"
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
 *  - compare <slugs_csv> → compare_papers.run_compare (다중 논문 비교 HTML/md 생성)
 *  - ensure_env <managed_dir> → py312(+deps) 인터프리터 확보 (없으면 venv 생성/파이썬 다운로드)
 *  - run_full <topic> → run_full.py --mode curate --source zotero --images all (배포 제외, py312 실행)
 */
const BRIDGE_PY = `import sys, os, json, subprocess

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


def _run(cmd, timeout=None):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _run_log(cmd, timeout=None):
    # stdout 을 캡처해 stderr 로만 흘린다 — 브리지 stdout 은 최종 JSON 만 남겨야
    # lastJson() 파싱이 깨지지 않는다.
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.stdout:
        sys.stderr.write(r.stdout)
    if r.stderr:
        sys.stderr.write(r.stderr)
    sys.stderr.flush()
    return r


def _is_py312(py):
    if not py or not os.path.exists(py):
        return False
    try:
        r = _run([py, "-c", "import sys;print('%d.%d' % sys.version_info[:2])"], timeout=30)
        return r.returncode == 0 and (r.stdout or "").strip() == "3.12"
    except Exception:
        return False


def _probe_deps(py):
    # 파이프라인이 실제로 요구하는 무거운 의존성만 게이트로 삼는다.
    try:
        r = _run([py, "-c", "import fitz, umap, hdbscan, sentence_transformers"], timeout=180)
        return r.returncode == 0
    except Exception:
        return False


def _plat_tag():
    import platform
    m = platform.machine()
    if m in ("arm64", "aarch64"):
        return "aarch64-apple-darwin"
    return "x86_64-apple-darwin"


def _find_py312_candidates(pc_root, managed):
    import shutil
    out = []
    def add(p):
        p = (p or "").strip()
        if p and p not in out:
            out.append(p)
    add(os.path.join(managed, "venv312", "bin", "python"))
    add(os.environ.get("PAPER_CURATION_PY312", ""))
    add(os.environ.get("PC_PYTHON_PATH", ""))
    add("/opt/homebrew/Caskroom/miniconda/base/envs/py312/bin/python")
    add("/opt/homebrew/opt/python@3.12/bin/python3.12")
    add("/usr/local/opt/python@3.12/bin/python3.12")
    add(shutil.which("python3.12"))
    add(os.path.join(managed, "python312", "python", "bin", "python3.12"))
    return out


def _make_venv(base, venv_dir):
    sys.stderr.write("[ensure_env] creating venv: %s (base=%s)\n" % (venv_dir, base))
    sys.stderr.flush()
    r = _run_log([base, "-m", "venv", venv_dir], timeout=300)
    if r.returncode != 0:
        raise RuntimeError("venv creation failed (exit %d)" % r.returncode)


def _pip_install(py, pc_root):
    req = os.path.join(pc_root, "requirements.txt")
    sys.stderr.write("[ensure_env] installing dependencies (can take several minutes)...\n")
    sys.stderr.flush()
    _run_log([py, "-m", "pip", "install", "--upgrade", "pip"], timeout=600)
    r = _run_log([py, "-m", "pip", "install", "-r", req], timeout=5400)
    if r.returncode != 0:
        raise RuntimeError("pip install failed (exit %d)" % r.returncode)


def _download_standalone(managed):
    import urllib.request, tarfile, platform, json as _json
    dest = os.path.join(managed, "python312")
    cand = os.path.join(dest, "python", "bin", "python3.12")
    if os.path.exists(cand):
        return cand
    if platform.system() != "Darwin":
        raise RuntimeError("auto-download supports macOS only; install Python 3.12 manually")
    os.makedirs(dest, exist_ok=True)
    tag = _plat_tag()
    api = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
    req = urllib.request.Request(api, headers={"User-Agent": "paper-curio"})
    data = _json.load(urllib.request.urlopen(req, timeout=60))
    url = ""
    for a in data.get("assets", []):
        n = a.get("name", "")
        if "cpython-3.12" in n and tag in n and n.endswith("install_only.tar.gz"):
            url = a.get("browser_download_url", "")
            break
    if not url:
        raise RuntimeError("no python-build-standalone 3.12 asset for %s" % tag)
    sys.stderr.write("[ensure_env] downloading Python 3.12: %s\n" % url)
    sys.stderr.flush()
    tgz = os.path.join(managed, "_py312.tar.gz")
    urllib.request.urlretrieve(url, tgz)
    with tarfile.open(tgz) as t:
        t.extractall(dest)
    try:
        os.remove(tgz)
    except Exception:
        pass
    if not os.path.exists(cand):
        raise RuntimeError("standalone extract missing python3.12")
    return cand


def _ensure_py312(pc_root, managed):
    cands = _find_py312_candidates(pc_root, managed)
    for c in cands:
        if _is_py312(c) and _probe_deps(c):
            return c, "found"
    venv_dir = os.path.join(managed, "venv312")
    venv_py = os.path.join(venv_dir, "bin", "python")
    base = None
    for c in cands:
        if c != venv_py and _is_py312(c):
            base = c
            break
    action = "venv-created"
    if base is None:
        base = _download_standalone(managed)
        action = "downloaded"
    if not _is_py312(venv_py):
        _make_venv(base, venv_dir)
    _pip_install(venv_py, pc_root)
    if _is_py312(venv_py) and _probe_deps(venv_py):
        return venv_py, action
    raise RuntimeError("environment prepared but dependency import still fails")

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
            # 연결 생성 LLM 호출은 출력이 커서 느린 망에선 기본 180s 를 넘겨 타임아웃 →
            # 폴백으로 빠지고 JSON 영속화가 누락된다. env 로 상향(기본 500s).
            # generate_connections_from_candidates 가 내부에서 with_options(request_timeout_s)
            # 로 클라이언트 타임아웃을 덮어쓰므로, 같은 값을 명시적으로 전달해야 실제로 적용된다.
            _to = float(os.environ.get("PC_CONN_HTTP_TIMEOUT", "500"))
            client = Anthropic(timeout=_to, max_retries=2)  # ANTHROPIC_API_KEY env
            conns = generate_connections_from_candidates(
                cand, topic_papers, client, priority_slugs=set([slug]),
                request_timeout_s=_to)
            out = conns.get(slug, [])

            try:
                from lib.connections import sync_topic_connections
                sync_topic_connections(conns, topic, slugs, topic_dir, log=lambda *a: None)
                # 신규 논문 N 의 연결 상대(이웃) 개별 페이지를 다시 렌더 — N→이웃 의
                # 역방향 엣지(이웃→N)가 이웃의 "같이 보면 좋은 논문" 에 즉시 뜨도록.
                # (N 자신의 페이지는 이후 단계가 렌더한다. 이웃은 _paper_connections 를
                #  직접 읽으므로 sync 직후 재렌더하면 N 이 반영된다.)
                try:
                    import review_to_html as _RTH
                    _neighbors = [c.get("slug") for c in out if c.get("slug")]
                    if _neighbors:
                        _RTH._run_review_to_html(slugs=_neighbors)
                except Exception:
                    pass  # 이웃 재렌더 실패해도 본 작업은 영향 없음
            except Exception:
                pass  # 글로벌 동기화 실패해도 outgoing은 반환

            print(json.dumps({"ok": True, "connections": out})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e, "connections": []})); return

    if cmd == "sync_conns":
        # TS 폴백이 계산한 connections 를 토픽 _paper_connections.json + global 에 영속화.
        # 브리지(LLM) 경로가 실패해 폴백으로 빠져도 Deep Research 그래프/본체 파이프라인이
        # 이 논문을 보게 하여 연결 갭을 구조적으로 막는다.
        # argv: <pc_root> sync_conns <slug> <topic> <conns_json_path>
        slug, topic, conns_path = sys.argv[3], sys.argv[4], sys.argv[5]
        try:
            docs_root = os.path.join(pc_root, "docs")
            topic_dir = os.path.join(docs_root, topic)
            conns_in = json.load(open(conns_path, encoding="utf-8")) or []
            # {slug,relation,reason} 만 남긴다(sync_topic_connections 가 기대하는 형식)
            norm = [{"slug": c.get("slug"), "relation": c.get("relation", "alternative"),
                     "reason": c.get("reason", "")}
                    for c in conns_in if c.get("slug")]
            if not norm:
                print(json.dumps({"ok": True, "synced": 0})); return
            # filter_for_topic 가 이 slug 를 떨궈내지 않도록 topic_slugs 에 포함
            cls_path = os.path.join(topic_dir, "_new_classification.json")
            slugs = []
            if os.path.exists(cls_path):
                slugs = [a["slug"] for a in
                         json.load(open(cls_path, encoding="utf-8")).get("assignments", [])
                         if a.get("slug")]
            if slug not in slugs:
                slugs = list(slugs) + [slug]
            from lib.connections import sync_topic_connections
            sync_topic_connections({slug: norm}, topic, slugs, topic_dir, log=lambda *a: None)
            print(json.dumps({"ok": True, "synced": len(norm)})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e})); return

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
            import classify_papers as C
            docs = os.path.join(pc_root, "docs")
            def _has_model(t):
                return bool(t) and os.path.exists(os.path.join(docs, t, "_hdbscan_model.joblib"))
            alias = {"science-of-science": "scisci", "ai-for-science": "ai4s"}
            cands = [topic, topic.replace("-", "+"), alias.get(topic, "")]
            model_topic = next((t for t in cands if _has_model(t)), None)
            if not model_topic:
                print(json.dumps({"ok": False, "reason": "no_model_topic:%s" % topic})); return
            # Canonical classifier (원본 classify_papers._run_classify): 임베딩을
            # 실제 _embeddings_cache.json 에 영속화 + {topic}/_new_classification.json
            # 재기록 + _papers_index classifications + _umap_coords 까지 일괄 갱신한다.
            # → 신규 논문이 연결/네트워크/인덱스 코퍼스의 1급 멤버가 된다.
            # (기존 classify_via_bundle 경로는 인덱스 + 임시 임베딩만 써서, curio 논문이
            #  분류는 됐어도 _new_classification.json·임베딩 캐시에 빠져 연결 패스에서
            #  제외됐다. slugs=slug 로 해당 논문만 재분류하고 나머지는 보존.)
            C._run_classify(model_topic, slugs=slug)
            idx_path = os.path.join(docs, "papers", "_papers_index.json")
            arr = json.load(open(idx_path, encoding="utf-8"))
            p = next((x for x in arr if x.get("slug") == slug), None)
            if p is None:
                print(json.dumps({"ok": False, "reason": "not_in_index"})); return
            primary = ((p.get("classifications", {}) or {}).get(model_topic, {})
                       or {}).get("primary_category")
            print(json.dumps({"ok": True, "primary_category": primary, "model_topic": model_topic})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e})); return

    if cmd == "integrate":
        # 신규 논문을 토픽 뷰에 반영. 먼저 연결을 *완성*(extract_insights
        # --connections-only)한 뒤 뷰를 렌더한다:
        #   - extract_insights : 연결 완성. 신규 논문의 outbound 뿐 아니라 inbound/허브
        #     까지 채우고 top-25 후보로 recall 을 넓힌다. conn 캐시(증분)라 전체
        #     ~2만 개 재생성이 아니라 dirty(신규 + top-k 바뀐 이웃)만 → 저렴.
        #   - build_search_index(Deep Research) + build_topic_index(category) +
        #     generate_network(network) : 완성된 연결을 뷰에 반영. 청크 임베딩 캐시
        #     히트라 비용 낮음.
        # 각 스크립트를 py312 서브프로세스로 실행. cwd=pc_root.
        topic = sys.argv[3]
        import subprocess
        pipe = os.path.join(pc_root, "pipeline")
        steps = [
            ("extract_insights.py", ["--topic", topic, "--connections-only"]),
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

    if cmd == "deploy":
        # Publish a topic to Cloudflare via prepare_deploy (key strip ->
        # wrangler deploy -> gh-pages stubs -> 200 OK check). CF credentials:
        # process env first, then config.json so it works even when Zotero was
        # launched without shell exports.
        topic = sys.argv[3]
        import subprocess
        sp = os.path.join(pc_root, "pipeline", "prepare_deploy.py")
        if not os.path.exists(sp):
            print(json.dumps({"ok": False, "reason": "no_prepare_deploy"})); return
        env = dict(os.environ)
        try:
            cfg = json.load(open(os.path.join(pc_root, "config.json"), encoding="utf-8"))
            cf = cfg.get("cloudflare") or {}
            tok = (env.get("CF_API_TOKEN") or env.get("CLOUDFLARE_API_TOKEN")
                   or cf.get("api_token") or cfg.get("cloudflare_api_token") or "")
            acct = (env.get("CLOUDFLARE_ACCOUNT_ID") or cf.get("account_id")
                    or cfg.get("cloudflare_account_id") or "")
            if tok:
                env["CF_API_TOKEN"] = tok; env["CLOUDFLARE_API_TOKEN"] = tok
            if acct:
                env["CLOUDFLARE_ACCOUNT_ID"] = acct
        except Exception:
            pass
        if not env.get("CF_API_TOKEN") or not env.get("CLOUDFLARE_ACCOUNT_ID"):
            print(json.dumps({"ok": False, "reason": "no_cf_credentials"})); return
        try:
            cp = subprocess.run([sys.executable, sp, "--topic", topic, "--push"],
                                cwd=pc_root, capture_output=True, text=True,
                                timeout=1800, env=env)
            tail = ((cp.stdout or "") + " " + (cp.stderr or ""))[-600:]
            print(json.dumps({"ok": cp.returncode == 0, "code": cp.returncode, "tail": tail})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e})); return

    if cmd == "compare":
        # Multi-paper comparison — compare_papers.run_compare writes
        # docs/papers/_comparisons/<name>/{index.html, comparison.md} and
        # returns {ok, html, md, dir, title}. Its progress logs go to stdout
        # BEFORE the final JSON line, which lastJson() on the TS side skips.
        slugs = [s.strip() for s in sys.argv[3].split(",") if s.strip()]
        try:
            import compare_papers as CP
            print(json.dumps(CP.run_compare(slugs))); return
        except SystemExit as e:
            print(json.dumps({"ok": False, "reason": str(e)})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e})); return

    if cmd == "ensure_env":
        managed = sys.argv[3] if len(sys.argv) > 3 else os.path.join(pc_root, ".pc_managed")
        os.makedirs(managed, exist_ok=True)
        try:
            py, action = _ensure_py312(pc_root, managed)
            print(json.dumps({"ok": True, "python": py, "action": action})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": str(e)})); return

    if cmd == "run_full":
        # Full pipeline for a topic: Zotero sync -> review new -> classify ->
        # timeline images. Cloudflare deploy suppressed (use the Deploy menu).
        topic = sys.argv[3]
        sp = os.path.join(pc_root, "pipeline", "run_full.py")
        if not os.path.exists(sp):
            print(json.dumps({"ok": False, "reason": "no_run_full"})); return
        env = dict(os.environ)
        env["PAPER_CURATION_NO_DEPLOY"] = "1"
        env["PYTHONUTF8"] = "1"
        try:
            cp = subprocess.run(
                [sys.executable, "-u", sp, "--topic", topic,
                 "--mode", "curate", "--source", "zotero", "--images", "all"],
                cwd=pc_root, capture_output=True, text=True, timeout=28800, env=env)
            tail = ((cp.stdout or "") + " " + (cp.stderr or ""))[-800:]
            print(json.dumps({"ok": cp.returncode == 0, "code": cp.returncode, "tail": tail})); return
        except subprocess.TimeoutExpired:
            print(json.dumps({"ok": False, "reason": "timeout"})); return
        except Exception as e:
            print(json.dumps({"ok": False, "reason": "error:%s" % e})); return

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
  exe?: string,
): Promise<PyResult> {
  const Subprocess = await getSubprocess()
  if (!Subprocess) {
    return { ok: false, stdout: "", stderr: "Subprocess 모듈 접근 불가", code: -1 }
  }
  try {
    const opts: any = { command: exe || pythonPath(), arguments: args, stderr: "pipe" }
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
 * TS 폴백이 계산한 connections 를 토픽 _paper_connections.json + global 에 영속화.
 * 브리지(LLM) 경로가 실패해 폴백으로 빠져도 연결이 JSON 스토어에 남아 Deep Research
 * 그래프/본체 파이프라인이 이 논문을 보게 한다(연결 갭 방지). LLM 불필요 → 키 불필요.
 * 실패 시 false(무시 — 페이지엔 이미 연결이 주입돼 있음).
 */
export async function syncConnectionsViaBridge(
  topic: string,
  slug: string,
  slugDir: string,
  conns: ConnItem[],
  pcRoot: string,
): Promise<boolean> {
  if (!pcRoot || !topic || !conns.length) return false
  try {
    const connsPath = joinPath(slugDir, "_pc_conn_sync.json")
    await writeText(
      connsPath,
      JSON.stringify(
        conns.map((c) => ({ slug: c.slug, relation: c.relation, reason: c.reason })),
      ),
    )
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "sync_conns", slug, topic, connsPath])
    if (!r.ok) {
      log("sync_conns 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return false
    }
    return !!lastJson(r.stdout).ok
  } catch (e) {
    log("syncConnectionsViaBridge 예외", e)
    return false
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
/**
 * Publish a topic to Cloudflare via prepare_deploy.py (key strip + wrangler
 * deploy + gh-pages stub sync). CF credentials come from the process env or
 * config.json (cloudflare.api_token / cloudflare.account_id).
 */
export async function deployViaBridge(
  topic: string,
  pcRoot: string,
): Promise<{ ok: boolean; reason?: string; tail?: string }> {
  if (!pcRoot || !topic) return { ok: false, reason: "no_topic" }
  try {
    const script = await ensureBridgeScript()
    const r = await runPython([script, pcRoot, "deploy", topic])
    if (!r.ok) {
      log("deploy 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return { ok: false, reason: `bridge:${r.code}`, tail: r.stderr.slice(0, 300) }
    }
    const j = lastJson(r.stdout)
    log(`deploy ${j.ok ? "OK" : "실패"}: ${j.reason || j.code || ""}`)
    return { ok: !!j.ok, reason: j.reason, tail: j.tail }
  } catch (e) {
    log("deployViaBridge 예외", e)
    return { ok: false, reason: String(e) }
  }
}


let _runnerCache: string | undefined

/** 부트스트랩용 python3(>=3.8) 하나를 찾는다. ensure_env 스크립트 실행에만 사용. */
async function resolveRunnerPython(): Promise<string> {
  if (_runnerCache !== undefined) return _runnerCache
  const cands = [
    pythonPath(),
    "/opt/homebrew/Caskroom/miniconda/base/envs/py312/bin/python",
    "/opt/homebrew/bin/python3.12",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ]
  for (const c of cands) {
    const r = await runPython(
      ["-c", "import sys;print(sys.version_info[0])"],
      undefined,
      c,
    )
    if (r.ok && r.stdout.trim().startsWith("3")) {
      _runnerCache = c
      return c
    }
  }
  _runnerCache = ""
  return ""
}

/**
 * run_full 실행에 쓸 py312(+deps) 인터프리터를 확보한다. 없으면 관리형 venv를
 * 만들어 requirements를 설치하고, python3.12 자체가 없으면 relocatable Python을
 * 내려받는다. 최초 1회만 오래 걸리고 이후엔 즉시 반환.
 */
export async function ensurePy312(
  pcRoot: string,
): Promise<{ ok: boolean; python?: string; action?: string; reason?: string }> {
  const runner = await resolveRunnerPython()
  if (!runner) return { ok: false, reason: "no_python" }
  const script = await ensureBridgeScript()
  const managed = joinPath(PathUtils.profileDir, "papercurio")
  const env: Record<string, string> = {}
  const pp = getPrefStr("PYTHON_PATH")
  if (pp) env.PC_PYTHON_PATH = pp
  const r = await runPython([script, pcRoot, "ensure_env", managed], env, runner)
  const j = lastJson(r.stdout)
  if (!r.ok || !j?.ok) {
    log("ensure_env 실패", `code=${r.code}`, String(j?.reason ?? ""), r.stderr.slice(-400))
    return { ok: false, reason: String(j?.reason ?? `bridge:${r.code}`) }
  }
  return { ok: true, python: j.python, action: j.action }
}

/**
 * 컬렉션 전체 처리 — Zotero sync → 신규 리뷰 → 주제분류 → 타임라인 이미지.
 * Cloudflare 배포는 하지 않는다(PAPER_CURATION_NO_DEPLOY=1). py312 환경을 먼저
 * 확보한 뒤 그 인터프리터로 run_full.py를 돌린다. 길게 걸린다(수 분~).
 */
export async function runFullViaBridge(
  topic: string,
  pcRoot: string,
  onStage?: (stage: "env" | "run") => void,
): Promise<{ ok: boolean; reason?: string; tail?: string; code?: number }> {
  if (!pcRoot || !topic) return { ok: false, reason: "no_topic" }
  try {
    onStage?.("env")
    const boot = await ensurePy312(pcRoot)
    if (!boot.ok || !boot.python) {
      return { ok: false, reason: boot.reason ?? "env" }
    }
    if (boot.action && boot.action !== "found") {
      log(`py312 준비: ${boot.action} → ${boot.python}`)
      setPref("PYTHON_PATH", boot.python)
    }
    onStage?.("run")
    const script = await ensureBridgeScript()
    const env: Record<string, string> = { PAPER_CURATION_NO_DEPLOY: "1" }
    const a = getAnthropicKey()
    if (a) env.ANTHROPIC_API_KEY = a
    const g = getGeminiKey()
    if (g) {
      env.GOOGLE_API_KEY = g
      env.GEMINI_API_KEY = g
    }
    const r = await runPython(
      [script, pcRoot, "run_full", topic],
      env,
      boot.python,
    )
    if (!r.ok) {
      log("run_full 브리지 실패", `code=${r.code}`, r.stderr.slice(0, 200))
      return { ok: false, reason: `bridge:${r.code}`, tail: r.stderr.slice(0, 300) }
    }
    const j = lastJson(r.stdout)
    log(`run_full ${j.ok ? "OK" : "실패"}: code=${j.code ?? ""} ${j.reason ?? ""}`)
    return { ok: !!j.ok, reason: j.reason, tail: j.tail, code: j.code }
  } catch (e) {
    log("runFullViaBridge 예외", e)
    return { ok: false, reason: String(e) }
  }
}
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

/** 다중 논문 비교 — compare_papers.run_compare. 성공 시 생성된 HTML 절대경로 반환. */
export async function compareViaBridge(
  slugs: string[],
  pcRoot: string,
): Promise<{ ok: boolean; html?: string; title?: string; reason?: string }> {
  if (!pcRoot || slugs.length < 2) return { ok: false, reason: "need_two_slugs" }
  try {
    const script = await ensureBridgeScript()
    const env: Record<string, string> = {}
    const a = getAnthropicKey()
    if (a) env.ANTHROPIC_API_KEY = a
    const g = getGeminiKey()
    if (g) {
      // Audio Overview 위젯에 키를 굽기 위해 (없으면 위젯이 브라우저에서 프롬프트)
      env.GOOGLE_API_KEY = g
      env.GEMINI_API_KEY = g
    }
    // 설정 토글 "논문 비교 그림 생성" — OFF면 PaperBanana 다이어그램 스킵 (수십 초로 단축)
    if (getPref("COMPARE_IMAGE") === false) env.COMPARE_IMAGE = "0"
    const r = await runPython([script, pcRoot, "compare", slugs.join(",")], env)
    const j = lastJson(r.stdout)
    if (r.ok && j?.ok) return { ok: true, html: j.html, title: j.title }
    log("compare 브리지 실패", `code=${r.code}`, String(j?.reason ?? ""), r.stderr.slice(0, 200))
    return { ok: false, reason: String(j?.reason ?? r.stderr.slice(-300) ?? "unknown") }
  } catch (e) {
    log("compareViaBridge 예외", e)
    return { ok: false, reason: String(e) }
  }
}
