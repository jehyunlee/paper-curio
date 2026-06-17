# Right-click menu
itemmenu-review = paper-curation Review generation

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
