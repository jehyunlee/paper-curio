# Paper Curio

**한국어** | [English](README.en.md)

## 최소 리뷰와 공통 모듈

최신 paper-curation과 Python 3.12를 연결하고 **선택한 리뷰 제공자의 키**를 OS 키 저장소에 저장합니다. 기본은 Anthropic Sonnet 5이며 OpenAI·Google을 명시적으로 선택할 수 있습니다. Review Generation은 별도 시작 확인 없이 **추출 → 리뷰 → HTML + bibliography.json → 등록 → 관련 논문 검색·순위화**를 실행합니다. 실행 중 다시 누르면 **다시 만들기 / 생성 기다리기**를 선택합니다. 다시 만들기는 현재 단계가 안전하게 끝나고 예약 정리가 완료된 뒤 같은 논문을 캐시 없이 새로 생성합니다. 이미 발생한 API 비용은 취소되지 않습니다. 리뷰의 **금액 상한은 없습니다**. 내부 준비 상태·리뷰 자격증명 검사는 유지합니다.

리뷰 실패 시 다른 제공자로 자동 전송하지 않습니다. 관련 논문 처리는 로컬 임베딩 + BM25로 새 논문만 기존 코퍼스와 비교하며, LLM 호출·LLM 제공자로의 전송·추가 API 키가 필요하지 않습니다. 전체 재분류·검색 인덱스·타임라인·배포·서지 DB 갱신은 하지 않습니다. 연결 처리 실패는 **리뷰 저장됨 / 연결 처리 미완료**로 표시하고 리뷰를 보존합니다. 덮어쓰기를 끄고 같은 Curio 리뷰를 다시 실행하면 기존 리뷰를 재사용해 연결을 재시도합니다. 진행창은 처리 종료까지 유지되는 비모달 창이라 다른 논문 열기·추가를 막지 않습니다. **서지 DB 반영 대기**는 별도 상태입니다.

우클릭 **Paper Curation 기능 모듈**은 CLI와 동일한 레지스트리·계획·결과를 사용합니다. 읽기/내보내기·논문 AI·컬렉션 관리에서 시작하고 오디오·타임라인·배포·메일은 별도로 선택합니다. 요약·질의는 로컬 Ollama `qwen3.8:27b-mlx`도 지원하며 검증 가능한 원문 인용이 없는 답변은 거부합니다. Comparison 메뉴도 이 공통 비교 기능을 사용하며 자동 그림 생성은 하지 않습니다.

설정에는 `credential:<provider>` 참조만 남기고 값은 OS keyring에 저장합니다. 환경변수는 자동화용 우선 주입 경로이며 평문 설정으로 복사하지 않습니다. 과거 평문 키 설정은 더 이상 읽지 않으므로 키를 OS 저장소에 다시 저장하세요. 리뷰 비용 상한 설정과 단가 입력란은 제거했습니다. 공동 코퍼스 예약·등록·취소와 공통 CLI/full 작업 잠금으로 동시 쓰기를 조정합니다. 직접 내부 스크립트로 공통 실행기를 우회하지 마세요.

로컬 리뷰는 `fcntl` 잠금이 있는 macOS/Linux용입니다. Windows 로컬 리뷰는 아직 런타임 미지원이며, 기존 문서 열람·대화와는 별개입니다.

Zotero 9 / 10 플러그인 — **논문 PDF와 바로 대화(AI Chat)하고, 여러 논문을 비교 분석(Comparative Chat)하며, Zotero 컬렉션을 paper-curation 토픽으로 전체 처리합니다.** LLM API 키(Anthropic / OpenAI / Gemini 중 하나)만 있으면 AI Chat은 설치 직후 바로 동작합니다.

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

## 5분 시작 — 어디에서 무엇을 설정하나

![세 가지 사용 경로](https://raw.githubusercontent.com/jehyunlee/paper-curation/master/usage_workflow.png)

| 순서 | 어디에서                                        | 무엇을                                                                                                                                                            |
| ---- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 터미널                                          | [paper-curation](https://github.com/jehyunlee/paper-curation) 클론 → `conda` `py312` → `pip install -r requirements.txt` → `python pipeline/setup.py` (키 불필요) |
| 2    | Zotero → Tools → Plugins                        | 아래 **설치** 절차로 `paper-curio.xpi` 설치                                                                                                                       |
| 3    | Zotero → Settings → Paper Curio → **출력 위치** | **paper-curation 루트 경로**에 1의 폴더 지정 (Python 경로는 비우면 `py312`)                                                                                       |
| 4    | Zotero → Settings → Paper Curio → **API 키**    | **리뷰 제공자** 선택 → 키 입력 → **OS 키 저장소에 저장**. 관련 논문 검색에는 추가 API 키가 필요하지 않습니다. |
| 5    | 라이브러리에서 논문 항목 우클릭                 | **paper-curation Review 생성** → 즉시 실행. 실행 중 다시 누르면 다시 만들기 / 생성 기다리기 선택 |
| 6    | 우클릭 **Paper Curation 기능 모듈**             | 요약·질의·비교(논문 AI), 검색 색인·지표·서지(컬렉션 관리), 오디오·타임라인·배포·메일(선택 기능)을 카드별로 **실행 계획 확인 → 선택 작업 실행**                    |

각 단계의 화면 항목, 결과 위치, 상태 메시지(`needs-key`·`busy`·**서지 DB 반영 대기** 등)의 뜻은
📘 **[활용 매뉴얼](https://github.com/jehyunlee/paper-curation/blob/master/docs/user-guide.md)** 에 있습니다.

## 설치

### 사용자 — 릴리스에서 설치 (권장)

릴리스마다 **Zotero 메이저 버전별 XPI**를 따로 제공합니다. 사용 중인 Zotero 버전(**Help → About Zotero**)에 맞는 파일을 받으세요. 두 파일은 같은 소스·같은 기능이며 Zotero 호환 범위만 다릅니다.

| 사용 중인 Zotero | 내려받을 파일 | 비고 |
|---|---|---|
| **10.x** | **[`paper-curio-zotero10.xpi`](https://github.com/jehyunlee/paper-curio/releases/latest/download/paper-curio-zotero10.xpi)** | v0.11.0부터 제공 |
| **9.x** (7·8 포함) | **[`paper-curio-zotero9.xpi`](https://github.com/jehyunlee/paper-curio/releases/latest/download/paper-curio-zotero9.xpi)** | v0.10.0 이하는 `paper-curio.xpi` 단일 파일(Zotero 9 전용) |

1. 위 표에서 자기 버전의 XPI를 내려받습니다. 지난 버전은 [릴리스 목록](https://github.com/jehyunlee/paper-curio/releases)에서 같은 이름으로 찾을 수 있습니다.
2. Zotero → **Tools → Plugins → ⚙️ (우상단) → Install Plugin From File…** → 받은 XPI 선택.
3. 이후 업데이트는 **자동**입니다 — `update.json`에 버전별 항목이 있어 Zotero 9는 9용, Zotero 10은 10용 XPI만 받습니다.

> Zotero를 9에서 10으로 올리면 9용 플러그인은 "호환되지 않음"으로 비활성화됩니다. 그때는 `paper-curio-zotero10.xpi`를 한 번 수동 설치하면 이후 자동 업데이트가 10용 라인을 따라갑니다. 설정·API 키 참조는 그대로 유지됩니다.

> 설치 + API 키 하나만으로 **AI Chat / Comparative Chat이 바로 동작합니다** (Light 모드). Review 생성·figure 추출·연관논문 분석·컬렉션 전체 처리 등 Enhanced 기능에는 아래 **선택 의존성** 섹션(paper-curation + py312 브리지)이 필요합니다.

### 개발자 — 소스 빌드

```bash
npm install
npm run build          # → build/paper-curio-zotero9.xpi + build/paper-curio-zotero10.xpi + build/update.json
npm run build-only 10  # 한 타깃만 (병합 update.json은 생성하지 않음)
```

한 소스에서 Zotero 메이저별 XPI를 만듭니다. `addon/manifest.json`의 `strict_min/max_version`은 빌드 시 `scripts/targets.mjs`의 타깃 표로 채워지므로, 새 Zotero 메이저를 지원하려면 그 표에 항목을 추가하면 됩니다. 빌드한 XPI는 위와 같은 방식으로 직접 설치할 수 있습니다.

릴리스 절차 — 두 XPI가 **항상 함께** 나갑니다:

```bash
# package.json version 올리고 커밋한 뒤
npm run build && npm test && npm run release
```

`npm run release`는 `v<version>` 릴리스에 두 XPI를 첨부하고, `release` 태그의 `update.json`을 버전별 항목이 담긴 병합본으로 갱신합니다. 이미 있는 태그는 덮어쓰지 않습니다.

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
| 연관 논문(connections)  | 공통 `related-papers` 기능 | 등록 후 `refresh_paper_connections.py`로 대상 논문만 로컬 임베딩 + BM25 검색·순위화·양방향 연결 및 HTML 갱신 (LLM 미사용) |
| `index.html`            | 공통 Python 실행기      | 초기 리뷰 HTML 생성 후 연결 단계에서 대상·이웃 페이지를 다시 렌더링 |
| `_papers_index.json`    | 공통 코퍼스 등록        | topic은 Zotero collection에서 가져오며, category가 없어도 연결 검색에 포함 |
| topic index / timelines | 🐍 원본 파이프라인 호출 | 컬렉션 우클릭 `run_full.py --mode curate --source zotero --images changed` → `index.html`, `_category_*`, `research_timeline.png`, `category_timeline_*.png` |

> originality·토픽 출력은 컬렉션 전체 처리 기능입니다. 리뷰 파일 등록 후 공통 `related-papers` 단계를 실행하며, 분류가 아직 없는 논문도 검색 대상에 포함합니다. 연결 단계 실패는 리뷰 등록을 취소하지 않습니다. 대화의 PDF 추출은 기존 pdf.js 경로를 유지합니다.

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
- 리뷰: **text·figure·review·HTML·bibliography.json** 생성·등록 후 공통 연결 처리를 자동 실행합니다.
- ✅ Collection 우클릭 `이 컬렉션 전체 처리` — 신규 컬렉션은 alias를 물어 `config.json`에 등록한 뒤 Zotero sync → review → 주제분류 → narrative/main·category timeline → topic index까지 실행 (Cloudflare 배포 제외)
- 컬렉션 전체 처리의 py312 자동 준비 — 지정 Python 우선, 없으면 관리형 venv/relocatable Python으로 bootstrap
- 관련 논문은 공통 `related-papers` 기능으로 로컬 임베딩 + BM25 검색·순위화를 수행하며, 미처리와 검색 결과 0건을 구분합니다.
- index.html, topic 기록, 비파괴 덮어쓰기, ko/en 로케일. 최소 리뷰 HTML에는 운영자 키를 삽입하지 않음.
- ✅ GitHub 릴리스 + 자동 업데이트 manifest

## 라이선스

AGPL-3.0-or-later
