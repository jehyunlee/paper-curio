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
// Audio Overview (browser-direct Gemini podcast) — paper-curation lib/audio_overview.py 포팅.
//
// 원본과 다른 점은 단 두 가지(플러그인 맥락):
//   1) Gemini 키를 빌드 타임에 baking 하지 않는다 (window._GEMINI_KEY = "").
//      AUDIO_JS의 기존 키 prompt+localStorage 흐름에 그대로 위임.
//   2) 이메일 백엔드(/api/audio-email)가 없으므로 window._LOCAL_EMAILS = []로 둔다.
//      AUDIO_JS의 try/catch가 전송 실패를 graceful하게 처리해 다운로드로 떨어진다.
// 나머지 CSS/HTML/JS(대본생성·TTS·lamejs MP3 인코딩·재생·다운로드)는 무수정 1:1.
// ---------------------------------------------------------------------------

// audio_overview.py get_audio_css(accent, accent_dark, accent_bg) — CSS 전문 그대로.
export function getAudioCss(theme: Theme): string {
  return `.audio-bar { margin: 0.6rem 0 0.2rem; }
.audio-btn { display: inline-flex; align-items: center; gap: 0.4rem; background: ${theme.accent}; color: #fff; border: none; border-radius: 20px; padding: 0.45rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; font-family: inherit; box-shadow: 0 1px 4px rgba(0,0,0,0.12); }
.audio-btn:hover { background: ${theme.accent_dark}; }
.audio-btn:disabled { background: #bbb; cursor: not-allowed; box-shadow: none; }
.audio-modal-bg { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center; padding: 1rem; }
.audio-modal-bg.active { display: flex; }
.audio-modal { background: #fff; border-radius: 14px; max-width: 540px; width: 100%; max-height: 92vh; overflow-y: auto; padding: 1.4rem 1.6rem; box-shadow: 0 8px 40px rgba(0,0,0,0.25); }
.audio-modal h3 { margin: 0 0 0.2rem; color: ${theme.accent}; font-size: 1.15rem; }
.audio-modal .sub { font-size: 0.8rem; color: #888; margin-bottom: 1rem; }
.audio-row { margin-bottom: 0.9rem; }
.audio-row > label { display: block; font-size: 0.82rem; font-weight: 700; color: #444; margin-bottom: 0.3rem; }
.audio-seg { display: inline-flex; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
.audio-seg button { background: #fff; border: none; padding: 0.4rem 0.9rem; font-size: 0.85rem; cursor: pointer; font-family: inherit; color: #555; border-right: 1px solid #eee; }
.audio-seg button:last-child { border-right: none; }
.audio-seg button.on { background: ${theme.accent_bg}; color: ${theme.accent_dark}; font-weight: 700; }
.audio-modal select, .audio-modal input[type=text], .audio-modal textarea { width: 100%; padding: 0.45rem 0.6rem; border: 1px solid #ddd; border-radius: 8px; font-size: 0.85rem; font-family: inherit; color: #333; background: #fff; }
.audio-modal textarea { min-height: 80px; resize: vertical; line-height: 1.55; }
.audio-adv-toggle { font-size: 0.82rem; color: ${theme.accent_dark}; cursor: pointer; user-select: none; font-weight: 600; }
.audio-adv { display: none; margin-top: 0.6rem; }
.audio-adv.open { display: block; }
.audio-actions { display: flex; gap: 0.6rem; justify-content: flex-end; margin-top: 1.1rem; }
.audio-actions .cancel { background: #eee; color: #555; }
.audio-actions button { border: none; border-radius: 20px; padding: 0.5rem 1.2rem; font-size: 0.88rem; font-weight: 600; cursor: pointer; font-family: inherit; }
.audio-actions .go { background: ${theme.accent}; color: #fff; }
.audio-actions .go:disabled { background: #bbb; cursor: not-allowed; }
.audio-status { font-size: 0.82rem; color: #666; margin-top: 0.8rem; min-height: 1.1em; }
.audio-notice { font-size: 0.8rem; color: #555; background: #fffbe6; border: 1px solid #f0d97a; border-radius: 6px; padding: 0.55rem 0.7rem; margin-top: 0.7rem; display: none; }
.audio-notice.show { display: block; }
.audio-player { display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #eee; }
.audio-player.show { display: block; }
.audio-player audio { width: 100%; margin-bottom: 0.6rem; }
.audio-speed { display: flex; align-items: center; gap: 0.6rem; font-size: 0.82rem; color: #555; }
.audio-speed input[type=range] { flex: 1; }
.audio-dl { display: inline-block; margin-top: 0.6rem; font-size: 0.82rem; color: ${theme.accent_dark}; text-decoration: none; font-weight: 600; }`;
}

// review_to_html.py audio_bar_html() — 제목 h1 아래 들어갈 생성 버튼.
export function audioBarHtml(): string {
  return (
    '<div class="audio-bar">' +
    '<button class="audio-btn" id="audio-open" onclick="openAudioModal()">' +
    "\u{1F3A7} Audio Overview 생성</button></div>"
  );
}

// audio_overview.py audio_modal_html() — 공유 모달 마크업 그대로.
// review_to_html.py가 넘기는 sub_text를 default로 박아둔다.
export function audioModalHtml(): string {
  const subText =
    "이 논문 리뷰를 팟캐스트형 오디오로 생성합니다. " +
    "(Gemini · 키는 브라우저에만 저장 · 완성본은 이메일로도 전송)";
  return `
<div class="audio-modal-bg" id="audio-modal-bg">
  <div class="audio-modal">
    <h3>\u{1F3A7} Audio Overview</h3>
    <div class="sub">${subText}</div>
    <div class="audio-row">
      <label>화자 수</label>
      <div class="audio-seg" id="seg-speakers">
        <button data-v="1">1인</button><button data-v="2">2인</button><button data-v="3">3인</button>
      </div>
    </div>
    <div class="audio-row">
      <label>언어</label>
      <div class="audio-seg" id="seg-lang">
        <button data-v="ko">한국어</button><button data-v="en">English</button>
      </div>
    </div>
    <div class="audio-row">
      <label>대상 청중</label>
      <select id="audio-audience">
        <option value="general">일반인</option>
        <option value="student">대학생·대학원생</option>
        <option value="expert">전문가</option>
      </select>
    </div>
    <div class="audio-row">
      <label>길이</label>
      <div class="audio-seg" id="seg-length">
        <button data-v="10">10분</button><button data-v="20">20분</button><button data-v="30">30분</button>
      </div>
    </div>
    <div class="audio-row">
      <label>톤</label>
      <select id="audio-tone">
        <option value="friendly">친근한</option>
        <option value="academic">학술적</option>
        <option value="lively">활기찬</option>
      </select>
    </div>
    <div class="audio-row">
      <label>주안점 (선택)</label>
      <input type="text" id="audio-focus" placeholder="예: 방법론의 한계, 산업 응용 가능성">
    </div>
    <div class="audio-row">
      <span class="audio-adv-toggle" onclick="toggleAudioAdv()">▸ 고급: 구성 방향(대본 작성 지침) 직접 수정</span>
      <div class="audio-adv" id="audio-adv">
        <textarea id="audio-direction"></textarea>
      </div>
    </div>
    <div class="audio-notice" id="audio-notice"></div>
    <div class="audio-status" id="audio-status"></div>
    <div class="audio-actions">
      <button class="cancel" onclick="closeAudioModal()">닫기</button>
      <button class="go" id="audio-go" onclick="runAudioGen()">생성</button>
    </div>
    <div class="audio-player" id="audio-player">
      <audio id="audio-el" controls></audio>
      <div class="audio-speed">
        <span>속도</span>
        <input type="range" id="audio-speed" min="0.75" max="1.75" step="0.05" value="1">
        <span id="audio-speed-val">1.0x</span>
      </div>
      <a class="audio-dl" id="audio-dl" download="audio_overview.mp3">⬇ MP3 다운로드</a>
    </div>
  </div>
</div>`;
}

// audio_overview.py AUDIO_JS — 브라우저 IIFE 전체. 원본 r"""...""" 와 런타임 바이트 동일.
// (TS 템플릿 리터럴 특성상 백틱과 `${` 만 escape: 원본 line 600의 template literal
//  `✍️ 대본 생성 중... (${SCRIPT_MODEL})` 만 해당. 그 외 로직은 한 글자도 바뀌지 않음.)
const AUDIO_JS = `
(function() {
// _GEMINI_KEY is baked into the page at build time on localhost and
// stripped on deploy. To let Cloudflare visitors still generate audio,
// we additionally accept a user-provided key via localStorage and via
// a one-time prompt the first time they click the button. The key
// stays in their browser only — it is never sent anywhere except
// google's TTS / Gemini endpoints.
// Read the Gemini key from any slot the user might have used in this
// browser before — direct _GEMINI_KEY, or _LLM_KEY if they typed a
// Gemini key into the Deep Research prompt (AIza-prefixed). This lets
// Audio Overview pick up keys that Deep Research stored, and vice
// versa, without a second prompt.
let GKEY = (window._GEMINI_KEY || "") || (function() {
  try {
    const direct = localStorage.getItem("_GEMINI_KEY") || "";
    if (direct) return direct;
    const llm = localStorage.getItem("_LLM_KEY") || "";
    if (llm && String(llm).startsWith("AIza")) return llm;
    return "";
  } catch (e) { return ""; }
})();
function rememberGeminiKey(k) {
  GKEY = k || "";
  window._GEMINI_KEY = GKEY;
  try {
    if (GKEY) {
      localStorage.setItem("_GEMINI_KEY", GKEY);
      // Also seed the Deep Research unified slot so users who started
      // here don't get re-prompted on the topic page. Only fill it when
      // empty — never overwrite an existing Anthropic/OpenAI key.
      const existing = localStorage.getItem("_LLM_KEY") || "";
      if (!existing) localStorage.setItem("_LLM_KEY", GKEY);
    }
  } catch (e) {}
}
function ensureGeminiKey() {
  if (GKEY) return GKEY;
  const k = prompt(
    "Audio Overview는 Gemini API Key가 필요합니다.\\n" +
    "https://aistudio.google.com/apikey 에서 발급 후 입력하세요.\\n" +
    "(브라우저에만 저장됩니다 — 외부로 전송하지 않습니다)"
  );
  if (!k) return "";
  const t = String(k).trim();
  if (!t.startsWith("AIza")) {
    alert("올바른 형식이 아닙니다. Gemini API Key는 AIza 로 시작합니다.");
    return "";
  }
  rememberGeminiKey(t);
  return GKEY;
}
const AUDIO_MODE = window._AUDIO_MODE || "paper";
function audioCtx() {
  if (typeof window._audioContextProvider === "function")
    return window._audioContextProvider() || {title:"", review:"", connections:[]};
  return window._AUDIO || {title:"", review:"", connections:[]};
}
const SCRIPT_MODEL = "gemini-3.1-pro-preview";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GBASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const SAMPLE_RATE = 24000;
const MAX_CHUNK_CHARS = 2200;   // per TTS call, keeps long scripts within limits
const POOL = 3;                 // concurrent TTS calls

const DEFAULT_DIRECTION = {
  paper: {
    ko: "논문의 originality(독창성)를 중심으로, '같이 보면 좋은 논문'들과의 연관성(예: 장단점 비교, 대조, 후속, 보완 등)을 엮어서 전체 맥락을 파악할 수 있도록 구성한다.",
    en: "Center the narrative on the paper's originality, weaving in how it relates to the recommended related papers (e.g., pros/cons comparison, contrast, follow-up, complement) so the listener grasps the overall context."
  },
  deep: {
    ko: "질문에 대한 답을 중심으로, 인용된 논문들을 근거로 엮어 전체 맥락과 핵심 통찰을 설명한다.",
    en: "Center on answering the question, weaving in the cited papers as evidence to explain the overall context and the key insights."
  }
};
function defaultDirection(lang) { return (DEFAULT_DIRECTION[AUDIO_MODE] || DEFAULT_DIRECTION.paper)[lang]; }

const ROLES = {
  ko: {
    1: [{label:"내레이터", voice:"Kore", desc:"차분하고 명료한 1인 내레이터"}],
    2: [{label:"전문가", voice:"Kore", desc:"과학기술 전문가(여성). 핵심 내용을 정확하고 깊이 있게 설명한다."},
        {label:"리포터", voice:"Puck", desc:"파급효과와 의의에 관심이 많은 진행자(남성). 청취자 눈높이에서 질문하고 맥락을 넓힌다."}],
    3: [{label:"사회자", voice:"Leda", desc:"토론을 이끌고 핵심을 정리하는 진행자"},
        {label:"전문가", voice:"Kore", desc:"과학기술 전문가(여성). 핵심을 설명한다."},
        {label:"리포터", voice:"Algieba", desc:"파급효과와 맥락에 관심 많은 패널(남성)."}]
  },
  en: {
    1: [{label:"Narrator", voice:"Kore", desc:"a calm, clear solo narrator"}],
    2: [{label:"Expert", voice:"Kore", desc:"a science-and-technology expert (female) who explains the core precisely and in depth"},
        {label:"Reporter", voice:"Puck", desc:"a host (male) keen on impact and significance, asking listener-level questions and widening the context"}],
    3: [{label:"Host", voice:"Leda", desc:"a host who drives the discussion and sums up the key points"},
        {label:"Expert", voice:"Kore", desc:"a science-and-technology expert (female) explaining the core"},
        {label:"Reporter", voice:"Algieba", desc:"a panelist (male) keen on impact and context"}]
  }
};

// Gemini multi-speaker TTS needs a leading style instruction or it tries to
// "answer" the transcript as text instead of voicing it.
const TTS_PREFIX = {ko: "다음 대화를 자연스럽고 생동감 있게 읽어줘:\\n", en: "Read the following conversation naturally and with energy:\\n"};

const AUDIENCE = {
  ko: {general:"일반 대중", student:"대학생·대학원생", expert:"해당 분야 전문가"},
  en: {general:"a general audience", student:"undergraduate and graduate students", expert:"domain experts"}
};
const TONE = {
  ko: {friendly:"친근하지만 전문적이고, 청취자에게 말 걸 듯이", academic:"차분하고 학술적이며 정확하게", lively:"활기차고 박진감 있게"},
  en: {friendly:"warm yet professional, speaking directly to the listener", academic:"calm, academic and precise", lively:"lively and energetic"}
};

const SETTINGS_KEY = "paperAudioSettings";
function defaultSettings() {
  return {speakers:"2", lang:"ko", audience:"student", length:"10", tone:"friendly",
          focus:"", direction:defaultDirection("ko"), directionDirty:false};
}
function loadSettings() {
  try { return Object.assign(defaultSettings(), JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); }
  catch (e) { return defaultSettings(); }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }

function setSeg(groupId, val) {
  document.querySelectorAll("#" + groupId + " button").forEach(function(b) {
    b.classList.toggle("on", b.getAttribute("data-v") === String(val));
  });
}
function getSeg(groupId) {
  const on = document.querySelector("#" + groupId + " button.on");
  return on ? on.getAttribute("data-v") : null;
}

function openAudioModal() {
  // Acquire the Gemini key lazily — at modal-open time. This lets
  // Cloudflare visitors paste their own key the first time and have it
  // remembered for subsequent sessions (localStorage).
  if (!ensureGeminiKey()) {
    // User dismissed the prompt or entered an invalid key. Don't open
    // the modal — pretending the form is usable would lead to a
    // confusing 401 deep inside the generation flow.
    return;
  }
  // We used to prompt for the email address here, but that forced
  // visitors to commit before they'd even seen the form. The recipient
  // list is now resolved inside runAudioGen() — the prompt fires once,
  // the first time they actually click "생성", and never again
  // (localStorage remembers it).
  const s = loadSettings();
  setSeg("seg-speakers", s.speakers);
  setSeg("seg-lang", s.lang);
  setSeg("seg-length", s.length);
  document.getElementById("audio-audience").value = s.audience;
  document.getElementById("audio-tone").value = s.tone;
  document.getElementById("audio-focus").value = s.focus || "";
  const dir = document.getElementById("audio-direction");
  dir.value = s.directionDirty ? s.direction : defaultDirection(s.lang);
  dir.dataset.dirty = s.directionDirty ? "1" : "";
  document.getElementById("audio-status").textContent = "";
  const _notice = document.getElementById("audio-notice");
  if (_notice) { _notice.textContent = ""; _notice.classList.remove("show"); }
  document.getElementById("audio-modal-bg").classList.add("active");
}
function closeAudioModal() { document.getElementById("audio-modal-bg").classList.remove("active"); }
function toggleAudioAdv() {
  const a = document.getElementById("audio-adv");
  a.classList.toggle("open");
  document.querySelector(".audio-adv-toggle").textContent =
    (a.classList.contains("open") ? "▾" : "▸") + " 고급: 구성 방향(대본 작성 지침) 직접 수정";
}

function wireAudioModal() {
  ["seg-speakers", "seg-lang", "seg-length"].forEach(function(gid) {
    document.querySelectorAll("#" + gid + " button").forEach(function(b) {
      b.addEventListener("click", function() {
        setSeg(gid, b.getAttribute("data-v"));
        if (gid === "seg-lang") {
          const dir = document.getElementById("audio-direction");
          if (!dir.dataset.dirty) dir.value = defaultDirection(b.getAttribute("data-v"));
        }
      });
    });
  });
  const dir = document.getElementById("audio-direction");
  if (dir) dir.addEventListener("input", function() { dir.dataset.dirty = "1"; });
  document.getElementById("audio-modal-bg").addEventListener("click", function(e) {
    if (e.target.id === "audio-modal-bg") closeAudioModal();
  });
}

function collectSettings() {
  const dir = document.getElementById("audio-direction");
  return {
    speakers: getSeg("seg-speakers") || "2",
    lang: getSeg("seg-lang") || "ko",
    audience: document.getElementById("audio-audience").value,
    length: getSeg("seg-length") || "10",
    tone: document.getElementById("audio-tone").value,
    focus: document.getElementById("audio-focus").value.trim(),
    direction: dir.value.trim(),
    directionDirty: dir.dataset.dirty === "1"
  };
}

function lengthGuide(min, lang) {
  // Calibrated from measured Gemini TTS rate (~560 ko chars/min) and over-asked
  // ~1.3x because the model under-fills long length targets. ko≈730 chars/min.
  const m = parseInt(min, 10);
  if (lang === "en") return "about " + m + " minutes — write at least " + (m * 200) +
    " words; fill the entire length with substantive discussion and do not wrap up early";
  return "약 " + m + "분 분량 — 한국어로 최소 " + (m * 730) +
    "자 이상 작성하고, 내용을 충분히 깊게 다뤄 분량을 끝까지 채울 것(중간에 서둘러 마무리하지 말 것)";
}

function connectionsText(lang) {
  const cs = audioCtx().connections || [];
  if (!cs.length) return "";
  const head = AUDIO_MODE === "deep"
    ? (lang === "en" ? "Cited papers (use as evidence):" : "인용된 논문 (근거로 엮을 것):")
    : (lang === "en" ? "Recommended related papers (weave these into the context):" : "같이 보면 좋은 논문 (맥락에 엮을 것):");
  const lines = cs.map(function(c) {
    return "- [" + (c.relation || "") + "] " + (c.title || "") + (c.reason ? " — " + c.reason : "");
  });
  return head + "\\n" + lines.join("\\n");
}

function buildScriptPrompt(s) {
  const ctx = audioCtx();
  const lang = s.lang;
  const roles = ROLES[lang][s.speakers];
  const tone = TONE[lang][s.tone];
  const aud = AUDIENCE[lang][s.audience];
  const len = lengthGuide(s.length, lang);
  const conns = connectionsText(lang);
  const srcLabel = AUDIO_MODE === "deep"
    ? (lang === "en" ? "Source material (the question and the generated answer)" : "분석 자료 (질문과 생성된 답변)")
    : (lang === "en" ? "Paper review" : "논문 리뷰 자료");
  let fmt;
  if (s.speakers === "1") {
    fmt = lang === "en"
      ? "- Format: a single narrator from start to finish; output narration text only, no speaker labels.\\n- Do not invent a show name or introduce yourself by name; dive straight into the content."
      : "- 형식: 한 명의 내레이터가 처음부터 끝까지 진행. 화자 라벨 없이 순수 내레이션 텍스트만 출력.\\n- 프로그램 이름이나 진행자 이름을 지어내 자기소개하지 말고, 곧바로 내용으로 들어갈 것.";
  } else {
    const roleLines = roles.map(function(r) { return "- " + r.label + ": " + r.desc; }).join("\\n");
    const labels = roles.map(function(r) { return r.label; });
    fmt = (lang === "en"
        ? "- Format: a " + s.speakers + "-person conversational podcast.\\n" + roleLines +
          "\\n- Begin every utterance with exactly one of these labels followed by ': ' — " +
          labels.join(", ") + "\\n- Natural turn-taking; no one speaks more than ~5 sentences in a row." +
          "\\n- Exactly " + s.speakers + " speakers — never add a third speaker, narrator, or host." +
          "\\n- The labels are voice tags only: speakers must NOT address each other by these labels or by any personal name, must NOT introduce themselves, and must NOT invent a show or host name. Dive straight into the substance."
        : "- 형식: " + s.speakers + "인 대화형 팟캐스트.\\n" + roleLines +
          "\\n- 각 발화는 반드시 다음 라벨 중 하나로 시작하고 콜론+공백을 붙일 것 — " +
          labels.join(", ") + "\\n- 자연스러운 turn-taking, 한 명이 5문장 이상 연속 독점 금지." +
          "\\n- 등장인물은 정확히 " + s.speakers + "명뿐 — 제3의 화자·내레이터·해설자를 절대 추가하지 말 것." +
          "\\n- 라벨은 음성 구분용 표시일 뿐이다. 대사 속에서 서로를 그 라벨(예: '전문가님')이나 이름으로 부르지 말고, 자기·상대를 소개하거나 프로그램·진행자 이름을 지어내지 말 것. 곧바로 내용으로 들어갈 것.");
  }
  const focusLine = s.focus ? (lang === "en" ? "- Special emphasis: " + s.focus + "\\n"
                                             : "- 주안점: " + s.focus + "\\n") : "";
  if (lang === "en") {
    return "You are a science-podcast scriptwriter. Using the material below, write a script a listener can play in one sitting.\\n\\n" +
      "Requirements:\\n- Length: " + len + "\\n- Tone: " + tone + "\\n- Target audience: " + aud +
      " — use vocabulary and analogies at this level.\\n" + focusLine +
      "- Editorial direction: " + s.direction + "\\n" + fmt +
      "\\n- Spell out acronyms on first use, then abbreviate.\\n- No markdown, no headers, no bullet symbols, no sound-effect or SSML tags.\\n\\n" +
      (conns ? conns + "\\n\\n" : "") +
      srcLabel + ":\\n---\\n" + ctx.review + "\\n---\\n\\nOutput only the script body, starting immediately (no 'Script:' preamble).";
  }
  return "당신은 과학 팟캐스트 작가입니다. 아래 자료를 바탕으로 청취자가 한 번에 들을 수 있는 대본을 작성하세요.\\n\\n" +
    "요구사항:\\n- 길이: " + len + "\\n- 톤: " + tone + "\\n- 대상 청취자: " + aud +
    " — 이 수준의 어휘와 비유로 설명할 것.\\n" + focusLine +
    "- 구성 방향: " + s.direction + "\\n" + fmt +
    "\\n- 영어 약어는 첫 등장 시 한국어 풀이를 곁들이고 이후 약어 사용.\\n- 마크다운 헤더·불릿·강조 기호 금지. 효과음·SSML 태그·괄호 안 메타 표기 없음.\\n\\n" +
    (conns ? conns + "\\n\\n" : "") +
    srcLabel + ":\\n---\\n" + ctx.review + "\\n---\\n\\n위 요구사항에 따라 대본 본문만 출력하세요. '대본:' 같은 머리말 없이 바로 시작.";
}

async function geminiPost(model, body) {
  const r = await fetch(GBASE + model + ":generateContent?key=" + encodeURIComponent(GKEY), {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  });
  if (!r.ok) {
    let msg = r.status + " " + r.statusText;
    try { const j = await r.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
    throw new Error(msg);
  }
  return r.json();
}

async function callScript(prompt) {
  const j = await geminiPost(SCRIPT_MODEL, {
    contents: [{parts: [{text: prompt}]}],
    generationConfig: {temperature: 0.85, maxOutputTokens: 65536}
  });
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map(function(p) { return p.text || ""; }).join("").trim();
}

function speechSingle(voice) {
  return {voiceConfig: {prebuiltVoiceConfig: {voiceName: voice}}};
}
function speechMulti(roles) {
  return {multiSpeakerVoiceConfig: {speakerVoiceConfigs: roles.map(function(r) {
    return {speaker: r.label, voiceConfig: {prebuiltVoiceConfig: {voiceName: r.voice}}};
  })}};
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function ttsCall(text, speechConfig) {
  const j = await geminiPost(TTS_MODEL, {
    contents: [{parts: [{text: text}]}],
    generationConfig: {responseModalities: ["AUDIO"], speechConfig: speechConfig}
  });
  const part = ((((j.candidates || [])[0] || {}).content || {}).parts || [])[0] || {};
  const data = (part.inlineData || part.inline_data || {}).data;
  if (!data) throw new Error("TTS 응답에 오디오가 없습니다");
  return b64ToBytes(data);
}

function parseTurns(script, labels) {
  // Flexible: treat any short "Label:" at line start as a turn boundary. A
  // stray 3rd speaker / narrator the model slipped in is remapped to an
  // allowed speaker (alternating), so multi-speaker TTS never voices a
  // phantom 3rd voice from a label embedded inside another turn's text.
  const allow = {}; labels.forEach(function(l, i) { allow[l] = i; });
  const re = /^([A-Za-z가-힣][A-Za-z가-힣0-9]{0,9})\\s*:\\s*(.*)$/;
  const turns = []; let cur = null, buf = [], lastIdx = -1;
  function flush() { if (cur && buf.join(" ").trim()) turns.push({speaker: cur, text: buf.join(" ").trim()}); }
  script.split(/\\r?\\n/).forEach(function(raw) {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(re);
    if (m) {
      flush();
      const label = m[1];
      if (label in allow) { cur = label; lastIdx = allow[label]; }
      else { lastIdx = (lastIdx + 1) % labels.length; cur = labels[lastIdx]; }
      buf = [m[2].trim()];
    } else if (cur) buf.push(line);
  });
  flush();
  return turns;
}

function chunkParagraphs(text, maxChars) {
  const paras = text.split(/\\n\\s*\\n/).map(function(p) { return p.replace(/\\s+/g, " ").trim(); }).filter(Boolean);
  const chunks = []; let cur = "";
  paras.forEach(function(p) {
    if (cur && (cur.length + p.length + 1) > maxChars) { chunks.push(cur); cur = ""; }
    cur = cur ? cur + "\\n" + p : p;
  });
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}

function chunkTurns(turns, maxChars) {
  const chunks = []; let cur = [], len = 0;
  turns.forEach(function(t) {
    const piece = t.speaker + ": " + t.text;
    if (cur.length && (len + piece.length + 1) > maxChars) { chunks.push(cur); cur = []; len = 0; }
    cur.push(piece); len += piece.length + 1;
  });
  if (cur.length) chunks.push(cur);
  return chunks.map(function(c) { return c.join("\\n"); });
}

async function poolMap(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = [];
  for (let k = 0; k < Math.min(concurrency, items.length); k++) runners.push(run());
  await Promise.all(runners);
  return results;
}

function concatPcm(parts) {
  const silence = new Uint8Array(Math.floor(SAMPLE_RATE * 0.2) * 2); // 200ms
  const pieces = []; let total = 0;
  parts.forEach(function(p, i) {
    if (i) { pieces.push(silence); total += silence.length; }
    pieces.push(p); total += p.length;
  });
  const out = new Uint8Array(total); let off = 0;
  pieces.forEach(function(p) { out.set(p, off); off += p.length; });
  return out;
}

function pcmToMp3(pcm) {
  if (typeof lamejs === "undefined") throw new Error("MP3 인코더(lamejs) 로드 실패");
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const enc = new lamejs.Mp3Encoder(1, SAMPLE_RATE, 128);
  const block = 1152, out = [];
  for (let i = 0; i < samples.length; i += block) {
    const buf = enc.encodeBuffer(samples.subarray(i, i + block));
    if (buf.length) out.push(new Uint8Array(buf));
  }
  const tail = enc.flush();
  if (tail.length) out.push(new Uint8Array(tail));
  return new Blob(out, {type: "audio/mpeg"});
}

function setStatus(msg) { document.getElementById("audio-status").textContent = msg; }

async function synthesize(s, script) {
  const roles = ROLES[s.lang][s.speakers];
  if (s.speakers === "1") {
    const chunks = chunkParagraphs(script, MAX_CHUNK_CHARS);
    const cfg = speechSingle(roles[0].voice);
    let done = 0;
    const parts = await poolMap(chunks, async function(c) {
      const pcm = await ttsCall(c, cfg);
      setStatus("🔊 음성 합성 " + (++done) + "/" + chunks.length);
      return pcm;
    }, POOL);
    return concatPcm(parts);
  }
  const labels = roles.map(function(r) { return r.label; });
  const turns = parseTurns(script, labels);
  if (!turns.length) throw new Error("대본에서 화자 라벨을 찾지 못했습니다");
  if (s.speakers === "2") {
    const chunks = chunkTurns(turns, MAX_CHUNK_CHARS);
    const cfg = speechMulti(roles);
    const prefix = TTS_PREFIX[s.lang] || TTS_PREFIX.ko;
    let done = 0;
    const parts = await poolMap(chunks, async function(c) {
      const pcm = await ttsCall(prefix + c, cfg);
      setStatus("🔊 음성 합성 " + (++done) + "/" + chunks.length);
      return pcm;
    }, POOL);
    return concatPcm(parts);
  }
  // 3 speakers: per-turn single-voice (Gemini multi-speaker caps at 2)
  const voiceMap = {}; roles.forEach(function(r) { voiceMap[r.label] = r.voice; });
  let done = 0;
  const parts = await poolMap(turns, async function(t) {
    const pcm = await ttsCall(t.text, speechSingle(voiceMap[t.speaker] || roles[0].voice));
    setStatus("🔊 음성 합성 " + (++done) + "/" + turns.length);
    return pcm;
  }, POOL);
  return concatPcm(parts);
}

let _audioUrl = null;
async function runAudioGen() {
  if (!ensureGeminiKey()) { setStatus("Gemini API Key가 필요합니다."); return; }
  const ctx = audioCtx();
  if (!ctx.review || !ctx.review.trim()) { setStatus("먼저 분석할 내용이 필요합니다."); return; }
  const go = document.getElementById("audio-go");
  go.disabled = true;
  const s = collectSettings();
  saveSettings(s);
  // Tell the user up front that they can leave the page — generation
  // can take several minutes and the finished MP3 will be emailed to
  // them automatically (so the tab need not stay open). We use a
  // persistent banner (audio-notice) so it doesn't get overwritten by
  // the progress messages in audio-status.
  const recipients = resolveAudioRecipients();
  const notice = document.getElementById("audio-notice");
  if (notice) {
    if (recipients.length) {
      notice.textContent = "📧 Audio Overview 작성이 완료되면 이메일로 보내드립니다 (" + recipients.join(", ") + "). 다른 작업을 하셔도 좋습니다.";
      notice.classList.add("show");
    } else {
      notice.classList.remove("show");
      notice.textContent = "";
    }
  }
  try {
    setStatus(\`✍️ 대본 생성 중... (\${SCRIPT_MODEL})\`);
    const script = await callScript(buildScriptPrompt(s));
    if (!script) throw new Error("대본이 비어 있습니다");
    setStatus("🔊 음성 합성 중...");
    const pcm = await synthesize(s, script);
    setStatus("🎚️ MP3 인코딩 중...");
    const blob = pcmToMp3(pcm);
    if (_audioUrl) URL.revokeObjectURL(_audioUrl);
    _audioUrl = URL.createObjectURL(blob);
    const el = document.getElementById("audio-el");
    el.src = _audioUrl;
    if ("preservesPitch" in el) el.preservesPitch = true;
    const dl = document.getElementById("audio-dl");
    dl.href = _audioUrl;
    const fname = (ctx.title || "audio_overview").slice(0, 60).replace(/[^\\w가-힣 -]/g, "").trim().replace(/\\s+/g, "_") + ".mp3";
    dl.download = fname;
    document.getElementById("audio-player").classList.add("show");
    const dur = pcm.length / 2 / SAMPLE_RATE;
    setStatus("✅ 완료 (약 " + Math.round(dur) + "초). 다운로드 가능.");

    // Send by email (optional). LOCAL pages have a baked recipient list;
    // WEB pages ask the visitor once and remember in localStorage. If
    // /api/audio-email isn't deployed (e.g. running plain
    // \`python -m http.server\`), we silently skip — the download is the
    // fallback either way.
    try {
      const recipients = resolveAudioRecipients();
      if (recipients.length) {
        setStatus("📧 이메일로 전송 중...");
        const ok = await sendAudioEmail(blob, fname, ctx.title || "Audio Overview", s.lang, recipients);
        if (ok) {
          setStatus("✅ 완료 — 다운로드 가능 + 이메일 발송됨 (" + recipients.join(", ") + ")");
        } else {
          setStatus("✅ 완료 — 다운로드 가능 (이메일 발송은 실패. 위에서 직접 받으세요)");
        }
      }
    } catch (mailErr) {
      console.warn("audio email send skipped:", mailErr);
    }
  } catch (e) {
    console.error(e);
    setStatus("오류: " + (e.message || e));
  } finally {
    go.disabled = false;
  }
}

// ── Email delivery helpers ──────────────────────────────────────────
function isLocalHost() {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0"
      || h.endsWith(".local") || window.location.protocol === "file:";
}

function resolveAudioRecipients() {
  // LOCAL pages: baked list (\`window._LOCAL_EMAILS\`) — the owner sees
  // every audio without ever being asked.
  // WEB pages: localStorage + first-time prompt.
  const baked = Array.isArray(window._LOCAL_EMAILS) ? window._LOCAL_EMAILS.filter(Boolean) : [];
  if (isLocalHost() && baked.length) return baked;
  let e = "";
  try { e = localStorage.getItem("_AUDIO_EMAIL") || ""; } catch (er) {}
  if (e) return [e];
  const entered = prompt(
    "Audio Overview 완성본을 이메일로 받으시려면 주소를 입력하세요.\\n" +
    "(브라우저에만 저장되며 다음에 다시 묻지 않습니다. 비워두면 다운로드만 합니다.)"
  );
  if (!entered) return [];
  const t = String(entered).trim();
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(t)) {
    alert("이메일 형식이 올바르지 않습니다. 다운로드로 받으세요.");
    return [];
  }
  try { localStorage.setItem("_AUDIO_EMAIL", t); } catch (er) {}
  return [t];
}

async function sendAudioEmail(blob, filename, title, lang, recipients) {
  const fd = new FormData();
  fd.append("mp3", blob, filename);
  fd.append("filename", filename);
  fd.append("title", title || "Audio Overview");
  fd.append("lang", lang || "ko");
  for (const r of recipients) fd.append("email", r);
  try {
    const r = await fetch("/api/audio-email", { method: "POST", body: fd });
    if (!r.ok) {
      const txt = await r.text();
      console.warn("audio-email server returned", r.status, txt.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("audio-email fetch failed:", e);
    return false;
  }
}

document.addEventListener("DOMContentLoaded", function() {
  // Button always enabled — clicking will trigger ensureGeminiKey()
  // which prompts the user when the page was deployed without a baked
  // key. We keep a hint in the button tooltip and a small inline note
  // when no key is cached so the visitor knows what to expect (some
  // browsers hide tooltips on mobile / dark mode, hence the visible
  // text fallback).
  const ob = document.getElementById("audio-open");
  if (ob && !GKEY) {
    ob.title = "클릭 시 Gemini API Key 입력 창이 뜹니다 (브라우저에만 저장)";
    const bar = ob.parentElement;
    if (bar && !bar.querySelector(".audio-hint")) {
      const hint = document.createElement("span");
      hint.className = "audio-hint";
      hint.textContent = "Gemini API Key 필요 (첫 클릭 시 입력)";
      hint.style.cssText = "margin-left:0.6rem;font-size:0.78rem;color:#888;";
      bar.appendChild(hint);
    }
  }
  if (!document.getElementById("audio-modal-bg")) return;
  wireAudioModal();
  const sp = document.getElementById("audio-speed");
  const el = document.getElementById("audio-el");
  if (sp && el) sp.addEventListener("input", function() {
    el.playbackRate = parseFloat(sp.value);
    document.getElementById("audio-speed-val").textContent = parseFloat(sp.value).toFixed(2) + "x";
  });
});

window.openAudioModal = openAudioModal;
window.closeAudioModal = closeAudioModal;
window.toggleAudioAdv = toggleAudioAdv;
window.runAudioGen = runAudioGen;
})();
`;

// review_to_html.py audio_script_block(ctx) → audio_overview.py audio_script_block.
// 원본과 다른 점 2가지만 적용:
//   - 키 baking 안 함: window._GEMINI_KEY = "" (AUDIO_JS의 prompt+localStorage가 처리)
//   - 이메일 백엔드 없음: window._LOCAL_EMAILS = [] (AUDIO_JS try/catch가 다운로드로 fallback)
// mode는 원본 review 경로와 동일하게 "paper".
export interface AudioCtx {
  title: string;
  review: string;
  connections: ConnItem[];
}

export function audioScriptBlock(ctx: AudioCtx): string {
  const prefix =
    'window._GEMINI_KEY = "";\n' +
    'window._AUDIO_MODE = "paper";\n' +
    "window._LOCAL_EMAILS = [];\n" +
    "window._AUDIO = " + JSON.stringify(ctx) + ";\n";
  return (
    '<script src="https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js"></script>\n' +
    "<script>\n" +
    prefix +
    AUDIO_JS +
    "\n</script>"
  );
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

  // Audio Overview bar (review_to_html.py: h1 직후)
  bodyParts.push(audioBarHtml());

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

  // Assemble (get_css + get_audio_css 합치기 — review_to_html.py와 동일)
  const css = getCss(theme) + "\n" + getAudioCss(theme);
  const audioCtx: AudioCtx = {
    title: input.frontmatter.title,
    review: input.body,
    connections: input.connections,
  };
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
${audioModalHtml()}
${audioScriptBlock(audioCtx)}
</body>
</html>`;
  return html;
}
