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
// どのモデルになるかは返事を見るまで分からないので、仮押さえはこのモデルの単価との高い方で取る。
const FALLBACK_PRICE = PRICES["claude-opus-5"];

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
export function holdUsd({ model, inputTokens, maxOutputTokens, other }) {
  const p = other ? OTHER_PRICE : maxOf([priceOf(model), FALLBACK_PRICE]);
  const input = Math.min(MAX_INPUT_TOKENS, Math.max(0, Number(inputTokens) || 0) + OVERHEAD_TOKENS);
  const out = Math.max(0, Number(maxOutputTokens) || 0);
  return (input * Math.max(p.in, p.cacheWrite) + out * p.out) / 1e6;
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

// 米ドルを 100 万分の 1 ドルの整数にする（Durable Object では小数の足し引きをしない）。切り上げ。
export function toMicro(usd) {
  const n = Math.ceil(Number(usd) * 1e6);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── 金額の枠の設定 ─────────────────────────────────────────────────
//
//   AI_MONTHLY_BUDGET_USD   月の枠。既定 $80（$100 に対して、精算の取りこぼしと他の用途の分の余裕を取る）
//   AI_DAILY_BUDGET_MAX_USD 1日の額の上限の天井。既定 $8
// 1日の額の上限 = min(天井, 2 × その日の始まりの時点の月の残り ÷ 月の残り日数（その日を含む）)。
// 月の初めは 1日 $5.3 ほど。前半で使われなかった分は後半へ回り、1日で月の枠を使い切られない。
export const DEFAULT_MONTHLY_BUDGET_USD = 80;
export const DEFAULT_DAILY_BUDGET_MAX_USD = 8;
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
    factor: DAILY_BUDGET_FACTOR,
  };
}
