// Vertex AI (Gemini) の呼び出し。
//
// 東京から出さないための決まり
// ----------------------------
// 窓口(ホスト名)にリージョンが入っている。
//
//   https://asia-northeast1-aiplatform.googleapis.com/…/locations/asia-northeast1/…
//
// Google のドキュメントでは、生成AIの機械学習処理は**リクエストした
// リージョン内で行われる**とされている。逆に "global" の窓口を使うと
// 世界中に振り分けられ、国内処理の保証が無くなる。
//
// **ここが一番危ない。** グローバル窓口に流れてもエラーにならず、黙って
// 国外へ出る。だから窓口の組み立てを1か所に閉じ、"global" を弾き、
// 検査でも固定してある (tools/tests/vertex-region.test.cjs)。
//
// 間取り図には施主名・敷地住所が入りうるので、ここは譲れない。
import { getAccessToken } from "./google-auth.mjs";

export const DEFAULT_LOCATION = "asia-northeast1";      // 東京
export const DEFAULT_PLAN_MODEL = "gemini-2.5-pro";

// 日本国内で処理されるリージョンかどうか。
// asia-northeast1 = 東京、asia-northeast2 = 大阪。
export function isJapanLocation(location) {
  return location === "asia-northeast1" || location === "asia-northeast2";
}

// 窓口の組み立てはここだけ。呼び出し側で文字列を作らせない。
export function endpointFor({ location, project, model }) {
  if (!isJapanLocation(location)) {
    throw new Error(`日本国内ではないリージョンが指定されました: ${location}`);
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
    `/locations/${location}/publishers/google/models/${model}:generateContent`;
}

export function vertexConfig(env) {
  let credentials = null;
  const raw = env && env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try { credentials = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { credentials = null; }
  }
  return {
    configured: !!(credentials && credentials.client_email && credentials.private_key),
    credentials,
    project: (env && env.VERTEX_PROJECT) || (credentials && credentials.project_id) || "",
    location: (env && env.VERTEX_LOCATION) || DEFAULT_LOCATION,
    model: (env && env.VERTEX_PLAN_MODEL) || DEFAULT_PLAN_MODEL,
  };
}

// 画像1枚と指示文を渡して、本文と使用トークン数を返す。
//
// 使用トークン数は**必ず**返す。1回いくらかかったかを、推定ではなく実測で
// 押さえられるようにするため。
// maxOutputTokens: 図面1枚ぶんの JSON は、壁が多いと8千トークンでは足りない。
// 足りないと finishReason=MAX_TOKENS で**途中で切れた JSON** が返り、
// 読み取り自体は課金されているのに1件も使えない、という一番損な失敗になる。
// thinkingBudget: 思考にも上限を置く。**上限が無いと費用に上限が無い。**
// 実際、検算を促す指示を入れたら思考だけで32,765トークンを使い切り、
// 答えが0トークンのまま打ち切られた(課金だけされて1件も使えない)。
// 答えのJSONは2,000〜3,700トークンなので、出力の上限は思考ぶんを足した値。
export async function generate({ config, system, text, image, maxOutputTokens = 32768, thinkingBudget = 8192, fetchImpl = fetch, now }) {
  const auth = await getAccessToken(config.credentials, { fetchImpl, now });
  if (!auth.ok) return { ok: false, status: auth.status, message: "認証に失敗しました: " + auth.message };

  let url;
  try {
    url = endpointFor({ location: config.location, project: config.project, model: config.model });
  } catch (e) {
    return { ok: false, status: 500, message: e.message };
  }

  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: "image/" + image.format, data: image.base64 } });
  parts.push({ text });

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    // 図面の読み取りは創作ではないので、ぶれさせない。
    generationConfig: {
      temperature: 0, maxOutputTokens, responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget },
    },
  });

  const response = await fetchImpl(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer " + auth.token, "content-type": "application/json" },
    body,
  }));
  const raw = await response.text();
  if (!response.ok) {
    let message = raw.slice(0, 300);
    try {
      const err = JSON.parse(raw);
      message = (err.error && err.error.message) || message;
    } catch { /* 本文が JSON でないことがある */ }
    return { ok: false, status: response.status, message };
  }

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, status: 502, message: "Vertex の応答が JSON ではない" }; }

  const candidate = (parsed.candidates && parsed.candidates[0]) || null;
  const answer = ((candidate && candidate.content && candidate.content.parts) || [])
    .map((p) => (p && p.text) || "").join("");
  const usage = parsed.usageMetadata || null;
  return {
    ok: true,
    text: answer,
    // 呼び出し側が同じ形で扱えるように、名前をそろえて返す。
    // 思考ぶん(thoughtsTokenCount)は出力として課金されるが、**答えの長さとは
    // 別物**。混ぜて数えると「JSONを短くしたのに高くなった」理由が見えない。
    // 合算値と内訳の両方を返す。
    usage: usage ? {
      inputTokens: usage.promptTokenCount || 0,
      answerTokens: usage.candidatesTokenCount || 0,
      thoughtTokens: usage.thoughtsTokenCount || 0,
      outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
      totalTokens: usage.totalTokenCount || 0,
    } : null,
    stopReason: (candidate && candidate.finishReason) || "",
  };
}

// モデルの返事から JSON を取り出す。
//
// responseMimeType を指定していても、``` で囲って返ることがある。
// 素直に JSON.parse すると、それだけで失敗する。
export function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch { /* 前後に文が付いている場合へ続く */ }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}
