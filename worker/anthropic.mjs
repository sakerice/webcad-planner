// Anthropic（Claude）へ送る。worker/openai.mjs・worker/vertex.mjs と同じ役割。
//
// なぜ在るのか
// ------------
// 間取りの読み取りを Claude に移す（2026-10-17 の決定。費用あたりの性能が
// 上がったため）。移す前に、同じ図面・同じ指示文・同じ出力の形で今の OpenAI と
// 点数を比べる（tools/plan-eval/）。ここはそのための送り口で、既定はまだ
// OpenAI のまま。AI_IMPORT_PROVIDER=anthropic で切り替わる。
//
// SDK ではなく fetch で呼ぶ
// -------------------------
// この Worker は npm の依存を持たず、OpenAI も Vertex も fetch で呼んでいる。
// ビルド（build.sh → wrangler）に依存の取り込みを足すと本番の公開経路が変わる。
// 経路を変えずに比べられるよう、ここも同じ書き方にそろえる。
//
// **キーはこのファイルの外へ出さない。** 応答にも、エラーの文面にも混ぜない。
// 使用トークン数は必ず返す（1回いくらかかったかを推定ではなく実測で押さえる）。
//
// 待ち方
// ------
// Claude には OpenAI の background（受け付けて後から取りに行く）に当たるものが
// Messages API には無い。Vertex と同じく、**1回の通信の中で答えを待つ**。
// 待っている間は Worker の CPU 時間を使わない。外向きの通信も図面1枚につき1回。
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
// 安全側の判定で断られたとき、Anthropic が勧める別のモデルで同じ依頼をやり直す。
// 間取り図で断られることはまず無いが、断られたら利用者には何も返らない。
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function anthropicConfig(env) {
  const key = (env && env.ANTHROPIC_API_KEY) || "";
  return {
    configured: Boolean(key),
    apiKey: key,
    model: (env && env.ANTHROPIC_MODEL) || "claude-opus-5-5",
    // 考える深さ。Opus 5.5 の既定は medium、Sonnet 5.5 は high で揃っていない。
    // 比べるときに条件がずれないよう、こちらで明示する。
    effort: (env && env.ANTHROPIC_EFFORT) || "high",
  };
}

// **キーが混ざらないよう、本文をそのまま流さない。**
function safeReason(raw) {
  try { return String(JSON.parse(raw).error.message || "").slice(0, 300); }
  catch (e) { return String(raw).slice(0, 300); }
}

// 依頼を組み立てる。検査から中身を見られるよう、送る処理と分けておく。
//
// 並び順は「指示 → 仕様書・知識 → 図面 → 今回の依頼」。仕様書と知識は
// どの図面でも同じなので、そこまでを使い回し（prompt caching）の範囲にする。
// 図面を先に置くと、ページごとに頭が変わって使い回しが効かない。
export function buildRequest({ config, system, text, docs, image, images, maxOutputTokens = 32000 }) {
  const content = [];
  const docList = (Array.isArray(docs) ? docs : (docs ? [docs] : [])).filter(Boolean);
  docList.forEach((doc, i) => {
    const block = { type: "text", text: String(doc) };
    if (i === docList.length - 1) block.cache_control = { type: "ephemeral" };
    content.push(block);
  });
  for (const one of Array.isArray(images) ? images : (image ? [image] : [])) {
    if (!one) continue;
    const mime = one.mimeType || ("image/" + one.format);
    content.push(mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mime, data: one.base64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: one.base64 } });
  }
  content.push({ type: "text", text });

  const body = {
    model: config.model,
    max_tokens: maxOutputTokens,
    messages: [{ role: "user", content }],
    output_config: { effort: config.effort || "high" },
    fallbacks: "default",
  };
  if (system) body.system = system;
  // 出力の形は通信の設定として強制する（お願いではなく）。
  if (config.schema) body.output_config.format = { type: "json_schema", schema: config.schema };
  return body;
}

export async function generate({
  config, system, text, docs, image, images, maxOutputTokens = 32000, fetchImpl = fetch,
}) {
  if (!config || !config.apiKey) {
    return { ok: false, status: 503, message: "Anthropic のキーがこの環境に設定されていません。" };
  }
  const body = JSON.stringify(buildRequest({ config, system, text, docs, image, images, maxOutputTokens }));

  let response;
  try {
    response = await fetchImpl(new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-beta": FALLBACK_BETA,
        "content-type": "application/json",
      },
      body,
    }));
  } catch (e) {
    const why = (e && e.cause && (e.cause.code || e.cause.message)) || "";
    return { ok: false, status: 502, message: "Anthropic へ届きませんでした: " + (e && e.message ? e.message : e) + (why ? ` (${why})` : "") };
  }

  const raw = await response.text();
  if (!response.ok) return { ok: false, status: response.status, message: safeReason(raw) };

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    return { ok: false, status: 502, message: "Anthropic の返事を JSON として読めませんでした。" };
  }
  return readResult(data);
}

// 返事を、こちらの形（openai.mjs / vertex.mjs と同じ）に直す。
export function readResult(data) {
  // 断られたときは中身が出力の形に合っていない。読まずに返す。
  if (data.stop_reason === "refusal") {
    const why = data.stop_details && data.stop_details.explanation;
    return { ok: false, status: 502, message: "Claude がこの依頼を断りました。" + (why ? ` (${String(why).slice(0, 200)})` : "") };
  }
  const out = [];
  for (const block of data.content || []) {
    if (block && block.type === "text" && typeof block.text === "string") out.push(block.text);
  }
  const u = data.usage || {};
  const cacheWrite = Number(u.cache_creation_input_tokens || 0);
  const cacheRead = Number(u.cache_read_input_tokens || 0);
  const input = Number(u.input_tokens || 0) + cacheWrite + cacheRead;
  const output = Number(u.output_tokens || 0);
  return {
    ok: true,
    text: out.join(""),
    stopReason: data.stop_reason || "",
    model: data.model || "",
    usage: {
      inputTokens: input,
      outputTokens: output,
      // 考えた量は出力に含まれて別には数えられない。0 として、合計は出力で見る。
      thoughtTokens: 0,
      answerTokens: output,
      totalTokens: input + output,
      cacheWriteTokens: cacheWrite,
      cacheReadTokens: cacheRead,
    },
  };
}
