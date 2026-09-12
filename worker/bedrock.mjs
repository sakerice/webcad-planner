// Amazon Bedrock の呼び出し。
//
// 使う API は Converse。理由は、日本国内に固定できる2つのモデル
// (Claude Opus 4.8 と Claude Sonnet 4.6) の両方が対応している唯一の窓口
// だから。Messages API は Sonnet 4.6 が bedrock-runtime で受けていない。
//
// 日本国内に閉じる指定
// --------------------
// モデルIDの頭に "jp." を付けると、推論が東京(ap-northeast-1)と
// 大阪(ap-northeast-3)の中だけで走る。付けないか "global." にすると
// 世界中に振り分けられる。間取り図には施主名や敷地住所が入りうるので、
// **既定は必ず jp.** にしてある。
//
//   jp.anthropic.claude-sonnet-4-6  … 既定。出力の形を JSON に強制できる
//   jp.anthropic.claude-opus-4-8    … より高精度。読み取りが厳しければこちら
//
// Claude Opus 5 には jp. が無い(東京では global のみ)ので、ここでは使えない。
import { signRequest } from "./aws-sigv4.mjs";

export const DEFAULT_REGION = "ap-northeast-1";
export const DEFAULT_PLAN_MODEL = "jp.anthropic.claude-sonnet-4-6";

// 国内に閉じていないモデルIDを取り違えて設定してしまう事故を防ぐ。
export function isJapanResident(modelId) {
  return typeof modelId === "string" && modelId.startsWith("jp.");
}

export function bedrockConfig(env) {
  const accessKeyId = (env && env.AWS_ACCESS_KEY_ID) || "";
  const secretAccessKey = (env && env.AWS_SECRET_ACCESS_KEY) || "";
  return {
    configured: !!(accessKeyId && secretAccessKey),
    credentials: { accessKeyId, secretAccessKey, sessionToken: (env && env.AWS_SESSION_TOKEN) || "" },
    region: (env && env.AWS_REGION) || DEFAULT_REGION,
    model: (env && env.BEDROCK_PLAN_MODEL) || DEFAULT_PLAN_MODEL,
  };
}

// 画像1枚と指示文を渡して、返ってきた本文(文字列)と使用トークン数を返す。
//
// fetchImpl は検査で差し替えるためのもの。既定はそのまま fetch。
export async function converse({ config, system, text, image, maxTokens = 8000, fetchImpl = fetch }) {
  const url = `https://bedrock-runtime.${config.region}.amazonaws.com/model/${config.model}/converse`;
  const content = [];
  if (image) content.push({ image: { format: image.format, source: { bytes: image.base64 } } });
  content.push({ text });

  const body = JSON.stringify({
    messages: [{ role: "user", content }],
    system: system ? [{ text: system }] : undefined,
    // 図面の読み取りは創作ではないので、ぶれさせない。
    inferenceConfig: { maxTokens, temperature: 0 },
  });

  const request = await signRequest({
    url, body, service: "bedrock", region: config.region,
    credentials: config.credentials,
    headers: { "content-type": "application/json" },
  });

  const response = await fetchImpl(request);
  const raw = await response.text();
  if (!response.ok) {
    // AWS の本文には鍵は入らないが、余計なものを通さないよう要点だけ拾う。
    let message = "";
    try { message = JSON.parse(raw).message || ""; } catch { message = raw.slice(0, 200); }
    return { ok: false, status: response.status, message };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, status: 502, message: "Bedrock の応答が JSON ではない" }; }

  const parts = (parsed.output && parsed.output.message && parsed.output.message.content) || [];
  const answer = parts.map((p) => (p && p.text) || "").join("");
  return {
    ok: true,
    text: answer,
    usage: parsed.usage || null,
    stopReason: parsed.stopReason || "",
  };
}

// モデルの返事から JSON を取り出す。
//
// 「```json ... ```」で囲って返す、前置きの一文を添える、といったことが
// 普通に起きる。素直に JSON.parse すると、それだけで失敗する。
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
