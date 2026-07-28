const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const AUTO_SAVE_IDLE_MS = 10 * 1000;
const AUTO_SAVE_MAX_MS = 30 * 1000;
const MAX_PLAN_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PLAN_BYTES + 128 * 1024;
const MAX_JOURNAL_ENTRY_BYTES = 1_500_000;
const COLLECTIONS = ["walls", "items", "rooms"];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function roomKey(roomId) {
  return `rooms/${roomId}.json`;
}

function patchKey(version) {
  return `patch:${String(version).padStart(12, "0")}`;
}

function randomRoomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function validPlan(plan) {
  return plan && typeof plan === "object" && Array.isArray(plan.walls) &&
    Array.isArray(plan.items) && Array.isArray(plan.rooms);
}

function encodedSize(value) {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
}

async function readJsonWithLimit(request, maxBytes = MAX_REQUEST_BYTES) {
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

function applyPatch(plan, patch) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (request.method === "POST" && url.pathname === "/api/rooms") {
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

    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(\/socket|\/update|\/save)?$/);
    if (!match || !ROOM_ID_RE.test(match[1])) return json({ error: "not_found" }, 404);
    const roomId = match[1];
    const action = match[2] || "/plan";
    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
    const forwarded = new URL(request.url);
    forwarded.hostname = "room";
    forwarded.pathname = action;
    return stub.fetch(new Request(forwarded, request));
  },
};

export class CollaborationRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  enqueue(task) {
    const pending = this.queue.then(task);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  async getMeta() {
    return await this.state.storage.get("meta") || null;
  }

  async setNextAlarm(meta) {
    const times = [Number(meta.expiresAt || 0), Number(meta.checkpointDueAt || 0)].filter((value) => value > 0);
    if (times.length) await this.state.storage.setAlarm(Math.min(...times));
  }

  async listJournal() {
    return await this.state.storage.list({ prefix: "patch:" });
  }

  async clearJournal(entries) {
    const keys = Array.from(entries.keys());
    for (const key of keys) await this.state.storage.delete(key);
  }

  async readSnapshot(meta) {
    const object = await this.env.PLANS.get(roomKey(meta.roomId));
    if (!object) return null;
    try { return JSON.parse(await object.text()); } catch { return null; }
  }

  async materializePlan(meta, extraPatch = null) {
    const plan = await this.readSnapshot(meta);
    if (!plan) return null;
    const entries = await this.listJournal();
    for (const patch of entries.values()) applyPatch(plan, patch);
    if (extraPatch) applyPatch(plan, extraPatch);
    return { plan, entries };
  }

  async writeSnapshot(plan, meta) {
    const encoded = JSON.stringify(plan);
    if (encodedSize(encoded) > MAX_PLAN_BYTES) throw new Error("plan_too_large");
    await this.env.PLANS.put(roomKey(meta.roomId), encoded, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        updatedAt: String(meta.updatedAt),
        expiresAt: String(meta.expiresAt),
        version: String(meta.version),
      },
    });
  }

  async checkpoint(meta, extraPatch = null, broadcast = true) {
    const materialized = await this.materializePlan(meta, extraPatch);
    if (!materialized) return null;
    const savedAt = Date.now();
    const next = { ...meta, savedAt, dirtySince: null, checkpointDueAt: null };
    await this.writeSnapshot(materialized.plan, next);
    await this.clearJournal(materialized.entries);
    await this.state.storage.put("meta", next);
    await this.setNextAlarm(next);
    if (broadcast) this.broadcast({ type: "checkpoint", version: next.version, savedAt, expiresAt: next.expiresAt });
    return next;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/initialize" && request.method === "POST") {
      const meta = await request.json();
      await this.state.storage.put("meta", meta);
      await this.setNextAlarm(meta);
      return json({ ok: true });
    }
    if (url.pathname === "/socket") return this.openSocket(request, url);
    if (url.pathname === "/plan" && request.method === "GET") return this.enqueue(() => this.getPlan());
    if (url.pathname === "/update" && request.method === "POST") return this.enqueue(() => this.update(request));
    if (url.pathname === "/save" && request.method === "POST") return this.enqueue(() => this.manualSave(request));
    return json({ error: "not_found" }, 404);
  }

  async getPlan() {
    const meta = await this.getMeta();
    if (!meta) return json({ error: "not_found" }, 404);
    if (meta.expiresAt <= Date.now()) {
      await this.expire(meta);
      return json({ error: "expired" }, 410);
    }
    const materialized = await this.materializePlan(meta);
    if (!materialized) return json({ error: "not_found" }, 404);
    return new Response(JSON.stringify(materialized.plan), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-room-version": String(meta.version),
        "x-room-expires-at": String(meta.expiresAt),
        "x-room-saved-at": String(meta.savedAt || meta.updatedAt || 0),
      },
    });
  }

  async openSocket(request, url) {
    if (request.headers.get("upgrade") !== "websocket") return json({ error: "upgrade_required" }, 426);
    const meta = await this.getMeta();
    if (!meta || meta.expiresAt <= Date.now()) return json({ error: "expired" }, 410);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const clientId = (url.searchParams.get("client") || "").slice(0, 64);
    const name = (url.searchParams.get("name") || "ゲスト").slice(0, 32);
    server.serializeAttachment({ clientId, name });
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({
      type: "welcome",
      version: meta.version,
      expiresAt: meta.expiresAt,
      savedAt: meta.savedAt || meta.updatedAt || 0,
      checkpointPending: !!meta.checkpointDueAt,
    }));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async update(request) {
    const meta = await this.getMeta();
    if (!meta || meta.expiresAt <= Date.now()) return json({ error: "expired" }, 410);
    let payload;
    try { payload = await readJsonWithLimit(request); } catch (response) { return response; }
    if (!payload || payload.type !== "patch" || !payload.patch) return json({ error: "invalid_patch" }, 400);
    const now = Date.now();
    const version = Number(meta.version || 0) + 1;
    const dirtySince = Number(meta.dirtySince || now);
    let next = {
      ...meta,
      version,
      updatedAt: now,
      expiresAt: now + RETENTION_MS,
      dirtySince,
      checkpointDueAt: Math.min(now + AUTO_SAVE_IDLE_MS, dirtySince + AUTO_SAVE_MAX_MS),
    };
    const patchBytes = encodedSize(payload.patch);
    if (patchBytes > MAX_JOURNAL_ENTRY_BYTES) {
      next = await this.checkpoint(next, payload.patch, false);
      if (!next) return json({ error: "not_found" }, 404);
    } else {
      await this.state.storage.put(patchKey(version), payload.patch);
      await this.state.storage.put("meta", next);
      await this.setNextAlarm(next);
    }
    this.broadcast({
      type: "patch",
      version: next.version,
      expiresAt: next.expiresAt,
      clientId: String(payload.clientId || "").slice(0, 64),
      patch: payload.patch,
    });
    if (patchBytes > MAX_JOURNAL_ENTRY_BYTES) {
      this.broadcast({ type: "checkpoint", version: next.version, savedAt: next.savedAt, expiresAt: next.expiresAt });
    }
    return json({
      version: next.version,
      expiresAt: next.expiresAt,
      savedAt: next.savedAt || 0,
      checkpointPending: !!next.checkpointDueAt,
      conflict: Number(payload.baseVersion || 0) !== Number(meta.version || 0),
    });
  }

  async manualSave(request) {
    const meta = await this.getMeta();
    if (!meta || meta.expiresAt <= Date.now()) return json({ error: "expired" }, 410);
    let payload;
    try { payload = await readJsonWithLimit(request); } catch (response) { return response; }
    if (!payload || !validPlan(payload.plan)) return json({ error: "invalid_plan" }, 400);
    const encoded = JSON.stringify(payload.plan);
    if (encodedSize(encoded) > MAX_PLAN_BYTES) return json({ error: "plan_too_large" }, 413);
    const now = Date.now();
    const entries = await this.listJournal();
    const next = {
      ...meta,
      version: Number(meta.version || 0) + 1,
      updatedAt: now,
      expiresAt: now + RETENTION_MS,
      savedAt: now,
      dirtySince: null,
      checkpointDueAt: null,
    };
    await this.writeSnapshot(payload.plan, next);
    await this.clearJournal(entries);
    await this.state.storage.put("meta", next);
    await this.setNextAlarm(next);
    this.broadcast({
      type: "snapshot",
      version: next.version,
      expiresAt: next.expiresAt,
      savedAt: next.savedAt,
      clientId: String(payload.clientId || "").slice(0, 64),
    });
    return json({ version: next.version, expiresAt: next.expiresAt, savedAt: next.savedAt });
  }

  broadcast(message) {
    const encoded = JSON.stringify(message);
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(encoded); } catch { /* disconnected */ }
    }
  }

  broadcastPresence() {
    const people = this.state.getWebSockets().map((socket) => {
      try { return socket.deserializeAttachment(); } catch { return null; }
    }).filter(Boolean);
    this.broadcast({ type: "presence", people });
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== "string") return;
    try {
      const data = JSON.parse(message);
      if (data.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    } catch { /* ignore malformed client messages */ }
  }

  async webSocketClose(socket) {
    try { socket.close(1000, "closed"); } catch { /* already closed */ }
    this.broadcastPresence();
  }

  async webSocketError(socket) {
    try { socket.close(1011, "error"); } catch { /* already closed */ }
    this.broadcastPresence();
  }

  async expire(meta) {
    await this.env.PLANS.delete(roomKey(meta.roomId));
    await this.state.storage.deleteAll();
    for (const socket of this.state.getWebSockets()) {
      try { socket.close(4001, "room expired"); } catch { /* disconnected */ }
    }
  }

  async alarm() {
    return this.enqueue(async () => {
      const meta = await this.getMeta();
      if (!meta) return;
      const now = Date.now();
      if (meta.expiresAt <= now) {
        await this.expire(meta);
        return;
      }
      if (meta.checkpointDueAt && meta.checkpointDueAt <= now) {
        await this.checkpoint(meta);
        return;
      }
      await this.setNextAlarm(meta);
    });
  }
}

export { applyPatch };
