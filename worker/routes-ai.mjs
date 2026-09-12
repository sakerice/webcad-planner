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
//   POST /api/ai/import-plan  間取り図 → プランJSON  … Amazon Bedrock (東京・大阪)
//   POST /api/ai/render       3Dの画像 → 写実的な画像 … OpenAI (未実装)
//
// 間取り図には施主名・敷地住所が入りうるので、処理を日本国内に閉じられる
// Bedrock を使う。一方レンダーの入力は利用者自身が作った家の3D画像で個人情報を
// 含まないうえ、Bedrock 東京の画像生成モデルは 2026-09-30 に無くなるため、
// そちらは国外のサービスになる。
import { json, readJsonWithLimit, planProblems, PlanSchema } from "./shared.mjs";
import { bedrockConfig, converse, extractJson, isJapanResident } from "./bedrock.mjs";
import { SYSTEM_PROMPT, buildPlanPrompt } from "./plan-prompt.mjs";

// 画像は data URL で受け取る。10MB は間取り図の写真に十分な大きさ。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_CHARS = 8000;
const MAX_HINT_CHARS = 500;
const MAX_AI_REQUEST_BYTES = MAX_IMAGE_BYTES + 256 * 1024;

export function handlesAi(pathname) {
  return pathname.startsWith("/api/ai/");
}

export async function handleAi(request, env, url, deps = {}) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload;
  try { payload = await readJsonWithLimit(request, MAX_AI_REQUEST_BYTES); } catch (response) { return response; }

  if (url.pathname === "/api/ai/import-plan") return aiImportPlan(payload, env, deps);
  if (url.pathname === "/api/ai/render") return aiRender(payload, env, deps);
  return json({ error: "not_found" }, 404);
}

// data URL を検める。画像以外や、上限を超えるものはここで落とす。
function readImage(value, field) {
  if (typeof value !== "string" || !value) return { error: `${field} が無い` };
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) return { error: `${field} は data:image/png|jpeg|webp;base64, の形で送ること` };
  if (m[2].length * 3 / 4 > MAX_IMAGE_BYTES) return { error: `${field} が大きすぎる(上限 ${MAX_IMAGE_BYTES} バイト)` };
  return { format: m[1] === "jpeg" ? "jpeg" : m[1], base64: m[2] };
}

// ── 間取り図 → プランJSON ────────────────────────────────────────────
async function aiImportPlan(payload, env, deps) {
  const image = readImage(payload && payload.image, "image");
  if (image.error) return json({ error: "invalid_request", message: image.error }, 400);

  const hint = String((payload && payload.hint) || "").slice(0, MAX_HINT_CHARS);

  const config = bedrockConfig(env);
  if (!config.configured) {
    return json({
      error: "ai_not_configured",
      message: "AWS の鍵がこの環境に設定されていません。wrangler secret put AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY で設定してください。",
    }, 503);
  }
  // 国内に閉じない設定で間取り図を送ってしまう事故を、ここで止める。
  // 送ってしまってから気づいても取り返しがつかない。
  if (!isJapanResident(config.model) && env.ALLOW_NON_JP_PLAN_MODEL !== "1") {
    return json({
      error: "ai_model_not_japan_resident",
      message: `間取り図は個人情報を含みうるため、日本国内で処理するモデル(jp. で始まるID)しか使えません。いまの設定: ${config.model}`,
    }, 500);
  }

  const result = await converse({
    config,
    system: SYSTEM_PROMPT,
    text: buildPlanPrompt({ hint }),
    image: { format: image.format, base64: image.base64 },
    fetchImpl: deps.fetchImpl,
  });
  if (!result.ok) {
    return json({ error: "ai_upstream_error", status: result.status, message: result.message }, 502);
  }

  const parsed = extractJson(result.text);
  if (!parsed) {
    return json({ error: "ai_bad_response", message: "AI の返事から JSON を取り出せませんでした。" }, 502);
  }
  return finishImportedPlan(parsed, result.usage);
}

// モデルの出力から、渡してよい間取りを作る。
//
// ここだけは純粋な関数にしてあるので、モデルを呼ばずに検査できる。
export function finishImportedPlan(parsed, usage) {
  const plan = {
    walls: Array.isArray(parsed.walls) ? parsed.walls : [],
    rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
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
    notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 20).map(String) : [],
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
