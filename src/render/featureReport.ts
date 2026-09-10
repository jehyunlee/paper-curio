/** A portable report contains generated claims, not local runtime output paths. */
export function featureReportHtml(
  label: string,
  result: Record<string, any>,
): string {
  const clean = (value: unknown) =>
    String(value ?? "")
      .replace(
        /(?:\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\Users\\)[^\s<>"']+/g,
        "[local path removed]",
      )
      .replace(
        /(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{10,}/g,
        "[credential removed]",
      )
  const escape = (value: unknown) =>
    clean(value).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch]!,
    )
  const claims = Array.isArray(result.data?.claims) ? result.data.claims : []
  const body = claims.length
    ? claims
        .map(
          (claim: Record<string, unknown>) =>
            `<section><p>${escape(claim.text)}</p><blockquote>${escape(claim.quote)}</blockquote><p class="source">Source: ${escape(claim.source_id)}</p></section>`,
        )
        .join("\n")
    : `<pre>${escape(result.text || result.status || "")}</pre>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(label)}</title><style>body{max-width:850px;margin:40px auto;padding:0 20px;font:16px/1.65 system-ui,sans-serif;color:#222}section{border-bottom:1px solid #ddd;padding:12px 0}blockquote{border-left:3px solid #999;padding-left:16px;color:#444}.source,footer{font-size:13px;color:#666}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>${escape(label)}</h1><p>Provider: ${escape(result.provider)} · Model: ${escape(result.model)}</p>${body}<footer>AI-generated analysis. Quotations identify supporting source text; they do not establish that every inference is correct. Source copyright remains with its owner.</footer></body></html>`
}
