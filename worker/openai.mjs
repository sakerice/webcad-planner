// OpenAI へ送る。worker/vertex.mjs と同じ役割。
//
// なぜ在るのか
// ------------
// 間取り図の読み取りを Gemini で詰めてきたが、失敗の仕方が一貫している
// （文字は読めるが、空間として解釈できない）。これがモデル固有の弱点なのか、
// この種の作業の限界なのかは、1つのモデルだけでは切り分けられない。
// 同じ入力・同じ指示で別のモデルに読ませて比べるために在る。
//
// vertex.mjs との違いは認証だけ。あちらはサービスアカウントの鍵で JWT を
// 署名してトークンを取るが、こちらはキー1本を Authorization に載せる。
// **キーはこのファイルの外へ出さない。** 応答にも、エラーの文面にも混ぜない。
//
// 使用トークン数は必ず返す。1回いくらかかったかを推定ではなく実測で押さえる。
const ENDPOINT = "https://api.openai.com/v1/responses";

// **投げて、後から取りに行く。**
//
// 1本の接続を保ったまま答えを待つと、間取り図の読み取りのように考える時間が
// 長い依頼では接続が先に切れる（Node の既定は5分で UND_ERR_HEADERS_TIMEOUT）。
// Cloudflare Workers にも同じ制約がある。OpenAI の background を使い、
// 受付だけしてもらってから、出来たかどうかを見に行く。
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

async function waitForResponse(id, config, fetchImpl, sleep) {
  const until = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < until) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetchImpl(`${ENDPOINT}/${id}`, {
      headers: { authorization: "Bearer " + config.apiKey },
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false, status: res.status, raw };
    let data;
    try { data = JSON.parse(raw); } catch (e) { return { ok: false, status: 502, raw }; }
    if (data.status === "completed" || data.status === "failed"
        || data.status === "incomplete" || data.status === "cancelled") {
      return { ok: true, data };
    }
  }
  return { ok: false, status: 504, raw: "待っても出来上がりませんでした。" };
}

export function openaiConfig(env) {
  const key = (env && env.OPENAI_API_KEY) || "";
  return {
    configured: Boolean(key),
    apiKey: key,
    model: (env && env.OPENAI_MODEL) || "gpt-5",
  };
}

// responseSchema(Vertex の形)を、OpenAI の JSON Schema に直す。
//
// 中身は同じものを指しているが、書き方が違う。
//   型の名前が大文字(STRING)か小文字(string)か
//   項目の並び順の指定が propertyOrdering か、あるいは無いか
// 指示文と仕様書は共通のものを使いたいので、ここで形だけ合わせる。
export function toJsonSchema(node) {
  if (!node || typeof node !== "object") return node;
  const type = String(node.type || "").toLowerCase();
  const out = {};
  if (type) out.type = type === "integer" ? "integer" : type;
  if (node.description) out.description = node.description;
  if (node.enum) out.enum = node.enum;
  if (type === "object") {
    out.properties = {};
    for (const key of Object.keys(node.properties || {})) {
      out.properties[key] = toJsonSchema(node.properties[key]);
    }
    // OpenAI の Structured Outputs は、すべての項目を required にし、
    // additionalProperties を false にすることを求める。
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  if (type === "array") out.items = toJsonSchema(node.items);
  return out;
}

export async function generate({
  config, system, text, docs, image, images,
  maxOutputTokens = 32768, fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (!config || !config.apiKey) {
    return { ok: false, status: 503, message: "OpenAI のキーがこの環境に設定されていません。" };
  }

  const content = [];
  for (const one of Array.isArray(images) ? images : (image ? [image] : [])) {
    if (!one) continue;
    const mime = one.mimeType || ("image/" + one.format);
    content.push({ type: "input_image", image_url: `data:${mime};base64,${one.base64}`, detail: "high" });
  }
  for (const doc of Array.isArray(docs) ? docs : (docs ? [docs] : [])) {
    if (doc) content.push({ type: "input_text", text: String(doc) });
  }
  content.push({ type: "input_text", text });

  const body = JSON.stringify({
    model: config.model,
    instructions: system || undefined,
    input: [{ role: "user", content }],
    max_output_tokens: maxOutputTokens,
    background: true,
    store: true,
    text: config.schema ? {
      format: { type: "json_schema", name: "plan", strict: true, schema: config.schema },
    } : { format: { type: "json_object" } },
  });

  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization: "Bearer " + config.apiKey, "content-type": "application/json" },
      body,
    });
  } catch (e) {
    const why = (e && e.cause && (e.cause.code || e.cause.message)) || "";
    return { ok: false, status: 502, message: "OpenAI へ届きませんでした: " + (e && e.message ? e.message : e) + (why ? ` (${why})` : "") };
  }

  const raw = await response.text();
  if (!response.ok) {
    // **キーが混ざらないよう、本文をそのまま流さない。**
    let reason = "";
    try { reason = String(JSON.parse(raw).error.message || "").slice(0, 300); } catch (e) { reason = raw.slice(0, 300); }
    return { ok: false, status: response.status, message: reason };
  }

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    return { ok: false, status: 502, message: "OpenAI の返事を JSON として読めませんでした。" };
  }

  // 受け付けただけの状態なら、出来上がるまで見に行く。
  if (data.id && (data.status === "queued" || data.status === "in_progress")) {
    const waited = await waitForResponse(data.id, config, fetchImpl, sleep);
    if (!waited.ok) {
      let reason = String(waited.raw || "").slice(0, 300);
      try { reason = String(JSON.parse(waited.raw).error.message || "").slice(0, 300); } catch (e) { /* そのまま */ }
      return { ok: false, status: waited.status, message: reason };
    }
    data = waited.data;
  }
  if (data.status === "failed") {
    return { ok: false, status: 502, message: String((data.error && data.error.message) || "OpenAI 側で失敗しました。").slice(0, 300) };
  }

  const out = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part && typeof part.text === "string") out.push(part.text);
    }
  }
  const usage = data.usage || {};
  const reasoning = (usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens) || 0;
  return {
    ok: true,
    text: out.join(""),
    stopReason: data.status || "",
    usage: {
      inputTokens: Number(usage.input_tokens || 0),
      outputTokens: Number(usage.output_tokens || 0),
      thoughtTokens: Number(reasoning),
      answerTokens: Number(usage.output_tokens || 0) - Number(reasoning),
      totalTokens: Number(usage.total_tokens || 0),
    },
  };
}
