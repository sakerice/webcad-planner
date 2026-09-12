// 共有ルームの HTTP ルート。worker.mjs の fetch から中身を移した。
//
// /api/rooms            POST   間取りを預けてルームを作る
// /api/rooms/:id        GET    いまの間取りを取る
// /api/rooms/:id/socket GET    WebSocket をつなぐ
// /api/rooms/:id/update POST   差分を送る
// /api/rooms/:id/save   POST   手動保存
//
// ルームの実体は Durable Object (worker/collab-room.mjs) なので、ここは
// ルームIDを検め、正しい Durable Object へ渡すところまでを受け持つ。
import {
  ROOM_ID_RE, RETENTION_MS, MAX_PLAN_BYTES,
  json, roomKey, randomRoomId, validPlan, encodedSize, readJsonWithLimit,
} from "./shared.mjs";

// この worker が扱うパスかどうか。router はこれを見て振り分ける。
export function handlesRooms(pathname) {
  return pathname === "/api/rooms" || pathname.startsWith("/api/rooms/");
}

export async function handleRooms(request, env, url) {
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    return createRoom(request, env);
  }

  const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(\/socket|\/update|\/save)?$/);
  if (!match || !ROOM_ID_RE.test(match[1])) return json({ error: "not_found" }, 404);
  const roomId = match[1];
  const action = match[2] || "/plan";
  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
  const forwarded = new URL(request.url);
  forwarded.hostname = "room";
  forwarded.pathname = action;
  return stub.fetch(new Request(forwarded, request));
}

async function createRoom(request, env) {
  let plan;
  try { plan = await readJsonWithLimit(request, MAX_PLAN_BYTES); } catch (response) { return response; }
  if (!validPlan(plan)) return json({ error: "invalid_plan" }, 400);
  const encoded = JSON.stringify(plan);
  if (encodedSize(encoded) > MAX_PLAN_BYTES) return json({ error: "plan_too_large" }, 413);
  const roomId = randomRoomId();
  const now = Date.now();
  const expiresAt = now + RETENTION_MS;
  await env.PLANS.put(roomKey(roomId), encoded, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { updatedAt: String(now), expiresAt: String(expiresAt), version: "1" },
  });
  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
  await stub.fetch(new Request("https://room/initialize", {
    method: "POST",
    body: JSON.stringify({ roomId, version: 1, updatedAt: now, expiresAt, savedAt: now, dirtySince: null, checkpointDueAt: null }),
  }));
  const shareUrl = new URL(request.url);
  shareUrl.pathname = "/";
  shareUrl.search = "";
  shareUrl.hash = `room=${roomId}`;
  return json({ roomId, url: shareUrl.toString(), version: 1, expiresAt, savedAt: now }, 201);
}
