// AI を呼ぶルート。
//
// なぜ Worker 側に置くのか
// ------------------------
// AI の API キーをブラウザへ出すわけにいかない。index.html は誰でも読めるし、
// 通信も開発者ツールで丸見えなので、キーを持てるのはサーバ側だけになる。
// wrangler secret で env に入れ、この層から先へは出さない。
//
// いまどこまでできているか
// ------------------------
// 入口の検査・大きさの上限・設定の有無の判定・取り込んだ間取りの検査までを
// 実装してある。**実際にモデルを呼ぶ callModel だけが未実装**で、
// どのモデルを使うか決まっていないため、呼ばれると ai_not_implemented を返す。
// 使うモデルが決まったら、触るのは callModel 1か所で済む。
//
//   POST /api/ai/render       3Dの画像と指示文 → レンダリングした画像
//   POST /api/ai/import-plan  間取り図の画像   → プランJSON
import { json, readJsonWithLimit, planProblems, PlanSchema } from "./shared.mjs";

// 画像は data URL で受け取る。10MB は 3D ビューの PNG に十分な大きさ。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_CHARS = 8000;
const MAX_AI_REQUEST_BYTES = MAX_IMAGE_BYTES + 256 * 1024;

export function handlesAi(pathname) {
  return pathname.startsWith("/api/ai/");
}

// キーの置き場所を1か所にまとめる。ここ以外で env のキーを読まない。
function aiConfig(env) {
  const key = env && (env.AI_API_KEY || "");
  return {
    configured: !!key,
    key,
    provider: (env && env.AI_PROVIDER) || "",
    model: (env && env.AI_MODEL) || "",
  };
}

export async function handleAi(request, env, url) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const config = aiConfig(env);
  if (!config.configured) {
    // 鍵が無いこと自体は異常ではない(手元で動かしているときなど)。
    // 利用者に何をすればよいか分かる形で返す。
    return json({
      error: "ai_not_configured",
      message: "AI の鍵がこの環境に設定されていません。wrangler secret put AI_API_KEY で設定してください。",
    }, 503);
  }

  let payload;
  try { payload = await readJsonWithLimit(request, MAX_AI_REQUEST_BYTES); } catch (response) { return response; }

  if (url.pathname === "/api/ai/render") return aiRender(payload, config);
  if (url.pathname === "/api/ai/import-plan") return aiImportPlan(payload, config);
  return json({ error: "not_found" }, 404);
}

// data URL を検める。画像以外や、上限を超えるものはここで落とす。
function checkImage(value, field) {
  if (typeof value !== "string" || !value) return `${field} が無い`;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) return `${field} は data:image/png|jpeg|webp;base64, の形で送ること`;
  // base64 は元の 4/3 倍。概算で足りる。
  if (m[2].length * 3 / 4 > MAX_IMAGE_BYTES) return `${field} が大きすぎる(上限 ${MAX_IMAGE_BYTES} バイト)`;
  return null;
}

async function aiRender(payload, config) {
  const bad = checkImage(payload && payload.image, "image");
  if (bad) return json({ error: "invalid_request", message: bad }, 400);
  const prompt = String((payload && payload.prompt) || "");
  if (!prompt.trim()) return json({ error: "invalid_request", message: "prompt が無い" }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: "invalid_request", message: `prompt が長すぎる(上限 ${MAX_PROMPT_CHARS} 文字)` }, 400);
  }
  return callModel(config, { task: "render", image: payload.image, prompt });
}

async function aiImportPlan(payload, config) {
  const bad = checkImage(payload && payload.image, "image");
  if (bad) return json({ error: "invalid_request", message: bad }, 400);

  const result = await callModel(config, { task: "import-plan", image: payload.image, prompt: payload && payload.prompt });
  if (!(result instanceof Response) || !result.ok) return result;

  // モデルが返した間取りは、**必ず**検査を通してから返す。
  // 出所が信用できないものを、そのままブラウザの DATA に入れさせない。
  let body;
  try { body = await result.json(); } catch { return json({ error: "ai_bad_response" }, 502); }
  return finishImportedPlan(body && body.plan);
}

// モデルの出力から、渡してよい間取りを作る。ここだけは純粋な関数にしてある
// ので、モデルを呼ばずに検査できる。
export function finishImportedPlan(plan) {
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
  });
}

// ── ここから先が未実装 ──────────────────────────────────────────────
//
// 使うモデルが決まったら、この関数だけを実装する。呼び出し元は task で
// 何をさせたいかを渡してくるので、ここでモデルごとの形へ変換する。
// 返すのは Response。render は {image}、import-plan は {plan} を持つ JSON。
async function callModel(config, task) {
  return json({
    error: "ai_not_implemented",
    message: `AI の呼び出しがまだ実装されていません(provider=${config.provider || "未設定"}, task=${task.task})。`,
  }, 501);
}
