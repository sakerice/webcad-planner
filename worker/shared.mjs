// Worker の各ルートが共通で使うもの。
//
// もとは worker.mjs 1枚に、共通の道具・共有編集ルーム・HTTPの振り分けが
// 同居していた。AIの呼び出しを足すにあたって、鍵を扱う場所と間取りを扱う
// 場所を混ぜたくないので分けた。
import PlanSchema from "../assets/js/plan-schema.js";

export const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
export const AUTO_SAVE_IDLE_MS = 10 * 1000;
export const AUTO_SAVE_MAX_MS = 30 * 1000;
export const MAX_PLAN_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_PLAN_BYTES + 128 * 1024;
export const MAX_JOURNAL_ENTRY_BYTES = 1_500_000;
export const COLLECTIONS = ["walls", "items", "rooms"];

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export function roomKey(roomId) {
  return `rooms/${roomId}.json`;
}

export function patchKey(version) {
  return `patch:${String(version).padStart(12, "0")}`;
}

export function randomRoomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 共有ルームに置いてよい間取りか（**既存の共有の門番。ゆるいまま**）。
//
// 中身までは見ない。ここを assets/js/plan-schema.js の検査に差し替えると、
// 既に手元にある間取りのうち、長さゼロの壁が1本混ざっているようなものが
// 共有できなくなる。それは整理ではなく仕様の変更なので、ここは触らない。
export function validPlan(plan) {
  return plan && typeof plan === "object" && Array.isArray(plan.walls) &&
    Array.isArray(plan.items) && Array.isArray(plan.rooms);
}

// 何がどう駄目なのかまで見る検査。**これから作る経路（AIに起こさせた
// 間取りの取り込みなど、出所が信用できないもの）のための門番**で、
// 既存の共有には掛けない。ブラウザ側の取り込みと同じ物差しになる。
export function planProblems(plan) {
  return PlanSchema.validatePlan(plan);
}

export { PlanSchema };

export function encodedSize(value) {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
}

export async function readJsonWithLimit(request, maxBytes = MAX_REQUEST_BYTES) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Response("Plan is too large", { status: 413 });
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Response("Plan is too large", { status: 413 });
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new Response("Invalid JSON", { status: 400 });
  }
}

export function applyPatch(plan, patch) {
  for (const name of COLLECTIONS) {
    if (!Array.isArray(plan[name])) plan[name] = [];
    const change = patch.collections && patch.collections[name];
    if (!change) continue;
    const removed = new Set((change.removes || []).map(String));
    const upserts = new Map((change.upserts || []).filter(Boolean).map((item) => [String(item.id), item]));
    plan[name] = plan[name]
      .filter((item) => !removed.has(String(item && item.id)))
      .map((item) => upserts.has(String(item && item.id)) ? upserts.get(String(item.id)) : item);
    const present = new Set(plan[name].map((item) => String(item && item.id)));
    for (const [id, item] of upserts) {
      if (!present.has(id)) plan[name].push(item);
    }
  }
  if (patch.fields && typeof patch.fields === "object") {
    for (const [key, value] of Object.entries(patch.fields)) {
      if (!COLLECTIONS.includes(key) && key !== "viewState") plan[key] = value;
    }
  }
  return plan;
}
