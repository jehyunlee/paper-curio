pref-api-keys = API Keys
pref-api-keys-hint = Priority: environment variable → this field. Tried in order Anthropic → OpenAI → Gemini. Leave blank if set via env var.
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
