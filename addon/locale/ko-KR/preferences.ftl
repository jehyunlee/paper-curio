pref-api-keys = API 키
pref-api-keys-hint = 우선순위: 환경변수 → 이 입력칸. Anthropic → OpenAI → Gemini 순으로 시도합니다. 환경변수로 설정했다면 비워두세요.
pref-anthropic-key = Anthropic API Key
pref-openai-key = OpenAI API Key
pref-gemini-key = Gemini API Key

pref-models = 모델
pref-anthropic-model = Anthropic 모델
pref-openai-model = OpenAI 모델
pref-gemini-model = Gemini 모델

pref-output = 출력 위치
pref-output-hint = paper-curation이 설치돼 있으면 root 경로를 비워두면 자동 탐색합니다(직접 지정도 가능). 없으면 fallback 경로를 지정하세요 — 리뷰는 <경로>/docs/papers/ 아래에 생성됩니다.
pref-pc-root = paper-curation 루트 경로
pref-fallback-dir = Fallback 출력 경로
pref-overwrite =
    .label = 기존 review 덮어쓰기 (Overwrite existing)
pref-compare-image =
    .label = 논문 비교 그림 생성 (~수 분)
pref-compare-image-hint = ON(기본): 논문 비교 시 PaperBanana로 비교 다이어그램을 생성해 페이지 상단에 넣습니다(수 분 소요, Gemini 키 필요). OFF: 다이어그램 없이 텍스트 비교만 생성해 수십 초로 단축됩니다.
pref-overwrite-hint = OFF(기본): 이미 review가 있는 논문은 건너뜁니다. ON: 기존 review.md·index.html을 덮어씁니다(분류 등 메타데이터는 보존). Paper Curio가 직접 만든 review는 이 설정과 무관하게 항상 재생성됩니다.
pref-python-path = Python 경로
pref-python-path-hint = paper-curation 원본 함수(figure 추출 등)를 호출할 Python 인터프리터. paper-curation과 동일한 py3.12 + PyMuPDF 환경이어야 합니다. 비우면 기본 conda py312 사용.
