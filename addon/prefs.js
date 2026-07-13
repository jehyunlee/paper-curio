pref("extensions.zotero.__addonRef__.enable", true)

// LLM provider API keys (env vars take precedence and overwrite these on startup)
pref("extensions.zotero.__addonRef__.ANTHROPIC_API_KEY", "")
pref("extensions.zotero.__addonRef__.OPENAI_API_KEY", "")
pref("extensions.zotero.__addonRef__.GEMINI_API_KEY", "")

// Default models per provider (paper-curation과 동일 기준)
// Anthropic: paper-curation WRITE_REVIEW_MODEL. Gemini: 주력 모델. OpenAI: 참조 모델.
pref("extensions.zotero.__addonRef__.ANTHROPIC_MODEL", "claude-sonnet-5")
pref("extensions.zotero.__addonRef__.OPENAI_MODEL", "gpt-5")
pref("extensions.zotero.__addonRef__.GEMINI_MODEL", "gemini-3.1-pro-preview")

// paper-curation discovery / output
pref("extensions.zotero.__addonRef__.PAPER_CURATION_ROOT", "")
pref("extensions.zotero.__addonRef__.OUTPUT_FALLBACK_DIR", "")

// 기존 review 덮어쓰기 정책 (기본 OFF = 이미 review 있으면 건너뜀)
pref("extensions.zotero.__addonRef__.OVERWRITE_EXISTING", false)

// 논문 비교 시 PaperBanana 다이어그램 생성 (OFF면 비교가 수십 초로 단축)
pref("extensions.zotero.__addonRef__.COMPARE_IMAGE", true)

// collection명 → topic 매핑 (JSON). 비우면 collection명을 slugify해 topic으로 사용.
// 예: {"AI for Science":"ai4s","Physical AI":"physical-ai"}
pref("extensions.zotero.__addonRef__.COLLECTION_TOPIC_MAP", "")

// Python 인터프리터 (paper-curation 원본 함수 호출용 — figure 추출 등). py3.12 + PyMuPDF 필요.
pref("extensions.zotero.__addonRef__.PYTHON_PATH", "/opt/homebrew/Caskroom/miniconda/base/envs/py312/bin/python")

// Chat 답변 언어 (ko | en). 기본 한국어. 채팅 창의 EN/KO 버튼과 공유.
pref("extensions.zotero.__addonRef__.CHAT_LANG", "ko")

// Chat 답변 최대 출력 토큰. 답변이 이 값에서 잘려도 자동으로 이어받아 완성한다.
// (과거 4096 하드코딩 탓에 긴 답변이 끊기던 문제 수정.) 실제 요청은 모델별
// 출력 상한으로 clamp되며(sonnet 64000/opus 32000/그 외 8192), 과금은 실제
// 생성 토큰 기준이라 값을 높여도 미사용분 비용은 없다. 필요시 더 높여도 안전.
pref("extensions.zotero.__addonRef__.CHAT_MAX_TOKENS", 32000)
