// AI を呼ぶルート。
//
// なぜ Worker 側に置くのか
// ------------------------
// API キーをブラウザへ出すわけにいかない。index.html は誰でも読めるし通信も
// 開発者ツールで見えるので、キーを持てるのはサーバ側だけになる。
// wrangler secret で env に入れ、この層から先へは出さない。
//
// 2つの機能で提供元が違う理由
// --------------------------
//   POST /api/ai/import-plan  間取り図 → プランJSON  … Vertex AI Gemini (東京)
//   POST /api/ai/render       3Dの画像 → 写実的な画像 … OpenAI (未実装)
//
// 間取り図には施主名・敷地住所が入りうるので、東京リージョンで処理を閉じ
// られる Vertex AI の Gemini を使う。一方レンダーの入力は利用者自身が作った
// 家の3D画像で個人情報を含まないので、そちらは国外のサービスでよい。
// (東京で動く画像生成モデルはそもそも無い)
import { json, readJsonWithLimit, planProblems, PlanSchema } from "./shared.mjs";
import PlanRooms from "../assets/js/plan-rooms.js";
import PlanGrid from "../assets/js/plan-grid.js";
import { vertexConfig, generate, extractJson, isJapanLocation } from "./vertex.mjs";
import { openaiConfig, generate as openaiGenerate, startJob, fetchJob, readResult, toJsonSchema } from "./openai.mjs";
import { SYSTEM_PROMPT, buildPlanPrompt, planProcedure, decodeCompactPlan } from "./plan-prompt.mjs";
import { PLAN_RESPONSE_SCHEMA } from "./plan-response-schema.mjs";
import { planSpec } from "./plan-spec.mjs";
import { planKnowledge } from "./plan-knowledge.mjs";
import { LOCATE_SYSTEM, LOCATE_PROMPT, LOCATE_SCHEMA, normalizeBox } from "./plan-locate.mjs";
import { REVISE_SYSTEM, buildRevisePrompt } from "./plan-revise.mjs";
import { reviseAdvice, failureFacts, nextStep } from "./plan-gate.mjs";
import { nameRooms, pickModels, missingByRoom, MAX_ROOMS, MAX_SLOTS } from "./plan-finish.mjs";

// 画像は data URL で受け取る。10MB は間取り図の写真に十分な大きさ。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// 1日に使える量。**回数ではなく「点」で数える。**
//
// 呼び出しによって費用が10倍以上違う。回数で数えると、安い呼び出しを基準に
// すれば財布が危なく、高い呼び出しを基準にすれば安い機能まで使えなくなる。
//
//   図面の位置を探す  1点  （gemini-2.5-flash、実測 ¥0.2）
//   図面を読み取る   10点  （gpt-6-astra、実測 ¥40 / 図面1枚）
//
// **1点あたりおよそ ¥4。** 3ページのPDFを1回取り込むと 3 + 30 = 33点 ≒ ¥120。
//
// /api/ai/* には認証が無い。URLを知っていれば誰でも呼べ、そのまま請求される。
// ここが費用の歯止めになる。環境変数 AI_DAILY_TOTAL / AI_DAILY_PER_USER で
// 上書きできる。モデルを変えたら COST を見直すこと。
const COST_LOCATE = 1;
const COST_IMPORT_PAGE = 10;
// 見直しは、元の図面と「答えを描き直した絵」の2枚を見て、全体を作り直させる。
// 入力の画像が1枚増えるが出力は同じなので、読み取りと同じ重さとして数える。
const COST_REVISE_PAGE = 10;
// 「1回の取り込み」の目安。3ページのPDFで 3×(1+10+10) = 63点。
// 上限は**回数で**設定する（点は内部の数え方で、設定する人が意識するものではない）。
const POINTS_PER_IMPORT = 63;
const DEFAULT_IMPORTS_TOTAL = 5;     // 全体。1日およそ ¥1,100
const DEFAULT_IMPORTS_PER_USER = 2;  // 1つの接続元

function quotaLimits(env) {
  const perUser = Number((env && env.AI_DAILY_IMPORTS_PER_USER) || DEFAULT_IMPORTS_PER_USER);
  const total = Number((env && env.AI_DAILY_IMPORTS_TOTAL) || DEFAULT_IMPORTS_TOTAL);
  return {
    imports: { perUser, total },
    points: {
      perUser: Math.max(1, Math.round(perUser * POINTS_PER_IMPORT)),
      total: Math.max(1, Math.round(total * POINTS_PER_IMPORT)),
    },
  };
}
// 1回に読むページ数の上限。各ページが各階になる。
const MAX_PAGES = 8;
const MAX_PROMPT_CHARS = 8000;
const MAX_HINT_CHARS = 500;
const MAX_AI_REQUEST_BYTES = MAX_IMAGE_BYTES * 4 + 256 * 1024;

export function handlesAi(pathname) {
  return pathname.startsWith("/api/ai/");
}

export async function handleAi(request, env, url, deps = {}) {
  // 残り回数を見るだけの窓口。**何も変えないので GET で受ける。**
  if (url.pathname === "/api/ai/quota") return aiQuota(env, request);

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload;
  try { payload = await readJsonWithLimit(request, MAX_AI_REQUEST_BYTES); } catch (response) { return response; }

  if (url.pathname === "/api/ai/finish-plan") return aiFinishPlan(payload, env, deps);
  if (url.pathname === "/api/ai/import-plan") return aiImportPlan(payload, env, deps, request);
  if (url.pathname === "/api/ai/revise-plan") return aiRevisePlan(payload, env, deps, request);
  if (url.pathname === "/api/ai/plan-result") return aiPlanResult(payload, env, deps);
  if (url.pathname === "/api/ai/find-plan") return aiFindPlan(payload, env, deps, request);
  if (url.pathname === "/api/ai/render") return aiRender(payload, env, deps);
  return json({ error: "not_found" }, 404);
}

// data URL を検める。扱えない種類や、上限を超えるものはここで落とす。
//
// **PDF もそのまま受ける。** ベクターなので、ブラウザで画像に変換してから
// 送るより、Gemini 側で開いたほうが寸法の文字がはっきり読める。実測でも
// PDF直送が最良だった(4辺の寸法線がすべて検算を通り、3階建てを1回で読めた)。
const ACCEPTED_TYPES = {
  "image/png": true, "image/jpeg": true, "image/webp": true, "application/pdf": true,
};
function readImage(value, field) {
  if (typeof value !== "string" || !value) return { error: `${field} が無い` };
  const m = /^data:([a-z]+\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m || !ACCEPTED_TYPES[m[1]]) {
    return { error: `${field} は PNG / JPEG / WebP / PDF を data:...;base64, の形で送ること` };
  }
  if (m[2].length * 3 / 4 > MAX_IMAGE_BYTES) return { error: `${field} が大きすぎる(上限 ${MAX_IMAGE_BYTES} バイト)` };
  return { mimeType: m[1], base64: m[2] };
}

// ── 紙面のどこに平面図があるか ──────────────────────────────────────
//
// 切り出しは画面側で行う。ここは位置を答えるだけ。画素を持っているのは
// ブラウザのほうで、PDFならその範囲を高い解像度で描き直せるため。
// 本日あと何回使えるか。**数えずに見るだけ。**
//
// 全体の上限があるので、自分が使っていなくても使えないことがある。
// 押してから断られるより、押す前に分かっているほうがよい。
async function aiQuota(env, request) {
  const limits = quotaLimits(env);
  const seen = await takeQuota(request, env, 0, true);
  const left = Number(seen.remaining);
  return json({
    // 残りを回数にする。1回ぶんに満たない端数は切り捨てる。
    left: Number.isFinite(left) ? Math.floor(left / POINTS_PER_IMPORT) : null,
    perUser: limits.imports.perUser,
    total: limits.imports.total,
    counted: Boolean(env && env.AI_QUOTA),
  });
}

// 位置を探すほうは、安いモデルでよい。大きな領域を1つ答えるだけ。
//
// **gemini-2.5-flash を使う。** 実測（同じページ、正解は縦 0.240〜0.600）:
//
//   gemini-2.5-flash  0.240〜0.600  ほぼ一致       ¥0.2
//   gpt-5.4-mini      0.184〜0.308  上端だけを切る  ¥0.1
//
// 安いモデルならどれでもよいわけではない。gpt-5.4-mini は寸法線の帯だけを
// 返し、そこを切り出して送った結果、読み取りが「図面が無い」と答えた。
// Vertex が混んでいたのを見て測らずに切り替えたのが誤りだった。
//
// Vertex が使えない環境では OpenAI に回す。そのときは読み取りと同じモデルを
// 使う（安いモデルで外すくらいなら、切り出しを捨てるか、良いモデルで当てる）。
function locateProvider(env) {
  const want = (env && env.AI_LOCATE_PROVIDER) || "";
  const vertex = vertexConfig(env);
  if (want !== "openai" && vertex.configured) return { kind: "vertex" };
  const openai = openaiConfig(env);
  if (openai.configured) {
    return { kind: "openai", config: { ...openai, model: (env && env.AI_LOCATE_MODEL) || "gpt-6-astra" } };
  }
  return { kind: "vertex" };
}

// 図面の読み取りを、どこへ投げるか。
//
// 実測（同じ切り出し画像・同じ指示文・同じ仕様書、1階の図面1枚）:
//
//                    費用   所要   L字  廻り階段  寸法線4辺
//   gemini-2.5-pro   ¥16    79秒   ✗     ✗       ✓
//   gpt-5            ¥26   140秒   ✗     ✗       右辺✗
//   gpt-6-astra      ¥40    73秒   ✓     ✓       ✓
//
// Astra だけが、L字の部屋を長方形2つで表し、廻り階段を直進部分に接して置いた。
// どちらも他の2つでは指示を変えても出なかったもので、**モデルの世代の差**。
// 思考トークンは gpt-5 の1/10（1,552 対 15,360）で、迷わずに答えている。
function importProvider(env) {
  const want = (env && env.AI_IMPORT_PROVIDER) || "";
  const openai = openaiConfig(env);
  if (want === "vertex") return { kind: "vertex" };
  if (want === "openai" || openai.configured) {
    return { kind: "openai", config: { ...openai, model: (env && env.OPENAI_MODEL) || "gpt-6-astra" } };
  }
  return { kind: "vertex" };
}

async function aiFindPlan(payload, env, deps, request) {
  const image = readImage(payload && payload.image, "image");
  if (image.error) return json({ error: "invalid_request", message: image.error }, 400);

  const provider = locateProvider(env);
  if (provider.kind === "vertex") {
    const config = vertexConfig(env);
    if (!config.configured) return json({ error: "ai_not_configured", message: "鍵が設定されていません。" }, 503);
    if (!isJapanLocation(config.location)) {
      return json({ error: "ai_region_not_japan", message: `いまの設定: ${config.location}` }, 500);
    }
    provider.config = { ...config, model: (env && env.AI_LOCATE_MODEL) || "gemini-2.5-flash" };
  }

  const quota = await takeQuota(request, env, COST_LOCATE);
  if (!quota.ok) {
    return json({ error: "ai_quota_exceeded", scope: quota.scope, message: "本日ぶんの読み取りを使い切りました。明日またお試しください。" }, 429);
  }

  const common = {
    system: LOCATE_SYSTEM,
    text: LOCATE_PROMPT,
    image: { mimeType: image.mimeType, base64: image.base64 },
    // 位置が分かればよく、寸法の文字は読まない。考える必要も無い。
    maxOutputTokens: 512,
    fetchImpl: deps.fetchImpl,
  };
  const result = provider.kind === "openai"
    ? await openaiGenerate({ ...common, config: { ...provider.config, schema: toJsonSchema(LOCATE_SCHEMA) } })
    : await generate({ ...common, config: provider.config, responseSchema: LOCATE_SCHEMA, thinkingBudget: 0 });

  if (!result.ok) return json({ error: "ai_upstream_error", status: result.status, message: result.message }, 502);

  const parsed = extractJson(result.text);
  const box = normalizeBox(parsed);
  return json({ box: box.ok ? box : null, reason: box.ok ? "" : box.reason, usage: result.usage || null });
}

// ── 読み取ったあとの「仕上げ」 ───────────────────────────────────────
//
// 部屋の種別と、設備のモデルを決める。足りないものは種別から計算で出る。
//
// **回数を数えない。** ここが呼ぶのは Jev だけで、1回の判断が入力数百
// トークン、出力は無料。読み取り(¥40/ページ)とは桁が3つ違う。数の仕組みは
// 1つの Durable Object に集まるので、安い呼び出しまで通すと、そこが
// 高い呼び出しの待ち行列になる。
//
// 代わりに**1回で投げられる判断の数を抑える**(部屋40・設備24・候補8)。
// 認証が無い窓口なので、上限は要求の形のほうで持つ。
async function aiFinishPlan(payload, env, deps) {
  const rooms = Array.isArray(payload && payload.rooms) ? payload.rooms : [];
  const slots = Array.isArray(payload && payload.slots) ? payload.slots : [];
  if (!rooms.length && !slots.length) {
    return json({ error: "invalid_request", message: "rooms か slots が要る" }, 400);
  }
  if (rooms.length > MAX_ROOMS || slots.length > MAX_SLOTS) {
    return json({ error: "invalid_request", message: "1回に送れる数を超えている" }, 400);
  }

  const [named, picks] = await Promise.all([
    nameRooms(rooms, env, deps),
    pickModels(slots, env, deps),
  ]);

  // 足りないものは、種別が決まったあとで数える。
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const missing = missingByRoom(named.map((r) => ({
    id: r.id, type: r.type, kinds: (byId.get(r.id) || {}).kinds || [],
  })));

  return json({ rooms: named, picks, missing });
}

// ── 間取り図 → プランJSON ────────────────────────────────────────────
async function aiImportPlan(payload, env, deps, request) {
  // PDF はブラウザ側でページごとの画像にしてから送られてくる。
  // 1枚だけの古い形(image)も受ける。
  const raw = Array.isArray(payload && payload.images) && payload.images.length
    ? payload.images.slice(0, MAX_PAGES)
    : [payload && payload.image];
  const images = [];
  for (let i = 0; i < raw.length; i++) {
    const one = readImage(raw[i], raw.length > 1 ? `images[${i}]` : "image");
    if (one.error) return json({ error: "invalid_request", message: one.error }, 400);
    images.push(one);
  }

  const hint = String((payload && payload.hint) || "").slice(0, MAX_HINT_CHARS);

  // **数を引く前に、投げられる状態かを確かめる。**
  // 鍵が無い・リージョンが日本でない、といった断り方は AI を一度も呼ばない。
  // それで回数を減らすと、利用者は何もできないまま持ち分を失う（実測で、鍵を
  // 入れる前に試した1回が本番の回数を消費した）。
  const provider = resolveImportProvider(env);
  if (provider.error) return provider.error;

  // 使う前に数える。**送ってから断ると費用は戻らない。**
  const quota = await takeQuota(request, env, images.length * COST_IMPORT_PAGE);
  if (!quota.ok) {
    return json({
      error: "ai_quota_exceeded",
      scope: quota.scope,
      message: "本日ぶんの読み取りを使い切りました。明日またお試しください。",
    }, 429);
  }

  const asks = images.map((img, i) => ({
    system: SYSTEM_PROMPT,
    text: buildPlanPrompt({ hint: pageHint(hint, i, images.length) }),
    images: [{ mimeType: img.mimeType, base64: img.base64 }],
    fetchImpl: deps.fetchImpl,
  }));
  if (provider.kind === "openai") return startPlanJobs(provider, asks, env);

  const results = await Promise.all(asks.map((ask) => askForPlan(provider, ask)));
  const pages = collectPages(results);
  if (pages.error) return withNextStep(pages.error, env, deps, { images });
  return withNextStep(finishImportedPlan(
    pages.list.length === 1 ? pages.list[0] : { floors: mergeFloors(pages.list) },
    sumUsage(results),
    // 見直しのために、**モデルが答えたそのままの形**をページごとに返す。
    // アプリが組み立てたあとの形では、本人に自分の答えとして見せられない。
    { pages: pages.list, revise: await reviseAdvice(pages.list, env, deps) },
  ), env, deps, { images, pages: pages.list });
}

// ── 自分の答えを見直させる ───────────────────────────────────────────
//
// 読み取りの直後に、画面が「答えを平面図として描き直した絵」を作って送ってくる。
// 元の図面とその絵を並べて渡し、違うところを直させる。
//
// **失敗しても、読み取りの結果は画面側に残っている。** ここが落ちたときは
// 見直す前のものがそのまま使われる。見直しは上積みであって、必須の工程ではない。
async function aiRevisePlan(payload, env, deps, request) {
  const raw = Array.isArray(payload && payload.images) ? payload.images.slice(0, MAX_PAGES) : [];
  const renders = Array.isArray(payload && payload.renders) ? payload.renders.slice(0, MAX_PAGES) : [];
  const pagesIn = Array.isArray(payload && payload.pages) ? payload.pages.slice(0, MAX_PAGES) : [];
  if (!raw.length || raw.length !== renders.length || raw.length !== pagesIn.length) {
    return json({ error: "invalid_request", message: "images / renders / pages は同じ数だけ送ること" }, 400);
  }

  const pairs = [];
  for (let i = 0; i < raw.length; i++) {
    const original = readImage(raw[i], `images[${i}]`);
    if (original.error) return json({ error: "invalid_request", message: original.error }, 400);
    const drawn = readImage(renders[i], `renders[${i}]`);
    if (drawn.error) return json({ error: "invalid_request", message: drawn.error }, 400);
    if (!pagesIn[i] || typeof pagesIn[i] !== "object") {
      return json({ error: "invalid_request", message: `pages[${i}] が読み取り結果の形ではない` }, 400);
    }
    pairs.push({ original, drawn, page: pagesIn[i] });
  }

  const hint = String((payload && payload.hint) || "").slice(0, MAX_HINT_CHARS);

  const provider = resolveImportProvider(env);
  if (provider.error) return provider.error;

  const quota = await takeQuota(request, env, pairs.length * COST_REVISE_PAGE);
  if (!quota.ok) {
    return json({
      error: "ai_quota_exceeded",
      scope: quota.scope,
      message: "本日ぶんの読み取りを使い切りました。明日またお試しください。",
    }, 429);
  }

  const asks = pairs.map((pair, i) => ({
    system: REVISE_SYSTEM,
    text: buildRevisePrompt({
      json: JSON.stringify(pair.page),
      hint: pageHint(hint, i, pairs.length),
    }),
    // **手順も渡す。** 見直しは全体を作り直させるので、読み取りと同じ手順が要る。
    // 渡さずに作り直させたところ、室名から畳数を除くという手順7の決まりが
    // 破られた（「Living Dining Kitchen」→「LDK（13.7帖）」）。
    docs: [planKnowledge(), planSpec(), planProcedure()],
    // **元の図面が先、描き直した絵が後。** 指示文がこの順で呼んでいる。
    images: [
      { mimeType: pair.original.mimeType, base64: pair.original.base64 },
      { mimeType: pair.drawn.mimeType, base64: pair.drawn.base64 },
    ],
    fetchImpl: deps.fetchImpl,
  }));
  if (provider.kind === "openai") return startPlanJobs(provider, asks, env);

  const results = await Promise.all(asks.map((ask) => askForPlan(provider, ask)));
  const pages = collectPages(results);
  if (pages.error) return pages.error;
  return finishImportedPlan(
    pages.list.length === 1 ? pages.list[0] : { floors: mergeFloors(pages.list) },
    sumUsage(results),
    { pages: pages.list, revised: true },
  );
}

// 読み取りを投げる先を決めて、鍵とリージョンを検める。
// 読み取りと見直しで同じ手続きを二度書かないため、ここに1つだけ置く。
function resolveImportProvider(env) {
  const provider = importProvider(env);
  if (provider.kind !== "vertex") return provider;
  const config = vertexConfig(env);
  if (!config.configured) {
    return { error: json({
      error: "ai_not_configured",
      message: "AI の鍵がこの環境に設定されていません。"
        + " wrangler secret put OPENAI_API_KEY か GOOGLE_SERVICE_ACCOUNT_JSON で設定してください。",
    }, 503) };
  }
  // 日本国内ではないリージョンへ間取り図を送ってしまう事故を、ここで止める。
  // グローバル窓口はエラーにならず黙って国外へ出るので、送る前に弾く。
  if (!isJapanLocation(config.location)) {
    return { error: json({
      error: "ai_region_not_japan",
      message: `間取り図は個人情報を含みうるため、日本国内のリージョンでしか処理できません。いまの設定: ${config.location}`,
    }, 500) };
  }
  return { ...provider, config };
}

// 1回ぶんの問い合わせ。提供元による書き方の違いは、ここだけに閉じる。
function askForPlan(provider, { system, text, images, docs, fetchImpl }) {
  const common = { system, docs: docs || [planKnowledge(), planSpec()], text, images, fetchImpl };
  if (provider.kind === "openai") {
    return openaiGenerate({ ...common, config: { ...provider.config, schema: toJsonSchema(PLAN_RESPONSE_SCHEMA) } });
  }
  return generate({ ...common, config: provider.config, responseSchema: PLAN_RESPONSE_SCHEMA });
}

// **投げるだけ。答えは待たない。**
//
// Cloudflare Workers の無料プランは、1つのリクエストから出せる外向きの通信を
// 50回までに制限している。OpenAI は考えている間「まだです」を返すので、3秒
// おきに問い合わせると図面3枚で70回を超える（実測: 本番で HTTP 500）。
// 投げたら受付番号を返し、繰り返し見に行く役はブラウザに持たせる。
//
// Vertex は投げた同じ通信で答えが返るので、この形にする必要がない。
function startPlanJob(provider, { system, text, images, docs, fetchImpl }) {
  return startJob({
    config: { ...provider.config, schema: toJsonSchema(PLAN_RESPONSE_SCHEMA) },
    system, docs: docs || [planKnowledge(), planSpec()], text, images, fetchImpl,
  });
}

// まとめて投げて、受付番号を返す。1回の通信は「投げる」ぶんだけで済む。
async function startPlanJobs(provider, asks, env) {
  const started = await Promise.all(asks.map((ask) => startPlanJob(provider, ask)));
  const failed = started.find((r) => !r.ok);
  if (failed) return json({ error: "ai_upstream_error", status: failed.status, message: failed.message }, 502);
  const jobs = [];
  for (const one of started) jobs.push(await jobToken(one.id, env));
  return json({ jobs });
}

// 受付番号に署名を付ける。
//
// 番号だけで結果を引けると、番号を知った誰でも他人の間取りを取り出せる。
// 間取り図は個人情報を含みうるので、**こちらが出した番号であることを確かめて
// から**でないと渡さない。鍵は env の秘密から導く。外へは出ない。
async function signJob(id, env) {
  const secret = (env && (env.OPENAI_API_KEY || env.GOOGLE_SERVICE_ACCOUNT_JSON)) || "";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("plan-job:" + secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(id)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function jobToken(id, env) { return `${id}.${await signJob(id, env)}`; }

async function readJobToken(token, env) {
  const raw = String(token || "");
  const cut = raw.lastIndexOf(".");
  if (cut < 1) return null;
  const id = raw.slice(0, cut), sig = raw.slice(cut + 1);
  const want = await signJob(id, env);
  if (sig.length !== want.length) return null;
  let same = 0;
  for (let i = 0; i < want.length; i++) same |= sig.charCodeAt(i) ^ want.charCodeAt(i);
  return same === 0 ? id : null;
}

// ── 出来たかどうかを見に行く ─────────────────────────────────────────
//
// ブラウザが数秒おきに呼ぶ。**1回につき、受付番号の数だけしか通信しない。**
// まだなら pending を返す。全部そろったところで間取りに組み立てる。
//
// 回数はここでは数えない。投げるときに数え終えている。
async function aiPlanResult(payload, env, deps) {
  const tokens = Array.isArray(payload && payload.jobs) ? payload.jobs.slice(0, MAX_PAGES) : [];
  if (!tokens.length) return json({ error: "invalid_request", message: "jobs が無い" }, 400);

  const provider = resolveImportProvider(env);
  if (provider.error) return provider.error;
  if (provider.kind !== "openai") {
    return json({ error: "invalid_request", message: "この提供元は受付番号を使わない" }, 400);
  }

  const ids = [];
  for (const token of tokens) {
    const id = await readJobToken(token, env);
    if (!id) return json({ error: "invalid_request", message: "受付番号が正しくありません。" }, 400);
    ids.push(id);
  }

  const got = await Promise.all(ids.map((id) => fetchJob({ config: provider.config, id, fetchImpl: deps.fetchImpl })));
  const failed = got.find((g) => !g.ok);
  if (failed) return json({ error: "ai_upstream_error", status: failed.status, message: failed.message }, 502);

  const done = got.filter((g) => g.done).length;
  if (done < got.length) return json({ pending: true, done, total: got.length });

  const results = got.map((g) => readResult(g.data));
  const pages = collectPages(results);
  if (pages.error) return withNextStep(pages.error, env, deps, {});
  // 見直しの結果を組み立てているときは、もう一度見直すかを問わない。
  // 門は「読み取りの次に見直しを払うか」だけを決める。
  const revised = Boolean(payload && payload.revised);
  return withNextStep(finishImportedPlan(
    pages.list.length === 1 ? pages.list[0] : { floors: mergeFloors(pages.list) },
    sumUsage(results),
    {
      pages: pages.list,
      revised,
      ...(revised ? {} : { revise: await reviseAdvice(pages.list, env, deps) }),
    },
  ), env, deps, { pages: pages.list });
}

// 失敗した返事に、**次の一手**を1つ足す。
//
// これまでの文面は、エラーの種類と HTTP のステータスからの決め打ちだった。
// ai_bad_response はどんな原因でも「図面がはっきり写るように囲み直して
// ください」になる。実際の原因は、囲みが広すぎる・狭すぎる・そもそも平面図が
// 写っていない・画像が小さすぎる、と別物である。
//
// **ここで足すのは、こちらが用意した行動の名前だけ。** 画面に出る日本語は
// assets/js/plan-import.js が持っている。選べなければ何も足さず、これまでの
// 文面に戻る。
async function withNextStep(res, env, deps, context) {
  if (!res || res.status === 200) return res;
  let body;
  try { body = await res.clone().json(); } catch (e) { return res; }
  if (!body || typeof body !== "object" || !body.error) return res;
  const images = Array.isArray(context && context.images) ? context.images : [];
  const picked = await nextStep(failureFacts({
    error: body.error,
    pageCount: images.length || (Array.isArray(context && context.pages) ? context.pages.length : 0),
    imageBytes: images.map((im) => Math.round((im.base64 || "").length * 3 / 4)),
    mimeTypes: images.map((im) => im.mimeType),
    problems: body.problems,
    pages: context && context.pages,
  }), env, deps);
  if (!picked) return res;
  return json({ ...body, next: picked.step }, res.status);
}

// 返事の束を、ページごとのJSONにほどく。1つでも駄目なら全体を失敗にする。
function collectPages(results) {
  const failed = results.find((r) => !r.ok);
  if (failed) {
    return { error: json({ error: "ai_upstream_error", status: failed.status, message: failed.message }, 502) };
  }
  const list = [];
  for (const r of results) {
    const parsed = extractJson(r.text);
    if (!parsed) {
      return { error: json({ error: "ai_bad_response", message: "AI の返事から JSON を取り出せませんでした。" }, 502) };
    }
    list.push(parsed);
  }
  return { list };
}

// 使った枚数を数える。Durable Object が数の持ち主。
//
// 数える相手は接続元のIPアドレス。利用者の口座の仕組みがまだ無いため。
// 定額サブスクと使用回数制限を入れるときは、ここを口座ごとに替える。
async function takeQuota(request, env, count, peek) {
  if (!env || !env.AI_QUOTA) return { ok: true, scope: "none", limit: 0, remaining: 0 };
  const who = (request && request.headers.get("cf-connecting-ip")) || "unknown";
  const limits = quotaLimits(env);
  const id = env.AI_QUOTA.idFromName("ai-usage");
  const url = `https://ai-quota/take?cost=${count}&who=${encodeURIComponent(who)}`
    + `&perDay=${limits.points.perUser}&totalPerDay=${limits.points.total}`
    + (peek ? "&peek=1" : "");
  // **数の仕組みが止まっても、機能まで止めない。**
  // 数は1つの Durable Object に集まるので、そこが詰まると全員が待たされる。
  // 実測で、詰まったときに要求がハンドラまで届かず40秒返らないことがあった。
  // 待つのは短くし、返ってこなければ通す。
  const pass = { ok: true, scope: "error", limit: 0, remaining: 0 };
  try {
    const res = await Promise.race([
      env.AI_QUOTA.get(id).fetch(url),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (!res) return pass;
    return await res.json();
  } catch (e) {
    return pass;
  }
}

// ページごとの補足。何ページ目かを伝えると、階の取り違えが減る。
function pageHint(hint, index, total) {
  if (total <= 1) return hint;
  const page = `この画像はPDFの${index + 1}ページ目です（全${total}ページ）。`;
  return hint ? `${page}\n${hint}` : page;
}

// ページごとの読み取りを、1つの家にまとめる。
//
// 見出し(「2階平面図」など)から階を判断させているが、書かれていない図面も
// ある。同じ階が2つ来たら、ページの並び順を正とする。
function mergeFloors(pages) {
  const out = [];
  const used = new Set();
  pages.forEach((page, i) => {
    const floors = Array.isArray(page && page.floors) ? page.floors : [];
    for (const f of floors) {
      if (!f || typeof f !== "object") continue;
      let floor = Number(f.floor);
      if (!Number.isFinite(floor) || floor < 1 || used.has(floor)) floor = i + 1;
      used.add(floor);
      out.push({ ...f, floor });
    }
  });
  return out;
}

function sumUsage(results) {
  const keys = ["inputTokens", "answerTokens", "thoughtTokens", "outputTokens", "totalTokens"];
  const out = { calls: results.length };
  for (const k of keys) {
    out[k] = results.reduce((n, r) => n + Number((r.usage && r.usage[k]) || 0), 0);
  }
  return out;
}

// モデルの出力から、渡してよい間取りを作る。
//
// ここだけは純粋な関数にしてあるので、モデルを呼ばずに検査できる。
export function finishImportedPlan(parsed, usage, extra) {
  const plan = decodeCompactPlan(parsed);
  // 壁はAIに出させず、**部屋と部屋の境目から作る**。
  // 壁の端点を独立に答えさせると、位置は通り芯に載るのに伸ばし方が違う、
  // という失敗が残った(実測で13本中12本は通り芯にぴったり載っていた)。
  // 壁の端点は、その壁が仕切っている部屋から決まるものだからである。
  if (plan.floors.length) {
    const built = PlanGrid.buildFloors(plan.floors);
    plan.walls = built.walls;
    plan.rooms = built.rooms;
    for (const m of built.problems) plan.notes.push(m);
  } else if (plan.walls.length) {
    // 古い形で壁が直に返ってきた場合だけ、壁と文字から部屋を計算する。
    const floors = [...new Set(plan.walls.map((w) => w.floor || 1))];
    plan.rooms = floors.flatMap((f) => PlanRooms.roomsFromWalls(plan.walls, plan.labels, { floor: f }));
  }
  const checked = planProblems(plan);
  if (!checked.ok) {
    return json({
      error: "ai_invalid_plan",
      message: "AI が返した間取りが読み込める形ではありません。",
      problems: checked.errors.slice(0, 20),
    }, 422);
  }
  const normalized = PlanSchema.normalizePlan(plan);
  return json({
    plan: normalized,
    summary: PlanSchema.summarize(normalized),
    warnings: checked.warnings,
    // モデルが「読めなかった」と言っていることは、そのまま利用者に見せる。
    notes: plan.notes.slice(0, 20),
    usage: usage || null,
    ...(extra || {}),
  });
}

// ── 3Dの画像 → 写実的な画像 (未実装) ──────────────────────────────────
async function aiRender(payload, env) {
  const image = readImage(payload && payload.image, "image");
  if (image.error) return json({ error: "invalid_request", message: image.error }, 400);
  const prompt = String((payload && payload.prompt) || "");
  if (!prompt.trim()) return json({ error: "invalid_request", message: "prompt が無い" }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: "invalid_request", message: `prompt が長すぎる(上限 ${MAX_PROMPT_CHARS} 文字)` }, 400);
  }
  if (!(env && env.OPENAI_API_KEY)) {
    return json({
      error: "ai_not_configured",
      message: "OpenAI の鍵がこの環境に設定されていません。wrangler secret put OPENAI_API_KEY で設定してください。",
    }, 503);
  }
  return json({
    error: "ai_not_implemented",
    message: "画像レンダーの呼び出しはまだ実装されていません。",
  }, 501);
}
