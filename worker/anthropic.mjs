// Anthropic（Claude）へ送る。worker/openai.mjs・worker/vertex.mjs と同じ役割。
//
// なぜ在るのか
// ------------
// 間取りの読み取りを Claude に移した（2026-10-17 の決定、2026-10-19 に既定へ。
// tools/plan-eval/ で OpenAI と点数を比べてから切り替えた）。鍵（ANTHROPIC_API_KEY）が
// 入っている環境では Claude が既定で、AI_IMPORT_PROVIDER で別の提供元を名指しできる。
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

// 答えを少しずつ受け取る形（ストリーミング）で投げ、Anthropic の返事（SSE）をそのまま返す。
//
// **ここでは読み解かない。** Worker の CPU 時間には上限がある（無料プランで1リクエスト10ms）。
// 数千の小さな出来事を JSON として読むと上限に触れうるので、届いたバイトを画面へ流すだけにし、
// 読み解くのは画面側（assets/js/plan-import.js）に任せる。費用は答えをまとめて受け取るときと同じ。
//
// 考えている内容の要約（thinking の display: summarized）も流す。画面に「作っている内容」として出す。
export async function startStream({
  config, system, text, docs, image, images, maxOutputTokens = 32000, fetchImpl = fetch,
}) {
  if (!config || !config.apiKey) {
    return { ok: false, status: 503, message: "Anthropic のキーがこの環境に設定されていません。" };
  }
  const body = buildRequest({ config, system, text, docs, image, images, maxOutputTokens });
  body.stream = true;
  body.thinking = { type: "adaptive", display: "summarized" };
  return sendStream(config, JSON.stringify(body), fetchImpl);
}

function requestHeaders(config) {
  return {
    "x-api-key": config.apiKey,
    "anthropic-version": API_VERSION,
    "anthropic-beta": FALLBACK_BETA,
    "content-type": "application/json",
  };
}

// 投げて、返事の本文（SSE）を読まずに返す。失敗のときだけ本文を読む（キーは混ぜない）。
async function sendStream(config, bodyText, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(new Request(ENDPOINT, {
      method: "POST",
      headers: requestHeaders(config),
      body: bodyText,
    }));
  } catch (e) {
    // network: 届かなかった（worker/ai-fallback.mjs が一時的な失敗として切り替える）。
    return { ok: false, network: true, status: 502, message: "Anthropic へ届きませんでした: " + (e && e.message ? e.message : e) };
  }
  // unbilled: 上流が 2xx 以外を返した（生成が始まっていないので課金されない、という前提。worker/ai-budget.mjs が 0 で精算する）。
  if (!response.ok) return { ok: false, unbilled: true, status: response.status, message: safeReason(await response.text()) };
  return { ok: true, body: response.body };
}

// ── 会話と道具を付けて呼ぶ（チャット、worker/chat.mjs） ──────────────────
//
// buildRequest は user のメッセージ1件しか作れず、道具も受けない。チャットは画面が持ち回る会話
// （messages）をそのまま送り、道具（間取りの操作）を付ける。
//
// 決まり（claude-opus-5-5）: thinking は adaptive のみ（budget_tokens は 400）、tool_choice は
// 指定しない（any・tool は 400。既定の auto）、temperature などは送らない。
// 本文の欄の並びは毎回同じにする（system と tools を1バイトも変えない。プロンプトキャッシュのため）。
//
// キャッシュの印は2つ。system の最後のブロックに付ける印（道具と system までを使い回す）と、
// 本文の最上位の cache_control（自動のキャッシュ。会話の伸びる末尾に印を自動で置き直す）。
// 最上位の cache_control は Claude API で anthropic-version 2023-06-01 のまま、ベータのヘッダ無しで
// 使える（Anthropic の文書の prompt caching の "Automatic vs explicit breakpoints" と、
// 提供範囲の表 "Automatic prompt caching: Claude API Yes"。2026-11-17 に確かめた）。
// 印は1回に4つまでなので、messages に cache_control を入れない（worker/chat.mjs が断る）。
export function buildConversationRequest({ config, system, tools, messages, maxOutputTokens = 8000 }) {
  const body = {
    model: config.model,
    max_tokens: maxOutputTokens,
    stream: true,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: config.effort || "medium" },
    fallbacks: "default",
  };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;
  body.cache_control = { type: "ephemeral" };
  body.messages = messages;
  return body;
}

// 本文の文字列を作る。messages は、呼び出し側が既に JSON にした文字列（messagesJson）で受ける。
// worker/chat.mjs は messages の JSON を、札の検査（SHA-256）と本文の両方に使うので、
// 2回 JSON にしないで済むよう、messages の手前までを JSON にして後ろに継ぐ。
// messages は最後の欄なので、継いだ結果は JSON.stringify(buildConversationRequest(...)) と同じ文字列になる。
export function conversationBodyText({ config, system, tools, messagesJson, maxOutputTokens = 8000 }) {
  const head = JSON.stringify(buildConversationRequest({ config, system, tools, messages: [], maxOutputTokens }));
  const tail = '"messages":[]}';
  if (!head.endsWith(tail)) throw new Error("conversation body layout changed");
  return head.slice(0, head.length - 3) + messagesJson + "}";
}

// 作り終えた本文（文字列かバイト列）を送る。返事の SSE は読まずに返す。
export async function sendConversation({ config, body, fetchImpl = fetch }) {
  if (!config || !config.apiKey) {
    return { ok: false, status: 503, message: "Anthropic のキーがこの環境に設定されていません。" };
  }
  return sendStream(config, body, fetchImpl);
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
      headers: requestHeaders(config),
      body,
    }));
  } catch (e) {
    const why = (e && e.cause && (e.cause.code || e.cause.message)) || "";
    return { ok: false, network: true, status: 502, message: "Anthropic へ届きませんでした: " + (e && e.message ? e.message : e) + (why ? ` (${why})` : "") };
  }

  const raw = await response.text();
  if (!response.ok) return { ok: false, unbilled: true, status: response.status, message: safeReason(raw) };

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    return { ok: false, status: 502, message: "Anthropic の返事を JSON として読めませんでした。" };
  }
  return readResult(data);
}

// 返事を、こちらの形（openai.mjs / vertex.mjs と同じ）に直す。
export function readResult(data) {
  // 断られたときは中身が出力の形に合っていない。読まずに返す。
  const u = data.usage || {};
  // 断られても（2xx）入力と途中までの出力は課金されうるので、usage は付けて返す（精算に使う）。
  if (data.stop_reason === "refusal") {
    const why = data.stop_details && data.stop_details.explanation;
    // refused: 断られた。別の提供元へは切り替えない（worker/ai-fallback.mjs）。
    return { ok: false, refused: true, status: 502, model: data.model || "", usage: usageOf(u),
      message: "Claude がこの依頼を断りました。" + (why ? ` (${String(why).slice(0, 200)})` : "") };
  }
  const out = [];
  for (const block of data.content || []) {
    if (block && block.type === "text" && typeof block.text === "string") out.push(block.text);
  }
  return {
    ok: true,
    text: out.join(""),
    stopReason: data.stop_reason || "",
    model: data.model || "",
    usage: usageOf(u),
  };
}

function usageOf(u) {
  const cacheWrite = Number(u.cache_creation_input_tokens || 0);
  const cacheRead = Number(u.cache_read_input_tokens || 0);
  const input = Number(u.input_tokens || 0) + cacheWrite + cacheRead;
  const output = Number(u.output_tokens || 0);
  return {
    inputTokens: input,
    outputTokens: output,
    // 考えた量は出力に含まれて別には数えられない。0 として、合計は出力で見る。
    thoughtTokens: 0,
    answerTokens: output,
    totalTokens: input + output,
    cacheWriteTokens: cacheWrite,
    cacheReadTokens: cacheRead,
  };
}
