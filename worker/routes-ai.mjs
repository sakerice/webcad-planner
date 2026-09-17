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
import { vertexConfig, generate, extractJson, isJapanLocation } from "./vertex.mjs";
import { SYSTEM_PROMPT, buildPlanPrompt, decodeCompactPlan } from "./plan-prompt.mjs";
import { PLAN_RESPONSE_SCHEMA } from "./plan-response-schema.mjs";
import { planSpec } from "./plan-spec.mjs";
import { planKnowledge } from "./plan-knowledge.mjs";

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

// ── 間取り図 → プランJSON ────────────────────────────────────────────
async function aiImportPlan(payload, env, deps) {
  const image = readImage(payload && payload.image, "image");
  if (image.error) return json({ error: "invalid_request", message: image.error }, 400);

  const hint = String((payload && payload.hint) || "").slice(0, MAX_HINT_CHARS);

  const config = vertexConfig(env);
  if (!config.configured) {
    return json({
      error: "ai_not_configured",
      message: "Google の鍵がこの環境に設定されていません。wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON で設定してください。",
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

  const result = await generate({
    config,
    system: SYSTEM_PROMPT,
    docs: [planKnowledge(), planSpec()],
    text: buildPlanPrompt({ hint }),
    image: { mimeType: image.mimeType, base64: image.base64 },
    responseSchema: PLAN_RESPONSE_SCHEMA,
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
  const plan = decodeCompactPlan(parsed);
  // 部屋はAIに出させず、**壁と文字から計算する**。
  // 両方出させると食い違い、同じ図面で部屋が3〜9個に変動した。壁から
  // 作れば、壁と部屋は必ず一致する。寸法の読み違いもここで吸収する
  // (実測で 227.5→275、455→450 の読み違いを確認している)。
  const labels = plan.labels;
  const floors = [...new Set(plan.walls.map((w) => w.floor || 1))];
  plan.rooms = floors.flatMap((f) => PlanRooms.roomsFromWalls(plan.walls, labels, { floor: f }));
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
