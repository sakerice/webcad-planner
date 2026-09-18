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
import { openaiConfig, generate as openaiGenerate, toJsonSchema } from "./openai.mjs";
import { SYSTEM_PROMPT, buildPlanPrompt, decodeCompactPlan } from "./plan-prompt.mjs";
import { PLAN_RESPONSE_SCHEMA } from "./plan-response-schema.mjs";
import { planSpec } from "./plan-spec.mjs";
import { planKnowledge } from "./plan-knowledge.mjs";
import { LOCATE_SYSTEM, LOCATE_PROMPT, LOCATE_SCHEMA, normalizeBox } from "./plan-locate.mjs";

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
// 「1回の取り込み」の目安。3ページのPDFで 3×(1+10) = 33点。
// 上限は**回数で**設定する（点は内部の数え方で、設定する人が意識するものではない）。
const POINTS_PER_IMPORT = 33;
const DEFAULT_IMPORTS_TOTAL = 10;    // 全体。1日およそ ¥1,200
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

  if (url.pathname === "/api/ai/import-plan") return aiImportPlan(payload, env, deps, request);
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

  // 使う前に数える。**送ってから断ると費用は戻らない。**
  const quota = await takeQuota(request, env, images.length * COST_IMPORT_PAGE);
  if (!quota.ok) {
    return json({
      error: "ai_quota_exceeded",
      scope: quota.scope,
      message: "本日ぶんの読み取りを使い切りました。明日またお試しください。",
    }, 429);
  }

  const provider = importProvider(env);
  if (provider.kind === "vertex") {
    const config = vertexConfig(env);
    if (!config.configured) {
      return json({
        error: "ai_not_configured",
        message: "AI の鍵がこの環境に設定されていません。"
          + " wrangler secret put OPENAI_API_KEY か GOOGLE_SERVICE_ACCOUNT_JSON で設定してください。",
      }, 503);
    }
    // 日本国内ではないリージョンへ間取り図を送ってしまう事故を、ここで止める。
    // グローバル窓口はエラーにならず黙って国外へ出るので、送る前に弾く。
    if (!isJapanLocation(config.location)) {
      return json({
        error: "ai_region_not_japan",
        message: `間取り図は個人情報を含みうるため、日本国内のリージョンでしか処理できません。いまの設定: ${config.location}`,
      }, 500);
    }
    provider.config = config;
  }

  const calls = images.map((img, i) => {
    const common = {
      system: SYSTEM_PROMPT,
      docs: [planKnowledge(), planSpec()],
      text: buildPlanPrompt({ hint: pageHint(hint, i, images.length) }),
      image: { mimeType: img.mimeType, base64: img.base64 },
      fetchImpl: deps.fetchImpl,
    };
    if (provider.kind === "openai") {
      return openaiGenerate({
        ...common,
        config: { ...provider.config, schema: toJsonSchema(PLAN_RESPONSE_SCHEMA) },
      });
    }
    return generate({ ...common, config: provider.config, responseSchema: PLAN_RESPONSE_SCHEMA });
  });
  const results = await Promise.all(calls);

  const failed = results.find((r) => !r.ok);
  if (failed) {
    return json({ error: "ai_upstream_error", status: failed.status, message: failed.message }, 502);
  }

  const pages = [];
  for (const r of results) {
    const parsed = extractJson(r.text);
    if (!parsed) {
      return json({ error: "ai_bad_response", message: "AI の返事から JSON を取り出せませんでした。" }, 502);
    }
    pages.push(parsed);
  }
  return finishImportedPlan(pages.length === 1 ? pages[0] : { floors: mergeFloors(pages) }, sumUsage(results));
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
export function finishImportedPlan(parsed, usage) {
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
