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
//
// 外の AI(/mcp)から使う関数もここに置く(段5)。HTTP の経路としては外へ出さない。
//   createRoomWithPlan(env, plan, origin)  POST /api/rooms と同じ置き方でルームを作る
//   roomOp(env, roomId, op, args)          ルームの中の /op を呼ぶ(操作を1つ当てて全員へ流す)
//   roomRead(env, roomId, what)            ルームの中の /read を呼ぶ(要約か検査)
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
  const made = await createRoomWithPlan(env, plan, request.url);
  if (made.error) return json({ error: made.error }, made.status);
  return json(made, 201);
}

// 間取りを R2 に置き、ルームの Durable Object を初期化する。POST /api/rooms の中身(返事・状態・R2 への置き方は同じ)。
// origin は共有の URL の土台(オリジン。パスや問い合わせが付いていても / にする)。
// 戻り値: 成功 {roomId, url, version:1, expiresAt, savedAt}。失敗 {error:"invalid_plan", status:400} か {error:"plan_too_large", status:413}。
export async function createRoomWithPlan(env, plan, origin) {
  if (!validPlan(plan)) return { error: "invalid_plan", status: 400 };
  const encoded = JSON.stringify(plan);
  if (encodedSize(encoded) > MAX_PLAN_BYTES) return { error: "plan_too_large", status: 413 };
  // 共有の URL の土台を先に組み立てる。origin が URL として読めないときは、R2 に置く前にここで例外になる
  // (置いたあとで落ちると、誰も開けないルームの中身が R2 に残るため)。
  const shareUrl = new URL(origin);
  shareUrl.pathname = "/";
  shareUrl.search = "";
  const roomId = randomRoomId();
  shareUrl.hash = `room=${roomId}`;
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
  return { roomId, url: shareUrl.toString(), version: 1, expiresAt, savedAt: now };
}

// ルームの中の経路を呼ぶ。id の形(22 文字)が違えば Durable Object を引かずに room_not_found。
// ルームの中で例外が出た・返事が JSON でない・ルームの返事の形でない、ときは例外を外へ出さず、ROOM_UNAVAILABLE を返す。
// ルームの返事の形: {ok:true, …}、{ok:false, code:"room_not_found"}(404)、{ok:false, errors:[…]}(本文が読めないときは 400)。
export const ROOM_UNAVAILABLE_MESSAGE = "いまは操作できませんでした。少し待ってからもう一度お試しください。";
function roomUnavailable() {
  return { ok: false, errors: [{ message: ROOM_UNAVAILABLE_MESSAGE }] };
}
function isRoomReply(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.ok !== "boolean") return false;
  if (body.ok) return true;
  return body.code === "room_not_found" || (Array.isArray(body.errors) && body.errors.length > 0);
}
async function callRoom(env, roomId, path, body) {
  if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return { ok: false, code: "room_not_found" };
  try {
    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
    const res = await stub.fetch(new Request(`https://room${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    let reply;
    try { reply = await res.json(); } catch { return roomUnavailable(); }
    if (!isRoomReply(reply)) return roomUnavailable();
    // 成功の形で返ってきても、状態が成功でなければ信用しない。失敗の形(無いルーム・本文の誤り)は状態に関わらずそのまま返す。
    if (reply.ok && !res.ok) return roomUnavailable();
    return reply;
  } catch {
    return roomUnavailable();
  }
}

// 操作を1つ当てる。戻り値はルームの /op の返事そのまま:
//   {ok:true, version, changedIds, removedIds, warnings} / {ok:false, errors:[{message, candidates?}]} / {ok:false, code:"room_not_found"}
export function roomOp(env, roomId, op, args) {
  return callRoom(env, roomId, "/op", { op, args });
}

// 今のプランを読む。what は "summary" か "inspect"。戻り値はルームの /read の返事そのまま:
//   {ok:true, version, summary} / {ok:true, version, inspect:{ok, errors, warnings}} / {ok:false, errors:[{message}]} / {ok:false, code:"room_not_found"}
export function roomRead(env, roomId, what) {
  return callRoom(env, roomId, "/read", { what });
}
