# Paper Curio

Zotero 9 플러그인 — **논문 PDF와 바로 대화(AI Chat)하고, 여러 논문을 비교 분석(Comparative Chat)합니다.** LLM API 키(Anthropic / OpenAI / Gemini 중 하나)만 있으면 설치 직후 바로 동작합니다.

여기에 [**paper-curation**](https://github.com/jehyunlee/paper-curation)을 연동하면(경로 한 줄 지정) **연관논문 분석 · 답변 속 논문 그림 표시 · review 생성 · 비교 HTML · 웹 배포** 같은 강화 기능이 활성화됩니다. ARIA처럼 툴바 버튼 없이, **우클릭 메뉴 단일 진입점**입니다.

## 두 가지 모드

| | **Light (기본)** | **Enhanced (paper-curation 연동)** |
|---|---|---|
| 필요 조건 | Zotero + LLM API 키 | + paper-curation 경로 (Settings) |
| AI Chat — PDF와 멀티턴 대화 (스트리밍·수식·EN/KO) | ✅ | ✅ 코퍼스 text.md 우선 → **더 빠름** |
| Comparative Chat — 논문 비교 분석 | ✅ 선택 논문끼리 | ✅ + **이미 연결된 관련 연구**와 함께 |
| 답변 속 논문 **그림 인라인 표시** | — | ✅ |
| 대화 내보내기 .md / .html | ✅ | ✅ (그림 임베드 포함) |
| 대화 내보내기 **Obsidian** (위키링크) | — | ✅ |
| Review 생성 · Comparison HTML · 웹 배포 | — | ✅ (Python 3.12 브리지) |

Light 모드는 PDF 텍스트를 로컬에 캐시해 재오픈이 즉시입니다. Enhanced 모드는 paper-curation이 이미 분해해 둔 `text.md`·`figures/`를 먼저 읽어 첫 응답 준비가 더 빠릅니다.

## 설치

### 사용자 — 릴리스에서 설치 (권장)

1. **[최신 릴리스](https://github.com/jehyunlee/paper-curio/releases/latest)** 에서 **`paper-curio.xpi`** 를 내려받습니다.
2. Zotero 9 → **Tools → Plugins → ⚙️ (우상단) → Install Plugin From File…** → 받은 `paper-curio.xpi` 선택.
3. 이후 업데이트는 **자동**입니다 — Zotero가 릴리스의 `update.json` 매니페스트를 통해 새 버전을 받아옵니다.

> 설치 + API 키만으로 **AI Chat / Comparative Chat이 바로 동작합니다** (Light 모드). Review 생성·figure 추출·연관논문 분석 등 Enhanced 기능에는 아래 **선택 의존성** 섹션(paper-curation + Python 3.12)이 필요합니다.

### 개발자 — 소스 빌드

```bash
npm install
npm run build          # → build/paper-curio.xpi  (tsc + pack)
```

빌드한 `build/paper-curio.xpi`를 위와 같은 방식으로 직접 설치할 수 있습니다. 릴리스 발행(.xpi 빌드 + GitHub 릴리스 업로드 + 자동업데이트 manifest 갱신)은 `npm run release`로 한 번에 처리됩니다.

## 선택 의존성: [paper-curation](https://github.com/jehyunlee/paper-curation) (Enhanced 모드)

이 플러그인은 [paper-curation](https://github.com/jehyunlee/paper-curation) 파이프라인의 **원본 Python 함수**(`extract_text`, `extract_figures`, `write_review` 등)를 subprocess로 호출합니다. 따라서 완전한 동작에는 다음이 필요합니다:

| 요구사항 | 용도 | 없을 때 |
|---|---|---|
| [paper-curation](https://github.com/jehyunlee/paper-curation) 설치 | 원본 함수 import + `docs/papers/` 출력 | text/review는 TS 폴백, **figure는 불가** |
| **Python 3.12** + 그 안의 `PyMuPDF`, `anthropic` | 브리지 인터프리터 (`PYTHON_PATH` pref) | figure/원본 text·review 불가 → TS 폴백 |
| `(선택)` Java + `opendataloader-pdf` | 구조화 text 추출 | PyMuPDF 텍스트로 자동 폴백 |

paper-curation은 보통 **py3.12 환경**(`.venv312` 등)에서 돕니다. 같은 인터프리터를 `Settings → Paper Curio → Python 경로`에 지정하세요.

## 무엇을 어떻게 만드나

| 출력 | 생성 방식 | 원본 함수 |
|---|---|---|
| `text.md` | 🐍 원본 함수 호출 | `run_update_force.extract_text` |
| `figures/figN.png` | 🐍 원본 함수 호출 | `run_update_force.extract_figures` (PyMuPDF) |
| `review.md` | 🐍 원본 함수 호출 | `run_update_force.write_review` (`claude-haiku-4-5`) |
| `originality.md` | 🐍 원본 함수 호출 | `originality_extractor._extract_rule_based` |
| 연관 논문(connections) | 🐍 원본 함수 호출 | `specter2_embed` + `compute_related_candidates` + `generate_connections_from_candidates` + `sync_topic_connections` (코퍼스 임베딩 캐시 필요) |
| `index.html` | TS (`review_to_html.py` 포팅 + Audio Overview) | connections 주입 위해 TS |
| `_papers_index.json` | TS append | topic은 Zotero collection에서, category는 paper-curation `classify_papers.py`에 위임 |

> 키가 없거나 브리지(py312/paper-curation)가 없으면 review는 TS 멀티프로바이더(Anthropic→OpenAI→Gemini)로, text는 pdf.js로 graceful fallback 합니다. figure는 원본 전용입니다.

## API 키

우선순위: **환경변수 → preferences 입력칸**. 시도 순서 Anthropic → OpenAI → Gemini.

| Provider | 환경변수 | 기본 모델 (paper-curation과 동일) |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5` |
| Gemini | `GEMINI_API_KEY` (또는 `GOOGLE_API_KEY`) | `gemini-3.1-pro-preview` |

> 원본 `write_review`는 `ANTHROPIC_API_KEY`로 `claude-haiku-4-5`를 사용합니다. macOS GUI 앱은 셸 환경변수를 못 보므로, 환경변수로 쓰려면 `launchctl setenv` 또는 LaunchAgent가 필요합니다. 아니면 Settings에 직접 입력하세요.

## 출력 위치

1. preferences의 `paper-curation 루트 경로`
2. 환경변수 `PAPER_CURATION_DIR` / `PAPER_CURATION_ROOT`
3. 자동 탐색 (`~/Documents/.../paper-curation` 등 후보)
4. paper-curation이 없으면 preferences의 `Fallback 출력 경로` 아래 `docs/papers/` 생성

판정 기준: `<root>/docs/papers/` 존재. review는 `docs/papers/{NNN}_{slug}/`에 생성됩니다.

## 기존 review 처리

이미 review가 있는 논문은 **기본 건너뜀**(비파괴). `Settings → Overwrite existing`을 켜야 덮어씁니다(이때도 분류 메타는 보존). Paper Curio가 직접 만든 review는 항상 재생성됩니다.

## 범위 (v0.5)

- ✅ 우클릭 단일/다중 처리 + 진행 윈도우
- ✅ 우클릭 `paper-curation Review HTML 열기` — 이미 생성된 리뷰(index.html)를 브라우저로 바로 오픈 (생성 안 함)
- ✅ 우클릭 `paper-curation AI 대화 (PDF Q&A)` — 논문 PDF를 컨텍스트로 멀티턴 질의응답, 상단에서 GPT·Anthropic·Gemini 모델 선택
- ✅ **text·figure·review·originality·connections를 모두 paper-curation 원본 함수로 생성** (py312 브리지)
- ✅ connections = 원본 SPECTER2 임베딩 + 코사인 top-k + Anthropic 생성 (캐시 있는 토픽: ai4s/scisci/humanoid/physical-ai/ai4s+scisci)
- ✅ index.html(Audio Overview 포함), topic 부여, 3-provider 폴백, 비파괴 덮어쓰기, ko/en 로케일
- ✅ GitHub 릴리스 + 자동 업데이트 manifest
- ⏳ connections incoming(역참조) 양방향 — 현재 outgoing만, incoming은 paper-curation 전체 connections run에 위임 (category와 동일 패턴)
- ⏳ category 자동 분류 — paper-curation `classify_papers.py`(HDBSCAN)에 위임

## 라이선스

AGPL-3.0-or-later
