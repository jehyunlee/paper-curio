# Paper Curio

[한국어](README.md) | **English**

A Zotero 9 plugin for **chatting directly with paper PDFs (AI Chat), comparing multiple papers (Comparative Chat), and processing entire Zotero collections as paper-curation topics.** AI Chat works immediately after installation with just one LLM API key (Anthropic, OpenAI, or Gemini).

Connecting [**paper-curation**](https://github.com/jehyunlee/paper-curation) requires just one path setting and enables **related-paper analysis, inline paper figures in answers, review generation, comparison HTML, and full collection processing from the context menu (reviews, classification, narratives, and main/category timelines; deployment excluded)**. Like ARIA, it has no toolbar button: **the context menu is the single entry point**.

## Two modes

| | **Light (default)** | **Enhanced (paper-curation integration)** |
|---|---|---|
| Requirements | Zotero + an LLM API key | Also requires the paper-curation path in Settings |
| AI Chat — multi-turn PDF conversations (streaming, equations, EN/KO) | Supported | Supported; prefers corpus `text.md` for **faster preparation** |
| Comparative Chat — compare papers | Selected papers | Selected papers plus **already-linked related research** |
| **Citedby** — analyze papers citing the selected paper | Not available | HTML report (PDF printing and Zotero links) + bulk import into Zotero |
| **Inline figures** from papers in answers | Not available | Supported |
| Export conversations as .md / .html | Supported | Supported, including embedded figures |
| Export conversations to **Obsidian** (wikilinks) | Not available | Supported |
| Review generation, Comparison HTML, full collection processing | Not available | Supported via the Python 3.12 bridge, including alias registration for new collections |

Light mode caches PDF text locally for instant reopening. Enhanced mode first reads the `text.md` and `figures/` already extracted by paper-curation, reducing preparation time for the first response.

## Installation

### Users — install from a release (recommended)

1. Download **`paper-curio.xpi`** from the **[latest release](https://github.com/jehyunlee/paper-curio/releases/latest)**.
2. In Zotero 9, choose **Tools → Plugins → gear menu (upper right) → Install Plugin From File…**, then select the downloaded `paper-curio.xpi`.
3. Subsequent updates are **automatic**: Zotero retrieves new versions using the release's `update.json` manifest.

> Installation and one API key are enough to start using **AI Chat / Comparative Chat immediately** (Light mode). Enhanced features such as review generation, figure extraction, related-paper analysis, and full collection processing require paper-curation and the py312 bridge described under **Optional dependency** below.

### Developers — build from source

```bash
npm install
npm run build          # → build/paper-curio.xpi  (tsc + pack)
```

Install the resulting `build/paper-curio.xpi` using the same procedure above. `npm run release` handles release publishing in one step: building the .xpi, uploading the GitHub release, and updating the automatic-update manifest.

## Optional dependency: [paper-curation](https://github.com/jehyunlee/paper-curation) (Enhanced mode)

This plugin invokes the paper-curation pipeline's **original Python functions** (`extract_text`, `extract_figures`, `write_review`, etc.) through subprocesses. Full functionality therefore requires:

| Requirement | Purpose | Without it |
|---|---|---|
| [paper-curation](https://github.com/jehyunlee/paper-curation) installation | Import original functions and write to `docs/papers/` | TypeScript fallback for text/reviews; **no figure extraction** |
| **Python 3.12** + paper-curation requirements | Bridge interpreter (`PYTHON_PATH` preference or an automatically managed environment) | No figures, original text/review functions, or full collection processing; TypeScript fallback is used where available |
| (Optional) Java + `opendataloader-pdf` | Structured text extraction | Automatically falls back to PyMuPDF text |

paper-curation normally runs in a **py312 environment**. Setting the same interpreter under **Settings → Paper Curio → Python path** is the fastest option. When left blank, Paper Curio searches for py312 or creates a managed venv, attempting to download a relocatable Python distribution when necessary.

## How outputs are generated

| Output | Generation method | Original function |
|---|---|---|
| `text.md` | Original Python function | `run_update_force.extract_text` |
| `figures/figN.png` | Original Python function | `run_update_force.extract_figures` (PyMuPDF) |
| `review.md` | Original Python function | `run_update_force.write_review` (`claude-haiku-4-5`) |
| `originality.md` | Original Python function | `originality_extractor._extract_rule_based` |
| Related papers (connections) | Original Python functions | `specter2_embed` + `compute_related_candidates` + `generate_connections_from_candidates` + `sync_topic_connections` (requires a corpus embedding cache) |
| `index.html` | TypeScript (port of `review_to_html.py` + Audio Overview) | TypeScript is used to inject connections |
| `_papers_index.json` | TypeScript append | Topic comes from the Zotero collection; category assignment is delegated to paper-curation's `classify_papers.py` |
| Topic index / timelines | Original Python pipeline | Collection context menu invokes `run_full.py --mode curate --source zotero --images changed` → `index.html`, `_category_*`, `research_timeline.png`, `category_timeline_*.png` |

> When the required key or bridge (py312/paper-curation) is unavailable, reviews gracefully fall back to the TypeScript multi-provider implementation (Anthropic → OpenAI → Gemini), and text extraction falls back to pdf.js. Figures require the original Python implementation.

## API keys

Precedence: **environment variables → preference fields**. Providers are tried in this order: Anthropic → OpenAI → Gemini.

| Provider | Environment variable | Default model (same as paper-curation) |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5` |
| Gemini | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `gemini-3.1-pro-preview` |

> The original `write_review` uses `claude-haiku-4-5` with `ANTHROPIC_API_KEY`. macOS GUI apps cannot see shell environment variables, so using environment variables requires `launchctl setenv` or a LaunchAgent. Alternatively, enter keys directly in Settings.

## Output location

The root is resolved in this order:

1. The paper-curation root path in preferences.
2. The `PAPER_CURATION_DIR` / `PAPER_CURATION_ROOT` environment variables.
3. Automatic discovery (candidates such as `~/Documents/.../paper-curation`).
4. When paper-curation is unavailable, `docs/papers/` is created under the fallback output path in preferences.

A root is recognized by the presence of `<root>/docs/papers/`. Reviews are generated in `docs/papers/{NNN}_{slug}/`.

## Existing reviews

Papers that already have reviews are **skipped by default** (non-destructive). Enable **Settings → Overwrite existing** to overwrite them; classification metadata is preserved even then. Reviews created by Paper Curio itself are always regenerated.

## Feature scope (v0.9.1)

- Single/multiple-item processing from the context menu, with a progress window.
- **Open paper-curation Review HTML** in the context menu opens an existing review (`index.html`) directly in the browser without generating a new one.
- **paper-curation AI Chat (PDF Q&A)** in the context menu provides multi-turn Q&A using the paper PDF as context, with GPT, Anthropic, and Gemini model selection at the top.
- **paper-curation Citedby** in the context menu collects citing papers from OpenAlex, Scopus, S2, and arXiv using the selected paper's DOI, extracts originality, and—when a topic is entered—applies an LLM filter and produces 5W1H summaries. It opens a **self-contained HTML report** in the browser. The report's **Print PDF** button creates a PDF with working links. Papers already in your library open directly through `zotero://open-pdf` (or their bibliographic record when no PDF is available). Citing papers can then be **bulk-imported into Zotero**, automatically skipping DOI, arXiv, and title duplicates, ready for `run_full --mode curate --source zotero`.
- **Text, figures, reviews, originality, and connections are all generated using paper-curation's original functions** through the py312 bridge.
- **Process entire collection** in the collection context menu prompts for an alias for a new collection and registers it in `config.json`, then runs Zotero sync → reviews → topic classification → narrative/main and category timelines → topic index. Cloudflare deployment is excluded.
- Automatic py312 setup: prefers the specified Python interpreter; otherwise bootstraps a managed venv or relocatable Python.
- Connections use original SPECTER2 embeddings, cosine top-k selection, and generation with Anthropic/OpenAI/Gemini fallback.
- `index.html` (including Audio Overview), topic assignment, three-provider fallback, non-destructive overwrite handling, and Korean/English locales.
- GitHub releases and an automatic-update manifest.
- **Pending:** bidirectional incoming connections (backlinks). Only outgoing connections are currently handled; incoming connections are delegated to a full paper-curation connections run.

## License

AGPL-3.0-or-later
