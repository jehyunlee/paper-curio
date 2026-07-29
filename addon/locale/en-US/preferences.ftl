pref-llm-backend = LLM Backend
pref-llm-backend-hint = Choose an API SDK or a CLI that uses your local login session. CLI mode needs no API key, but its CLI must already be authenticated.
pref-llm-backend-select = Invocation method
pref-backend-api =
    .label = API keys (Anthropic / OpenAI / Gemini)
pref-backend-claude =
    .label = Claude CLI (claude -p)
pref-backend-codex =
    .label = Codex CLI (codex exec)
pref-claude-cli-path = Claude executable
pref-codex-cli-path = Codex executable
pref-cli-path-hint = Leave blank to search ~/.local/bin and common Homebrew locations. Set an absolute path only when Zotero cannot find the CLI.

pref-api-keys = API Keys
pref-api-keys-hint = Used when API keys is selected above. Priority: environment variable → this field. Tried in order Anthropic → OpenAI → Gemini.
pref-anthropic-key = Anthropic API Key
pref-openai-key = OpenAI API Key
pref-gemini-key = Gemini API Key

pref-models = Models
pref-anthropic-model = Anthropic Model
pref-openai-model = OpenAI Model
pref-gemini-model = Gemini Model

pref-output = Output Location
pref-output-hint = If paper-curation is installed, leave the root path to auto-detect (or set it explicitly). Otherwise set a fallback dir; reviews are written under <dir>/docs/papers/.
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
