// 共有編集のルーム（Durable Object）。worker.mjs から移した。
//
// 1つのルームに1つのインスタンスが立ち、WebSocket をここで受ける。
// 間取りの実体は R2 に置き、編集は差分(patch)としてストレージに積み、
// 落ち着いたところで R2 へ書き戻す(checkpoint)。
//
// 段5で、外の AI(MCP)から間取りを直すための、ルームの中だけの経路を足した(外の /api/rooms/:id/… には出さない)。
//   POST /op    {op, args}            操作を1つ当て、変わった物を画面の共同編集と同じ差分として積み、全員へ流す(clientId "mcp")
//   POST /read  {what:"summary"|"inspect"}  今のプランの要約か検査
// /op で積んだ差分は、配るときに source:"ai" の印を付ける(印はルームが自分で付ける。画面の /update の差分には付かない)。
// 画面はこの印を見て、外の AI の変更を「元に戻す」で戻せるようにする。印を知らない古い画面は今までどおり相手の差分として当てる。
// 外の AI からの変更を受け付けるかどうか(meta.aiEditsOff。既定は受け付ける)は、画面から POST /ai-edits {off} で切り替える
// (外の /api/rooms/:id/ai-edits。routes-rooms.mjs が転送する)。止めている間の /op は断る(/read は通す)。
// 止めている間は、画面からでない /update・/save も断る(ルームの id を知った外の AI や道具が、/api/rooms/:id/update を
// 素の HTTP で呼んでスイッチを素通りしないように)。スイッチの切り替え(/ai-edits)は、いつでも画面からだけ受ける
// (外から「受け付ける」に戻されないように)。「画面から」は routes-rooms.mjs が Origin を見て付ける印(SCREEN_HEADER)で、
// 画面の共同編集は今までどおり通る。Origin はブラウザの外からなら偽れるので、偽ってまで呼ぶ相手は止まらない
// (見分け方と守れる範囲は worker/room-screen.mjs の冒頭)。
//
// ルームをまたいだ全体の回数の上限(worker/room-quota.mjs)。画面からの書き込み(/update・/save・スイッチの切り替え)は
// 20 回ぶんをまとめて取り、残りを meta.writeLease {day, left} に持つ。外の AI の /op は、積む直前に1回ずつ数える。
// 呼ぶのは worker/routes-rooms.mjs の roomOp・roomRead(id の形を確かめてから Durable Object を引く)。
import {
  RETENTION_MS, AUTO_SAVE_IDLE_MS, AUTO_SAVE_MAX_MS,
  MAX_PLAN_BYTES, MAX_JOURNAL_ENTRY_BYTES,
  json, roomKey, patchKey, validPlan, encodedSize, readJsonWithLimit, applyPatch, PlanSchema,
} from "./shared.mjs";
import PlanCorePatch from "../assets/js/plan-core/patch.js";
import OperationsCatalog from "../assets/js/plan-core/operations-catalog.js";
import { workerApply, workerSummarize, workerInspect, REFUSAL } from "./plan-ctx.mjs";
import { roomPatchProblem, roomPlanProblem, maxSameId, upsertKeyCounts } from "./room-guard.mjs";
import { SCREEN_HEADER } from "./room-screen.mjs";
import {
  ROOM_WRITE_LEASE, takeScreenWriteLease, takeMcpOpAll,
  writeLimitMessage, MCP_OP_LIMIT_ALL_MESSAGE, MCP_OP_BUSY_MESSAGE,
} from "./room-quota.mjs";
import { whoOf } from "./ai-budget.mjs";

// MCP 経由の差分の送り手の名前。画面の clientId は 24 桁の16進(index.html の sharedClientId)なので重ならない。
export const MCP_CLIENT_ID = "mcp";
// /op・/read の本文の上限。操作1つの引数なので小さい。
const MAX_OP_BODY_BYTES = 64 * 1024;

// 外の AI(/op・/read)の回数の上限。誰でも呼べる受け口から、1つのルームへ回し続けられないようにする
// (Durable Object の無料枠は1日の書き込み 10 万行。使い切ると、その日の全ルームの共同編集と AI の機能が止まる)。
// 画面からの経路(/update・/save・GET・WebSocket)には掛けない。
//   /op  … ルームごとに1日(UTC)600 回。成功・失敗を問わず、当てようとした回数。
//          数はメモリと meta(成功して積んだときだけ書く。数のためだけには書かない)の多いほうを使う。
//          メモリが消える(ルームが眠る)と失敗の分は数え直しになるが、それは許す。
//   /read … ルームごとに1分 60 回。メモリだけで数える(書き込みを増やさない)。
//   消す数 … deleteObjects は1回に 20 件まで(MCP_DELETE_PER_CALL)。消えた物(removedIds。removeWall の壁も数える)は
//          ルームごとに1日(UTC)100 件まで(MCP_DELETES_PER_DAY)。数は /op の回数と同じ {day, n, del} に入れ
//          (meta.mcpOps)、当てて積めたときだけ増やす(断った操作では増えない)。
//          画面の操作(/update)には掛けない。画面の正当な使い方では、1度に消すのは選んだ数個〜十数個。
//   範囲 … 動かす・置く・足す・大きさを変える操作(moveObject・placeItem・addRoom・resizeRoom・addWall)で、
//          変わった物が現実の家としてあり得ない値になるものは断る(mcpRangeProblem)。座標は原点から ±200m、
//          部屋の辺は 100mm〜100m(下限は足す・大きさを変えるときだけ見る)、物の大きさは 100m まで。
// これらで守れるのは「1日に消せる数」と「敷地から遠く離れた所へ動かす・桁外れの大きさにする」ことまで。
// 名前の書き換え・設定の変更・範囲の中での移動や大きさの変更は数えていないので、名前の中の指示に乗せられた
// 外の AI が 1日 600 回の操作でプランを大きく作り替えることは、この上限では防げない。
export const MCP_OPS_PER_DAY = 600;
export const MCP_DELETE_PER_CALL = 20;
export const MCP_DELETES_PER_DAY = 100;
// 範囲の値の根拠: 手元の fixtures と既定のプラン(64 件)で、座標の絶対値の最大は約 16.4m(周辺のビル)、
// 物の大きさの最大は 30m(道路)、部屋の辺の最小は 900mm(トイレ)。部屋の辺の下限 100mm は、画面で部屋を描くときの
// 下限(index.html の handleRoomClick は幅・奥行きとも 100mm を超える部屋だけを作る)に合わせた(パイプスペースなどの小さな部屋を弾かない)。
export const MCP_COORD_MAX = 200000;
export const MCP_ROOM_SIDE_MIN = 100;
const ROOM_SIZE_OPS = new Set(["addRoom", "resizeRoom"]);
export const MCP_SIZE_MAX = 100000;
const RANGE_OPS = new Set(["moveObject", "placeItem", "addRoom", "resizeRoom", "addWall"]);

// 範囲の外になった物があれば理由の文(引数を直せば通る失敗として返す)、無ければ null。変わった物(changedIds)だけを見る。
export function mcpRangeProblem(op, result) {
  if (!RANGE_OPS.has(op)) return null;
  const ids = new Set((result.changedIds || []).map(String));
  const plan = result.plan || {};
  const far = (v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) > MCP_COORD_MAX;
  const where = `この受け口からは、座標は原点から ±${MCP_COORD_MAX}mm（200m）の範囲で渡してください`;
  for (const w of plan.walls || []) {
    if (!w || !ids.has(String(w.id))) continue;
    if ([w.x1, w.y1, w.x2, w.y2].some(far)) return `${where}（壁 ${String(w.id).slice(0, 40)}）`;
  }
  for (const r of plan.rooms || []) {
    if (!r || !ids.has(String(r.id))) continue;
    const w = Number(r.w), d = Number(r.d);
    if (far(Number(r.x) + w / 2) || far(Number(r.y) + d / 2)) return `${where}（部屋）`;
    // 大きさは、足す・大きさを変える操作のときだけ見る(画面で作った小さな部屋を動かすだけの操作は断らない)。
    if (ROOM_SIZE_OPS.has(op) && !(w >= MCP_ROOM_SIDE_MIN && d >= MCP_ROOM_SIDE_MIN && w <= MCP_SIZE_MAX && d <= MCP_SIZE_MAX)) {
      return `この受け口からは、部屋の幅と奥行きは ${MCP_ROOM_SIDE_MIN}〜${MCP_SIZE_MAX}mm で渡してください`;
    }
  }
  for (const it of plan.items || []) {
    if (!it || !ids.has(String(it.id))) continue;
    const w = Number(it.w) || 0, d = Number(it.d) || 0;
    if (far(Number(it.x) + w / 2) || far(Number(it.y) + d / 2)) return `${where}（物）`;
    if (w > MCP_SIZE_MAX || d > MCP_SIZE_MAX) return `この受け口からは、物の幅と奥行きは ${MCP_SIZE_MAX}mm までで渡してください`;
  }
  return null;
}
export const MCP_DELETE_LIMIT_MESSAGE = "このプランは、きょう AI から消せる数の上限に達しました。消さない操作はできます。消すのは house-planner の画面で行ってください。";
export const MCP_READS_PER_MINUTE = 60;
export const MCP_OP_LIMIT_MESSAGE = "このプランは、きょう AI から直せる回数の上限に達しました。あすまたお試しいただくか、house-planner の画面で直してください。";
export const MCP_READ_LIMIT_MESSAGE = "このプランを読む回数が多すぎます。少し待ってからもう一度お試しください。";
// 外の AI からの変更を止めているときの /op の失敗の文(mcp.mjs が「止められている」種類として返す)。
export const MCP_AI_EDITS_OFF_MESSAGE = "利用者が外部 AI からの変更を止めています。プランを読むことはできますが、直すことはできません。";
// POST /ai-edits の本文の上限({off:true} だけなので小さい)。
const MAX_AI_EDITS_BODY_BYTES = 1024;
// 外の AI の変更として配る差分の印(broadcast の source)。
export const AI_SOURCE = "ai";
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

// 操作の前(before)と後(after)のプランから、画面の共同編集(index.html の buildSharedPatch)と同じ形の差分を作る。
//   {collections: {walls|items|rooms: {upserts: [物の写し], removes: [id の文字]}}, fields: {欄: 値の写し}}
// - 物は id(文字)ごとに JSON で比べる。新しい物・中身の変わった物を upserts、無くなった物を removes に入れる。
//   upserts の並びは after の並び(新しい物は末尾に足される。applyPatch と operations.js の足し方と同じ)。
// - 欄は PlanCorePatch.SHARED_FIELDS だけを、画面と同じく「無い欄は null」として比べ、変わった欄を入れる。
// - 共有しない欄(SHARED_FIELDS と物の配列以外)が変わったら、差分にせず unshared に名前を返す
//   (画面どうしの共同編集では届かない欄なので、外の AI の操作だけが届けると画面ごとに食い違う)。
// 戻り値: {patch: 差分 | null(何も変わらない), unshared: [欄の名前]}
export function buildRoomPatch(before, after) {
  const patch = { collections: {}, fields: {} };
  let changed = false;
  for (const name of PlanCorePatch.COLLECTIONS) {
    const old = new Map();
    for (const item of (before && before[name]) || []) old.set(String(item && item.id), JSON.stringify(item));
    const now = new Map();
    for (const item of (after && after[name]) || []) now.set(String(item && item.id), item);
    const upserts = [];
    for (const [id, item] of now) {
      const encoded = JSON.stringify(item);
      if (old.get(id) !== encoded) upserts.push(JSON.parse(encoded));
    }
    const removes = Array.from(old.keys()).filter((id) => !now.has(id));
    if (upserts.length || removes.length) {
      patch.collections[name] = { upserts, removes };
      changed = true;
    }
  }
  const sig = (plan, key) => JSON.stringify(plan && plan[key] !== undefined ? plan[key] : null);
  for (const key of PlanCorePatch.SHARED_FIELDS) {
    const encoded = sig(after, key);
    if (sig(before, key) !== encoded) {
      patch.fields[key] = JSON.parse(encoded);
      changed = true;
    }
  }
  const unshared = [];
  const known = new Set([...PlanCorePatch.COLLECTIONS, ...PlanCorePatch.SHARED_FIELDS]);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (known.has(key)) continue;
    if (sig(before, key) !== sig(after, key)) unshared.push(key);
  }
  return { patch: changed ? patch : null, unshared };
}

// 引数の大きさの上限(Worker の計算時間を守るため。checkArgs と操作の前に見る)。
const MAX_ARG_STRING = 500;
const MAX_ARG_ARRAY = 200;
const MAX_ARG_DEPTH = 6;   // args 自身を1段と数える

// 上限を超えていれば理由の文、収まっていれば null。
export function argsTooLarge(args) {
  const walk = (v, depth, where) => {
    if (typeof v === "string") return v.length > MAX_ARG_STRING ? `${where} の文字が長すぎます（${MAX_ARG_STRING} 字まで）` : null;
    if (!v || typeof v !== "object") return null;
    if (depth > MAX_ARG_DEPTH) return `引数の入れ子が深すぎます（${MAX_ARG_DEPTH} 段まで）`;
    if (Array.isArray(v)) {
      if (v.length > MAX_ARG_ARRAY) return `${where} の数が多すぎます（${MAX_ARG_ARRAY} 件まで）`;
      for (let i = 0; i < v.length; i++) { const m = walk(v[i], depth + 1, where); if (m) return m; }
      return null;
    }
    const keys = Object.keys(v);
    if (keys.length > MAX_ARG_ARRAY) return `${where} の項目が多すぎます（${MAX_ARG_ARRAY} 件まで）`;
    for (const k of keys) {
      // JSON.parse は __proto__ を自分の鍵として作る。写すときにプロトタイプを差し替えるので受け付けない。
      if (PlanCorePatch.UNSAFE_KEYS.includes(k)) return `引数に使えない名前の項目があります（${k}）`;
      if (k.length > MAX_ARG_STRING) return `項目の名前が長すぎます（${MAX_ARG_STRING} 字まで）`;
      const m = walk(v[k], depth + 1, depth === 1 ? k : where);
      if (m) return m;
    }
    return null;
  };
  return walk(args, 1, "args");
}

// 検査(workerInspect)の errors が、当てる前より増えたものを返す。
// 文の中の配列の位置([12])は、消す・足すでずれるので比べるときは外す。同じ文の数が増えたぶんだけを「増えた」とする。
export function addedInspectErrors(beforeErrors, afterErrors) {
  const norm = (m) => String(m).replace(/\[\d+\]/g, "[]");
  const count = new Map();
  for (const m of beforeErrors || []) count.set(norm(m), (count.get(norm(m)) || 0) + 1);
  const added = [];
  for (const m of afterErrors || []) {
    const k = norm(m);
    const n = count.get(k) || 0;
    if (n > 0) count.set(k, n - 1);
    else added.push(String(m));
  }
  return added;
}

// 保存されたプランの形が崩れていて、Worker の要約・検査・操作が例外になったときの文。
// (形を確かめる前に積まれた差分や、別の道で置かれたプランのとき。部屋は変えない)
export const BROKEN_PLAN_MESSAGE = "このプランには AI から扱えない形の所があるため、読んだり直したりできませんでした。house-planner の画面で直してください。";

function roomNotFound() {
  return json({ ok: false, code: "room_not_found" }, 404);
}
// 画面からの書き込みが全体の上限に当たったときの返事。
function writeLimited() {
  return json({ error: "write_limit", message: writeLimitMessage() }, 429, { "retry-after": "600" });
}
function opFailure(messages, status = 200) {
  return json({ ok: false, errors: messages.map((m) => (typeof m === "string" ? { message: m } : m)) }, status);
}

export class CollaborationRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
    // 外の AI の回数(メモリの中の数)。/op は {day, n}、/read は {start, n}(1分の窓)。
    this.mcpOps = { day: "", n: 0, del: 0 };
    this.mcpReads = { start: 0, n: 0 };
    // 全体の上限で断った接続元と時刻(メモリ)。断ったあとの1分は、数える先へ聞き直さずに断る。
    this.writeDenied = null;
  }

  // 画面からの書き込みを1回数える(全体の上限。worker/room-quota.mjs)。
  // 戻り値 {ok:true, meta: meta に足す欄 | null} か {ok:false}(上限。何も書かない)。
  async takeScreenWrite(meta, request) {
    if (!this.env || !this.env.AI_QUOTA) return { ok: true, meta: null };
    const now = Date.now();
    const day = utcDay(now);
    const held = meta.writeLease && meta.writeLease.day === day ? Number(meta.writeLease.left) || 0 : 0;
    if (held > 0) return { ok: true, meta: { writeLease: { day, left: held - 1 } } };
    const who = whoOf(request);
    const denied = this.writeDenied;
    if (denied && denied.who === who && denied.day === day && now >= denied.at && now - denied.at < 60 * 1000) return { ok: false };
    const got = await takeScreenWriteLease(this.env, request);
    if (got === "exceeded") {
      this.writeDenied = { who, day, at: now };
      return { ok: false };
    }
    // 数えられなかったときは通す(共同編集を止めない)。残りは持たない
    if (got !== "ok") return { ok: true, meta: null };
    return { ok: true, meta: { writeLease: { day, left: ROOM_WRITE_LEASE - 1 } } };
  }

  // 外の AI からの変更を止めている間、画面からでない書き込みを断る。通すときは null。
  outsideWriteRefusal(request, meta) {
    if (!meta.aiEditsOff || request.headers.get(SCREEN_HEADER) === "1") return null;
    return json({ error: "ai_edits_off", message: MCP_AI_EDITS_OFF_MESSAGE }, 403);
  }

  // /op を1回数える。上限を超えていれば null(数を進めない)。進めた後の {day, n, del} を返す(del はその日に消えた物の数)。
  takeMcpOp(meta) {
    const day = utcDay(Date.now());
    const today = this.mcpOps.day === day;
    const storedToday = meta && meta.mcpOps && meta.mcpOps.day === day;
    const used = Math.max(today ? this.mcpOps.n : 0, storedToday ? Number(meta.mcpOps.n) || 0 : 0);
    const del = Math.max(today ? Number(this.mcpOps.del) || 0 : 0, storedToday ? Number(meta.mcpOps.del) || 0 : 0);
    if (used >= MCP_OPS_PER_DAY) return null;
    this.mcpOps = { day, n: used + 1, del };
    return { ...this.mcpOps };
  }

  // /read を1回数える。上限を超えていれば false。
  takeMcpRead() {
    const now = Date.now();
    if (!(now - this.mcpReads.start < 60 * 1000) || now < this.mcpReads.start) this.mcpReads = { start: now, n: 0 };
    if (this.mcpReads.n >= MCP_READS_PER_MINUTE) return false;
    this.mcpReads.n += 1;
    return true;
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
    let plan;
    try { plan = JSON.parse(await object.text()); } catch { return null; }
    return plan && typeof plan === "object" && !Array.isArray(plan) ? plan : null;
  }

  // 元の全体に、積んだ差分を順に当てる。
  // 形を確かめる前(2026-11)に積まれた壊れた差分があっても、例外で落ちずに読めるようにする。
  // applyPatch は形の合わない部分を飛ばすが、それでも例外が出た差分は飛ばして残りを当てる。
  async materializePlan(meta, extraPatch = null) {
    const plan = await this.readSnapshot(meta);
    if (!plan) return null;
    const entries = await this.listJournal();
    for (const [key, patch] of entries) {
      try { applyPatch(plan, patch); } catch (e) { console.warn("[room] 積んだ差分を当てられないので飛ばす", key, e && e.message); }
    }
    if (extraPatch) applyPatch(plan, extraPatch);
    return { plan, entries };
  }

  // 戻り値は置いた大きさ(UTF-8 のバイト数)。
  async writeSnapshot(plan, meta) {
    const encoded = JSON.stringify(plan);
    const bytes = encodedSize(encoded);
    if (bytes > MAX_PLAN_BYTES) throw new Error("plan_too_large");
    await this.env.PLANS.put(roomKey(meta.roomId), encoded, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        updatedAt: String(meta.updatedAt),
        expiresAt: String(meta.expiresAt),
        version: String(meta.version),
      },
    });
    return bytes;
  }

  // materialized(省略可)は、呼ぶ側が materializePlan(meta, extraPatch) で作った物(作り直さないため)。
  // 書き戻したあとの meta に、R2 の本体の大きさ(planBytes)を入れ、積んだ差分の大きさ(journalBytes)を 0 に戻す。
  async checkpoint(meta, extraPatch = null, broadcast = true, materialized = null) {
    if (!materialized) materialized = await this.materializePlan(meta, extraPatch);
    if (!materialized) return null;
    const savedAt = Date.now();
    const next = { ...meta, savedAt, dirtySince: null, checkpointDueAt: null, journalBytes: 0, sameIdMax: maxSameId(materialized.plan) };
    next.planBytes = await this.writeSnapshot(materialized.plan, next);
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
    if (url.pathname === "/ai-edits" && request.method === "POST") return this.enqueue(() => this.setAiEdits(request));
    // ここから下はルームの中だけの経路(routes-rooms.mjs の転送の一覧には無い。roomOp・roomRead が直接呼ぶ)
    if (url.pathname === "/op" && request.method === "POST") return this.enqueue(() => this.applyOp(request));
    if (url.pathname === "/read" && request.method === "POST") return this.enqueue(() => this.read(request));
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
      aiEditsOff: !!meta.aiEditsOff,
    }));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  // 大きさの見積もりに使う3つの数。meta に無い数(この欄を足す前に作った部屋)は、ここで1回だけ数え、
  // learned に入れて返す(呼ぶ側が差分を積むときに meta へ書く。断るときは書かない)。
  //   planBytes  … R2 の本体の大きさ(無ければ R2 の物の大きさ)
  //   journalBytes … 積んである差分の大きさの合計(無ければ積んである差分を読んで数える)
  //   sameIdMax  … 本体の中で同じ id の物が並ぶ数の最大(無ければ本体を読んで数える)。積んだ差分では増えない
  //               (差分の当て方は、新しい id の物を1つ足すか、ある物を置き換えるか消すだけ)
  async roomSizes(meta) {
    const learned = {};
    const finite = (v) => Number.isFinite(Number(v)) && v !== null && v !== "" && Number(v) >= 0;
    let planBytes = finite(meta.planBytes) ? Number(meta.planBytes) : null;
    let sameIdMax = finite(meta.sameIdMax) ? Number(meta.sameIdMax) : null;
    if (planBytes === null || sameIdMax === null) {
      const object = await this.env.PLANS.get(roomKey(meta.roomId));
      if (!object) return null;
      if (planBytes === null) planBytes = learned.planBytes = Number.isFinite(Number(object.size)) ? Number(object.size) : encodedSize(await object.text());
      if (sameIdMax === null) {
        let plan = null;
        try { plan = JSON.parse(await object.text()); } catch { plan = null; }
        sameIdMax = learned.sameIdMax = maxSameId(plan);
      }
    }
    let journalBytes = finite(meta.journalBytes) ? Number(meta.journalBytes) : null;
    if (journalBytes === null) {
      journalBytes = 0;
      for (const patch of (await this.listJournal()).values()) journalBytes += encodedSize(patch === undefined ? null : patch);
      learned.journalBytes = journalBytes;
    }
    return { planBytes, journalBytes, sameIdMax, learned };
  }

  // 本体(R2)に、積んである差分とこの差分を当てたあとの大きさの上界。プランを作らずに数える(本体の JSON を読むだけ)。
  // 鍵ごとの物の数は本体から数え(room-guard.mjs の upsertKeyCounts。当て方と同じ PlanCorePatch.upsertKey)、
  // 差分ごとの増え方は PlanCorePatch.patchGrowthBound(当て方と同じ取り出し方)で数える。
  async growthBound(meta, patch) {
    const object = await this.env.PLANS.get(roomKey(meta.roomId));
    if (!object) return null;
    const text = await object.text();
    let plan = null;
    try { plan = JSON.parse(text); } catch { return null; }
    const counts = upsertKeyCounts(plan);
    const countOf = (name, key) => counts[name].get(key) || 0;
    const sizeOf = (v) => encodedSize(JSON.stringify(v === undefined ? null : v));
    let total = encodedSize(text);
    for (const entry of (await this.listJournal()).values()) total += PlanCorePatch.patchGrowthBound(entry, countOf, sizeOf);
    return total + PlanCorePatch.patchGrowthBound(patch, countOf, sizeOf);
  }

  // 差分を1つ積んで全員へ流す。/update(画面)と /op(外の AI)が共用する。
  // 版を1つ進め、期限を延ばし、書き戻しを予約する。差分が大きいときは積まずにその場で R2 へ書き戻す。
  // 戻り値は進めたあとの meta。書き戻しで元の全体が R2 に無かったときは null(何も流さない)。
  // 当てたあとのプランが保存の上限(MAX_PLAN_BYTES)を超えるときは、何も変えずに {tooLarge: true} を返す
  // (受けてしまうと書き戻しが毎回失敗し、積んだ差分が増え続けて部屋が開けなくなるため)。
  // 当てたあとの大きさの上の見積もり(bound)は 本体 + (積んだ差分の合計 + この差分) × 同じ id の物の数の最大。
  // 差分は物と欄を置き換えるだけだが、同じ id の物が k 個あると、upsert の物が k 個に写るため。
  // bound が上限以下なら積む。上限の2倍を超えるなら当てずに断る(膨らんだプランをメモリに作らないため)。
  // その間なら実際に当てて測り、収まればその場で書き戻す。
  // extraMeta(省略可)は meta に足して一緒に保存する欄(/op の nextId)。
  // source(省略可)は配る差分に付ける印(/op だけが AI_SOURCE を渡す。/update は渡さないので、画面が名乗っても付かない)。
  async commitPatch(meta, patch, clientId, extraMeta = null, source = null) {
    const now = Date.now();
    const version = Number(meta.version || 0) + 1;
    const dirtySince = Number(meta.dirtySince || now);
    let next = {
      ...meta,
      ...(extraMeta || {}),
      version,
      updatedAt: now,
      expiresAt: now + RETENTION_MS,
      dirtySince,
      checkpointDueAt: Math.min(now + AUTO_SAVE_IDLE_MS, dirtySince + AUTO_SAVE_MAX_MS),
    };
    const encoded = JSON.stringify(patch);
    const patchBytes = encodedSize(encoded);
    // Durable Object の保存は値を V8 の形式で書き、日本語を含む文字は1字2バイトになる。積むかどうかは大きいほうで決める。
    const storedBytes = Math.max(patchBytes, encoded.length * 2);
    const sizes = await this.roomSizes(meta);
    if (!sizes) return null;
    Object.assign(next, sizes.learned);
    // 1段目: 安い見積もり。差分の大きさに、同じ鍵の物の数の最大を掛ける
    let bound = sizes.planBytes + (sizes.journalBytes + patchBytes) * Math.max(1, sizes.sameIdMax);
    // 2段目: 1段目が上限を超えたら、当て方と同じ規則(PlanCorePatch.patchGrowthBound)で、本体の鍵ごとの数から上界を数え直す
    if (bound > MAX_PLAN_BYTES) {
      const exact = await this.growthBound(meta, patch);
      if (exact === null) return null;
      bound = Math.min(bound, exact);
    }
    if (bound > 2 * MAX_PLAN_BYTES) return { tooLarge: true };
    let writeNow = storedBytes > MAX_JOURNAL_ENTRY_BYTES;
    let materialized = null;
    if (bound > MAX_PLAN_BYTES) {
      materialized = await this.materializePlan(meta, patch);
      if (!materialized) return null;
      if (encodedSize(JSON.stringify(materialized.plan)) > MAX_PLAN_BYTES) return { tooLarge: true };
      writeNow = true;
    }
    if (writeNow) {
      next = await this.checkpoint(next, patch, false, materialized);
      if (!next) return null;
    } else {
      next.journalBytes = sizes.journalBytes + patchBytes;
      await this.state.storage.put(patchKey(version), patch);
      await this.state.storage.put("meta", next);
      await this.setNextAlarm(next);
    }
    const message = {
      type: "patch",
      version: next.version,
      expiresAt: next.expiresAt,
      clientId: String(clientId || "").slice(0, 64),
      patch,
    };
    if (source) message.source = source;
    this.broadcast(message);
    if (writeNow) {
      this.broadcast({ type: "checkpoint", version: next.version, savedAt: next.savedAt, expiresAt: next.expiresAt });
    }
    return next;
  }

  async update(request) {
    const meta = await this.getMeta();
    if (!meta || meta.expiresAt <= Date.now()) return json({ error: "expired" }, 410);
    const refusal = this.outsideWriteRefusal(request, meta);
    if (refusal) return refusal;
    let payload;
    try { payload = await readJsonWithLimit(request); } catch (response) { return response; }
    if (!payload || payload.type !== "patch" || !payload.patch) return json({ error: "invalid_patch" }, 400);
    // 形を確かめてから積む(壊れた差分を1回受けると、ルームのプランが開けなくなる・相手の画面が壊れるため)
    const problem = roomPatchProblem(payload.patch);
    if (problem) return json({ error: "invalid_patch", reason: problem }, 400);
    const lease = await this.takeScreenWrite(meta, request);
    if (!lease.ok) return writeLimited();
    const next = await this.commitPatch(meta, payload.patch, payload.clientId, lease.meta);
    if (!next) return json({ error: "not_found" }, 404);
    if (next.tooLarge) return json({ error: "plan_too_large" }, 413);
    return json({
      version: next.version,
      expiresAt: next.expiresAt,
      savedAt: next.savedAt || 0,
      checkpointPending: !!next.checkpointDueAt,
      conflict: Number(payload.baseVersion || 0) !== Number(meta.version || 0),
    });
  }

  // /op と /read の入口で、ルームがあるか・期限内かを見る。期限切れは取得(getPlan)と同じく片付ける。
  async liveMeta() {
    const meta = await this.getMeta();
    if (!meta) return null;
    if (meta.expiresAt <= Date.now()) {
      await this.expire(meta);
      return null;
    }
    return meta;
  }

  // POST /op {op, args}: 操作を1つ当てる。
  // 成功 {ok:true, version, changedIds, removedIds, warnings}。何も変わらなかったときは版を進めず、積まず、流さない。
  // 失敗 {ok:false, errors:[{message, candidates?}]}(ルームは1項目も変えない)。ルームが無い・期限切れ {ok:false, code:"room_not_found"}。
  async applyOp(request) {
    const meta = await this.liveMeta();
    if (!meta) return roomNotFound();
    // 利用者が外の AI からの変更を止めている。回数は数えない(止めている間に呼ばれても、あとの上限を減らさない)
    if (meta.aiEditsOff) return json({ ok: false, code: "ai_edits_off", errors: [{ message: MCP_AI_EDITS_OFF_MESSAGE }] }, 403);
    const counted = this.takeMcpOp(meta);
    if (!counted) return json({ ok: false, code: "op_limit", errors: [{ message: MCP_OP_LIMIT_MESSAGE }] }, 429);
    let payload;
    try { payload = await readJsonWithLimit(request, MAX_OP_BODY_BYTES); } catch {
      return opFailure(["操作を読み取れませんでした（{op, args} の JSON を 64KB までで送ってください）"], 400);
    }
    if (!payload || typeof payload !== "object" || typeof payload.op !== "string") {
      return opFailure(["操作を読み取れませんでした（{op, args} の形で送ってください）"], 400);
    }
    const op = payload.op;
    const args = payload.args === undefined ? {} : payload.args;
    const tooLarge = argsTooLarge(args);
    if (tooLarge) return opFailure([tooLarge]);
    const checked = OperationsCatalog.checkArgs(op, args);
    if (!checked.ok) return opFailure(checked.errors);
    if (op === "deleteObjects" && Array.isArray(args.ids) && args.ids.length > MCP_DELETE_PER_CALL) {
      return opFailure([`この受け口から1回に消せるのは ${MCP_DELETE_PER_CALL} 件までです（${args.ids.length} 件が来ました）。分けて呼んでください`]);
    }
    const materialized = await this.materializePlan(meta);
    if (!materialized) return roomNotFound();
    const before = materialized.plan;
    // 床材を floorMaterial の1つの欄に寄せてから当てる(画面が開くときと同じ PlanSchema.normalizeFloorMaterials)。
    // 古い形(部屋の texture に床材のキー)のままだと、床材を読む・書く操作の結果が画面と食い違う。
    // before は materializePlan がその都度作る写しなので、ここで直してよい。差分(buildRoomPatch)は直した後の
    // before と比べるので、寄せただけの部屋は差分に入らない(画面も開くときに同じに寄せている)。
    PlanSchema.normalizeFloorMaterials(before);
    // 新しい物の id は、ルームの減らない連番(meta.nextId)とプランの最大 + 1 の大きいほうから数える
    // (消した物の id を使い回すと、画面に残っている選択・取り消しの履歴・送る印が別の物を指すため)。
    let result;
    try { result = workerApply(before, [{ op, args }], { firstId: Number(meta.nextId) || 0 }); } catch (e) {
      console.warn("[room] /op で例外", e && e.message);
      return opFailure([BROKEN_PLAN_MESSAGE]);
    }
    if (result.errors.length) {
      return opFailure(result.errors.map((e) => (e.candidates ? { message: e.message, candidates: e.candidates } : { message: e.message })));
    }
    // 消す数の1日の上限。消えた物の数で数える(removeWall の壁、deleteObjects の物・壁・部屋)。
    // 数を増やすのは、下の検査をすべて通って積めたときだけ(断った操作では増やさない)。
    const removedCount = Array.isArray(result.removedIds) ? result.removedIds.length : 0;
    if (removedCount && counted.del + removedCount > MCP_DELETES_PER_DAY) {
      return json({ ok: false, code: "delete_limit", errors: [{ message: MCP_DELETE_LIMIT_MESSAGE }] }, 429);
    }
    const { patch, unshared } = buildRoomPatch(before, result.plan);
    if (unshared.length) {
      // 今の操作はどれも共有する欄だけを書く。ここに来たら操作の側が変わったということなので、届けずに断る。
      return opFailure([REFUSAL + "(この操作は、共同編集で相手に届かない設定を変えます)"]);
    }
    if (patch) {
      // 積む前に検査する。もとから誤りのあるプランも直せるよう、誤りが増えたときだけ断る。
      let added;
      try { added = addedInspectErrors(workerInspect(before).errors, workerInspect(result.plan).errors); } catch (e) {
        console.warn("[room] /op の検査で例外", e && e.message);
        return opFailure([BROKEN_PLAN_MESSAGE]);
      }
      if (added.length) {
        return opFailure([{ message: "この操作をすると間取りのデータが正しくなくなるため、行いませんでした（" + added.slice(0, 5).join(" / ") + "）" }]);
      }
    }
    // 現実の家としてあり得ない座標・大きさは断る(外の AI からだけ。データの形の検査の後に見る)。
    const range = mcpRangeProblem(op, result);
    if (range) return opFailure([range]);
    const out = (version) => json({
      ok: true,
      version,
      changedIds: result.changedIds,
      removedIds: result.removedIds,
      warnings: result.warnings,
    });
    if (!patch) return out(Number(meta.version || 0));
    // 画面の差分と同じ検査を通す(積まれる差分はすべて検査を通った、と言えるようにする)。
    // 検査の前に作られた部屋で、プランに使えない名前などが残っているときにここで断られる。
    if (roomPatchProblem(patch)) return opFailure([BROKEN_PLAN_MESSAGE]);
    const nextId = Math.max(Number(meta.nextId) || 0, Number(result.nextId) || 0);
    const mcpOps = { ...counted, del: counted.del + removedCount };
    // ルームをまたいだ全体の数(積む直前に数える。引数の誤りや何も変わらない操作は数えない)
    const all = await takeMcpOpAll(this.env);
    if (all === "exceeded") return json({ ok: false, code: "op_limit_all", errors: [{ message: MCP_OP_LIMIT_ALL_MESSAGE }] }, 429);
    if (all === "unavailable") return json({ ok: false, code: "op_busy", errors: [{ message: MCP_OP_BUSY_MESSAGE }] }, 503);
    const next = await this.commitPatch(meta, patch, MCP_CLIENT_ID, { nextId, mcpOps }, AI_SOURCE);
    if (!next) return roomNotFound();
    if (next.tooLarge) return opFailure(["この操作をするとプランが保存できる大きさ（10MB）を超えるため、行いませんでした"]);
    if (this.mcpOps.day === mcpOps.day) this.mcpOps = { ...this.mcpOps, del: Math.max(Number(this.mcpOps.del) || 0, mcpOps.del) };
    return out(next.version);
  }

  // POST /read {what}: "summary" → {ok:true, version, summary}、"inspect" → {ok:true, version, inspect:{ok, errors, warnings}}。
  async read(request) {
    const meta = await this.liveMeta();
    if (!meta) return roomNotFound();
    if (!this.takeMcpRead()) return json({ ok: false, code: "read_limit", errors: [{ message: MCP_READ_LIMIT_MESSAGE }] }, 429);
    let payload;
    try { payload = await readJsonWithLimit(request, MAX_OP_BODY_BYTES); } catch { payload = null; }
    const what = payload && payload.what;
    if (what !== "summary" && what !== "inspect") {
      return opFailure(["what は summary か inspect で渡してください"], 400);
    }
    const materialized = await this.materializePlan(meta);
    if (!materialized) return roomNotFound();
    const version = Number(meta.version || 0);
    try {
      if (what === "summary") return json({ ok: true, version, summary: workerSummarize(materialized.plan) });
      return json({ ok: true, version, inspect: workerInspect(materialized.plan) });
    } catch (e) {
      console.warn("[room] /read で例外", e && e.message);
      return opFailure([BROKEN_PLAN_MESSAGE]);
    }
  }

  // POST /ai-edits {off: true|false}: 外の AI からの変更を止める・受け付ける。meta.aiEditsOff に持ち、全員へ配る。
  // 版・期限・書き戻しの予約は変えない(プランは変わらない)。同じ値なら書かずにそのまま返す。
  // 返事 {aiEditsOff}。本文が読めない・形が違う 400、大きすぎ 413、ルームが無い・期限切れ 410、画面からでない 403。
  async setAiEdits(request) {
    const meta = await this.getMeta();
    if (!meta || meta.expiresAt <= Date.now()) return json({ error: "expired" }, 410);
    // 切り替えは画面からだけ受ける(止めたスイッチを、ルームの id を知った外の道具に戻されないように)
    if (request.headers.get(SCREEN_HEADER) !== "1") return json({ error: "forbidden" }, 403);
    let payload;
    try { payload = await readJsonWithLimit(request, MAX_AI_EDITS_BODY_BYTES); } catch (response) { return response; }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.off !== "boolean") {
      return json({ error: "invalid_request" }, 400);
    }
    const off = payload.off;
    if (!!meta.aiEditsOff !== off) {
      const lease = await this.takeScreenWrite(meta, request);
      if (!lease.ok) return writeLimited();
      await this.state.storage.put("meta", { ...meta, ...(lease.meta || {}), aiEditsOff: off });
      // 誰が切り替えたかは配らない(本文の clientId は名乗るだけの値で、他人を名乗れるため。画面は自分が押したかを手元で持つ)
      this.broadcast({ type: "ai-edits", off });
    }
    return json({ aiEditsOff: off });
  }

  async manualSave(request) {
    const meta = await this.getMeta();
    if (!meta || meta.expiresAt <= Date.now()) return json({ error: "expired" }, 410);
    const refusal = this.outsideWriteRefusal(request, meta);
    if (refusal) return refusal;
    let payload;
    try { payload = await readJsonWithLimit(request); } catch (response) { return response; }
    if (!payload || !validPlan(payload.plan)) return json({ error: "invalid_plan" }, 400);
    const problem = roomPlanProblem(payload.plan);
    if (problem) return json({ error: "invalid_plan", reason: problem }, 400);
    const encoded = JSON.stringify(payload.plan);
    if (encodedSize(encoded) > MAX_PLAN_BYTES) return json({ error: "plan_too_large" }, 413);
    const lease = await this.takeScreenWrite(meta, request);
    if (!lease.ok) return writeLimited();
    const now = Date.now();
    const entries = await this.listJournal();
    const next = {
      ...meta,
      ...(lease.meta || {}),
      version: Number(meta.version || 0) + 1,
      updatedAt: now,
      expiresAt: now + RETENTION_MS,
      savedAt: now,
      dirtySince: null,
      checkpointDueAt: null,
      journalBytes: 0,
      sameIdMax: maxSameId(payload.plan),
    };
    next.planBytes = await this.writeSnapshot(payload.plan, next);
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
