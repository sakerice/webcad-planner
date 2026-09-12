// 共有編集のルーム（Durable Object）。worker.mjs から中身を1文字も変えずに移した。
//
// 1つのルームに1つのインスタンスが立ち、WebSocket をここで受ける。
// 間取りの実体は R2 に置き、編集は差分(patch)としてストレージに積み、
// 落ち着いたところで R2 へ書き戻す(checkpoint)。
import {
  RETENTION_MS, AUTO_SAVE_IDLE_MS, AUTO_SAVE_MAX_MS,
  MAX_PLAN_BYTES, MAX_JOURNAL_ENTRY_BYTES,
  json, roomKey, patchKey, validPlan, encodedSize, readJsonWithLimit, applyPatch,
} from "./shared.mjs";

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
