// review_to_html.py 포팅 (paper-curation 호환)
//
// review.md(frontmatter + body) → index.html 1:1 충실 포팅.
// Audio Overview(버튼/모달/스크립트)는 제외 — 이 플러그인은 audio 미지원.
// 그 외 head/MathJax/KoPub link/lightbox JS/footer/connections-box/섹션 박스 분기는
// review_to_html.py(get_css / _inline / md_section_to_html / parse_scores / convert_review)와 동일.
//
// 순수 문자열 변환만 수행한다. Zotero/DOM API 호출 없음, import 없음(self-contained).

export interface Theme {
  accent: string;
  accent_bg: string;
  accent_dark: string;
  essence_border: string;
  essence_bg: string;
  link_color: string;
}

// review_to_html.py THEMES["ai4s"] 값 그대로 (back_href는 Theme 계약에 없어 제외).
export const DEFAULT_THEME: Theme = {
  accent: "#D63423",
  accent_bg: "#FEF0EF",
  accent_dark: "#A62018",
  essence_border: "#8B1A1A",
  essence_bg: "#FDF8F8",
  link_color: "#A62018",
};

// ai4s 테마의 목록 복귀 링크 (Python THEMES["ai4s"]["back_href"]).
const BACK_HREF = "../../ai4s/index.html";

export interface ConnItem {
  relation: "alternative" | "extension" | "foundation" | "counterpoint" | "application";
  slug: string;
  title: string;
  reason: string;
}

export interface ReviewHtmlInput {
  frontmatter: {
    title: string;
    authors: string[];
    date: string;
    doi?: string;
    url?: string;
    scores: { novelty: number; technical: number; significance: number; clarity: number; overall: number };
    essence: string;
  };
  body: string; // review.md의 '## ' 이하 본문 마크다운 전체 (figure ![](figures/figN.webp) 포함)
  slug: string;
  zoteroKey: string; // Zotero PDF 버튼용 — 있으면 버튼 추가, 없으면 생략
  connections: ConnItem[];
  theme?: Theme; // 기본 DEFAULT_THEME
}

// ---------------------------------------------------------------------------
// HTML escape (Python html.escape, quote=True 동등)
// ---------------------------------------------------------------------------
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ---------------------------------------------------------------------------
// get_css(t) — CSS 전문 (토큰까지 그대로)
// ---------------------------------------------------------------------------
function getCss(t: Theme): string {
  return `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'KoPub Dotum', 'KoPubDotumMedium', -apple-system, 'Noto Sans KR', sans-serif; max-width: 820px; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.7; color: #333; background: #f0f2f5; }
h1 { font-size: 1.4rem; color: #1a1a2e; border-bottom: 3px solid ${t.accent}; padding-bottom: 0.5rem; margin-bottom: 1rem; }
h2 { font-size: 1.1rem; color: ${t.accent}; margin: 0 0 0.6rem; padding: 0; border: none; }
h3 { font-size: 1rem; color: #333; margin: 0.8rem 0 0.4rem; }
p { margin: 0.4rem 0; font-size: 0.93rem; }
blockquote { border-left: 4px solid ${t.accent}; margin: 0.8rem 0; padding: 0.6rem 1rem; background: #f0f4f8; border-radius: 0 8px 8px 0; font-size: 0.88rem; color: #555; }
ul, ol { margin: 0.4rem 0 0.4rem 1.5rem; }
li { margin: 0.2rem 0; font-size: 0.93rem; }
.section-box { background: white; border-radius: 12px; padding: 1.2rem 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
table { border-collapse: collapse; margin: 0.5rem 0; font-size: 0.85rem; width: 100%; }
th, td { border: 1px solid #e0e0e0; padding: 6px 12px; text-align: left; }
th { background: ${t.accent}; color: white; font-weight: 600; font-size: 0.82rem; }
tr:nth-child(even) { background: #f8f9fa; }
td:last-child { text-align: center; font-weight: 600; color: ${t.accent}; }
.eval-badges { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.6rem 0; }
.eval-badge { background: ${t.accent_bg}; color: ${t.accent_dark}; padding: 0.2rem 0.7rem; border-radius: 14px; font-size: 0.8rem; font-weight: 600; }
.essence-box { border: 2px solid ${t.essence_border}; border-radius: 10px; padding: 1rem 1.2rem; margin: 0.8rem 0; background: ${t.essence_bg}; }
.essence-box h2 { color: ${t.essence_border}; margin: 0 0 0.5rem; border: none; padding: 0; }
code { background: #e8edf3; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85rem; }
img { max-width: min(100%, 700px); border: 1px solid #e8e8e8; border-radius: 8px; margin: 0.8rem auto; display: block; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
hr { border: none; border-top: 1px solid #e0e0e0; margin: 0.5rem 0; }
strong { color: #1a1a2e; }
a { color: ${t.link_color}; }
.back { margin-top: 1.5rem; padding: 0.8rem 0; border-top: 2px solid #e0e0e0; }
.back a { font-weight: 600; text-decoration: none; }
.back a:hover { text-decoration: underline; }
.connections-box { background: white; border-radius: 12px; padding: 1.2rem 1.5rem; margin: 1.2rem 0; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.connections-box h2 { color: ${t.accent}; margin: 0 0 0.8rem; border: none; padding: 0; font-size: 1.05rem; }
.conn-item { border-left: 3px solid #ddd; padding: 0.6rem 0 0.6rem 1rem; margin-bottom: 0.6rem; }
.conn-item.alternative { border-left-color: #3B82F6; }
.conn-item.extension { border-left-color: #10B981; }
.conn-item.foundation { border-left-color: #8B5CF6; }
.conn-item.counterpoint { border-left-color: #F59E0B; }
.conn-item.application { border-left-color: #EF4444; }
.conn-type { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin-bottom: 0.15rem; }
.conn-item.alternative .conn-type { color: #3B82F6; }
.conn-item.extension .conn-type { color: #10B981; }
.conn-item.foundation .conn-type { color: #8B5CF6; }
.conn-item.counterpoint .conn-type { color: #F59E0B; }
.conn-item.application .conn-type { color: #EF4444; }
.conn-title { font-size: 0.9rem; font-weight: 600; }
.conn-title a { color: #1a1a2e; text-decoration: none; }
.conn-title a:hover { color: ${t.accent}; text-decoration: underline; }
.conn-reason { font-size: 0.85rem; color: #555; margin-top: 0.15rem; }
.review-fig { text-align: center; margin: 1.5rem 0; padding: 1rem; background: #f8f9fa; border-radius: 12px; }
.review-fig img { max-width: min(100%, 700px); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: zoom-in; }
.lightbox { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 9999; cursor: zoom-out; align-items: center; justify-content: center; }
.lightbox.active { display: flex; }
.lightbox img { max-width: 95%; max-height: 95%; object-fit: contain; border-radius: 8px; }
.fig-caption { font-size: 0.85rem; color: #888; margin-top: 0.5rem; font-style: italic; }`;
}

// ---------------------------------------------------------------------------
// parse_scores(md) — 마크다운 테이블/리스트에서 평가 점수 추출
// ---------------------------------------------------------------------------
export function parseScores(md: string): Record<string, string> {
  const scores: Record<string, string> = {};
  const labels: Array<[string, string]> = [
    ["Novelty", "novelty"],
    ["Technical Soundness", "tech"],
    ["Significance", "sig"],
    ["Clarity", "clarity"],
    ["Overall", "overall"],
  ];
  for (const [label, key] of labels) {
    const lab = escapeRegExp(label);
    // Table: | Label | X/5 |
    let m = new RegExp(`\\|\\s*${lab}\\s*\\|\\s*(\\d+(?:\\.\\d+)?)\\s*/\\s*5\\s*\\|`).exec(md);
    if (!m) {
      // List: - Label: X/5
      m = new RegExp(`-\\s*${lab}\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*/\\s*5`).exec(md);
    }
    if (m) {
      scores[key] = m[1];
    }
  }
  return scores;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// list helpers (_get_indent / _is_ul / _is_ol / _list_content)
// ---------------------------------------------------------------------------
function getIndent(line: string): number {
  const stripped = line.replace(/^\s+/, "");
  return stripped ? Math.floor((line.length - stripped.length) / 2) : 0;
}

function isUl(s: string): boolean {
  return /^[-*]\s/.test(s);
}

function isOl(s: string): boolean {
  return /^\d+\.\s/.test(s);
}

function listContent(s: string): string {
  if (isUl(s)) {
    return s.replace(/^[-*]\s+/, "");
  }
  if (isOl(s)) {
    return s.replace(/^\d+\.\s*/, "");
  }
  return s;
}

// ---------------------------------------------------------------------------
// _inline(text) — 인라인 마크다운: bold, italic, code, link, 빈 링크, DOI auto-link
// ---------------------------------------------------------------------------
function inline(text: string): string {
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Remove empty markdown links: [](url) → just the URL or nothing
  text = text.replace(/\[\]\((https?:\/\/[^)]+)\)/g, (_m, url: string) => {
    // Empty DOI link like [](https://doi.org/) → remove entirely
    if (url.replace(/\/+$/, "") === "https://doi.org") {
      return "N/A";
    }
    // Non-empty URL with empty text → show URL as link
    return `<a href="${url}" target="_blank">${url}</a>`;
  });
  // DOI auto-link — skip DOIs already inside <a> tags (href or link text)
  text = text.replace(/(10\.\d{4,}\/[^\s<"]+)/g, (m0: string, doi: string, offset: number) => {
    const before = text.slice(0, offset);
    const lastAOpen = before.lastIndexOf("<a ");
    const lastAClose = before.lastIndexOf("</a>");
    if (lastAOpen > lastAClose) {
      return m0; // inside <a>...</a>, don't wrap
    }
    return `<a href="https://doi.org/${doi}" target="_blank">${doi}</a>`;
  });
  return text;
}

// ---------------------------------------------------------------------------
// md_section_to_html(text) — 블록 마크다운(테이블/중첩 리스트/단락/이미지) 변환
//
// figureExists: src(상대경로)가 디스크에 존재하는지 판단하는 선택적 콜백.
//   Python의 slug_dir + os.path.exists(...) 역할. 미지정 시 모든 figure를 렌더.
//   (http/https/data: src는 항상 렌더 — Python과 동일)
// ---------------------------------------------------------------------------
function mdSectionToHtml(
  text: string,
  figureExists?: (src: string) => boolean,
): string {
  const lines = text.trim().split("\n");
  const out: string[] = [];
  let inTable = false;
  let tableHeaderDone = false;
  // List state: stack of [tag, indentLevel]
  const listStack: Array<[string, number]> = [];

  const closeListsTo = (targetDepth: number): void => {
    while (listStack.length > targetDepth) {
      const [tag] = listStack.pop()!;
      out.push(`</${tag}>`);
    }
  };
  const closeAllLists = (): void => closeListsTo(0);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const s = line.trim();
    const indent = getIndent(line);

    // Table row
    if (s.startsWith("|") && s.slice(1).includes("|")) {
      closeAllLists();
      if (s.includes("---")) {
        i += 1;
        continue;
      }
      const cells = s
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (!inTable) {
        out.push("<table>");
        inTable = true;
        tableHeaderDone = false;
      }
      if (!tableHeaderDone) {
        out.push("<tr>" + cells.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr>");
        tableHeaderDone = true;
      } else {
        out.push("<tr>" + cells.map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>");
      }
      i += 1;
      continue;
    } else if (inTable) {
      out.push("</table>");
      inTable = false;
    }

    // List items (any indent level)
    if (isUl(s) || isOl(s)) {
      const tag = isOl(s) ? "ol" : "ul";
      const content = inline(listContent(s));

      if (listStack.length === 0) {
        // Start new list
        out.push(`<${tag}>`);
        listStack.push([tag, indent]);
      } else if (indent > listStack[listStack.length - 1][1]) {
        // Deeper indent → nested list inside last <li>
        // Remove closing </li> from last item to nest inside it
        if (out.length && out[out.length - 1].endsWith("</li>")) {
          out[out.length - 1] = out[out.length - 1].slice(0, -5); // strip </li>
        }
        out.push(`<${tag}>`);
        listStack.push([tag, indent]);
      } else if (indent < listStack[listStack.length - 1][1]) {
        // Shallower → close inner lists
        while (listStack.length && listStack[listStack.length - 1][1] > indent) {
          const [t] = listStack.pop()!;
          out.push(`</${t}>`);
          out.push("</li>"); // close parent <li>
        }
        // Check if tag type matches
        if (listStack.length && listStack[listStack.length - 1][0] !== tag) {
          const [t] = listStack.pop()!;
          out.push(`</${t}>`);
          out.push(`<${tag}>`);
          listStack.push([tag, indent]);
        }
      } else {
        // Same level, check tag switch
        if (listStack[listStack.length - 1][0] !== tag) {
          const [t] = listStack.pop()!;
          out.push(`</${t}>`);
          out.push(`<${tag}>`);
          listStack.push([tag, indent]);
        }
      }

      out.push(`<li>${content}</li>`);
      i += 1;
      continue;
    }

    // Empty line inside list — look ahead to see if list continues
    if (!s && listStack.length) {
      let continues = false;
      for (let j = i + 1; j < lines.length; j++) {
        const ps = lines[j].trim();
        if (!ps) {
          continue;
        }
        if (isUl(ps) || isOl(ps)) {
          continues = true;
        }
        break;
      }
      if (!continues) {
        closeAllLists();
      }
      i += 1;
      continue;
    }

    // Non-list content → close any open lists
    if (listStack.length) {
      closeAllLists();
    }

    // Image + optional inline caption: ![alt](src) *caption*
    const imgM = /^!\[([^\]]*)\]\(([^)]+)\)\s*(.*)/.exec(s);
    if (imgM) {
      const alt = imgM[1];
      const src = imgM[2];
      const rest = imgM[3].trim();
      // Defensive: drop the reference entirely if the figure file is
      // missing on disk. We also peek ahead to eat any adjacent
      // italic-only caption line so it does not end up orphaned.
      let fileOk = true;
      if (
        figureExists &&
        !(src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:"))
      ) {
        if (!figureExists(src)) {
          fileOk = false;
        }
      }
      if (!fileOk) {
        i += 1;
        while (i < lines.length && !lines[i].trim()) {
          i += 1;
        }
        if (i < lines.length) {
          const nxtLine = lines[i].trim();
          if (nxtLine.startsWith("*") && nxtLine.endsWith("*") && !nxtLine.startsWith("**")) {
            i += 1;
          }
        }
        continue;
      }
      out.push(`<div class="review-fig"><img src="${esc(src)}" alt="${esc(alt)}">`);
      // Inline caption on same line
      if (rest && rest.startsWith("*") && rest.endsWith("*")) {
        out.push(`<p class="fig-caption">${inline(rest)}</p></div>`);
      } else {
        out.push("</div>");
        // Check next line for caption
      }
      i += 1;
      continue;
    }

    // Italic-only line (figure caption) — attaches to preceding review-fig
    if (s.startsWith("*") && s.endsWith("*") && !s.startsWith("**")) {
      if (
        out.length &&
        out[out.length - 1] === "</div>" &&
        out.length >= 2 &&
        out[out.length - 2].includes("review-fig")
      ) {
        out.pop();
        out.push(`<p class="fig-caption">${inline(s)}</p></div>`);
      } else {
        out.push(`<p class="fig-caption">${inline(s)}</p>`);
      }
      i += 1;
      continue;
    }

    // HR
    if (s === "---" || s === "***") {
      out.push("<hr>");
      i += 1;
      continue;
    }

    // H3
    if (s.startsWith("### ")) {
      out.push(`<h3>${inline(s.slice(4))}</h3>`);
      i += 1;
      continue;
    }

    // Empty line
    if (!s) {
      i += 1;
      continue;
    }

    // Paragraph
    out.push(`<p>${inline(s)}</p>`);
    i += 1;
  }

  closeAllLists();
  if (inTable) {
    out.push("</table>");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// connections-box 렌더 (convert_review의 해당 부분 1:1)
// ---------------------------------------------------------------------------
const CONN_TYPE_LABELS: Record<string, string> = {
  alternative: "다른 접근",
  extension: "후속 연구",
  foundation: "기반 연구",
  counterpoint: "반론/비판",
  application: "응용 사례",
};

// 정렬: 1차 관계 유형, (시간순 2차 키는 plugin 입력에 date가 없어 입력 순서 유지)
const REL_ORDER: Record<string, number> = {
  foundation: 0,
  alternative: 1,
  extension: 2,
  application: 3,
  counterpoint: 4,
};

function renderConnections(connections: ConnItem[]): string {
  if (!connections.length) {
    return "";
  }

  // Dedup within the same relation (relation, slug) — keep first occurrence.
  const seenPairs = new Set<string>();
  const deduped: ConnItem[] = [];
  for (const c of connections) {
    const key = `${c.relation} ${c.slug}`;
    if (seenPairs.has(key)) {
      continue;
    }
    seenPairs.add(key);
    deduped.push(c);
  }

  // 정렬: 1차 관계 유형 (foundation→alternative→extension→application→counterpoint).
  // 안정 정렬로 같은 relation 내 입력 순서를 보존한다.
  const conns = deduped
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => {
      const ra = REL_ORDER[a.c.relation] ?? 9;
      const rb = REL_ORDER[b.c.relation] ?? 9;
      if (ra !== rb) {
        return ra - rb;
      }
      return a.idx - b.idx;
    })
    .map((x) => x.c);

  const connItems: string[] = [];
  for (const c of conns) {
    const cslug = c.slug || "";
    const rel = c.relation || "alternative";
    const reason = c.reason || "";
    const ctitle = c.title || cslug;
    const label = CONN_TYPE_LABELS[rel] || rel;
    connItems.push(
      `<div class="conn-item ${esc(rel)}">` +
        `<div class="conn-type">${esc(label)}</div>` +
        `<div class="conn-title"><a href="../${esc(cslug)}/index.html">${esc(ctitle)}</a></div>` +
        `<div class="conn-reason">${esc(reason)}</div>` +
        `</div>`,
    );
  }

  return (
    '<div class="connections-box">' +
    "<h2>같이 보면 좋은 논문</h2>" +
    connItems.join("\n") +
    "</div>"
  );
}

// ---------------------------------------------------------------------------
// metadata blockquote 구성 (convert_review의 meta_line 역할).
// review.md 본문에는 frontmatter가 이미 분리돼 들어오므로, 본문 메타가 없을 때를
// 대비해 frontmatter 값으로 blockquote를 직접 조립한다 (Python의 '> **저자**...' 라인 형식).
// ---------------------------------------------------------------------------
function buildMetaLine(fm: ReviewHtmlInput["frontmatter"]): string {
  const parts: string[] = [];
  if (fm.authors && fm.authors.length) {
    parts.push(`<strong>저자</strong>: ${esc(fm.authors.join(", "))}`);
  }
  if (fm.date) {
    parts.push(`<strong>날짜</strong>: ${esc(fm.date)}`);
  }
  if (fm.doi) {
    const doi = fm.doi.replace(/^https?:\/\/doi\.org\//, "");
    parts.push(
      `<strong>DOI</strong>: <a href="https://doi.org/${esc(doi)}" target="_blank">${esc(doi)}</a>`,
    );
  }
  if (fm.url) {
    parts.push(
      `<strong>URL</strong>: <a href="${esc(fm.url)}" target="_blank">${esc(fm.url)}</a>`,
    );
  }
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// 본문 섹션 분리 ('## ' 헤더 기준). convert_review의 re.split(r'^##\s+', ...).
// ---------------------------------------------------------------------------
function splitSections(body: string): Array<[string, string]> {
  // Strip Related Papers section (auto-generated for Obsidian)
  const cleaned = body.replace(/\n## Related Papers\n[\s\S]*?(?=\n## |$)/g, "");
  const parts = cleaned.split(/^##\s+/m);
  const parsed: Array<[string, string]> = [];
  for (let k = 1; k < parts.length; k++) {
    const sec = parts[k];
    const nl = sec.indexOf("\n");
    const secTitle = (nl === -1 ? sec : sec.slice(0, nl)).trim();
    const secBody = nl === -1 ? "" : sec.slice(nl + 1);
    parsed.push([secTitle, secBody]);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// buildReviewHtml — 전체 index.html 문자열 생성 (convert_review 1:1, audio 제외)
// ---------------------------------------------------------------------------
export function buildReviewHtml(input: ReviewHtmlInput): string {
  const theme = input.theme || DEFAULT_THEME;
  const fm = input.frontmatter;
  const title = fm.title || input.slug;

  const scores = input.frontmatter.scores;
  // parse_scores 동등 매핑 (frontmatter.scores → key 형태로 정렬된 점수)
  const scoreMap: Record<string, number> = {
    novelty: scores.novelty,
    tech: scores.technical,
    sig: scores.significance,
    clarity: scores.clarity,
    overall: scores.overall,
  };

  const parsedSections = splitSections(input.body);

  const bodyParts: string[] = [];

  // Title
  bodyParts.push(`<h1>${esc(title)}</h1>`);

  // Metadata blockquote (+ optional Zotero PDF button)
  const metaLine = buildMetaLine(fm);
  if (metaLine) {
    let pdfBtn = "";
    if (input.zoteroKey) {
      pdfBtn =
        ` <a href="zotero://open-pdf/library/items/${esc(input.zoteroKey)}" ` +
        `title="Open PDF in Zotero" ` +
        `style="margin-left:0.5rem; font-size:0.75rem; color:#555; ` +
        `text-decoration:none; padding:0.05rem 0.4rem; ` +
        `border-radius:3px; background:#f0f0f0; ` +
        `border:1px solid #ddd;">` +
        `&#x1F4C4; PDF</a>`;
    }
    bodyParts.push(`<blockquote><p>${metaLine}${pdfBtn}</p></blockquote>`);
  }

  bodyParts.push("<hr>");

  // Sections (eval badges rendered inside Evaluation section)
  for (const [secTitle, secBody] of parsedSections) {
    const secHtml = mdSectionToHtml(secBody);

    if (secTitle.startsWith("Essence") || secTitle.includes("한줄 요약")) {
      if (!secHtml.trim()) {
        continue;
      }
      bodyParts.push(`<div class="essence-box"><h2>Essence</h2>\n${secHtml}</div>`);
    } else if (secTitle.startsWith("평가") || secTitle.toLowerCase().startsWith("eval")) {
      // Evaluation section — render as badges (not table)
      const badges: string[] = [];
      const labels: Array<[string, string]> = [
        ["Novelty", "novelty"],
        ["Technical Soundness", "tech"],
        ["Significance", "sig"],
        ["Clarity", "clarity"],
        ["Overall", "overall"],
      ];
      for (const [label, key] of labels) {
        const v = scoreMap[key];
        if (v !== undefined && v !== null) {
          badges.push(`<span class="eval-badge">${label}: ${v}/5</span>`);
        }
      }
      const badgesHtml = badges.length ? `<div class="eval-badges">${badges.join(" ")}</div>` : "";
      // Extract 총평 from section body
      let verdictHtml = "";
      const vm = /\*\*총평\*\*:\s*([\s\S]+?)$/.exec(secBody);
      if (vm) {
        verdictHtml = `<p><strong>총평</strong>: ${inline(vm[1].trim())}</p>`;
      }
      bodyParts.push(
        `<div class="section-box"><h2>Evaluation</h2>\n${badgesHtml}\n${verdictHtml}</div>`,
      );
    } else {
      bodyParts.push(`<div class="section-box"><h2>${esc(secTitle)}</h2>\n${secHtml}</div>`);
    }
  }

  // Related papers (connections)
  const connHtml = renderConnections(input.connections);
  if (connHtml) {
    bodyParts.push(connHtml);
  }

  // Back link
  bodyParts.push(`<div class="back"><a href="${BACK_HREF}">&larr; 목록으로 돌아가기</a></div>`);

  // Assemble (audio CSS 제외)
  const css = getCss(theme);
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/font-kopub/1.0/kopubdotum.css">
<script>window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']]}};</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" async></script>
<style>
${css}
</style>
</head>
<body>
${bodyParts.join("\n")}
<div id="lightbox" class="lightbox"><img id="lightbox-img" alt=""></div>
<script>
document.addEventListener('DOMContentLoaded', function() {
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightbox-img');
  document.addEventListener('click', function(e) {
    const img = e.target.closest('.review-fig img');
    if (img) { lbImg.src = img.src; lb.classList.add('active'); }
  });
  lb.addEventListener('click', function() { lb.classList.remove('active'); lbImg.src = ''; });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && lb.classList.contains('active')) { lb.classList.remove('active'); lbImg.src = ''; }
  });
});
</script>
<footer style="text-align:center;padding:2rem 0 1rem;color:#999;font-size:0.85rem;border-top:1px solid #eee;margin-top:3rem;">
Developed by Jehyun Lee, KIST AIX Strategy Department | jehyun.lee@gmail.com
</footer>
</body>
</html>`;
  return html;
}
