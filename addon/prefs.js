pref("extensions.zotero.__addonRef__.enable", true)

// LLM provider API keys (env vars take precedence and overwrite these on startup)
pref("extensions.zotero.__addonRef__.ANTHROPIC_API_KEY", "")
pref("extensions.zotero.__addonRef__.OPENAI_API_KEY", "")
pref("extensions.zotero.__addonRef__.GEMINI_API_KEY", "")

// Default models per provider (paper-curation과 동일 기준)
// Anthropic: paper-curation WRITE_REVIEW_MODEL. Gemini: 주력 모델. OpenAI: 참조 모델.
pref("extensions.zotero.__addonRef__.ANTHROPIC_MODEL", "claude-sonnet-4-6")
pref("extensions.zotero.__addonRef__.OPENAI_MODEL", "gpt-5")
pref("extensions.zotero.__addonRef__.GEMINI_MODEL", "gemini-3.1-pro-preview")

// paper-curation discovery / output
pref("extensions.zotero.__addonRef__.PAPER_CURATION_ROOT", "")
pref("extensions.zotero.__addonRef__.OUTPUT_FALLBACK_DIR", "")

// 기존 review 덮어쓰기 정책 (기본 OFF = 이미 review 있으면 건너뜀)
pref("extensions.zotero.__addonRef__.OVERWRITE_EXISTING", false)
