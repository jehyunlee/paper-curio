# 우클릭 메뉴
itemmenu-review = paper-curation Review 생성
itemmenu-comparison = paper-curation Comparison

# 토스트 — 비교
toast-compare-need-two = 비교하려면 논문을 2편 이상 선택하세요.
toast-compare-too-many = 논문이 너무 많습니다 — 최대 { $max }편까지.
toast-compare-missing = 리뷰 없음: { $titles } — 먼저 paper-curation Review 를 실행하세요.
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
