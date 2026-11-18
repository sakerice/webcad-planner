// 共同編集のルーム(worker/collab-room.mjs の CollaborationRoom)を Node で動かすための偽物。
// テストではない(ファイル名が *.test.cjs でないので tools/run_tests.sh は走らせない)。
//
// 本物の決まりのうち、ルームの動きに効くものは守る:
//   - Durable Object の storage は、入れた値・出した値を structured clone する
//     (入れたあとに元の物を書き換えても中は変わらない。get で出した物を書き換えても中は変わらない)。
//   - storage.list は鍵の順(文字列の順)に並んだ Map を返す。prefix・start・end・limit・reverse を受ける。
//   - storage.delete は1つなら true/false、配列なら消した数を返す。deleteAll はアラームを消さない。
//   - R2 の get は無ければ null。text()/json() で中身、customMetadata・httpMetadata は写しを返す。
//   - getWebSockets は受け付けたソケットのうち閉じていない物。閉じたソケットへの send は例外。
//
// 使い方:
//   const { makeEnv, connect } = require('./collab-room-fakes.cjs');
//   const env = await makeEnv();                 // env.PLANS(偽の R2)、env.ROOMS(偽の Durable Object の名前空間)
//   const room = env.room(roomId);               // {instance(本物の CollaborationRoom), state, storage}
//   const ws = connect(room, 'client-a');        // 偽の WebSocket。ws.messages() で届いた物を JSON で返す
//   env.ROOMS.created                            // 作られた Durable Object の名前の一覧(id の形が違うときに作らないことを見る)
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

function fakeStorage() {
  const data = new Map();
  let alarm = null;
  const clone = (v) => structuredClone(v);
  const sortedKeys = () => Array.from(data.keys()).sort();
  return {
    data,
    alarmAt: () => alarm,
    async get(key) {
      if (Array.isArray(key)) {
        const out = new Map();
        for (const k of key) if (data.has(k)) out.set(k, clone(data.get(k)));
        return out;
      }
      return data.has(key) ? clone(data.get(key)) : undefined;
    },
    async put(key, value) {
      if (key && typeof key === 'object') {
        for (const k of Object.keys(key)) {
          if (key[k] === undefined) throw new TypeError('undefined は入れられない');
          data.set(k, clone(key[k]));
        }
        return;
      }
      if (value === undefined) throw new TypeError('undefined は入れられない');
      data.set(key, clone(value));
    },
    async delete(key) {
      if (Array.isArray(key)) { let n = 0; for (const k of key) if (data.delete(k)) n++; return n; }
      return data.delete(key);
    },
    async deleteAll() { data.clear(); },
    async list(opts = {}) {
      let keys = sortedKeys();
      if (opts.prefix !== undefined) keys = keys.filter((k) => k.startsWith(opts.prefix));
      if (opts.start !== undefined) keys = keys.filter((k) => k >= opts.start);
      if (opts.end !== undefined) keys = keys.filter((k) => k < opts.end);
      if (opts.reverse) keys.reverse();
      if (opts.limit !== undefined) keys = keys.slice(0, opts.limit);
      const out = new Map();
      for (const k of keys) out.set(k, clone(data.get(k)));
      return out;
    },
    async setAlarm(t) { alarm = t instanceof Date ? t.getTime() : Number(t); },
    async getAlarm() { return alarm; },
    async deleteAlarm() { alarm = null; },
  };
}

function fakeR2() {
  const objects = new Map();
  const decode = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof ArrayBuffer) return new TextDecoder().decode(v);
    if (ArrayBuffer.isView(v)) return new TextDecoder().decode(v);
    throw new TypeError('この偽の R2 は文字と ArrayBuffer だけ受ける');
  };
  return {
    objects,
    puts: [],
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        key,
        size: Buffer.byteLength(o.body),
        customMetadata: { ...o.customMetadata },
        httpMetadata: { ...o.httpMetadata },
        async text() { return o.body; },
        async json() { return JSON.parse(o.body); },
      };
    },
    async put(key, value, opts = {}) {
      const body = decode(value);
      objects.set(key, { body, customMetadata: { ...(opts.customMetadata || {}) }, httpMetadata: { ...(opts.httpMetadata || {}) } });
      this.puts.push(key);
      return { key };
    },
    async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
  };
}

function fakeState() {
  const storage = fakeStorage();
  const sockets = [];
  return {
    storage,
    sockets,
    getWebSockets() { return sockets.filter((s) => !s.closed); },
    acceptWebSocket(ws) { sockets.push(ws); },
  };
}

// 偽の WebSocket を、ルームが受け付けた物として足す(本物の openSocket は WebSocketPair と 101 の返事が要り、Node では作れない)。
function connect(room, clientId, name = 'ゲスト') {
  let attachment = null;
  const ws = {
    sent: [],
    closed: false,
    closeCode: null,
    send(s) { if (ws.closed) throw new Error('closed'); ws.sent.push(s); },
    close(code) { ws.closed = true; ws.closeCode = code; },
    serializeAttachment(v) { attachment = structuredClone(v); },
    deserializeAttachment() { return structuredClone(attachment); },
    messages() { return ws.sent.map((s) => JSON.parse(s)); },
    clear() { ws.sent.length = 0; },
  };
  ws.serializeAttachment({ clientId, name });
  room.state.acceptWebSocket(ws);
  return ws;
}

async function makeEnv() {
  const { CollaborationRoom } = await mod('worker/collab-room.mjs');
  const PLANS = fakeR2();
  const rooms = new Map();
  const env = { PLANS };
  const ROOMS = {
    created: [],
    idFromName(name) { return { name: String(name) }; },
    get(id) {
      const name = id.name;
      if (!rooms.has(name)) {
        ROOMS.created.push(name);
        const state = fakeState();
        rooms.set(name, { state, storage: state.storage, instance: new CollaborationRoom(state, env) });
      }
      const room = rooms.get(name);
      return {
        fetch: (input, init) => room.instance.fetch(input instanceof Request && init === undefined ? input : new Request(input, init)),
      };
    },
  };
  env.ROOMS = ROOMS;
  env.room = (name) => rooms.get(name) || null;
  return env;
}

module.exports = { makeEnv, connect, fakeStorage, fakeR2, fakeState };
