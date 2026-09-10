# Paper Curio

**한국어** | [English](README.en.md)

## 최소 리뷰와 공통 모듈

최신 paper-curation과 Python 3.12를 연결하고 **선택한 제공자의 키 하나**를 OS 키 저장소에 저장합니다. 기본은 Anthropic Sonnet 5이며 OpenAI·Google을 명시적으로 선택할 수 있습니다. 로컬 PDF가 첨부된 Zotero 항목에서 Review 생성을 선택하면 전송 대상·비용 계획을 확인한 뒤 **추출 → 리뷰 → HTML + bibliography.json**만 실행합니다. Zotero의 원래 creator JSON과 저널을 전달하며 Zotero Web API 키는 필요하지 않습니다.

리뷰 실패 시 OpenAI/Gemini로 자동 전송하지 않습니다. Google·Resend 키, 분류 모델, PaperBanana, 배포 계정도 요구하지 않습니다. 분류·연관논문 생성·검색 인덱스·타임라인·서지 DB 갱신은 리뷰 뒤에 자동 실행되지 않습니다. Curio는 검색용 논문 목록만 갱신하며, 완료 메시지의 **서지 DB 반영 대기**는 리뷰 실패와 다른 상태입니다. 컬렉션 전체 처리 메뉴는 별도의 기존 고급 작업입니다.

우클릭 **Paper Curation 기능 모듈**은 CLI와 동일한 레지스트리·계획·결과를 사용합니다. 읽기/내보내기·논문 AI·컬렉션 관리에서 시작하고 오디오·타임라인·배포·메일은 별도로 선택합니다. 요약·질의는 로컬 Ollama `qwen3.8:27b-mlx`도 지원하며 검증 가능한 원문 인용이 없는 답변은 거부합니다. Comparison 메뉴도 이 공통 비교 기능을 사용하며 자동 그림 생성은 하지 않습니다.

설정에는 `credential:<provider>` 참조만 남기고 값은 OS keyring에 저장합니다. 환경변수는 자동화용 우선 주입 경로이며 평문 설정으로 복사하지 않습니다. 과거 평문 키 설정은 더 이상 읽지 않으므로 키를 OS 저장소에 다시 저장하세요. 저장 성공 후 해당 과거 평문 항목을 제거합니다. 비용 상한을 설정하면 입력/출력 단가도 필요하며 미확정 또는 상한 초과 시 차단합니다. 공동 코퍼스 예약·등록·취소와 공통 CLI/full 작업 잠금으로 지원 진입점의 동시 쓰기를 조정합니다. 직접 내부 스크립트를 호출하는 디버깅 작업은 공통 실행기를 우회하지 않도록 주의하세요.

로컬 리뷰는 `fcntl` 잠금이 있는 macOS/Linux용입니다. Windows 로컬 리뷰는 아직 런타임 미지원이며, 기존 문서 열람·대화와는 별개입니다.

Zotero 9 플러그인 — **논문 PDF와 바로 대화(AI Chat)하고, 여러 논문을 비교 분석(Comparative Chat)하며, Zotero 컬렉션을 paper-curation 토픽으로 전체 처리합니다.** LLM API 키(Anthropic / OpenAI / Gemini 중 하나)만 있으면 AI Chat은 설치 직후 바로 동작합니다.

여기에 [**paper-curation**](https://github.com/jehyunlee/paper-curation)을 연동하면 **공통 리뷰·근거 기반 비교·요약, OS 키 저장, 연관논문 분석, 답변 속 그림 표시, 선택 모듈과 컬렉션 전체 처리**를 사용할 수 있습니다. 기존 전체 처리와 그림 생성은 별도 작업이며 자동으로 리뷰 뒤에 실행하지 않습니다. 진입점은 우클릭 메뉴입니다.

## 두 가지 모드

|                                                     | **Light (기본)**    | **Enhanced (paper-curation 연동)**                              |
| --------------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| 필요 조건                                           | Zotero + LLM API 키 | + paper-curation 경로 (Settings)                                |
| AI Chat — PDF와 멀티턴 대화 (스트리밍·수식·EN/KO)   | ✅                  | ✅ 코퍼스 text.md 우선 → **더 빠름**                            |
| Comparative Chat — 논문 비교 분석                   | ✅ 선택 논문끼리    | ✅ + **이미 연결된 관련 연구**와 함께                           |
| **Citedby** — 이 논문을 인용한 논문 분석            | —                   | ✅ HTML 리포트(PDF 출력·Zotero 링크) + Zotero 일괄 등록         |
| 답변 속 논문 **그림 인라인 표시**                   | —                   | ✅                                                              |
| 대화 내보내기 .md / .html                           | ✅                  | ✅ (그림 임베드 포함)                                           |
| 대화 내보내기 **Obsidian** (위키링크)               | —                   | ✅                                                              |
| Review 생성 · 근거 기반 비교 · Collection 전체 처리 | —                   | 공통 Python 실행기 (비교 결과 JSON 내보내기, 컬렉션 alias 등록) |

Light 모드는 PDF 텍스트를 로컬에 캐시해 재오픈이 즉시입니다. Enhanced 모드는 paper-curation이 이미 분해해 둔 `text.md`·`figures/`를 먼저 읽어 첫 응답 준비가 더 빠릅니다.

## 설치

### 사용자 — 릴리스에서 설치 (권장)

1. **[최신 릴리스](https://github.com/jehyunlee/paper-curio/releases/latest)** 에서 **`paper-curio.xpi`** 를 내려받습니다.
2. Zotero 9 → **Tools → Plugins → ⚙️ (우상단) → Install Plugin From File…** → 받은 `paper-curio.xpi` 선택.
3. 이후 업데이트는 **자동**입니다 — Zotero가 릴리스의 `update.json` 매니페스트를 통해 새 버전을 받아옵니다.

> 설치 + API 키 하나만으로 **AI Chat / Comparative Chat이 바로 동작합니다** (Light 모드). Review 생성·figure 추출·연관논문 분석·컬렉션 전체 처리 등 Enhanced 기능에는 아래 **선택 의존성** 섹션(paper-curation + py312 브리지)이 필요합니다.

### 개발자 — 소스 빌드

```bash
npm install
npm run build          # → build/paper-curio.xpi  (tsc + pack)
```

빌드한 `build/paper-curio.xpi`를 위와 같은 방식으로 직접 설치할 수 있습니다. 릴리스 발행(.xpi 빌드 + GitHub 릴리스 업로드 + 자동업데이트 manifest 갱신)은 `npm run release`로 한 번에 처리됩니다.

## 선택 의존성: [paper-curation](https://github.com/jehyunlee/paper-curation) (Enhanced 모드)

이 플러그인은 [paper-curation](https://github.com/jehyunlee/paper-curation) 파이프라인의 **원본 Python 함수**(`extract_text`, `extract_figures`, `write_review` 등)를 subprocess로 호출합니다. 따라서 완전한 동작에는 다음이 필요합니다:

| 요구사항                                                           | 용도                                   | 없을 때                                                                |
| ------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------- |
| [paper-curation](https://github.com/jehyunlee/paper-curation) 설치 | 공통 리뷰 실행기 + `docs/papers/` 출력 | 대화는 가능, 리뷰는 런타임 필요 상태                                   |
| **Python 3.12** + paper-curation requirements                      | 브리지 인터프리터 (`PYTHON_PATH` pref) | 리뷰는 런타임 필요 상태. 컬렉션 전체 처리만 관리형 환경 자동 준비 지원 |
| `(선택)` Java + `opendataloader-pdf`                               | 구조화 text 추출                       | PyMuPDF 텍스트로 자동 폴백                                             |

paper-curation은 표준으로 **py312 환경**에서 돕니다. 같은 인터프리터를 `Settings → Paper Curio → Python 경로`에 지정하세요. 최소 리뷰는 설치된 Python만 확인하고, 없으면 런타임 필요 상태를 표시합니다. 관리형 venv 생성·relocatable Python 다운로드는 컬렉션 전체 처리에서만 실행합니다.

## 무엇을 어떻게 만드나

| 출력                    | 생성 방식               | 원본 함수                                                                                                                                                    |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text.md`               | 🐍 원본 함수 호출       | `run_update_force.extract_text`                                                                                                                              |
| `figures/figN.png`      | 🐍 원본 함수 호출       | `run_update_force.extract_figures` (PyMuPDF)                                                                                                                 |
| `review.md`             | 공통 로컬 리뷰 실행기   | `run_update_force.write_review` (`claude-sonnet-5`)                                                                                                          |
| `originality.md`        | 🐍 원본 함수 호출       | `originality_extractor._extract_rule_based`                                                                                                                  |
| 연관 논문(connections)  | 🐍 원본 함수 호출       | `specter2_embed` + `compute_related_candidates` + `generate_connections_from_candidates` + `sync_topic_connections` (코퍼스 임베딩 캐시 필요)                |
| `index.html`            | 공통 Python 실행기      | `review_to_html.convert_review(keyless=True)` — 최소 리뷰에서 Audio·코퍼스 연결 주입 제외                                                                    |
| `_papers_index.json`    | TS append               | topic은 Zotero collection에서, category는 paper-curation `classify_papers.py`에 위임                                                                         |
| topic index / timelines | 🐍 원본 파이프라인 호출 | 컬렉션 우클릭 `run_full.py --mode curate --source zotero --images changed` → `index.html`, `_category_*`, `research_timeline.png`, `category_timeline_*.png` |

> 위 originality·connections·토픽 출력은 컬렉션 전체 처리 기능입니다. 최소 리뷰는 text·figure·review·HTML·서지 사이드카만 만듭니다. 공통 런타임이나 선택한 제공자 키가 없으면 해당 요구사항을 표시하고 중단합니다. 대화의 PDF 추출은 기존 pdf.js 경로를 유지합니다.

## API 키

우선순위: **환경변수 → 공통 OS keyring**. 리뷰·요약·질의·비교는 제공자를 명시적으로 선택하고 다른 회사로 자동 폴백하지 않습니다. OS 키 저장 버튼은 paper-curation의 Python keyring 런타임이 필요합니다. 연동 없는 Light 대화는 주입된 환경변수 키로 동작합니다.

| Provider  | 환경변수                                 | 기본 모델 (paper-curation과 동일) |
| --------- | ---------------------------------------- | --------------------------------- |
| Anthropic | `ANTHROPIC_API_KEY`                      | `claude-sonnet-5`                 |
| OpenAI    | `OPENAI_API_KEY`                         | `gpt-5`                           |
| Gemini    | `GEMINI_API_KEY` (또는 `GOOGLE_API_KEY`) | `gemini-3.1-pro-preview`          |

> 기본 리뷰는 Anthropic의 `claude-sonnet-5`입니다. macOS GUI 앱은 셸 환경변수를 자동으로 보지 못하므로 공통 OS 키 저장소를 사용하거나 LaunchAgent 등으로 환경변수를 주입하세요. 키를 평문 preferences·리뷰 요청 JSON·명령행 인자에 저장하지 않습니다.

## 출력 위치

1. preferences의 `paper-curation 루트 경로`
2. 환경변수 `PAPER_CURATION_DIR` / `PAPER_CURATION_ROOT`
3. 자동 탐색 (`~/Documents/.../paper-curation` 등 후보)
4. paper-curation이 없으면 preferences의 `Fallback 출력 경로` 아래 기존 자료 열람 가능. 새 리뷰에는 공통 실행기가 있는 paper-curation 설치 필요.

판정 기준: `<root>/docs/papers/` 존재. review는 `docs/papers/{NNN}_{slug}/`에 생성됩니다.

## 기존 review 처리

이미 review가 있는 논문은 **기본 건너뜀**(비파괴). `Settings → Overwrite existing`을 켜야 덮어씁니다(이때도 분류 메타는 보존). Paper Curio가 직접 만든 review는 항상 재생성됩니다.

## 범위 (v0.10.0)

- ✅ 우클릭 단일/다중 처리 + 진행 윈도우
- ✅ 우클릭 `paper-curation Review HTML 열기` — 이미 생성된 리뷰(index.html)를 브라우저로 바로 오픈 (생성 안 함)
- ✅ 우클릭 `paper-curation AI 대화 (PDF Q&A)` — 논문 PDF를 컨텍스트로 멀티턴 질의응답, 상단에서 GPT·Anthropic·Gemini 모델 선택
- ✅ 우클릭 `paper-curation Citedby` — 선택 논문의 DOI로 인용논문을 OpenAlex·Scopus·S2·arXiv에서 수집 → 독창성 추출 → (주제 입력 시) LLM 필터 + 5W1H 요약 → **자기완결 HTML 리포트**를 브라우저로 오픈. 리포트의 **[PDF 출력]** 버튼은 링크가 살아있는 PDF를 만들고, 내 라이브러리에 있는 논문은 `zotero://open-pdf`(없으면 서지정보)로 바로 열린다. 이어서 인용논문을 **Zotero에 일괄 등록**할 수 있다 (DOI·arXiv·제목 중복 자동 skip) → 그대로 `run_full --mode curate --source zotero` 로 이어짐
- 최소 리뷰: **text·figure·review·HTML·bibliography.json**을 공통 Python 실행기로 생성. originality·connections는 별도 컬렉션 처리.
- ✅ Collection 우클릭 `이 컬렉션 전체 처리` — 신규 컬렉션은 alias를 물어 `config.json`에 등록한 뒤 Zotero sync → review → 주제분류 → narrative/main·category timeline → topic index까지 실행 (Cloudflare 배포 제외)
- 컬렉션 전체 처리의 py312 자동 준비 — 지정 Python 우선, 없으면 관리형 venv/relocatable Python으로 bootstrap
- 컬렉션 전체 처리의 connections는 기존 SPECTER2 파이프라인 사용. 최소 리뷰에서 자동 생성하지 않음.
- index.html, topic 기록, 비파괴 덮어쓰기, ko/en 로케일. 최소 리뷰 HTML에는 운영자 키를 삽입하지 않음.
- ✅ GitHub 릴리스 + 자동 업데이트 manifest
- ⏳ connections incoming(역참조) 양방향 — 현재 outgoing만, incoming은 paper-curation 전체 connections run에 위임

## 라이선스

AGPL-3.0-or-later
