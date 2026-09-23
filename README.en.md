# Paper Curio

[한국어](README.md) | **English**

## Minimal reviews and shared modules

Connect an updated paper-curation checkout and Python 3.12, then store **one selected provider key** in the OS keyring. Anthropic Sonnet 5 is the default; OpenAI and Google are explicit alternatives. Select Review generation for a Zotero item with a local PDF. After confirming the provider and cost plan, it runs only **extraction → review → HTML + bibliography.json**. Original Zotero creator JSON and journal metadata are passed directly; no Zotero Web API key is needed.

Review failures do not trigger OpenAI/Gemini fallback. Google, Resend, clustering models, PaperBanana and deployment credentials are not required. Classification, connection generation, search indexing, timelines and bibliography DB updates no longer run automatically after a review. Curio updates the paper list for discovery, while the completion message explicitly reports **bibliography DB integration pending**, separately from review failure. Full collection processing remains a separate advanced operation.

The **Paper Curation modules** context menu uses the same registry, plans and results as the CLI. Start with reading/export, paper AI or collection management; select audio, timelines, publication and email separately. Grounded summaries/chat also support local Ollama `qwen3.8:27b-mlx`, rejecting answers without valid source quotations. Comparison now uses the shared comparison feature without automatic image generation.

Settings retain only `credential:<provider>` references; values live in the OS keyring. Environment overrides remain available for automation and are never copied into plaintext settings. Old plaintext key preferences are no longer read: save each key to the OS store again; the obsolete preference is removed only after storage succeeds. Cost ceilings require explicit input/output rates and block execution when rates are unknown or the bound exceeds the ceiling. Shared corpus reservation/registration/cancellation and operation locks coordinate supported Curio, feature-CLI and full-workflow writes. Direct debugging scripts must not bypass the shared execution boundary.

Local reviews currently require macOS/Linux with `fcntl` locking. Windows local reviews are not supported yet; existing document browsing and chat are separate features.

A Zotero 9 / 10 plugin for **chatting directly with paper PDFs (AI Chat), comparing multiple papers (Comparative Chat), and processing entire Zotero collections as paper-curation topics.** AI Chat works immediately after installation with just one LLM API key (Anthropic, OpenAI, or Gemini).

Connecting [**paper-curation**](https://github.com/jehyunlee/paper-curation) enables **shared reviews, grounded comparisons/summaries, OS credential storage, related-paper analysis, inline figures, optional modules and full collection processing**. Full processing and image generation remain separate tasks, not automatic post-review steps. All entry points are in the context menu.

## Two modes

|                                                                      | **Light (default)**     | **Enhanced (paper-curation integration)**                                               |
| -------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| Requirements                                                         | Zotero + an LLM API key | Also requires the paper-curation path in Settings                                       |
| AI Chat — multi-turn PDF conversations (streaming, equations, EN/KO) | Supported               | Supported; prefers corpus `text.md` for **faster preparation**                          |
| Comparative Chat — compare papers                                    | Selected papers         | Selected papers plus **already-linked related research**                                |
| **Citedby** — analyze papers citing the selected paper               | Not available           | HTML report (PDF printing and Zotero links) + bulk import into Zotero                   |
| **Inline figures** from papers in answers                            | Not available           | Supported                                                                               |
| Export conversations as .md / .html                                  | Supported               | Supported, including embedded figures                                                   |
| Export conversations to **Obsidian** (wikilinks)                     | Not available           | Supported                                                                               |
| Review generation, grounded comparison, full collection processing   | Not available           | Shared Python executor; comparison result JSON export and collection alias registration |

Light mode caches PDF text locally for instant reopening. Enhanced mode first reads the `text.md` and `figures/` already extracted by paper-curation, reducing preparation time for the first response.

## Five-minute start — where each setting lives

![Three usage paths](https://raw.githubusercontent.com/jehyunlee/paper-curation/master/usage_workflow.en.png)

| Step | Where                                                 | What                                                                                                                                                                                     |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Terminal                                              | Clone [paper-curation](https://github.com/jehyunlee/paper-curation) → `conda` `py312` → `pip install -r requirements.txt` → `python pipeline/setup.py` (no key needed)                   |
| 2    | Zotero → Tools → Plugins                              | Install `paper-curio.xpi` as described under **Installation** below                                                                                                                      |
| 3    | Zotero → Settings → Paper Curio → **Output Location** | Set **paper-curation root** to the folder from step 1 (leave **Python path** empty for `py312`)                                                                                          |
| 4    | Zotero → Settings → Paper Curio → **API Keys**        | Pick one **Review provider** → paste the key → **Save to OS keyring**. Optionally set the **Review cost ceiling** and rates                                                              |
| 5    | Right-click a paper item in the library               | **paper-curation Review generation** → check the plan (provider, output path, cost) → execute                                                                                            |
| 6    | Right-click → **Paper Curation modules**              | Summary/chat/comparison (Paper AI), indexes/metrics/bibliography (Collection), audio/timelines/publish/email (Optional features), each card via **Inspect plan → Execute selected task** |

Screen fields, output locations and the meaning of status messages (`needs-key`, `busy`,
**bibliography DB integration pending**, …) are in the
📘 **[User Guide](https://github.com/jehyunlee/paper-curation/blob/master/docs/user-guide.en.md)**.

## Installation

### Users — install from a release (recommended)

Every release ships **one XPI per Zotero major version**. Pick the file that matches your Zotero (**Help → About Zotero**). Both are built from the same source with the same features; only the Zotero compatibility range differs.

| Your Zotero | Download | Notes |
|---|---|---|
| **10.x** | **[`paper-curio-zotero10.xpi`](https://github.com/jehyunlee/paper-curio/releases/latest/download/paper-curio-zotero10.xpi)** | Available from v0.11.0 |
| **9.x** (also 7 / 8) | **[`paper-curio-zotero9.xpi`](https://github.com/jehyunlee/paper-curio/releases/latest/download/paper-curio-zotero9.xpi)** | v0.10.0 and earlier shipped a single `paper-curio.xpi` (Zotero 9 only) |

1. Download the XPI for your version from the table above. Older versions are listed under [Releases](https://github.com/jehyunlee/paper-curio/releases) with the same file names.
2. In Zotero, choose **Tools → Plugins → gear menu (upper right) → Install Plugin From File…**, then select the downloaded XPI.
3. Subsequent updates are **automatic**: `update.json` carries one entry per Zotero major, so Zotero 9 only receives the 9 build and Zotero 10 only receives the 10 build.

> After upgrading Zotero from 9 to 10, the Zotero 9 plugin is disabled as "incompatible". Install `paper-curio-zotero10.xpi` once by hand; automatic updates then follow the Zotero 10 line. Preferences and API-key references are preserved.

> Installation and one API key are enough to start using **AI Chat / Comparative Chat immediately** (Light mode). Enhanced features such as review generation, figure extraction, related-paper analysis, and full collection processing require paper-curation and the py312 bridge described under **Optional dependency** below.

### Developers — build from source

```bash
npm install
npm run build          # → build/paper-curio-zotero9.xpi + build/paper-curio-zotero10.xpi + build/update.json
npm run build-only 10  # one target only (no merged update.json)
```

One source tree produces one XPI per Zotero major. `strict_min/max_version` in `addon/manifest.json` are filled at build time from the target table in `scripts/targets.mjs`; supporting a new Zotero major means adding a row there. Install a built XPI using the same procedure above.

Release procedure — both XPIs **always ship together**:

```bash
# bump package.json version and commit, then
npm run build && npm test && npm run release
```

`npm run release` attaches both XPIs to the `v<version>` release and refreshes `update.json` on the `release` tag with the merged per-version entries. It refuses to overwrite an existing tag.

## Optional dependency: [paper-curation](https://github.com/jehyunlee/paper-curation) (Enhanced mode)

This plugin invokes the paper-curation pipeline's **original Python functions** (`extract_text`, `extract_figures`, `write_review`, etc.) through subprocesses. Full functionality therefore requires:

| Requirement                                                                | Purpose                                          | Without it                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [paper-curation](https://github.com/jehyunlee/paper-curation) installation | Shared review executor and `docs/papers/` output | Chat remains available; reviews report a missing runtime                                           |
| **Python 3.12** + paper-curation requirements                              | Bridge interpreter (`PYTHON_PATH` preference)    | Reviews report a missing runtime. Only full collection processing bootstraps a managed environment |
| (Optional) Java + `opendataloader-pdf`                                     | Structured text extraction                       | Automatically falls back to PyMuPDF text                                                           |

paper-curation normally runs in a **py312 environment**. Set that interpreter under **Settings → Paper Curio → Python path**. Minimal reviews check installed Python and report a missing runtime without installing anything. Managed venv creation and relocatable Python downloads belong only to full collection processing.

## How outputs are generated

| Output                       | Generation method            | Original function                                                                                                                                                              |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text.md`                    | Original Python function     | `run_update_force.extract_text`                                                                                                                                                |
| `figures/figN.png`           | Original Python function     | `run_update_force.extract_figures` (PyMuPDF)                                                                                                                                   |
| `review.md`                  | Shared local review executor | `run_update_force.write_review` (`claude-sonnet-5`)                                                                                                                            |
| `originality.md`             | Original Python function     | `originality_extractor._extract_rule_based`                                                                                                                                    |
| Related papers (connections) | Original Python functions    | `specter2_embed` + `compute_related_candidates` + `generate_connections_from_candidates` + `sync_topic_connections` (requires a corpus embedding cache)                        |
| `index.html`                 | Shared Python executor       | `review_to_html.convert_review(keyless=True)` — no Audio or corpus-connection injection in minimal reviews                                                                     |
| `_papers_index.json`         | TypeScript append            | Topic comes from the Zotero collection; category assignment is delegated to paper-curation's `classify_papers.py`                                                              |
| Topic index / timelines      | Original Python pipeline     | Collection context menu invokes `run_full.py --mode curate --source zotero --images changed` → `index.html`, `_category_*`, `research_timeline.png`, `category_timeline_*.png` |

> Originality, connections and topic outputs above belong to full collection processing. Minimal reviews produce only text, figures, review, HTML and a bibliography sidecar. A missing shared runtime or selected provider credential stops execution with a specific requirement. Chat retains its existing pdf.js extraction path.

## API keys

Precedence: **environment variables → shared OS keyring**. Reviews, summaries, grounded chat and comparisons require explicit provider selection and never fall back to another company. The OS key save button requires paper-curation's Python keyring runtime. Standalone Light chat works with an injected environment credential.

| Provider  | Environment variable                   | Default model (same as paper-curation) |
| --------- | -------------------------------------- | -------------------------------------- |
| Anthropic | `ANTHROPIC_API_KEY`                    | `claude-sonnet-5`                      |
| OpenAI    | `OPENAI_API_KEY`                       | `gpt-5`                                |
| Gemini    | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `gemini-3.1-pro-preview`               |

> Reviews default to Anthropic `claude-sonnet-5`. macOS GUI apps do not automatically inherit shell variables; use the shared OS keyring or inject environment credentials through a LaunchAgent. Keys are never stored in plaintext preferences, review request JSON or command-line arguments.

## Output location

The root is resolved in this order:

1. The paper-curation root path in preferences.
2. The `PAPER_CURATION_DIR` / `PAPER_CURATION_ROOT` environment variables.
3. Automatic discovery (candidates such as `~/Documents/.../paper-curation`).
4. A fallback output path supports browsing existing files. New reviews require a paper-curation installation containing the shared executor.

A root is recognized by the presence of `<root>/docs/papers/`. Reviews are generated in `docs/papers/{NNN}_{slug}/`.

## Existing reviews

Papers that already have reviews are **skipped by default** (non-destructive). Enable **Settings → Overwrite existing** to overwrite them; classification metadata is preserved even then. Reviews created by Paper Curio itself are always regenerated.

## Feature scope (v0.10.0)

- Single/multiple-item processing from the context menu, with a progress window.
- **Open paper-curation Review HTML** in the context menu opens an existing review (`index.html`) directly in the browser without generating a new one.
- **paper-curation AI Chat (PDF Q&A)** in the context menu provides multi-turn Q&A using the paper PDF as context, with GPT, Anthropic, and Gemini model selection at the top.
- **paper-curation Citedby** in the context menu collects citing papers from OpenAlex, Scopus, S2, and arXiv using the selected paper's DOI, extracts originality, and—when a topic is entered—applies an LLM filter and produces 5W1H summaries. It opens a **self-contained HTML report** in the browser. The report's **Print PDF** button creates a PDF with working links. Papers already in your library open directly through `zotero://open-pdf` (or their bibliographic record when no PDF is available). Citing papers can then be **bulk-imported into Zotero**, automatically skipping DOI, arXiv, and title duplicates, ready for `run_full --mode curate --source zotero`.
- Minimal reviews generate **text, figures, review, HTML and bibliography.json** through the shared Python executor. Originality and connections belong to separate collection processing.
- **Process entire collection** in the collection context menu prompts for an alias for a new collection and registers it in `config.json`, then runs Zotero sync → reviews → topic classification → narrative/main and category timelines → topic index. Cloudflare deployment is excluded.
- Full collection processing prepares py312 automatically: it prefers the specified Python interpreter, otherwise bootstrapping a managed venv or relocatable Python.
- Full collection processing uses the existing SPECTER2 connections pipeline; minimal reviews do not generate connections automatically.
- `index.html`, topic bookkeeping, non-destructive overwrite handling, and Korean/English locales. Minimal review HTML does not embed operator keys.
- GitHub releases and an automatic-update manifest.
- **Pending:** bidirectional incoming connections (backlinks). Only outgoing connections are currently handled; incoming connections are delegated to a full paper-curation connections run.

## License

AGPL-3.0-or-later
