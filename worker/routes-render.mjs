// アプリの中で生成する AIレンダーの窓口。
//
//   POST /api/ai/render         今の視点の 3 枚（3D の絵・深度・輪郭）と、任意の 4 枚目（法線）から、写真のような絵を 1 枚作る
//   POST /api/ai/render-report  生成した絵の「問題を報告」を R2 に残す（App Store 審査指針 1.2 への備え）
//   GET  /api/ai/quota の render 欄（renderQuota。worker/routes-ai.mjs の aiQuota が足す）
//
// 設計書: docs/superpowers/specs/2026-11-27-ai-render-in-app-design.md
//
// 決まり
//   - 文章の欄は受け取らない。指示文は preset と view から Worker が組む（worker/render-prompt.mjs）。
//     決まった欄以外が 1 つでもあれば断る（読まずに捨てると、画面の作り違いに気づけない）。
//   - 回数は AiQuota の pool=render（1 人 1 日 5 枚・全体 30 枚）。読み取りの点は使わない。
//     金額の枠（月・1 日の額）は読み取りと共有し、呼ぶ前に仮押さえして usage で精算する。
//   - 回数を戻す手段は AiQuota に無い。上流の失敗・安全上の停止でも 1 枚と数える（金額は usage どおり。
//     上流が 2xx 以外を返したときは 0、時間切れ・届かない・usage の無い返事は現実の 1 枚の見積もり
//     renderFailureUsd で精算する）。
//   - AI_RENDER_DAILY_TOTAL か AI_RENDER_DAILY_PER_USER が 0 なら、レンダーだけを止める（数えずに 429 scope total）。
//   - 上流のエラー本文は画面へ返さない（鍵の一部が入ることがある）。ログにも status だけを出す。
//   - Worker は絵を保存しない。例外は、利用者が「問題を報告」で絵を送ったときだけ。
import { json, readBytesWithLimit } from "./shared.mjs";
import { buildRenderPrompt, isRenderLighting, isRenderPreset, isRenderView } from "./render-prompt.mjs";
import { renderConfig, generateImage, RENDER_ASPECTS, RENDER_MAX_OUTPUT_TOKENS, RENDER_TIMEOUT_MS } from "./vertex-render.mjs";
import { renderHoldUsd, renderUsageUsd, renderFailureUsd, imageTokens, textTokens } from "./ai-price.mjs";
import { renderLimits, renderStopped } from "./ai-quota.mjs";
import {
  reserveRender, takeReport, settle, askQuota, whoOf, moneyParams, randomId,
  dayLimitMessage, MONTH_LIMIT_MESSAGE, BUSY_MESSAGE,
} from "./ai-budget.mjs";

// 1 枚あたりの上限（base64 の文字数）。画面は長辺 1536px の JPEG に縮めて送るので、ふつうは 0.5MB ほど。
export const MAX_RENDER_IMAGE_CHARS = 3 * 1024 * 1024;
const MAX_RENDER_BODY_BYTES = 4 * MAX_RENDER_IMAGE_CHARS + 64 * 1024;
// 報告に付ける絵（生成した 1K の PNG）は 3MB を超えうるので、少し大きく取る。
const MAX_REPORT_IMAGE_CHARS = 6 * 1024 * 1024;
const MAX_REPORT_BODY_BYTES = MAX_REPORT_IMAGE_CHARS + 16 * 1024;

const RENDER_KEYS = ["aspect", "images", "preset", "view"];
// base・depth・edge は必ず要る。normal（面の向きの絵）は任意（無ければ 3 枚で生成する）。これ以外の欄は断る。
export const IMAGE_KEYS = Object.freeze(["base", "depth", "edge"]);
export const IMAGE_KEYS_WITH_NORMAL = Object.freeze(["base", "depth", "edge", "normal"]);
export const REPORT_REASONS = Object.freeze(["inappropriate", "wrong_layout", "other"]);

// 中身の先頭の印（base64 のまま見る）。名乗った種類と中身が違うものは断る。
const MAGIC = { "image/jpeg": "/9j/", "image/png": "iVBORw0KGgo", "image/webp": "UklGR" };

const BAD_REQUEST_MESSAGE = "AIレンダーの依頼の形が正しくありません。画面を読み直してから、もう一度お試しください。";
const BLOCKED_MESSAGE = "この画面は仕上げられませんでした。視点を変えてお試しください。";
const UPSTREAM_MESSAGE = "AI から返事を受け取れませんでした。少し待ってから、もう一度お試しください。";
// 運営者が環境変数でレンダーを止めているとき（renderLimits が 0）。
export const RENDER_STOPPED_MESSAGE = "AIレンダーはいま使えません。しばらくしてから、もう一度お試しください。";

// 1 日の枚数は UTC の日付で切るので、日本時間の朝 9 時に戻る。
function againAt(now) {
  const jstHour = new Date(now + 9 * 60 * 60 * 1000).getUTCHours();
  return jstHour < 9 ? "朝9時から" : "明日の朝9時から";
}
export function renderUserLimitMessage(now = Date.now()) {
  return "今日の AIレンダーは使い切りました。" + againAt(now) + "また使えます。";
}
export function renderTotalLimitMessage(now = Date.now()) {
  return "AIレンダーが混み合っていて、今日の受付を終えました。" + againAt(now) + "また使えます。";
}

function badRequest() {
  return json({ error: "bad_request", message: BAD_REQUEST_MESSAGE }, 400);
}
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function sameKeys(obj, keys) {
  const got = Object.keys(obj).sort();
  return got.length === keys.length && got.every((k, i) => k === keys[i]);
}

// data URL を検める。{ mimeType, base64 } か null。
function readDataUrl(value, types, maxChars) {
  if (typeof value !== "string") return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64$/.exec(value.slice(0, comma));
  if (!m || !types.includes(m[1])) return null;
  const base64 = value.slice(comma + 1);
  if (!base64 || base64.length > maxChars || !/^[A-Za-z0-9+/]+=*$/.test(base64)) return null;
  if (!base64.startsWith(MAGIC[m[1]])) return null;
  return { mimeType: m[1], base64 };
}

async function readBody(request, maxBytes) {
  const bytes = await readBytesWithLimit(request, maxBytes);
  if (!bytes) return { error: true };
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return { error: true }; }
}

// 入力を検める。{ preset, view, aspect, images: [base, depth, edge(, normal)], withNormal } か null。
function readRenderInput(payload) {
  if (!isPlainObject(payload) || !sameKeys(payload, RENDER_KEYS)) return null;
  const { preset, view, aspect, images } = payload;
  if (!isRenderPreset(preset) || !isRenderView(view)) return null;
  if (typeof aspect !== "string" || !RENDER_ASPECTS.includes(aspect)) return null;
  if (!isPlainObject(images)) return null;
  const withNormal = Object.prototype.hasOwnProperty.call(images, "normal");
  const keys = withNormal ? IMAGE_KEYS_WITH_NORMAL : IMAGE_KEYS;
  if (!sameKeys(images, keys)) return null;
  const list = [];
  for (const k of keys) {
    const im = readDataUrl(images[k], ["image/jpeg", "image/png"], MAX_RENDER_IMAGE_CHARS);
    if (!im) return null;
    list.push(im);
  }
  return { preset, view, aspect, images: list, withNormal };
}

function logUpstream(where, result) {
  console.log(JSON.stringify({ ai_upstream_error: { where, status: Number(result && result.status) || 0,
    network: !!(result && result.network), finish: String((result && result.finish) || "") } }));
}

export async function aiRender(request, env, deps = {}) {
  const body = await readBody(request, MAX_RENDER_BODY_BYTES);
  if (body.error) return badRequest();
  const input = readRenderInput(body.value);
  if (!input) return badRequest();

  const config = renderConfig(env);
  if (!config.configured || !config.project) {
    return json({ error: "ai_not_configured", message: "AIレンダーはいま使えません。" }, 503);
  }

  if (renderStopped(renderLimits(env))) {
    return json({ error: "ai_quota_exceeded", scope: "total", message: RENDER_STOPPED_MESSAGE }, 429);
  }

  // 光の出し方（soft / sunlit）は、利用者が決めるまで API の欄にせず、運営者の環境変数でだけ切り替える。
  // 無い・知らない値なら soft（今の既定）。
  const lighting = isRenderLighting(env && env.AI_RENDER_LIGHTING) ? env.AI_RENDER_LIGHTING : "soft";
  const text = buildRenderPrompt({ preset: input.preset, view: input.view, withNormal: input.withNormal, lighting });
  const holdUsd = renderHoldUsd({ inputTokens: imageTokens(input.images) + textTokens(text), maxOutputTokens: RENDER_MAX_OUTPUT_TOKENS });
  const quota = await reserveRender(request, env, holdUsd, holdUsd);
  if (!quota.ok) return renderRefusal(quota.kind);

  const result = await generateImage({
    config, images: input.images, text, aspectRatio: input.aspect,
    fetchImpl: deps.fetchImpl || fetch, timeoutMs: deps.renderTimeoutMs || RENDER_TIMEOUT_MS,
  });

  // 精算。上流が 2xx 以外なら 0、usage があればその額、どちらでもなければ（時間切れ・届かない・usage の無い返事）
  // 現実の 1 枚の見積もり。仮押さえの額のままにすると、時間切れが続いただけで 1 日の額の枠
  // （読み取り・チャットと共有）を使い切り、全員の読み取りまで止まる。
  if (result.unbilled) await settle(env, quota.hold, 0, undefined, true);
  else if (result.usage) await settle(env, quota.hold, renderUsageUsd(result.usage), undefined, true);
  else await settle(env, quota.hold, Math.min(holdUsd, renderFailureUsd({ text, images: input.images })), undefined, false);

  if (result.ok) {
    return json({ image: `data:${result.mimeType};base64,${result.base64}`, remaining: quota.remaining });
  }
  if (result.blocked) return json({ error: "render_blocked", message: BLOCKED_MESSAGE }, 422);
  logUpstream("render", result);
  return json({ error: "ai_upstream_error", message: UPSTREAM_MESSAGE }, 502);
}

function renderRefusal(kind) {
  const now = Date.now();
  if (kind === "user") return json({ error: "ai_quota_exceeded", scope: "user", message: renderUserLimitMessage(now) }, 429);
  if (kind === "total") return json({ error: "ai_quota_exceeded", scope: "total", message: renderTotalLimitMessage(now) }, 429);
  if (kind === "month") return json({ error: "ai_quota_exceeded", scope: "month", message: MONTH_LIMIT_MESSAGE }, 429);
  if (kind === "day") return json({ error: "ai_quota_exceeded", scope: "day", message: dayLimitMessage(now) }, 429);
  return json({ error: "ai_quota_unavailable", message: BUSY_MESSAGE }, 503);
}

// GET /api/ai/quota の render 欄。{ left, perUser } と、0 枚のときは断る文 message。
// 数えられないときは left: null（画面は数を隠す）。金額そのものは返さない。
export async function renderQuota(env, request) {
  const limits = renderLimits(env);
  if (renderStopped(limits)) return { left: 0, perUser: limits.perUser, message: RENDER_STOPPED_MESSAGE };
  const hidden = { left: null, perUser: limits.perUser };
  if (!env || !env.AI_QUOTA) return hidden;
  const who = whoOf(request);
  const seen = await askQuota(env, "/take", {
    pool: "render", cost: "0", peek: "1", who, perDay: String(limits.perUser), totalPerDay: String(limits.total),
    ...moneyParams(env, 0, "", { who }),
  });
  if (!seen || seen.scope !== "peek") return hidden;
  // 1 枚の仮押さえの額。絵は多い方の 4 枚（法線あり）で見る（指示文はいちばん長いもので見る必要は無い。差は数百トークン）。
  const hold = renderHoldUsd({ inputTokens: imageTokens([{}, {}, {}, {}]) + 2000, maxOutputTokens: RENDER_MAX_OUTPUT_TOKENS }) * 1e6;
  const now = Date.now();
  if (Number(seen.monthLeft) < hold) return { ...hidden, left: 0, message: MONTH_LIMIT_MESSAGE };
  if (Number(seen.dayLeft) < hold || seen.spentOver === true) return { ...hidden, left: 0, message: dayLimitMessage(now) };
  const left = Number(seen.remaining);
  if (!Number.isFinite(left)) return hidden;
  if (left <= 0) {
    const totalOut = Number(seen.totalRemaining) <= 0;
    return { ...hidden, left: 0, message: totalOut ? renderTotalLimitMessage(now) : renderUserLimitMessage(now) };
  }
  return { ...hidden, left };
}

// ── 問題を報告 ───────────────────────────────────────────────────────

export async function aiRenderReport(request, env) {
  const body = await readBody(request, MAX_REPORT_BODY_BYTES);
  if (body.error) return badRequest();
  const payload = body.value;
  if (!isPlainObject(payload)) return badRequest();
  const keys = Object.keys(payload);
  if (!keys.every((k) => k === "reason" || k === "image")) return badRequest();
  if (!REPORT_REASONS.includes(payload.reason)) return badRequest();
  let image;
  if (payload.image !== undefined && payload.image !== null) {
    const im = readDataUrl(payload.image, ["image/png", "image/jpeg", "image/webp"], MAX_REPORT_IMAGE_CHARS);
    if (!im) return badRequest();
    image = payload.image;
  }
  if (!env || !env.PLANS) return json({ error: "report_unavailable", message: "いまは報告を受け付けられません。少し待ってから、もう一度お試しください。" }, 503);

  const counted = await takeReport(request, env);
  if (!counted.ok) {
    if (counted.kind === "day") {
      return json({ error: "ai_quota_exceeded", scope: "user", message: "今日はこれ以上報告を受け付けられません。" + againAt(Date.now()) + "また送れます。" }, 429);
    }
    return json({ error: "ai_quota_unavailable", message: BUSY_MESSAGE }, 503);
  }

  // 接続元の IP は書かない。日付の区切りは日本時間（運営者が見る日付と合わせる）。
  const now = Date.now();
  const day = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const key = `render-reports/${day}/${randomId()}.json`;
  const record = { at: new Date(now).toISOString(), reason: payload.reason, ...(image ? { image } : {}) };
  try {
    await env.PLANS.put(key, JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    return json({ error: "report_unavailable", message: "いまは報告を受け付けられません。少し待ってから、もう一度お試しください。" }, 503);
  }
  return json({ ok: true });
}
