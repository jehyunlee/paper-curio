# Right-click menu
itemmenu-review = paper-curation Review generation
itemmenu-comparison = paper-curation Comparison
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
