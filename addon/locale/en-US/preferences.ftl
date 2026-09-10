pref-api-keys = API Keys
pref-api-keys-hint = Select one review provider. There is no cross-provider fallback. Keys are stored in the shared OS keyring, not Zotero preferences; injected environment values take precedence.
pref-review-provider = Review provider
pref-review-budget = Review cost ceiling (optional)
pref-review-budget-hint = A ceiling requires your current provider input/output rates. Unknown rates or an estimate over the ceiling block execution. Blank ceiling means no budget cap.
pref-optional-providers = Other chat providers and optional features
pref-anthropic-key = Anthropic API Key
pref-openai-key = OpenAI API Key
pref-gemini-key = Gemini API Key

pref-models = Chat models (review models follow the selected provider contract)
pref-anthropic-model = Anthropic Model
pref-openai-model = OpenAI Model
pref-gemini-model = Gemini Model

pref-output = Output Location
pref-output-hint = Reviews require an updated paper-curation checkout and Python 3.12. Set its root path or use auto-detection. Fallback directories support existing corpus browsing, not the shared review engine.
pref-pc-root = paper-curation root
pref-fallback-dir = Fallback output dir
pref-overwrite =
    .label = Overwrite existing reviews
pref-compare-image =
    .label = Generate comparison diagram (~takes minutes)
pref-compare-image-hint = ON (default): paper comparisons include a PaperBanana diagram at the top (takes minutes, needs a Gemini key). OFF: text-only comparison, done in tens of seconds.
pref-overwrite-hint = OFF (default): papers that already have a review are skipped. ON: existing review.md/index.html are overwritten (classification metadata preserved). Reviews created by Paper Curio itself are always regenerated regardless of this setting.
pref-python-path = Python path
pref-python-path-hint = Python interpreter used to call paper-curation's original functions (figure extraction etc.). Must be the same py3.12 + PyMuPDF environment as paper-curation. Blank uses the default conda py312.

pref-chat = Chat
pref-chat-lang = Answer language
pref-chat-lang-hint = Language the AI answers in, for AI Chat / Comparative Chat. You can also toggle it per-window with the EN/KO button in the chat header.

pref-litdb = Literature DBs (Citedby)
pref-litdb-hint = Priority: environment variable → this field. Launching Zotero from Finder does not inherit terminal environment variables, so set them here in that case. All optional — a missing key only drops that source.
pref-scopus-key = Scopus API Key
pref-scopus-token = Scopus Inst Token
pref-s2-key = Semantic Scholar Key
pref-openalex-email = OpenAlex/Crossref Email
pref-springer-meta-key = Springer Nature Metadata Key
