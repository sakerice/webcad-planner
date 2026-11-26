// AIレンダー（POST /api/ai/render）の画像生成。Vertex AI の Gemini 画像モデルを、場所 global で呼ぶ。
//
// なぜ worker/vertex.mjs と分けるのか
// ----------------------------------
// worker/vertex.mjs は間取り図の読み取りの窓口で、日本国内のリージョンだけを通す（間取り図には
// 施主名・敷地住所が入りうる）。その制限は変えない。
// レンダーで送るのは利用者が作った家の 3D の絵（と、その奥行き・輪郭の絵）と、Worker が組んだ指示文だけで、
// 個人情報を含まない。採用したモデル gemini-nano-banana-2.1 は場所 global でしか動かない
// （https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/nano-banana-2-1 、
// 2026-11-27 に確かめた）。だから global の窓口の組み立てはこのファイルだけに置き、読み取りの側からは使わない。
//
// 呼び方（2026-11-27 に Vertex AI の公式文書で確かめた）
//   POST https://aiplatform.googleapis.com/v1/projects/<p>/locations/global/publishers/google/models/<m>:generateContent
//   generationConfig.responseModalities = ["IMAGE"]、generationConfig.imageConfig = { aspectRatio, imageSize }
//   絵は candidates[0].content.parts[].inlineData（mimeType・data）
//   安全上の停止は candidates[0].finishReason（SAFETY・IMAGE_SAFETY など）か promptFeedback.blockReason
// Google Search による根拠づけ（tools）は使わない（検索の記録が残るため）。
import { getAccessToken } from "./google-auth.mjs";

export const RENDER_LOCATION = "global";
export const DEFAULT_RENDER_MODEL = "gemini-nano-banana-2.1";
// 上流の待ちの上限。試し生成では 18〜24 秒だった。
export const RENDER_TIMEOUT_MS = 90000;
// 出力の上限。絵 1 枚（1K）は 1,120 トークン、考える分は試し生成で 500〜1,100 トークンだった。
// 上限が無いと仮押さえの額（worker/ai-price.mjs の renderHoldUsd）に上限が無くなる。
// 仮押さえは 1 日の額の枠（読み取り・チャットと共有）を呼んでいる間ふさぎ、利用者が途中で閉じて Worker が
// 止まったときはその額のまま「精算されずに残った額」に積まれる。だから実際の 1 枚の 2 倍弱の 4096 に抑える
// （8192 では仮押さえが約 $0.29、4096 で約 $0.17。2026-11-27）。
export const RENDER_MAX_OUTPUT_TOKENS = 4096;

// 採用モデルが受ける縦横比のうち、Worker が許すもの。極端な比（1:4・4:1・1:8・8:1）は 3D の画面から
// 撮ることがないので外す。画面は、画面の縦横比にいちばん近いものを選んで、そこへ中央で切り抜いて送る。
export const RENDER_ASPECTS = Object.freeze(["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"]);

// 安全上の理由で止まった印（https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse）。
const BLOCKED_FINISH = new Set([
  "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MODEL_ARMOR", "RECITATION",
  "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION",
]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// 窓口の組み立てはここだけ。場所は global に固定する（環境変数でも変えない）。
export function renderEndpoint({ project, model }) {
  return `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}` +
    `/locations/${RENDER_LOCATION}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

export function renderConfig(env) {
  let credentials = null;
  const raw = env && env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try { credentials = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { credentials = null; }
  }
  return {
    configured: !!(credentials && credentials.client_email && credentials.private_key),
    credentials,
    project: (env && env.VERTEX_PROJECT) || (credentials && credentials.project_id) || "",
    model: (env && env.AI_RENDER_MODEL) || DEFAULT_RENDER_MODEL,
  };
}

// 絵を 1 枚作る。images は [{ mimeType, base64 }]（3D の絵・深度・輪郭の順）。
// 返り値:
//   { ok: true, mimeType, base64, usage }
//   { ok: false, blocked: true, usage }       安全上の停止
//   { ok: false, unbilled: true, status }     上流が 2xx 以外（生成は始まっていない）
//   { ok: false, network: true }              届かなかった・時間切れ（課金されたかは分からない）
//   { ok: false, usage, status }              2xx だが絵が無い・読めない
// 上流のエラー本文は返さない（鍵の一部が入ることがある）。ログ用に status だけ返す。
export async function generateImage({ config, images, text, aspectRatio, fetchImpl = fetch, timeoutMs = RENDER_TIMEOUT_MS, now }) {
  let auth;
  try {
    auth = await getAccessToken(config.credentials, { fetchImpl, now });
  } catch (e) {
    return { ok: false, network: true, status: 502 };
  }
  if (!auth.ok) return { ok: false, unbilled: true, status: auth.status || 502 };

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [
      ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.base64 } })),
      { text },
    ] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio, imageSize: "1K" },
      maxOutputTokens: RENDER_MAX_OUTPUT_TOKENS,
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, raw;
  try {
    response = await fetchImpl(new Request(renderEndpoint(config), {
      method: "POST",
      headers: { authorization: "Bearer " + auth.token, "content-type": "application/json" },
      body,
      signal: controller.signal,
    }));
    raw = await response.text();
  } catch (e) {
    return { ok: false, network: true, status: 504 };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return { ok: false, unbilled: true, status: response.status };

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, status: 502 }; }
  const usage = readUsage(parsed && parsed.usageMetadata);
  if (parsed && parsed.promptFeedback && parsed.promptFeedback.blockReason) return { ok: false, blocked: true, usage };
  const candidate = (parsed && Array.isArray(parsed.candidates) && parsed.candidates[0]) || null;
  const finish = String((candidate && candidate.finishReason) || "");
  if (BLOCKED_FINISH.has(finish)) return { ok: false, blocked: true, usage };
  const parts = (candidate && candidate.content && Array.isArray(candidate.content.parts)) ? candidate.content.parts : [];
  for (const part of parts) {
    const d = part && (part.inlineData || part.inline_data);
    if (!d) continue;
    const mimeType = String(d.mimeType || d.mime_type || "");
    const data = typeof d.data === "string" ? d.data : "";
    if (IMAGE_TYPES.has(mimeType) && /^[A-Za-z0-9+/]+=*$/.test(data)) return { ok: true, mimeType, base64: data, usage };
  }
  return { ok: false, status: 502, usage, finish };
}

// usageMetadata を、こちらの形にする。outputTokens は絵と文の合計（candidatesTokenCount）、
// thoughtTokens は考えた分（thoughtsTokenCount。単価が違う）。無ければ null。
function readUsage(u) {
  if (!u || typeof u !== "object") return null;
  const input = Number(u.promptTokenCount);
  if (!Number.isFinite(input)) return null;
  return {
    inputTokens: input,
    outputTokens: Number(u.candidatesTokenCount) || 0,
    thoughtTokens: Number(u.thoughtsTokenCount) || 0,
  };
}
