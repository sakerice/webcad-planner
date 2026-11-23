// Gemini API（Google AI Studio の鍵 GEMINI_API_KEY で generativelanguage.googleapis.com を呼ぶ）。
//
// なぜ在るのか
// ------------
// AI の提供元が一時的に失敗したときの予備の3番目（Claude → OpenAI → Gemini。worker/ai-fallback.mjs）。
// 普段は Google に何も送らない。ここが呼ばれるのは、前の2つがどちらも一時的に失敗した（か鍵が無い）ときだけ。
//
// 既定では使わない（AI_GEMINI_FALLBACK=on のときだけ）
// ---------------------------------------------------
// Gemini API の利用規約（https://aistudio.google.com/docs/terms 、2026-03-23 施行。2026-11-23 に読んだ）では、
// 無料の枠（Unpaid Services）で送った内容と答えは Google の製品の改善に使われ、人が読むことがある。
// 有料（請求アカウントが有効な Cloud プロジェクト経由）なら改善に使わない。このアプリは利用者の間取り図を送り、
// プライバシーポリシーでは「学習に使わない提供元に渡す」としている。鍵のプロジェクトが有料かどうかは
// こちらから見えないので、運営者が確かめて AI_GEMINI_FALLBACK=on にするまで使わない。
//
// 既存の Vertex AI の経路（worker/vertex.mjs、サービスアカウント）とは別物。あちらは変えていない。
//
// 送り方（2026-11-23 に https://aistudio.google.com/docs/text-generation.md?generate-content=true と
// https://aistudio.google.com/api-reference/generate-content/generate-content.md で確かめた）
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   鍵はヘッダ x-goog-api-key（URL には入れない。URL はログに残りうる）
//   画像・PDF は parts[].inlineData { mimeType, data(base64) }
//   JSON の形は generationConfig.responseMimeType "application/json" と responseJsonSchema（JSON Schema）
//   temperature は送らない（Gemini 3.6 以降は無視され、将来 400 になると書かれている）
//   考える深さはモデルの既定のまま（gemini-4-hydrogen は high。思考は止められない）
//   usageMetadata: promptTokenCount・candidatesTokenCount・thoughtsTokenCount（思考は出力として課金）

export const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

// usable … 鍵があり、運営者が AI_GEMINI_FALLBACK=on にしている。これが false なら一切送らない。
export function geminiConfig(env) {
  const key = (env && env.GEMINI_API_KEY) || "";
  const on = String((env && env.AI_GEMINI_FALLBACK) || "").trim().toLowerCase() === "on";
  return {
    configured: Boolean(key),
    usable: Boolean(key) && on,
    apiKey: key,
    model: (env && env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL,
  };
}

// 安全上の理由で止まった・断られた、の印（別の提供元で通すことはしない）。
const REFUSED_FINISH = { SAFETY: true, PROHIBITED_CONTENT: true, BLOCKLIST: true, SPII: true, RECITATION: true };

// 1回の問い合わせ。返す形は worker/vertex.mjs・worker/openai.mjs の generate と同じ
// （ok・text・usage{inputTokens,outputTokens,...}・stopReason。失敗は network・unbilled・refused の印）。
export async function generate({ config, system, text, docs, image, images, maxOutputTokens = 65536, schema = null, fetchImpl = fetch }) {
  const parts = [];
  for (const one of Array.isArray(images) ? images : (image ? [image] : [])) {
    if (!one) continue;
    parts.push({ inlineData: { mimeType: one.mimeType || ("image/" + one.format), data: one.base64 } });
  }
  for (const doc of Array.isArray(docs) ? docs : (docs ? [docs] : [])) {
    if (doc) parts.push({ text: String(doc) });
  }
  parts.push({ text: String(text || "") });

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    ...(system ? { systemInstruction: { parts: [{ text: String(system) }] } } : {}),
    generationConfig: {
      maxOutputTokens,
      responseMimeType: "application/json",
      ...(schema ? { responseJsonSchema: schema } : {}),
    },
  });

  let response, raw;
  try {
    response = await fetchImpl(new Request(ENDPOINT + encodeURIComponent(config.model) + ":generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": config.apiKey, "content-type": "application/json" },
      body,
    }));
    raw = await response.text();
  } catch (e) {
    return { ok: false, network: true, status: 502, message: "Gemini API へ届きませんでした。" };
  }
  if (!response.ok) {
    let message = String(raw || "").slice(0, 300);
    try {
      const err = JSON.parse(raw);
      message = String((err.error && (err.error.status || "") + " " + (err.error.message || "")) || message).slice(0, 300);
    } catch { /* 本文が JSON でないことがある */ }
    // 2xx 以外は生成が始まっていない（課金されない）前提で 0 で精算する（Anthropic・OpenAI と同じ扱い）。
    return { ok: false, unbilled: true, status: response.status, message };
  }

  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, status: 502, message: "Gemini の返事を JSON として読めませんでした。" }; }
  return readResult(data);
}

export function readResult(data) {
  const u = (data && data.usageMetadata) || null;
  const usage = u ? {
    inputTokens: Number(u.promptTokenCount) || 0,
    answerTokens: Number(u.candidatesTokenCount) || 0,
    thoughtTokens: Number(u.thoughtsTokenCount) || 0,
    outputTokens: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0),
    totalTokens: Number(u.totalTokenCount) || 0,
  } : null;
  const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
  const candidate = (data && Array.isArray(data.candidates) && data.candidates[0]) || null;
  const finish = (candidate && candidate.finishReason) || "";
  if (blocked || !candidate || REFUSED_FINISH[finish]) {
    // 断られても入力は課金されうるので usage を付けて返す（精算に使う）。
    return { ok: false, refused: true, status: 502, usage, message: "Gemini がこの依頼を断りました。(" + String(blocked || finish || "no candidate") + ")" };
  }
  const answer = ((candidate.content && candidate.content.parts) || [])
    .filter((p) => p && !p.thought)
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .join("");
  return { ok: true, text: answer, usage, stopReason: finish, model: (data && data.modelVersion) || "" };
}
