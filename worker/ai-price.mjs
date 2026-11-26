// AI の単価と、1回の呼び出しが最悪いくらになるかの見積もり。
//
// なぜ在るのか
// ------------
// 運営者は Anthropic の月ごとの無料クレジットの範囲で AI を出したい（月 $100 を超えない。2026-11 利用者決定）。
// 1日の点数（worker/ai-quota.mjs）だけでは、1点あたりの費用が呼び出しの中身で大きく変わるため、月の金額を
// 押さえられなかった。そこで呼ぶ前に「最悪の額」を仮押さえし、返事の usage から実額を出して精算する。
// 単価と見積もりの決まりは、ここ1か所に置く。
//
// 単価は 100 万トークンあたりの米ドル（2026-11-20 に Anthropic の公表値で確かめた）。
// キャッシュの書き込みは 5 分の印（ephemeral）の値で、入力の 1.25 倍。
// 表に無いモデルは、表のいちばん高い単価で数える（読み出しも入力と同じ値にする）。
export const PRICES = Object.freeze({
  "claude-fable-5-2":  { in: 8, out: 40, cacheWrite: 10, cacheRead: 0.2 },
  "claude-fable-5-1":  { in: 10, out: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  "claude-fable-5":    { in: 10, out: 50, cacheWrite: 12.5, cacheRead: 1 },
  "claude-opus-5-5":   { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5":     { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8":   { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-7":   { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6":   { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-sonnet-5":   { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-4-6": { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-5-5":  { in: 0.5, out: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
  "claude-haiku-4-5":  { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
});

function maxOf(list) {
  const out = { in: 0, out: 0, cacheWrite: 0, cacheRead: 0 };
  for (const p of list) for (const k of Object.keys(out)) out[k] = Math.max(out[k], p[k]);
  return out;
}
// 表に無いモデルの単価。読み出しも入力と同じに見る（いちばん高い側）。
const TOP = maxOf(Object.values(PRICES));
export const UNKNOWN_PRICE = Object.freeze({ ...TOP, cacheRead: TOP.in });
// OpenAI・Vertex（予備の経路）の単価。実際の単価をここで追わず、表のいちばん高い値で数える（高めの概算）。
export const OTHER_PRICE = UNKNOWN_PRICE;
// 安全側の判定で断られたとき、Anthropic が別のモデルでやり直す（worker/anthropic.mjs の fallbacks: "default"）。
// やり直しの先は、Claude Opus 5.5 では claude-opus-5 と claude-opus-4-8 だけ（Anthropic の移行の手引き
// 「the permitted fallback targets are claude-opus-4-8 and claude-opus-5」、2026-11-20 に Skill claude-api で確かめた）。
// どちらに行くかは断られた種類で決まり、公表されていないので、仮押さえは2つの高い方の単価で取る。
// 途中で断られた試行とやり直しの試行は、それぞれ課金されうる（仮押さえは1回分。下の holdUsd の割り切りを見ること）。
export const FALLBACK_MODELS = Object.freeze(["claude-opus-5", "claude-opus-4-8"]);
const FALLBACK_PRICE = maxOf(FALLBACK_MODELS.map((m) => PRICES[m]));

// Gemini API（予備の3番目。worker/gemini.mjs）の単価。有料の段の Standard の値（思考の分は出力に含む）。
// 2026-11-23 に https://aistudio.google.com/docs/pricing （ai.google.dev/gemini-api/docs/pricing の転送先）で確かめた。
// 無料の段では 0 円だが、無料か有料かはこちらから見えないので、有料の値で数える（高めに数える側）。
// 表に無いモデル（GEMINI_MODEL で替えたとき）は、上の表のいちばん高い単価で数える。
export const GEMINI_PRICES = Object.freeze({
  "gemini-4-hydrogen": Object.freeze({ in: 1.5, out: 7.5 }),
  "gemini-3.5-flash-lite": Object.freeze({ in: 0.3, out: 2.5 }),
});
export function geminiPriceOf(model) {
  return Object.prototype.hasOwnProperty.call(GEMINI_PRICES, String(model || "")) ? GEMINI_PRICES[model] : OTHER_PRICE;
}

// AIレンダー（worker/vertex-render.mjs。Vertex AI の gemini-nano-banana-2.1）の単価。100 万トークンあたりの米ドル。
// 入力 $1.5、絵の出力 $30、文と思考の出力 $7.5。2026-11-26 と 2026-11-27 に Gemini API の料金
// （https://aistudio.google.com/docs/models/gemini-nano-banana-2.1）で確かめた値。Vertex AI でも同額かは確かめていない。
// 返事の candidatesTokenCount は絵と文の合計なので、全部を絵の単価（高い方）で数える。1 枚（1K）は約 $0.045。
export const RENDER_PRICE = Object.freeze({ in: 1.5, imageOut: 30, textOut: 7.5 });
// 仮押さえ: 入力は画像 1 枚 8,000 トークン（imageTokens。実測は 1,120）と指示文、出力は上限まで絵の単価で出たとして数える。
export function renderHoldUsd({ inputTokens, maxOutputTokens }) {
  const input = Math.min(MAX_INPUT_TOKENS, Math.max(0, Number(inputTokens) || 0) + OVERHEAD_TOKENS);
  return (input * RENDER_PRICE.in + Math.max(0, Number(maxOutputTokens) || 0) * RENDER_PRICE.imageOut) / 1e6;
}
// 時間切れ・届かない・usage の無い返事のときの精算額。課金されたかは分からないので、現実の 1 枚で数える。
// 入力は画像 1 枚 1,120 トークン（試し生成の実測は 3 枚と指示文で約 3,550）と指示文のバイト数、
// 出力は絵 1 枚（1K）1,120 トークンと思考 2,000 トークン（試し生成では 500〜1,100）。指示文 3KB で約 $0.058。
// 仮押さえの額（出力を上限まで絵の単価で見る。約 $0.17）のまま精算すると、1 日の額の枠（読み取り・チャットと
// 共有）を時間切れだけで食い尽くしうるため、2026-11-27 にこの見積もりへ替えた。
export const RENDER_IMAGE_INPUT_TOKENS = 1120;
export const RENDER_IMAGE_OUTPUT_TOKENS = 1120;
export const RENDER_FAILURE_THOUGHT_TOKENS = 2000;
export function renderFailureUsd({ text, images = 3 } = {}) {
  const count = Array.isArray(images) ? images.length : Math.max(0, Number(images) || 0);
  const input = count * RENDER_IMAGE_INPUT_TOKENS + textTokens(text);
  return (input * RENDER_PRICE.in + RENDER_IMAGE_OUTPUT_TOKENS * RENDER_PRICE.imageOut +
    RENDER_FAILURE_THOUGHT_TOKENS * RENDER_PRICE.textOut) / 1e6;
}
// usage（worker/vertex-render.mjs の形: inputTokens・outputTokens・thoughtTokens）から実額を出す。
export function renderUsageUsd(usage) {
  if (!usage) return null;
  const input = Number(usage.inputTokens), output = Number(usage.outputTokens), thought = Number(usage.thoughtTokens) || 0;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (input * RENDER_PRICE.in + output * RENDER_PRICE.imageOut + thought * RENDER_PRICE.textOut) / 1e6;
}

export function priceOf(model) {
  return Object.prototype.hasOwnProperty.call(PRICES, String(model || "")) ? PRICES[model] : UNKNOWN_PRICE;
}

// 1回の呼び出しの入力の上限（文脈の大きさ）。見積もりはこれを超えない。
const MAX_INPUT_TOKENS = 1000000;
// 画像1枚の見積もり。Claude の画像は大きくても約4,800トークン（高い解像度で受けるモデル）なので、余裕を見て 8,000。
const IMAGE_TOKENS = 8000;
// PDF は小さなファイルでもページ数が多ければ入力が膨らむ（1ページごとに画像と文字が入る）。バイト数からは
// 上限を出せないので、文脈の上限（100万トークン）で見る。画面は PDF をページごとの画像にしてから送るので、
// PDF をそのまま送ってくるのは画面の外からの呼び出しだけ（実質、1日の額の上限で断られる）。
// 指示の外側（道具の定義・出力の形の説明・考える設定など）に足しておく分。
const OVERHEAD_TOKENS = 2000;

// 文字のトークン数の見積もり。トークンは1バイトより細かくならないので、バイト数をそのまま上限として使う
// （日本語は1文字3バイトがおよそ1〜1.5トークン。英字や JSON は3〜4バイトで1トークン）。
export function textTokens(text) {
  if (!text) return 0;
  return typeof text === "number" ? Math.ceil(text) : new TextEncoder().encode(String(text)).byteLength;
}

export function imageTokens(images) {
  let n = 0;
  for (const im of images || []) {
    if (!im) continue;
    n += im.mimeType === "application/pdf" ? MAX_INPUT_TOKENS : IMAGE_TOKENS;
  }
  return Math.min(n, MAX_INPUT_TOKENS);
}

// 仮押さえの額（米ドル）。入力は全部「キャッシュ書き込み」の単価（入力より高い）で、出力は上限まで出たとして数える。
// 仮押さえは1回分。単価は「頼んだモデル」と「切り替わりうる先」（FALLBACK_MODELS）の高い方。表に無いモデルは、
// 表のいちばん高い単価。OpenAI・Vertex（other）は表のいちばん高い単価。
// 割り切り: 途中で断られて別のモデルでやり直すと2回分課金されうるが、2回分を仮押さえすると1日の額の上限
// （月初め約 $5.3）に読み取りが2回ほどしか入らず、普通の利用が止まる。そこで仮押さえは1回分にし、2回分
// 課金されたときは精算で usage どおりの実額（2回分）を月と日に足す。仮押さえを超えた分で枠をはみ出すのは、
// 同時に走っている要求の分だけ（1日の額の上限以内）なので、月の枠 $80 と $100 の間の余裕で受ける。
// gemini にモデル名を渡すと、Gemini API の単価（geminiPriceOf）で数える。
export function holdUsd({ model, inputTokens, maxOutputTokens, other, gemini }) {
  const input = Math.min(MAX_INPUT_TOKENS, Math.max(0, Number(inputTokens) || 0) + OVERHEAD_TOKENS);
  const out = Math.max(0, Number(maxOutputTokens) || 0);
  if (gemini) {
    const g = geminiPriceOf(gemini);
    return (input * Math.max(g.in, g.cacheWrite || 0) + out * g.out) / 1e6;
  }
  const own = priceOf(model);
  const p = other ? OTHER_PRICE : (own === UNKNOWN_PRICE ? UNKNOWN_PRICE : maxOf([own, FALLBACK_PRICE]));
  return (input * Math.max(p.in, p.cacheWrite) + out * p.out) / 1e6;
}

// 1回分の入力だけの額（途中で切れたとき、入力の実数が分からなければこれで数える）。
export function inputHoldUsd({ model, inputTokens }) {
  const p = priceOf(model);
  const input = Math.min(MAX_INPUT_TOKENS, Math.max(0, Number(inputTokens) || 0) + OVERHEAD_TOKENS);
  return input * Math.max(p.in, p.cacheWrite) / 1e6;
}

// 途中で切れた答えの出力の見積もり（トークン）。min(出力の上限, 経過秒数 × 300 + 1,000)。
// 300 トークン/秒は Opus の生成の速さの3倍以上の余裕を見た値で、厳密な保証ではない（それより速く出た分は
// 数え漏れる）。漏れは、月の枠 $80 と運営者が避けたい $100 の間の余裕で受ける。
export const STREAM_TOKENS_PER_SECOND = 300;
export function interruptedOutputTokens(maxOutputTokens, elapsedMs) {
  const guess = Math.ceil(Math.max(0, Number(elapsedMs) || 0) / 1000 * STREAM_TOKENS_PER_SECOND) + 1000;
  return Math.min(Math.max(0, Number(maxOutputTokens) || 0), guess);
}

// Anthropic の usage から実額を出す。model は返事のモデル。頼んだモデルとの高い方の単価で数える。
// usage の input_tokens はキャッシュの分を含まない（キャッシュは別の欄）。
export function anthropicUsageUsd({ requested, model, input, cacheWrite, cacheRead, output }) {
  const p = maxOf([priceOf(requested), priceOf(model || requested)]);
  return ((Number(input) || 0) * p.in + (Number(cacheWrite) || 0) * p.cacheWrite
    + (Number(cacheRead) || 0) * p.cacheRead + (Number(output) || 0) * p.out) / 1e6;
}

// OpenAI・Vertex の usage（こちらの形: inputTokens・outputTokens）から実額を出す。高めの単価で数える。
export function otherUsageUsd(usage) {
  if (!usage) return null;
  const input = Number(usage.inputTokens), output = Number(usage.outputTokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (input * OTHER_PRICE.in + output * OTHER_PRICE.out) / 1e6;
}

// Gemini API の usage（こちらの形。outputTokens は答えと思考の合計）から実額を出す。
export function geminiUsageUsd(usage, model) {
  if (!usage) return null;
  const input = Number(usage.inputTokens), output = Number(usage.outputTokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  const p = geminiPriceOf(model);
  return (input * p.in + output * p.out) / 1e6;
}

// 米ドルを 100 万分の 1 ドルの整数にする（Durable Object では小数の足し引きをしない）。切り上げ。
export function toMicro(usd) {
  const n = Math.ceil(Number(usd) * 1e6);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── 金額の枠の設定 ─────────────────────────────────────────────────
//
//   AI_MONTHLY_BUDGET_USD   月の枠。既定 $80（$100 に対して、精算の取りこぼしと他の用途の分の余裕を取る）
//   AI_DAILY_BUDGET_MAX_USD 1日の額の上限の天井。既定 $8
//   AI_DAILY_BUDGET_MIN_USD 1日の額の上限の下限。既定 $4（ただし月の残りを超えない）
// 1日の額の上限 = min(月の残り, max(下限, min(天井, 2 × その日の始まりの時点の月の残り ÷ 月の残り日数（その日を含む））))。
// 月の初めは 1日 $5.3 ほど。前半で使われなかった分は後半へ回り、1日で月の枠を使い切られない。
// 下限は、月の後半に1日の上限が見直し1回の仮押さえを下回り、見直しだけが毎日断られるのを防ぐため。
// 1人の1日の「精算されずに残った額」（途中で切れて見積もりで精算した額など）の上限と、1人の1日の使用額
// （これまでに精算した額）の上限は、どちらも1日の額の上限の 1/3。
export const DEFAULT_MONTHLY_BUDGET_USD = 80;
export const DEFAULT_DAILY_BUDGET_MAX_USD = 8;
export const DEFAULT_DAILY_BUDGET_MIN_USD = 4;
export const DAILY_BUDGET_FACTOR = 2;

function money(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function budgetConfig(env) {
  return {
    monthCap: toMicro(money(env && env.AI_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD)),
    dayMax: toMicro(money(env && env.AI_DAILY_BUDGET_MAX_USD, DEFAULT_DAILY_BUDGET_MAX_USD)),
    dayMin: toMicro(money(env && env.AI_DAILY_BUDGET_MIN_USD, DEFAULT_DAILY_BUDGET_MIN_USD)),
    factor: DAILY_BUDGET_FACTOR,
  };
}
