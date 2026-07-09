# Right-click menu
itemmenu-review = paper-curation Review generation
itemmenu-comparison = paper-curation Comparison
itemmenu-chat = paper-curation AI Chat (single PDF)
itemmenu-open-review = Open paper-curation Review HTML

# Toasts — comparison
toast-compare-need-two = Select 2 or more papers to compare.
toast-compare-too-many = Too many papers — select up to { $max }.
toast-compare-prereview = Reviewing { $n } paper(s) without a review first… (minutes each)
toast-compare-prereview-fail = Comparison aborted — review failed: { $title } — { $err }
toast-compare-running = Comparing { $n } papers… (takes 2-5 min incl. diagram)
toast-compare-done = Comparison ready — opening in browser
toast-compare-fail = Comparison failed: { $err }

# Toasts — guards
toast-no-items = No regular items selected.
toast-no-provider = No LLM API key configured. Set one in Settings → Paper Curio (Anthropic / OpenAI / Gemini).

# Toasts — single
toast-running = Generating review: { $title }
toast-done-one = Done: { $title } (score { $score }, { $provider })
toast-skipped = Skipped (review exists): { $title } — enable 'Overwrite existing' in Settings to replace
toast-fail = Failed: { $title } — { $err }

# Toasts — batch
toast-batch-header = Batch review ({ $n })
toast-pending = Pending: { $title }
toast-running-batch = Processing ({ $i }/{ $n }): { $title }
toast-done-line = Done: { $title } ({ $score })
toast-batch-summary = Done — { $ok } ok / { $skip } skipped / { $fail } failed / { $abort } aborted

# Collection menu — web deploy
collectionmenu-deploy = Web deploy this collection (Cloudflare)
toast-deploy-no-collection = Select a collection first.
toast-deploy-running = Deploying to web: { $topic } … (takes 1-2 min)
toast-deploy-done = Web deploy complete: { $topic }
toast-deploy-fail = Web deploy failed: { $topic } — { $err }
toast-deploy-no-cf = No Cloudflare credentials. Add cloudflare.api_token / cloudflare.account_id to config.json, or set CF_API_TOKEN / CLOUDFLARE_ACCOUNT_ID env vars.

# Toasts — open review HTML
toast-open-review-opened = Opened { $opened } review HTML file(s) ({ $missing } missing)
toast-open-review-none = No generated review HTML found — run 'paper-curation Review generation' first.

# AI chat (PDF Q&A)
toast-chat-extracting = Extracting PDF text: { $title }
toast-chat-ready = PDF ready — { $chars } chars / { $pages }p
toast-chat-no-pdf = No PDF text found — chatting from metadata only.
chat-title = AI Chat — { $title }
chat-model-label = Model
chat-input-placeholder = Ask about this paper… (Enter to send, Shift+Enter for newline)
chat-send = Send
chat-close = Close
chat-thinking = Thinking…
chat-empty-reply = (empty reply)
chat-greeting = Ask anything about "{ $title }" — answers use the full PDF as context. (Paid API calls; an estimated running cost is shown above.)
chat-no-pdf-note = Could not extract PDF text — answering from metadata only.
chat-cost = Paid API · est. ${ $cost } · in { $in } / out { $out } tok
chat-cost-title = Rough estimate from list prices; actual billing may differ.

# Comparative Chat (already-connected related papers) + multi-paper chat
itemmenu-comparative-study = paper-curation Comparative Chat (related papers)
chat-title-multi = AI Chat — { $n } papers
chat-greeting-multi = Ask anything about the { $n } selected papers — answers use their full PDFs as context. (Paid API calls; an estimated running cost is shown above.)
toast-chat-ready-multi = { $n } papers ready — { $chars } chars total
toast-compare-gather-related = Loading already-connected related papers…
toast-compare-related-found = { $n } connected related paper(s) loaded
compare-title = Comparative Chat — { $n } paper(s)
compare-seed-single = Analyze this paper's originality, limitations, and scholarly significance. Compare it against the already-connected related papers (if any): what is genuinely new, what falls short, and where this work sits within the related literature. Be specific and state the basis.
compare-seed-multi = Compare the selected papers with each other (commonalities, differences, and how they relate — who extends, replaces, or complements whom), then situate them against each paper's already-connected related papers to analyze originality, limitations, and scholarly significance. Summarize the core comparison as a table.

# Chat export (.md / .html / Obsidian)
chat-export-md = Export chat as Markdown (.md)
chat-export-html = Export chat as HTML (.html)
chat-export-obsidian = Export chat to Obsidian vault
chat-export-save = Save chat
chat-export-empty = Nothing to export yet — ask something first.
chat-export-done = Saved: { $path }
chat-export-obsidian-done = Saved to Obsidian vault: { $path }
chat-export-fail = Export failed: { $err }
chat-lang-title = Answer language — click to toggle EN / KO
