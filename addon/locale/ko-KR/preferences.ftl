pref-api-keys = API 키
pref-api-keys-hint = 리뷰 제공자 하나를 선택하세요. 다른 제공자로 자동 전송하지 않습니다. 키는 Zotero 설정이 아닌 공통 OS 키 저장소에 저장하며 주입된 환경변수가 우선합니다.
pref-review-provider = 리뷰 제공자
pref-review-budget = 리뷰 비용 상한 (선택)
pref-review-budget-hint = 상한을 설정하면 현재 제공자의 입력/출력 단가도 필요합니다. 단가 미확정 또는 예상 상한 초과 시 실행을 차단합니다. 상한이 비어 있으면 예산 제한이 없습니다.
pref-optional-providers = 다른 대화 제공자 및 선택 기능
pref-anthropic-key = Anthropic API Key
pref-openai-key = OpenAI API Key
pref-gemini-key = Gemini API Key

pref-models = 대화 모델 (리뷰 모델은 선택한 제공자 계약 사용)
pref-anthropic-model = Anthropic 모델
pref-openai-model = OpenAI 모델
pref-gemini-model = Gemini 모델

pref-output = 출력 위치
pref-output-hint = 리뷰에는 최신 paper-curation과 Python 3.12가 필요합니다. 루트 경로를 지정하거나 자동 탐색을 사용하세요. Fallback 경로는 기존 코퍼스 열람용이며 공통 리뷰 엔진은 제공하지 않습니다.
pref-pc-root = paper-curation 루트 경로
pref-fallback-dir = Fallback 출력 경로
pref-overwrite =
    .label = 기존 review 덮어쓰기 (Overwrite existing)
pref-overwrite-hint = OFF(기본): 이미 review가 있는 논문은 건너뜁니다. ON: 기존 review.md·index.html을 덮어씁니다(분류 등 메타데이터는 보존). Paper Curio가 직접 만든 review는 이 설정과 무관하게 항상 재생성됩니다.
pref-python-path = Python 경로
pref-python-path-hint = paper-curation 원본 함수(figure 추출 등)를 호출할 Python 인터프리터. paper-curation과 동일한 py3.12 + PyMuPDF 환경이어야 합니다. 비우면 기본 conda py312 사용.

pref-chat = 대화
pref-chat-lang = 답변 언어
pref-chat-lang-hint = AI Chat / Comparative Chat에서 AI가 답변하는 언어입니다. 채팅 창 상단의 EN/KO 버튼으로 창마다 즉시 전환할 수도 있습니다.

pref-litdb = 문헌 DB (Citedby)
pref-litdb-hint = 우선순위: 환경변수 → 이 입력칸. Zotero 를 Finder 로 실행하면 터미널 환경변수가 전달되지 않으므로, 그 경우 여기에 입력해야 합니다. 전부 선택 사항이며 없으면 해당 소스만 빠집니다.
pref-scopus-key = Scopus API Key
pref-scopus-token = Scopus Inst Token
pref-s2-key = Semantic Scholar Key
pref-openalex-email = OpenAlex/Crossref Email
pref-springer-meta-key = Springer Nature Metadata Key
