# Paper Curio

Zotero 9 플러그인 — 선택한 논문을 우클릭 한 번으로 **paper-curation 호환 review + index.html**로 생성합니다.

## 무엇을 하나

Zotero 라이브러리에서 논문(들)을 선택 → 우클릭 → **"paper-curation Review 생성"** →
- LLM(Anthropic → OpenAI → Gemini 순)으로 한국어 review 생성 (jargon은 영문 유지)
- `<paper-curation>/docs/papers/{NNN}_{slug}/review.md` (v1 frontmatter)
- 같은 폴더에 `index.html` (단독 열람용)
- `_papers_index.json`에 항목 추가
- 분류(category)는 비워두고 paper-curation의 다음 빌드(`classify_papers.py`)가 채움

ARIA처럼 별도 툴바 버튼은 없고, Zotmoov처럼 **우클릭 메뉴 단일 진입점**입니다.

## API 키

우선순위: **환경변수 → preferences 입력칸**. 시도 순서 Anthropic → OpenAI → Gemini.

| Provider | 환경변수 | 기본 모델 |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Gemini | `GEMINI_API_KEY` (또는 `GOOGLE_API_KEY`) | `gemini-2.0-flash` |

macOS GUI 앱은 셸 환경변수를 못 보므로, 환경변수로 쓰려면 `launchctl setenv` 또는 LaunchAgent 필요. 아니면 Settings에 직접 입력.

## 출력 위치

1. preferences의 `paper-curation 루트 경로`
2. 환경변수 `PAPER_CURATION_DIR` / `PAPER_CURATION_ROOT`
3. 자동 탐색 (`~/Documents/내노트북/paper-curation` 등)
4. paper-curation이 없으면 preferences의 `Fallback 출력 경로` 아래 `docs/papers/` 생성

판정 기준: `<root>/docs/papers/` 존재.

## 빌드

```bash
npm install
npm run build          # → build/paper-curio.xpi
# 또는 타입체크 건너뛰고: npm run build-only
```

## 설치 (Zotero 9)

Tools → Plugins → ⚙️ → Install Plugin From File → `build/paper-curio.xpi`

## 범위 (v0.1)

- ✅ 우클릭 단일/다중 처리, 진행 윈도우, 3-provider 폴백, 한국어 review, paper-curation 호환 출력
- ❌ figure 추출 / Audio Overview / 연관논문 / 카테고리 자동분류 (paper-curation에 위임)
