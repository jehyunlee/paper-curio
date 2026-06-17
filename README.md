# Paper Curio

Zotero 9 플러그인 — 라이브러리에서 논문을 우클릭 한 번으로 [**paper-curation**](https://github.com/jehyunlee/paper-curation) 호환 review를 생성합니다. text·figure·review를 **paper-curation의 원본 함수를 그대로 호출**해 만들기 때문에 본체 파이프라인과 출력이 일치합니다.

ARIA처럼 툴바 버튼을 두지 않고, Zotmoov처럼 **우클릭 메뉴 단일 진입점**(`paper-curation Review 생성`)입니다. 단일 선택은 즉시, 다중 선택은 순차 일괄 처리합니다.

## ⚠️ 의존성: [paper-curation](https://github.com/jehyunlee/paper-curation)

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

## 빌드 / 설치

```bash
npm install
npm run build          # → build/paper-curio.xpi  (tsc + pack)
```

Zotero 9 → Tools → Plugins → ⚙️ → Install Plugin From File → `build/paper-curio.xpi`

## 범위 (v0.4)

- ✅ 우클릭 단일/다중 처리 + 진행 윈도우
- ✅ **text·figure·review·originality·connections를 모두 paper-curation 원본 함수로 생성** (py312 브리지)
- ✅ connections = 원본 SPECTER2 임베딩 + 코사인 top-k + Anthropic 생성 (캐시 있는 토픽: ai4s/scisci/humanoid/physical-ai/ai4s+scisci)
- ✅ index.html(Audio Overview 포함), topic 부여, 3-provider 폴백, 비파괴 덮어쓰기, ko/en 로케일
- ✅ GitHub 릴리스 + 자동 업데이트 manifest
- ⏳ connections incoming(역참조) 양방향 — 현재 outgoing만, incoming은 paper-curation 전체 connections run에 위임 (category와 동일 패턴)
- ⏳ category 자동 분류 — paper-curation `classify_papers.py`(HDBSCAN)에 위임

## 라이선스

AGPL-3.0-or-later
