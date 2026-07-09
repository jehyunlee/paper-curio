# 우클릭 메뉴
itemmenu-review = paper-curation Review 생성
itemmenu-comparison = paper-curation Comparison
itemmenu-chat = paper-curation AI 대화 (PDF Q&A)
itemmenu-open-review = paper-curation Review HTML 열기

# 토스트 — 비교
toast-compare-need-two = 비교하려면 논문을 2편 이상 선택하세요.
toast-compare-too-many = 논문이 너무 많습니다 — 최대 { $max }편까지.
toast-compare-prereview = 리뷰 없는 논문 { $n }편을 먼저 생성합니다… (편당 수 분)
toast-compare-prereview-fail = 리뷰 생성 실패로 비교를 중단합니다: { $title } — { $err }
toast-compare-running = 논문 { $n }편 비교 중… (다이어그램 포함 2~5분 소요)
toast-compare-done = 비교 완료 — 브라우저에서 엽니다
toast-compare-fail = 비교 실패: { $err }

# 토스트 — 가드
toast-no-items = 선택된 논문(regular item)이 없습니다.
toast-no-provider = LLM API key가 설정되지 않았습니다. Settings → Paper Curio에서 Anthropic / OpenAI / Gemini 중 하나를 입력하세요.

# 토스트 — 단일
toast-running = 리뷰 생성 중: { $title }
toast-done-one = 완료: { $title } (점수 { $score }, { $provider })
toast-skipped = 건너뜀(이미 review 있음): { $title } — 덮어쓰려면 설정에서 'Overwrite existing' 활성화
toast-fail = 실패: { $title } — { $err }

# 토스트 — 일괄
toast-batch-header = 일괄 리뷰 생성 ({ $n }건)
toast-pending = 대기 중: { $title }
toast-running-batch = 처리 중 ({ $i }/{ $n }): { $title }
toast-done-line = 완료: { $title } ({ $score })
toast-batch-summary = 완료 — 성공 { $ok } / 건너뜀 { $skip } / 실패 { $fail } / 중단 { $abort }

# 컬렉션 메뉴 — 웹 배포
collectionmenu-deploy = 이 컬렉션 웹 배포 (Cloudflare)
toast-deploy-no-collection = 컬렉션을 먼저 선택하세요.
toast-deploy-running = 웹 배포 중: { $topic } … (1~2분 소요)
toast-deploy-done = 웹 배포 완료: { $topic }
toast-deploy-fail = 웹 배포 실패: { $topic } — { $err }
toast-deploy-no-cf = Cloudflare 자격증명이 없습니다. config.json의 cloudflare.api_token / cloudflare.account_id 를 추가하거나 CF_API_TOKEN·CLOUDFLARE_ACCOUNT_ID 환경변수를 설정하세요.

# 토스트 — Review HTML 열기
toast-open-review-opened = Review HTML { $opened }개 열었습니다 (없음 { $missing })
toast-open-review-none = 생성된 Review HTML이 없습니다 — 먼저 'paper-curation Review 생성'을 실행하세요.

# AI 대화 (PDF Q&A)
toast-chat-extracting = PDF 텍스트 추출 중: { $title }
toast-chat-ready = PDF 준비 완료 — { $chars }자 / { $pages }p
toast-chat-no-pdf = PDF 텍스트를 찾지 못했습니다 — 메타데이터로만 대화합니다.
chat-title = AI 대화 — { $title }
chat-model-label = 모델
chat-input-placeholder = 이 논문에 대해 질문하세요… (Enter 전송, Shift+Enter 줄바꿈)
chat-send = 보내기
chat-close = 닫기
chat-thinking = 생성 중…
chat-empty-reply = (빈 응답)
chat-greeting = 논문 "{ $title }"에 대해 무엇이든 물어보세요 — PDF 전문을 컨텍스트로 답합니다. (유료 API 호출이며, 상단에 예상 비용이 누적 표시됩니다.)
chat-no-pdf-note = PDF 텍스트를 추출하지 못했습니다 — 메타데이터만으로 답합니다.
chat-cost = 유료 API · 예상 ${ $cost } · in { $in } / out { $out } tok
chat-cost-title = 모델 공시 단가 기반 추정치입니다. 실제 청구액과 다를 수 있습니다.

# 비교 연구(이미 연결된 관련 연구) + 다중 논문 대화
itemmenu-comparative-study = paper-curation 비교 연구 (연결된 관련 연구)
chat-title-multi = AI 대화 — 논문 { $n }편
chat-greeting-multi = 선택한 { $n }편의 논문에 대해 무엇이든 물어보세요 — 각 PDF 전문을 컨텍스트로 답합니다. (유료 API 호출이며, 상단에 예상 비용이 누적 표시됩니다.)
toast-chat-ready-multi = 논문 { $n }편 준비 완료 — 총 { $chars }자
toast-compare-gather-related = 이미 연결된 관련 연구를 불러오는 중…
toast-compare-related-found = 연결된 관련 연구 { $n }편 로드
compare-title = 비교 연구 — 논문 { $n }편
compare-seed-single = 이 논문의 독창성, 한계, 학문적 의의를 분석해줘. 이미 연결된 관련 연구(있는 경우)와 비교해 무엇이 진짜 새롭고 무엇이 부족한지, 이 연구가 관련 문헌들 사이에서 어떤 위치에 있는지 구체적 근거와 함께 짚어줘.
compare-seed-multi = 선택한 논문들을 서로 비교하고(공통점·차이점, 그리고 상호 관계: 누가 무엇을 발전/대체/보완하는지), 각 논문에 이미 연결된 관련 연구(있는 경우)와 함께 놓고 독창성, 한계, 학문적 의의를 분석해줘. 핵심 비교는 표로 정리해줘.
